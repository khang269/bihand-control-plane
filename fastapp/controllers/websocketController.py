import logging
import asyncio
import threading
import time

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from fastapp.models.instanceModel import InstanceModel
from fastapp.models.chatMessageModel import ChatMessageModel
from fastapp.utils.jwtUtils import decodeJwtToken
from fastapp.services import sshService

logger = logging.getLogger(__name__)

wsRouter = APIRouter()

# Active WebSocket connections per instance for log streaming
active_connections: dict[str, list[WebSocket]] = {}

# Active WebSocket connections per Fleet for live Agent Activity (M2M) feed
fleet_active_connections: dict[str, list[WebSocket]] = {}

ADMIN_EMAILS = []
import os
_admin_user_env = os.getenv("ADMIN_USER")
if _admin_user_env:
    ADMIN_EMAILS.append(_admin_user_env)


def broadcast_log(instance_id: str, message: str):
    """
    Send a log message to all WebSocket clients watching this instance.
    Called by the provisioner service.
    """
    if instance_id in active_connections:
        disconnected = []
        for ws in active_connections[instance_id]:
            try:
                asyncio.get_event_loop().create_task(ws.send_json({
                    "type": "log",
                    "instanceId": instance_id,
                    "message": message,
                }))
            except Exception:
                disconnected.append(ws)
        
        for ws in disconnected:
            active_connections[instance_id].remove(ws)

def broadcast_fleet_activity(fleet_id: str, payload: dict):
    """
    Broadcasts real-time Agent Activity (from M2M Bridge) to all connected Fleet UI Dashboards.
    """
    if fleet_id in fleet_active_connections:
        disconnected = []
        for ws in fleet_active_connections[fleet_id]:
            try:
                asyncio.get_event_loop().create_task(ws.send_json(payload))
            except Exception:
                disconnected.append(ws)
        
        for ws in disconnected:
            fleet_active_connections[fleet_id].remove(ws)


@wsRouter.websocket("/ws/fleet/{fleet_id}/activity")
async def fleet_activity_stream(websocket: WebSocket, fleet_id: str, token: str = Query(default="")):
    """
    WebSocket endpoint for streaming live agent activity (Audit log / Terminal) for a specific fleet.
    Used by the React Dashboard to show exactly what the AI Company is doing in real-time.
    """
    if not token:
        await websocket.close(code=4001, reason="Authentication required")
        return
        
    payload = decodeJwtToken(token)
    if not payload:
        await websocket.close(code=4003, reason="Invalid token")
        return

    # TODO: Verify fleet_id belongs to payload["email"] in a real production system
    
    await websocket.accept()
    
    if fleet_id not in fleet_active_connections:
        fleet_active_connections[fleet_id] = []
    fleet_active_connections[fleet_id].append(websocket)
    
    logger.info(f"Fleet Activity WS connected for fleet {fleet_id}")
    
    try:
        # Keep connection alive
        while True:
            # We don't expect much input from the client on this socket, just ping/pong
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        logger.info(f"Fleet Activity WS disconnected for fleet {fleet_id}")
    except Exception as e:
        logger.error(f"Fleet Activity WS error for fleet {fleet_id}: {e}")
    finally:
        # Cleanup
        if fleet_id in fleet_active_connections:
            if websocket in fleet_active_connections[fleet_id]:
                fleet_active_connections[fleet_id].remove(websocket)
            if not fleet_active_connections[fleet_id]:
                del fleet_active_connections[fleet_id]

