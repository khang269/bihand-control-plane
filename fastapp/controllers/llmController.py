import logging
import os
import httpx
import asyncio
import uuid
import json
from fastapi import APIRouter, Header, HTTPException, Request, status
from fastapi.responses import StreamingResponse, JSONResponse
from typing import Optional, Dict, Any

from fastapp.utils.bihandKey import verify_bihand_api_key
from fastapp.database import get_db

logger = logging.getLogger(__name__)

def get_real_client_ip(request: Request) -> Optional[str]:
    xff = request.headers.get("x-forwarded-for")
    if xff:
        parts = [p.strip() for p in xff.split(",")]
        if parts:
            return parts[0]
    real_ip = request.headers.get("x-real-ip")
    if real_ip:
        return real_ip.strip()
    return request.client.host if request.client else None

llmRouter = APIRouter(tags=["Bihand Custom LLM Proxy Endpoint"])

# --- Helper function for tracking fine-grained task & run cost allocation ---
async def record_inference_spend(db, instance, cost_usd, credits_deducted, input_tokens, output_tokens):
    try:
        # 1. Increment API credits used specifically on this instance document!
        await asyncio.to_thread(
            db["instances"].update_one,
            {"_id": instance["_id"]},
            {"$inc": {"apiCreditsUsed": credits_deducted}}
        )
        if instance.get("fleetId"):
            await asyncio.to_thread(
                db["fleets"].update_one,
                {"_id": instance["fleetId"]},
                {"$inc": {"apiCreditsUsed": credits_deducted}}
            )
            
        # 2. Increment spend specifically on active run and task documents for fine-grained task-level display
        active_run = await asyncio.to_thread(
            db["runs"].find_one,
            {"instanceId": str(instance["_id"]), "status": "running"}
        )
        if active_run:
            await asyncio.to_thread(
                db["runs"].update_one,
                {"_id": active_run["_id"]},
                {"$inc": {
                    "inputTokens": input_tokens,
                    "outputTokens": output_tokens,
                    "costUsd": cost_usd
                }}
            )
            await asyncio.to_thread(
                db["tasks"].update_one,
                {"_id": active_run["taskId"]},
                {"$inc": {
                    "apiCreditsUsed": credits_deducted
                }}
            )
    except Exception as m2m_e:
        logger.error(f"Failed to record fine-grained inference spend: {m2m_e}")


