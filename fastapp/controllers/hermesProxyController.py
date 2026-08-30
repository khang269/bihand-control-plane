import logging
import asyncio
import httpx
from fastapi import APIRouter, Request, Query, HTTPException
from fastapi.responses import StreamingResponse, JSONResponse
from fastapp.models.instanceModel import InstanceModel
from fastapp.utils.jwtUtils import decodeJwtToken

logger = logging.getLogger(__name__)

hermesRouter = APIRouter()

async def get_instance_for_proxy(instance_id: str, token: str):
    if not token:
        raise HTTPException(status_code=401, detail="Authentication required")
    
    payload = decodeJwtToken(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")
        
    email = payload.get("email")
    instance = InstanceModel._getByIdWithKeys(instance_id)
    if not instance:
        raise HTTPException(status_code=404, detail="Instance not found")
        
    if instance.get("userId") != email:
        raise HTTPException(status_code=403, detail="Access denied")
        
    if instance.get("status") != "running":
        raise HTTPException(status_code=400, detail="Instance not running")

    external_ip = instance.get("externalIp")
    if not external_ip:
        raise HTTPException(status_code=400, detail="Instance lacks external IP")
        
    return instance, external_ip

@hermesRouter.api_route("/proxy/hermes/{instance_id}/v1/{path:path}", methods=["GET", "POST", "PUT", "DELETE"])
async def proxy_hermes_api(instance_id: str, path: str, request: Request, token: str = Query(default="")):
    """
    Proxy HTTP requests (including SSE) to Hermes Agent via its Nginx gateway.
    """
    instance, external_ip = await get_instance_for_proxy(instance_id, token)
    dashboard_token = instance.get("dashboardToken", "")
    
    target_url = f"https://{external_ip}/v1/{path}"
    
    headers = {
        "Authorization": f"Bearer {dashboard_token}",
    }
    
    # Forward the query params except token
    query_params = dict(request.query_params)
    query_params.pop("token", None)
    
    client = httpx.AsyncClient(verify=False, timeout=120.0)
    
    method = request.method
    body = await request.body() if method in ["POST", "PUT", "PATCH"] else None
    
    if request.headers.get("Content-Type"):
        headers["Content-Type"] = request.headers.get("Content-Type")

    try:
        req = client.build_request(
            method=method,
            url=target_url,
            params=query_params,
            headers=headers,
            content=body
        )
        
        # Check if it's likely an SSE stream (e.g. /events)
        if path.endswith("/events") or "stream" in path:
            async def stream_generator():
                try:
                    async with client.stream(method, target_url, params=query_params, headers=headers, content=body) as response:
                        if response.status_code != 200:
                            yield await response.aread()
                            return
                        async for chunk in response.aiter_raw():
                            yield chunk
                except Exception as e:
                    logger.error(f"Hermes SSE proxy error: {e}")
                finally:
                    await client.aclose()
                    
            return StreamingResponse(
                stream_generator(),
                media_type="text/event-stream"
            )
        else:
            response = await client.send(req)
            await client.aclose()
            return JSONResponse(
                content=response.json() if response.content else {},
                status_code=response.status_code
            )
            
    except Exception as e:
        logger.error(f"Hermes proxy error: {e}")
        await client.aclose()
        raise HTTPException(status_code=502, detail=f"Failed to connect to Hermes Agent: {str(e)}")