@wsRouter.websocket("/ws/provision/{instance_id}")
async def provision_log_stream(websocket: WebSocket, instance_id: str, token: str = Query(default="")):
    """
    WebSocket endpoint for streaming provisioning logs.
    Admin connects and receives real-time updates as the instance is being set up.
    """
    # Authenticate via token query param
    if not token:
        await websocket.close(code=4001, reason="Authentication required")
        return
    
    payload = decodeJwtToken(token)
    if not payload or payload.get("email") not in ADMIN_EMAILS:
        await websocket.close(code=4003, reason="Admin access required")
        return
    
    # Verify instance exists
    instance = InstanceModel._getById(instance_id)
    if not instance:
        await websocket.close(code=4004, reason="Instance not found")
        return
    
    await websocket.accept()
    
    # Register connection
    if instance_id not in active_connections:
        active_connections[instance_id] = []
    active_connections[instance_id].append(websocket)
    
    logger.info(f"WebSocket connected for instance {instance_id}")
    
    try:
        # Send existing logs as initial state
        if instance.get("provisionLog"):
            for log_entry in instance["provisionLog"]:
                await websocket.send_json({
                    "type": "log",
                    "instanceId": instance_id,
                    "message": log_entry,
                })
        
        # Send current status
        await websocket.send_json({
            "type": "status",
            "instanceId": instance_id,
            "status": instance["status"],
        })
        
        # Keep connection alive and poll for updates
        while True:
            try:
                # Wait for client messages (ping/pong or close)
                data = await asyncio.wait_for(websocket.receive_text(), timeout=5.0)
                
                if data == "ping":
                    await websocket.send_json({"type": "pong"})
                elif data == "status":
                    # Send current instance status
                    current = InstanceModel._getById(instance_id)
                    if current:
                        await websocket.send_json({
                            "type": "status",
                            "instanceId": instance_id,
                            "status": current["status"],
                            "externalIp": current.get("externalIp"),
                            "errorMessage": current.get("errorMessage"),
                        })
            except asyncio.TimeoutError:
                # No message from client, check if instance status changed
                current = InstanceModel._getById(instance_id)
                if current and current["status"] in ("running", "error", "deleted"):
                    await websocket.send_json({
                        "type": "complete",
                        "instanceId": instance_id,
                        "status": current["status"],
                        "externalIp": current.get("externalIp"),
                        "errorMessage": current.get("errorMessage"),
                    })
                    if current["status"] in ("running", "error"):
                        break
                continue
    
    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected for instance {instance_id}")
    except Exception as e:
        logger.error(f"WebSocket error for instance {instance_id}: {e}")
    finally:
        # Cleanup connection
        if instance_id in active_connections:
            if websocket in active_connections[instance_id]:
                active_connections[instance_id].remove(websocket)
            if not active_connections[instance_id]:
                del active_connections[instance_id]