@llmRouter.post("/v1/chat/completions")
async def bihand_chat_completions(request: Request, authorization: Optional[str] = Header(None)):
    """
    OpenAI-compatible chat completions proxy endpoint.
    Verifies Bihand API key, counts tokens, deducts credits, and forwards to centralized LiteLLM proxy instance.
    """
    # Print raw request details immediately to sys.stderr for debugging
    import sys
    try:
        raw_body = await request.body()
        sys.stderr.write(f"=== Incoming LLM Request ===\n")
        sys.stderr.write(f"Authorization: {authorization}\n")
        sys.stderr.write(f"Headers: {dict(request.headers)}\n")
        sys.stderr.write(f"Body: {raw_body.decode('utf-8', errors='ignore')}\n")
        sys.stderr.write(f"============================\n")
        sys.stderr.flush()
    except Exception as d_e:
        sys.stderr.write(f"Debugging request capture failed: {d_e}\n")
        sys.stderr.flush()

    # 1. Extract and verify Bihand API key
    api_key = None
    if authorization and authorization.startswith("Bearer "):
        api_key = authorization.split(" ")[1]
    
    if not api_key:
        # Check query params or headers as fallbacks
        api_key = request.query_params.get("api_key")
        
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Bihand API Key is required. Please pass it as 'Bearer bh_...' in the Authorization header."
        )
        
    email = verify_bihand_api_key(api_key)
    if not email:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or signatures-mismatched Bihand API Key."
        )
        
    # Check user credits
    db = get_db()
    user = await asyncio.to_thread(db["users"].find_one, {"email": email})
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Associated user not found in the Bihand database."
        )
        
    if user.get("credits", 0) <= 0:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail="Your Bihand credits have been depleted. Please purchase more credits from the Billing dashboard."
        )

    # 2. Parse request body
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body.")

    # Force model mapping to Gemini-3.5-flash
    body["model"] = "gemini-3.5-flash"
    
    # Calculate estimated input tokens for fallback billing verification before starting the inference
    prompt_text = ""
    for msg in body.get("messages", []):
        prompt_text += msg.get("content", "") or ""
    input_tokens_estimate = len(prompt_text) // 4 if prompt_text else 1
    if input_tokens_estimate == 0:
        input_tokens_estimate = 1

    litellm_api_key = os.environ.get("LITELLM_API_KEY", "sk-1234")
    if not litellm_api_key:
        raise HTTPException(
            status_code=500,
            detail="Bihand Server is missing LITELLM_API_KEY configuration for inference proxying."
        )

    stream = body.get("stream", False)
    
    # Prepare forwarding to Local Central LiteLLM proxy instance
    litellm_proxy_url = os.environ.get("LITELLM_PROXY_URL", "http://127.0.0.1:1234")
    gemini_openai_url = f"{litellm_proxy_url.rstrip('/')}/v1/chat/completions"

    if stream:
        # Implement Streaming Response Proxy
        async def stream_generator():
            total_completion_text = ""
            async with httpx.AsyncClient(timeout=120.0) as client:
                try:
                    async with client.stream(
                        "POST",
                        gemini_openai_url,
                        json=body,
                        headers={"Authorization": f"Bearer {litellm_api_key}"}
                    ) as response:
                        if response.status_code >= 400:
                            err_body = await response.aread()
                            import sys
                            sys.stderr.write(f"Gemini API returned error code {response.status_code}: {err_body.decode('utf-8', errors='ignore')}\n")
                            sys.stderr.write(f"Request Body: {body}\n")
                            sys.stderr.flush()
                            logger.error(f"Gemini API returned error code {response.status_code}: {err_body}")
                            yield f"data: {{\"error\": {{\"message\": \"Gemini proxy failure: {err_body.decode('utf-8', errors='ignore')}\"}}}} \n\n".encode()
                            return

                        async for chunk in response.aiter_bytes():
                            yield chunk
                            try:
                                text_chunk = chunk.decode("utf-8", errors="ignore")
                                for line in text_chunk.split("\n"):
                                    if line.startswith("data:") and "[DONE]" not in line:
                                        import json
                                        data_json = json.loads(line[5:].strip())
                                        choices = data_json.get("choices", [])
                                        if choices:
                                            delta = choices[0].get("delta", {})
                                            content = delta.get("content", "")
                                            if content:
                                                total_completion_text += content
                            except Exception as parse_e:
                                import sys
                                sys.stderr.write(f"Error parsing streaming chunk in chat completions: {parse_e}\n")
                                sys.stderr.flush()
                except Exception as stream_err:
                    logger.error(f"Stream connection error to Gemini: {stream_err}")
                    yield f"data: {{\"error\": {{\"message\": \"Gemini proxy connection error: {str(stream_err)}\"}}}} \n\n".encode()
                    return

            # Perform post-stream credit calculation and deduction (Gemini 3.5 Flash: $1.50 / 1M input, $9.00 / 1M output tokens)
            output_tokens_estimate = len(total_completion_text) // 4 if total_completion_text else 0
            if output_tokens_estimate == 0 and len(total_completion_text) > 0:
                output_tokens_estimate = 1

            cost_usd = (input_tokens_estimate * 0.0000015) + (output_tokens_estimate * 0.000009)
            credits_deducted = cost_usd * 100

            try:
                await asyncio.to_thread(
                    db["users"].update_one,
                    {"email": email},
                    {"$inc": {"credits": -credits_deducted}}
                )
                logger.info(f"Deducted {credits_deducted:.4f} credits from {email} for streaming Bihand LLM proxy.")
                
                # Report LLM spend inside M2M controller format to allow immediate Budget/Spend updates inside the fleet Dashboard!
                try:
                    # Look up active instance, preferring the client IP if matched, otherwise fallback to any running instance
                    client_ip = get_real_client_ip(request)
                    instance = None
                    if client_ip:
                        instance = await asyncio.to_thread(
                            db["instances"].find_one,
                            {"userId": email, "status": "running", "$or": [{"externalIp": client_ip}, {"ip": client_ip}]}
                        )
                    if not instance:
                        instance = await asyncio.to_thread(
                            db["instances"].find_one,
                            {"userId": email, "status": "running"}
                        )
                        
                    if instance:
                        # Report to the unified tracker helper
                        output_tokens_val = output_tokens_estimate
                        await record_inference_spend(db, instance, cost_usd, credits_deducted, input_tokens_estimate, output_tokens_val)
                except Exception as m2m_e:
                    logger.error(f"Failed to auto-increment fleet apiSpend or instance apiCreditsUsed: {m2m_e}")
            except Exception as e:
                logger.error(f"Failed to deduct streaming credits for {email}: {e}")

        return StreamingResponse(stream_generator(), media_type="text/event-stream")

    else:
        # Implement Non-Streaming Response Proxy
        async with httpx.AsyncClient(timeout=120.0) as client:
            try:
                response = await client.post(
                    gemini_openai_url,
                    json=body,
                    headers={"Authorization": f"Bearer {litellm_api_key}"}
                )
                if response.status_code >= 400:
                    import sys
                    sys.stderr.write(f"Gemini API returned error code {response.status_code}: {response.text}\n")
                    sys.stderr.write(f"Request Body: {body}\n")
                    sys.stderr.flush()
                    return JSONResponse(
                        status_code=response.status_code,
                        content={"error": {"message": f"Gemini proxy failure: {response.text}"}}
                    )

                resp_json = response.json()
                usage = resp_json.get("usage", {})
                input_tokens = usage.get("prompt_tokens", input_tokens_estimate)
                output_tokens = usage.get("completion_tokens", 0)

                # Gemini 3.5 Flash pricing: $1.50 / 1M input, $9.00 / 1M output tokens
                cost_usd = (input_tokens * 0.0000015) + (output_tokens * 0.000009)
                credits_deducted = cost_usd * 100

                await asyncio.to_thread(
                    db["users"].update_one,
                    {"email": email},
                    {"$inc": {"credits": -credits_deducted}}
                )
                logger.info(f"Deducted {credits_deducted:.4f} credits from {email} for Bihand LLM proxy request.")
                
                # Report LLM spend inside M2M controller format to allow immediate Budget/Spend updates inside the fleet Dashboard!
                try:
                    client_ip = get_real_client_ip(request)
                    instance = None
                    if client_ip:
                        instance = await asyncio.to_thread(
                            db["instances"].find_one,
                            {"userId": email, "status": "running", "$or": [{"externalIp": client_ip}, {"ip": client_ip}]}
                        )
                    if not instance:
                        instance = await asyncio.to_thread(
                            db["instances"].find_one,
                            {"userId": email, "status": "running"}
                        )
                        
                    if instance:
                        # Report to the unified tracker helper
                        await record_inference_spend(db, instance, cost_usd, credits_deducted, input_tokens, output_tokens)
                except Exception as m2m_e:
                    logger.error(f"Failed to auto-increment fleet apiSpend or instance apiCreditsUsed: {m2m_e}")

                return resp_json

            except Exception as e:
                logger.error(f"Inference error during non-streaming Gemini proxy: {e}")
                raise HTTPException(status_code=500, detail=f"Inference gateway connection error: {str(e)}")

