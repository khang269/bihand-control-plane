import hashlib
import hmac
import logging
import os
from datetime import datetime, timezone

from fastapi import APIRouter, Header, HTTPException, Request, Response

from fastapp.models.flowModel import FlowModel
from fastapp.models.customerProfileModel import CustomerProfileModel
from fastapp.models.conversationModel import ConversationModel
from fastapp.models.messageModel import MessageModel

logger = logging.getLogger(__name__)

channelWebhookRouter = APIRouter(tags=["Customer Support Channel Webhooks"])

# Third auth scheme (distinct from JWT for humans and X-Agent-Token for VM agents): platform
# signature verification. These endpoints are intentionally public - Meta/Zalo call them
# directly, with no user session - and must respond fast (no LLM calls here at all; that
# only happens after debounce, in dispatch_conversation_reply_task).


def _default_mode_for_flow(flow: dict) -> str:
    return (flow.get("supportPolicy") or {}).get("mode", "draft")


def _ingest_message(flow: dict, platform: str, channel_type: str, external_customer_id: str,
                     external_thread_id: str, external_message_id: str, text: str) -> None:
    fleet_id = flow["fleetId"]

    profile = CustomerProfileModel._getOrCreate(fleet_id, platform, external_customer_id)
    stages = flow.get("stages") or []
    conversation = ConversationModel._getOrCreateActive(
        fleet_id=fleet_id,
        flow_id=flow["_id"],
        customer_profile_id=profile["_id"],
        platform=platform,
        channel_type=channel_type,
        external_thread_id=external_thread_id,
        default_mode=_default_mode_for_flow(flow),
        initial_stage_key=stages[0]["key"] if stages else None,
    )

    message = MessageModel._create(
        conversation_id=conversation["_id"],
        platform=platform,
        direction="inbound",
        content=text,
        external_message_id=external_message_id,
        status="received",
    )
    if message is None:
        # Duplicate delivery (platform, externalMessageId) already processed - idempotent no-op.
        # This is the expected, common case for Messenger's aggressive webhook retries.
        return

    ConversationModel._touch(conversation["_id"])
    CustomerProfileModel._incrementCounters(profile["_id"])

    from fastapp.tasks import dispatch_conversation_reply_task
    dispatch_conversation_reply_task.apply_async(args=[conversation["_id"]], countdown=10)


@channelWebhookRouter.get("/messenger")
async def verify_messenger_webhook(request: Request):
    """Meta's webhook verification handshake: echo back hub.challenge only if hub.verify_token
    matches a token registered against a connected flow (see create_flow in fleetController.py)."""
    params = request.query_params
    mode = params.get("hub.mode")
    token = params.get("hub.verify_token")
    challenge = params.get("hub.challenge")

    if mode != "subscribe" or not token:
        raise HTTPException(status_code=403, detail="Verification failed")

    matched = FlowModel._collection().find_one({"platform": "messenger", "verifyToken": token})
    if not matched:
        raise HTTPException(status_code=403, detail="Verification failed")

    return Response(content=challenge or "", media_type="text/plain")


@channelWebhookRouter.post("/messenger")
async def receive_messenger_webhook(request: Request, x_hub_signature_256: str = Header(default=None, alias="X-Hub-Signature-256")):
    raw_body = await request.body()

    app_secret = os.environ.get("FACEBOOK_APP_SECRET")
    if app_secret:
        expected = "sha256=" + hmac.new(app_secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()
        if not x_hub_signature_256 or not hmac.compare_digest(expected, x_hub_signature_256):
            raise HTTPException(status_code=401, detail="Invalid signature")
    else:
        logger.warning("FACEBOOK_APP_SECRET not configured - skipping Messenger webhook signature verification")

    payload = await request.json()
    try:
        for entry in payload.get("entry", []):
            page_id = entry.get("id")
            if not page_id:
                continue
            flow = FlowModel._findByChannelId("messenger", "pageId", page_id)
            if not flow:
                logger.warning(f"Messenger webhook for unregistered page_id {page_id}")
                continue

            for event in entry.get("messaging", []):
                message = event.get("message") or {}
                text = message.get("text")
                sender_id = (event.get("sender") or {}).get("id")
                mid = message.get("mid")
                # Skip echoes of our own sent messages and non-text events (attachments,
                # read receipts, delivery confirmations) - Phase 1 is text-only.
                if message.get("is_echo") or not text or not sender_id or not mid:
                    continue

                _ingest_message(
                    flow=flow,
                    platform="messenger",
                    channel_type="page_webhook",
                    external_customer_id=sender_id,
                    external_thread_id=sender_id,
                    external_message_id=mid,
                    text=text,
                )
    except Exception as e:
        logger.error(f"Error processing Messenger webhook payload: {e}")

    # Always 200 quickly regardless of internal processing outcome - Meta retries aggressively
    # on non-200 responses, and per-message idempotency already guards against double-processing.
    return {"status": "ok"}


@channelWebhookRouter.get("/zalo")
async def verify_zalo_webhook(request: Request):
    """Zalo's OA webhook verification (if applicable) - mirrors the Messenger handshake shape.
    NOTE: verify against current Zalo OA docs at implementation time; Zalo's verification
    mechanics may differ from Meta's hub.challenge convention."""
    params = request.query_params
    challenge = params.get("challenge") or params.get("hub.challenge")
    return Response(content=challenge or "", media_type="text/plain")


@channelWebhookRouter.post("/zalo")
async def receive_zalo_webhook(request: Request):
    """NOTE: Zalo's webhook signature scheme and payload shape must be verified against
    current Zalo OA API docs before this goes live in production - written against the
    general single-event-per-call shape, not confirmed against a live test delivery."""
    payload = await request.json()
    try:
        oa_id = (payload.get("recipient") or {}).get("id") or payload.get("oa_id")
        if not oa_id:
            return {"status": "ok"}

        flow = FlowModel._findByChannelId("zalo", "oaId", oa_id)
        if not flow:
            logger.warning(f"Zalo webhook for unregistered oa_id {oa_id}")
            return {"status": "ok"}

        message = payload.get("message") or {}
        text = message.get("text")
        sender_id = (payload.get("sender") or {}).get("id")
        msg_id = message.get("msg_id")

        if text and sender_id and msg_id:
            _ingest_message(
                flow=flow,
                platform="zalo",
                channel_type="oa_webhook",
                external_customer_id=sender_id,
                external_thread_id=sender_id,
                external_message_id=msg_id,
                text=text,
            )
    except Exception as e:
        logger.error(f"Error processing Zalo webhook payload: {e}")

    return {"status": "ok"}