async def _bridge_claudecode_chat(websocket: WebSocket, external_ip: str, dashboard_token: str, ssl_context,
                                   instance_id: str = "", fleet_id: str = "", agent_type: str = "claudecode"):
    """
    Bridges the browser to the interactive chat daemon on the VM - chat_daemon.js (provisioned by
    claude_code_strategy.py) at wss://{ip}/api/claudechat for claudecode agents, or
    codex_chat_daemon.js (provisioned by codex_strategy.py) at wss://{ip}/api/codexchat for codex
    agents. Both daemons speak the same small wire vocabulary
    (session_ready/assistant_delta/tool_use/tool_result/turn_complete/error) despite wrapping
    different CLIs, so this bridge doesn't otherwise need to know which one it's talking to.
    Neither daemon has a connect handshake - each is ready to accept
    {"type":"user_message","text":...} frames as soon as the socket opens - so messages are
    forwarded through verbatim in both directions.

    Alongside relaying, this persists the conversation to ChatMessageModel so ChatPanel.tsx can
    replay history on reload and GET /tasks/next can surface it as task context - mirroring the
    exact delta-coalescing ChatPanel.tsx already does client-side (appendAssistantDelta/
    upsertToolUse/applyToolResult) so stored history matches what the UI renders.
    """
    import websockets
    import json
    import uuid

    chat_path = "/api/claudechat" if agent_type == "claudecode" else "/api/codexchat"
    target_ws_url = f"wss://{external_ip}{chat_path}"

    assistant_buffer = {"id": None, "text": ""}

    def flush_assistant_buffer():
        if instance_id and assistant_buffer["text"]:
            ChatMessageModel._insert(
                instance_id, fleet_id, agent_type, "assistant",
                assistant_buffer["id"] or str(uuid.uuid4()),
                text=assistant_buffer["text"],
            )
        assistant_buffer["id"] = None
        assistant_buffer["text"] = ""

    try:
        async with websockets.connect(
            target_ws_url,
            additional_headers={"Authorization": f"Bearer {dashboard_token}"},
            ssl=ssl_context,
            open_timeout=120,
            ping_interval=10,
            ping_timeout=60
        ) as target_ws:
            logger.info(f"Chat WS: Connected to {agent_type} chat daemon at {target_ws_url}")

            async def forward_to_client():
                try:
                    while True:
                        msg = await target_ws.recv()
                        await websocket.send_text(msg)

                        if not instance_id:
                            continue
                        try:
                            evt = json.loads(msg)
                        except Exception:
                            continue
                        evt_type = evt.get("type")
                        if evt_type == "assistant_delta":
                            if assistant_buffer["id"] is None:
                                assistant_buffer["id"] = str(uuid.uuid4())
                            assistant_buffer["text"] += evt.get("text", "")
                        elif evt_type == "tool_use":
                            flush_assistant_buffer()
                            ChatMessageModel._insert(
                                instance_id, fleet_id, agent_type, "tool",
                                evt.get("id") or str(uuid.uuid4()),
                                toolName=evt.get("name", "tool"), toolInput=evt.get("input"),
                                toolOutput=None, toolStatus="running",
                            )
                        elif evt_type == "tool_result":
                            if evt.get("id"):
                                ChatMessageModel._upsertToolResult(instance_id, evt["id"], evt.get("output"))
                        elif evt_type == "turn_complete":
                            flush_assistant_buffer()
                        elif evt_type == "error":
                            flush_assistant_buffer()
                            ChatMessageModel._insert(
                                instance_id, fleet_id, agent_type, "error",
                                str(uuid.uuid4()),
                                text=evt.get("text") or evt.get("message") or "Unknown error",
                            )
                except websockets.exceptions.ConnectionClosed:
                    logger.info("Chat WS: Claude Code chat daemon closed connection")
                except Exception as e:
                    logger.error(f"Error forwarding Claude Code chat daemon message to client: {e}")

            async def forward_to_target():
                try:
                    while True:
                        data = await websocket.receive_text()
                        try:
                            msg_data = json.loads(data)
                        except Exception:
                            continue
                        user_text = msg_data.get("text", "")
                        if user_text:
                            if instance_id:
                                ChatMessageModel._insert(
                                    instance_id, fleet_id, agent_type, "user",
                                    str(uuid.uuid4()), text=user_text,
                                )
                            await target_ws.send(json.dumps({"type": "user_message", "text": user_text}))
                except WebSocketDisconnect:
                    logger.info("Chat WS: Client disconnected")
                except Exception as e:
                    logger.error(f"Error forwarding client message to Claude Code chat daemon: {e}")

            task1 = asyncio.create_task(forward_to_target())
            task2 = asyncio.create_task(forward_to_client())

            done, pending = await asyncio.wait(
                [task1, task2],
                return_when=asyncio.FIRST_COMPLETED
            )
            for task in pending:
                task.cancel()

    except Exception as e:
        logger.error(f"Failed to connect to Claude Code chat daemon: {e}")
        try:
            await websocket.send_json({"type": "error", "text": f"Failed to connect to agent: {e}"})
        except Exception:
            pass
    finally:
        flush_assistant_buffer()
        try:
            await websocket.close()
        except Exception:
            pass