@llmRouter.post("/v1/responses")
async def bihand_responses_api(request: Request, authorization: Optional[str] = Header(None)):
    """
    OpenAI Responses API compatibility proxy endpoint.
    Routes directly to centralized LiteLLM proxy instance, and performs token tracking & billing.
    """
    # Print raw request details immediately to sys.stderr for debugging
    import sys
    try:
        raw_body = await request.body()
        sys.stderr.write(f"=== Incoming LLM Responses Request ===\n")
        sys.stderr.write(f"Authorization: {authorization}\n")
        sys.stderr.write(f"Headers: {dict(request.headers)}\n")
        sys.stderr.write(f"Body: {raw_body.decode('utf-8', errors='ignore')}\n")
        sys.stderr.write(f"============================\n")
        sys.stderr.flush()
    except Exception as d_e:
        sys.stderr.write(f"Debugging request capture failed: {d_e}\n")
        sys.stderr.flush()

    # Extract and verify Bihand API key
    api_key = None
    if authorization and authorization.startswith("Bearer "):
        api_key = authorization.split(" ")[1]
    
    if not api_key:
        api_key = request.query_params.get("api_key")
        
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Bihand API Key is required."
        )
        
    email = verify_bihand_api_key(api_key)
    if not email:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or signature-mismatched Bihand API Key."
        )
        
    db = get_db()
    user = await asyncio.to_thread(db["users"].find_one, {"email": email})
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found."
        )
        
    if user.get("credits", 0) <= 0:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail="Your Bihand credits have been depleted."
        )

    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body.")

    # Override incoming model to gemini-3.5-flash
    body["model"] = "gemini-3.5-flash"

    # Calculate fallback input tokens estimate for proxy verification
    prompt_text = ""
    input_val = body.get("input", [])
    if isinstance(input_val, str):
        prompt_text += input_val
    elif isinstance(input_val, list):
        for turn in input_val:
            cont = turn.get("content") or ""
            if isinstance(cont, list):
                prompt_text += "".join([p.get("text", "") for p in cont if isinstance(p, dict) and p.get("type") in ("text", "input_text")])
            else:
                prompt_text += str(cont)
    if body.get("instructions"):
        prompt_text += body["instructions"]
        
    input_tokens_estimate = len(prompt_text) // 4 if prompt_text else 1
    if input_tokens_estimate == 0:
        input_tokens_estimate = 1

    litellm_api_key = os.environ.get("LITELLM_API_KEY", "sk-1234")
    if not litellm_api_key:
        raise HTTPException(
            status_code=500,
            detail="Bihand Server is missing LITELLM_API_KEY."
        )

    stream = body.get("stream", False)
    
    # Point directly to local/central LiteLLM proxy instance responses endpoint
    litellm_proxy_url = os.environ.get("LITELLM_PROXY_URL", "http://127.0.0.1:1234")
    gemini_responses_url = f"{litellm_proxy_url.rstrip('/')}/v1/responses"

    if stream:
        async def stream_generator():
            total_completion_text = ""
            async with httpx.AsyncClient(timeout=120.0) as client:
                try:
                    async with client.stream(
                        "POST",
                        gemini_responses_url,
                        json=body,
                        headers={"Authorization": f"Bearer {litellm_api_key}"}
                    ) as response:
                        if response.status_code >= 400:
                            err_body = await response.aread()
                            logger.error(f"LiteLLM Responses proxy returned error: {err_body}")
                            yield f"event: error\ndata: {json.dumps({'type': 'error', 'message': f'LiteLLM Responses proxy failure: {err_body.decode()}'})}\n\n".encode()
                            return

                        async for line in response.aiter_lines():
                            yield (line + "\n\n").encode()
                            if line.startswith("data:") and "[DONE]" not in line:
                                try:
                                    data_json = json.loads(line[5:].strip())
                                    event_type = data_json.get("type")
                                    if event_type == "response.output_text.delta" and "delta" in data_json:
                                        total_completion_text += str(data_json["delta"])
                                    elif event_type == "response.content_part.delta" and "delta" in data_json:
                                        delta_dict = data_json["delta"]
                                        if isinstance(delta_dict, dict) and "text" in delta_dict:
                                            total_completion_text += str(delta_dict["text"])
                                except Exception:
                                    pass

                except Exception as stream_err:
                    logger.error(f"Stream connection error to LiteLLM Responses proxy: {stream_err}")
                    import traceback
                    traceback.print_exc()
                    yield f"event: error\ndata: {json.dumps({'type': 'error', 'message': str(stream_err)})}\n\n".encode()
                    return

            # Perform post-stream credit calculation and deduction
            output_tokens_estimate = len(total_completion_text) // 4 if total_completion_text else 0
            if output_tokens_estimate == 0 and len(total_completion_text) > 0:
                output_tokens_estimate = 1

            cost_usd = (input_tokens_estimate * 0.0000015) + (output_tokens_estimate * 0.000009)
            credits_deducted = cost_usd * 100

            try:
                await asyncio.to_thread(
                    db["users"].update_one,
                    {"email": email},
                    {"$inc": {"credits": -credits_deducted}}
                )
                logger.info(f"Deducted {credits_deducted} credits from {email} for streaming LiteLLM Responses proxy.")
                
                # Report LLM spend inside M2M controller format
                try:
                    client_ip = get_real_client_ip(request)
                    instance = None
                    if client_ip:
                        instance = await asyncio.to_thread(
                            db["instances"].find_one,
                            {"userId": email, "status": "running", "$or": [{"externalIp": client_ip}, {"ip": client_ip}]}
                        )
                    if not instance:
                        instance = await asyncio.to_thread(
                            db["instances"].find_one,
                            {"userId": email, "status": "running"}
                        )
                    if instance:
                        output_tokens_val = output_tokens_estimate
                        await record_inference_spend(db, instance, cost_usd, credits_deducted, input_tokens_estimate, output_tokens_val)
                except Exception as m2m_e:
                    logger.error(f"Failed to auto-increment fleet spend: {m2m_e}")
            except Exception as e:
                logger.error(f"Failed to deduct streaming credits: {e}")

        return StreamingResponse(stream_generator(), media_type="text/event-stream")

    else:
        # Non-streaming responses API proxy
        async with httpx.AsyncClient(timeout=120.0) as client:
            try:
                response = await client.post(
                    gemini_responses_url,
                    json=body,
                    headers={"Authorization": f"Bearer {litellm_api_key}"}
                )
                if response.status_code >= 400:
                    return JSONResponse(
                        status_code=response.status_code,
                        content={"error": {"message": f"LiteLLM Responses proxy failure: {response.text}"}}
                    )

                resp_json = response.json()
                usage = resp_json.get("usage", {})
                input_tokens = usage.get("prompt_tokens", input_tokens_estimate)
                output_tokens = usage.get("completion_tokens", 0)

                cost_usd = (input_tokens * 0.0000015) + (output_tokens * 0.000009)
                credits_deducted = cost_usd * 100

                await asyncio.to_thread(
                    db["users"].update_one,
                    {"email": email},
                    {"$inc": {"credits": -credits_deducted}}
                )

                # Report LLM spend inside M2M controller format
                try:
                    client_ip = get_real_client_ip(request)
                    instance = None
                    if client_ip:
                        instance = await asyncio.to_thread(
                            db["instances"].find_one,
                            {"userId": email, "status": "running", "$or": [{"externalIp": client_ip}, {"ip": client_ip}]}
                        )
                    if not instance:
                        instance = await asyncio.to_thread(
                            db["instances"].find_one,
                            {"userId": email, "status": "running"}
                        )
                    if instance:
                        await record_inference_spend(db, instance, cost_usd, credits_deducted, input_tokens, output_tokens)
                except Exception as m2m_e:
                    logger.error(f"Failed to auto-increment spend: {m2m_e}")

                return resp_json

            except Exception as e:
                logger.error(f"Inference error during non-streaming LiteLLM responses proxy: {e}")
                raise HTTPException(status_code=500, detail=f"Inference gateway connection error: {str(e)}")