@wsRouter.websocket("/ws/chat/{instance_id}")
async def proxy_chat_stream(websocket: WebSocket, instance_id: str, token: str = Query(default="")):
    """
    WebSocket endpoint for proxying real-time chat directly to the agent's on-VM chat backend.
    Bridges to OpenClaw's own gateway WS API for openclaw instances, or to the Claude Code
    interactive chat daemon for claudecode instances (see _bridge_claudecode_chat).
    """
    logger.info(f"Chat WS connection attempt for {instance_id}")
    if not token:
        logger.error("Chat WS: No token provided")
        await websocket.close(code=1008, reason="Authentication required")
        return
    
    payload = decodeJwtToken(token)
    if not payload:
        logger.error("Chat WS: Invalid or expired token")
        await websocket.close(code=1008, reason="Invalid token")
        return
        
    email = payload.get("email")
    instance = InstanceModel._getById(instance_id)
    if not instance:
        logger.error(f"Chat WS: Instance {instance_id} not found")
        await websocket.close(code=1008, reason="Instance not found")
        return
        
    if instance.get("userId") != email:
        logger.error(f"Chat WS: Access denied. User {email} does not own instance {instance_id}")
        await websocket.close(code=1008, reason="Access denied")
        return
        
    if instance.get("status") != "running":
        logger.error(f"Chat WS: Instance {instance_id} is not running (status: {instance.get('status')})")
        await websocket.close(code=1008, reason="Instance not running")
        return

    full_instance = InstanceModel._getByIdWithKeys(instance_id)
    external_ip = full_instance.get("externalIp")
    dashboard_token = full_instance.get("dashboardToken", "")
    agent_type = instance.get("agentType") or instance.get("iteration") or "openclaw"

    if not external_ip:
        logger.error(f"Chat WS: Instance {instance_id} lacks external IP")
        await websocket.close(code=1008, reason="Instance IP not available")
        return

    logger.info(f"Chat WS: Authenticated. Accepting connection and bridging to {external_ip} (agentType={agent_type})")
    await websocket.accept()

    import ssl
    ssl_context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ssl_context.check_hostname = False
    ssl_context.verify_mode = ssl.CERT_NONE

    if agent_type in ("claudecode", "codex"):
        await _bridge_claudecode_chat(
            websocket, external_ip, dashboard_token, ssl_context,
            instance_id=instance_id, fleet_id=instance.get("fleetId", ""), agent_type=agent_type,
        )
        return

    # --- OpenClaw path (existing behavior, unchanged) ---
    # We will use websockets library to connect to the internal agent
    import websockets
    import json

    target_ws_url = f"ws://{external_ip}:18789/api/chat"
    
    # Alternatively, connect through the Nginx proxy to bypass GCP firewall if 18789 is blocked externally:
    # target_ws_url = f"wss://{external_ip}/api/chat"
    # Note: If going through Nginx, Nginx requires Basic Auth mapped to the $auth_realm
    
    # GCP Firewall blocks 18789 by default! Let's route through Nginx proxy which is open on 443
    target_ws_url = f"wss://{external_ip}/api/chat"
    
    # The proxy requires basic auth AND the Bearer token for OpenClaw.
    # To bypass Basic Auth for websockets or handle it, we'd need the basic auth password.
    # However, Nginx is configured to bypass Basic Auth if Bearer is present:
    # map $http_authorization $auth_realm {
    #     default "NemoClaw Secure Workspace";
    #     ~^Bearer off;
    # }
    # So we just need the Bearer token! (ssl_context already built above, shared with the
    # claudecode branch)

    try:
        # Some versions of websockets use `additional_headers`, some use `extra_headers`
        # Let's use `additional_headers` which is the current standard for websockets >= 10.0
        async with websockets.connect(
            target_ws_url, 
            additional_headers={"Authorization": f"Bearer {dashboard_token}"},
            ssl=ssl_context,
            open_timeout=120,
            ping_interval=10,
            ping_timeout=60
        ) as target_ws:
            logger.info(f"Chat WS: Connected to agent backend at {target_ws_url}")
            
            import asyncio
            handshake_event = asyncio.Event()

            async def forward_to_client():
                import json
                import uuid
                
                try:
                    while True:
                        msg = await target_ws.recv()
                        
                        try:
                            msg_data = json.loads(msg)
                            
                            # Log all incoming messages for debugging the handshake
                            logger.info(f"OpenClaw message: {msg[:1000]}")
                            
                            # Handle 'hello' or 'connect.challenge' event from OpenClaw server
                            if msg_data.get("type") == "event" and msg_data.get("event") in ("hello", "connect.challenge"):
                                logger.info(f"Received '{msg_data.get('event')}' from OpenClaw, sending handshake...")
                                handshake = {
                                    "type": "req",
                                    "id": str(uuid.uuid4()),
                                    "method": "connect",
                                    "params": {
                                        "minProtocol": 1,
                                        "maxProtocol": 4,
                                        "role": "operator",
                                        "scopes": ["operator.read", "operator.write"],
                                        "auth": {
                                            "token": dashboard_token
                                        },
                                        "client": {
                                            "id": "openclaw-control-ui",
                                            "displayName": email,
                                            "mode": "webchat",
                                            "version": "2026.5.7",
                                            "platform": "web"
                                        }
                                    }
                                }
                                await target_ws.send(json.dumps(handshake))
                                continue
                                
                            # Handle 'res' to our connect request
                            if msg_data.get("type") == "res" and not msg_data.get("error"):
                                if not handshake_event.is_set():
                                    logger.info("Handshake accepted by OpenClaw.")
                                    handshake_event.set()
                                    continue
                                    
                            # Handle ANY error response from OpenClaw (handshake or chat)
                            if msg_data.get("type") == "res" and msg_data.get("error"):
                                logger.error(f"OpenClaw returned error: {msg_data['error']}")
                                if not handshake_event.is_set():
                                    handshake_event.set()
                                    
                                await websocket.send_text(json.dumps({
                                    "type": "error",
                                    "text": msg_data["error"].get("message", "Unknown OpenClaw API Error")
                                }))
                                continue
                            
                            # Just forward the RAW JSON directly to the frontend!
                            await websocket.send_text(msg)
                                
                        except Exception as parse_err:
                            logger.error(f"Error parsing/forwarding OpenClaw message: {parse_err}")
                            pass
                            
                except websockets.exceptions.ConnectionClosed:
                    logger.info("Chat WS: Agent closed connection")
                except Exception as e:
                    logger.error(f"Error forwarding to client: {e}")
                    
            async def forward_to_target():
                import uuid
                import json
                try:
                    # Wait until handshake is fully accepted before listening to the client
                    await handshake_event.wait()
                    
                    while True:
                        data = await websocket.receive_text()
                        logger.info(f"Chat WS: Received from client: {data}")
                        try:
                            msg_data = json.loads(data)
                            action = msg_data.get("action")
                            if action == "fetch_history":
                                req = {
                                    "id": str(uuid.uuid4()),
                                    "type": "req",
                                    "method": "chat.history",
                                    "params": {
                                        "sessionKey": "agent:main:main",
                                        "limit": 50
                                    }
                                }
                                logger.info(f"Fetching history from OpenClaw: {json.dumps(req)}")
                                await target_ws.send(json.dumps(req))
                                continue

                            user_text = msg_data.get("text", "")
                            
                            if user_text or msg_data.get("files"):
                                # Wrap the simple text in the exact protocol OpenClaw expects
                                idempotency_key = str(uuid.uuid4())
                                
                                params = {
                                    "sessionKey": "agent:main:main",
                                    "message": user_text,
                                    "idempotencyKey": idempotency_key
                                }
                                
                                # Attach files if provided via base64 encoded strings
                                files = msg_data.get("files", [])
                                if files:
                                    params["attachments"] = []
                                    for f in files:
                                        mime_type = f.get('type', 'application/octet-stream')
                                        file_type = "image" if mime_type.startswith("image/") else "file"
                                        params["attachments"].append({
                                            "type": file_type,
                                            "fileName": f.get("name", "attachment"),
                                            "mimeType": mime_type,
                                            "content": f.get("data")
                                        })

                                req = {
                                    "id": str(uuid.uuid4()),
                                    "type": "req",
                                    "method": "chat.send",
                                    "params": params
                                }
                                logger.info(f"Sending to OpenClaw: {json.dumps(req)}")
                                await target_ws.send(json.dumps(req))
                        except Exception as e:
                            logger.error(f"Chat WS Client forward error: {e}")
                            
                except WebSocketDisconnect:
                    logger.info("Chat WS: Client disconnected")
                except Exception as e:
                    logger.error(f"Error forwarding to target: {e}")
                    
            task1 = asyncio.create_task(forward_to_target())
            task2 = asyncio.create_task(forward_to_client())
            
            done, pending = await asyncio.wait(
                [task1, task2],
                return_when=asyncio.FIRST_COMPLETED
            )
            
            for task in pending:
                task.cancel()
            
    except Exception as e:
        logger.error(f"Failed to connect to agent websocket: {e}")
        try:
            await websocket.send_json({"type": "error", "text": f"Failed to connect to agent: {e}"})
        except:
            pass
    finally:
        try:
            await websocket.close()
        except:
            pass


@wsRouter.websocket("/ws/terminal/{instance_id}")
async def terminal_stream(websocket: WebSocket, instance_id: str, token: str = Query(default="")):
    """
    WebSocket endpoint for a raw interactive shell (PTY) into the agent VM. Bridges directly
    over the same paramiko SSH connection sshService already uses for the file browser -
    no on-VM daemon, no re-provisioning required for existing instances.
    """
    if not token:
        await websocket.close(code=1008, reason="Authentication required")
        return

    payload = decodeJwtToken(token)
    if not payload:
        await websocket.close(code=1008, reason="Invalid token")
        return

    email = payload.get("email")
    instance = InstanceModel._getById(instance_id)
    if not instance:
        await websocket.close(code=1008, reason="Instance not found")
        return

    if instance.get("userId") != email and email not in ADMIN_EMAILS:
        logger.error(f"Terminal WS: Access denied. User {email} does not own instance {instance_id}")
        await websocket.close(code=1008, reason="Access denied")
        return

    if instance.get("status") != "running":
        await websocket.close(code=1008, reason="Instance not running")
        return

    full_instance = InstanceModel._getByIdWithKeys(instance_id)
    external_ip = full_instance.get("externalIp")
    ssh_private_key = full_instance.get("sshKeyPrivate")
    fleet_id = instance.get("fleetId", "")

    if not external_ip or not ssh_private_key:
        await websocket.close(code=1008, reason="Instance SSH access not available")
        return

    await websocket.accept()

    loop = asyncio.get_event_loop()
    stop_event = threading.Event()
    client = None
    channel = None

    def pump_output(ch):
        try:
            while not stop_event.is_set():
                if ch.closed:
                    break
                if ch.recv_ready():
                    chunk = ch.recv(4096)
                    if not chunk:
                        break
                    text = chunk.decode("utf-8", errors="replace")
                    asyncio.run_coroutine_threadsafe(
                        websocket.send_json({"type": "output", "data": text}), loop
                    )
                else:
                    time.sleep(0.03)
        except Exception as e:
            logger.info(f"Terminal WS: output pump ended for {instance_id}: {e}")

    try:
        client, channel = sshService.open_shell(external_ip, ssh_private_key)
    except Exception as e:
        logger.error(f"Terminal WS: failed to open shell on {instance_id}: {e}")
        try:
            await websocket.send_json({"type": "error", "text": f"Failed to connect: {e}"})
        except Exception:
            pass
        await websocket.close()
        return

    logger.info(f"Terminal WS: session opened for instance {instance_id} by {email}")
    if fleet_id:
        broadcast_fleet_activity(fleet_id, {
            "type": "terminal_session_opened",
            "instanceId": instance_id,
            "email": email,
        })

    pump_thread = threading.Thread(target=pump_output, args=(channel,), daemon=True)
    pump_thread.start()

    try:
        await websocket.send_json({"type": "session_ready"})
        while True:
            msg = await websocket.receive_json()
            msg_type = msg.get("type")
            if msg_type == "input":
                data = msg.get("data", "")
                if data:
                    channel.send(data)
            elif msg_type == "resize":
                try:
                    cols = int(msg.get("cols", 80))
                    rows = int(msg.get("rows", 24))
                    channel.resize_pty(width=cols, height=rows)
                except Exception:
                    pass
    except WebSocketDisconnect:
        logger.info(f"Terminal WS: client disconnected for instance {instance_id}")
    except Exception as e:
        logger.error(f"Terminal WS error for instance {instance_id}: {e}")
        try:
            await websocket.send_json({"type": "error", "text": str(e)})
        except Exception:
            pass
    finally:
        stop_event.set()
        try:
            channel.close()
        except Exception:
            pass
        try:
            client.close()
        except Exception:
            pass
        logger.info(f"Terminal WS: session closed for instance {instance_id}")
        if fleet_id:
            broadcast_fleet_activity(fleet_id, {
                "type": "terminal_session_closed",
                "instanceId": instance_id,
                "email": email,
            })
        try:
            await websocket.close()
        except Exception:
            pass
