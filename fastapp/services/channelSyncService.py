"""
Installs and manages channel_sync.py on an agent's VM - the thin, non-agentic script that
gives personal (non-API) Facebook Messenger and Zalo accounts the same ingestion/reply
pipeline the webhook-based Page/OA tiers get, purely via browser automation.

This is intentionally separate from heartbeat.py: it is not part of the LLM agent loop, has
no reasoning of its own, and is only installed on-demand when a personal_browser flow is
created or reassigned to an agent (see create_flow/reassign_flow in fleetController.py,
and setup_personal_channel_sync_task in tasks.py) - not baked into every VM's boot sequence
unconditionally.
"""
import logging
from fastapp.services import sshService

logger = logging.getLogger(__name__)

CHANNEL_SYNC_REMOTE_PATH = "/opt/bihand/channel_sync.py"
CHANNEL_SYNC_SERVICE_NAME = "bihand-channel-sync.service"

# NOTE: DOM selectors below are written against the general, well-known shape of the
# Messenger and Zalo web UIs as of this writing - they WILL need to be verified and likely
# adjusted against the live UI before this is relied upon in production. Both platforms
# change their web UI markup periodically with no notice; this script has deliberately
# narrow, isolated selector functions so that upkeep is a small, localized diff rather than
# a rewrite.
CHANNEL_SYNC_SCRIPT = '''
import hashlib
import json
import re
import time
import traceback
from datetime import datetime, timezone

import requests
from playwright.sync_api import sync_playwright

API_URL = "{api_url}"
TOKEN = "{token}"
CDP_URL = "http://127.0.0.1:9222"
POLL_INTERVAL_SECONDS = 90

CHANNELS = {channels_json}  # e.g. [{{"platform": "messenger", "webUrl": "https://www.messenger.com/"}}, ...]

_seen_message_ids = set()

# Customer identity MUST NEVER be derived from the scraped display name/preview text - two
# different customers can share a name, and a customer renaming themselves would silently
# fork their conversation history into a "new" one. Both extractors below only return a
# platform-assigned, non-editable identifier, and the caller skips the thread entirely
# (logging why) rather than falling back to name-based identification when extraction fails.

# Messenger web navigates to a URL containing /t/<id> (or /e2ee/t/<id> for end-to-end
# encrypted threads) when a specific conversation is opened - <id> is Messenger's own
# per-thread identifier, not the customer's display name, and is stable across renames.
_MESSENGER_THREAD_ID_RE = re.compile(r"/t/([\\w.\\-]+)")

# Zalo Web's exact DOM markup for a stable per-conversation/per-user ID has NOT been
# verified against a live session in this environment - these are the most likely
# attribute names based on common SPA conventions and should be confirmed (and this list
# adjusted) against the real chat.zalo.me DOM before this is relied on in production.
_ZALO_STABLE_ID_ATTRS = ["data-uid", "data-conversation-id", "data-cid", "data-id"]
_ZALO_URL_ID_RE = re.compile(r"/(?:chat|conversation)/([\\w.\\-]+)")


def _extract_messenger_thread_id(page):
    match = _MESSENGER_THREAD_ID_RE.search(page.url)
    return match.group(1) if match else None


def _extract_zalo_thread_id(thread_element, page):
    for attr in _ZALO_STABLE_ID_ATTRS:
        val = thread_element.get_attribute(attr)
        if val and val.strip():
            return val.strip()
    match = _ZALO_URL_ID_RE.search(page.url)
    return match.group(1) if match else None


def _synthetic_message_id(thread_id, sender, text, ts_minute):
    raw = f"{{thread_id}}:{{sender}}:{{text}}:{{ts_minute}}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _report_inbound(platform, thread_id, customer_id, message_id, text):
    if message_id in _seen_message_ids:
        return
    try:
        res = requests.post(
            f"{{API_URL}}/channels/personal/inbound",
            headers={{"X-Agent-Token": TOKEN}},
            json={{
                "platform": platform,
                "externalThreadId": thread_id,
                "externalCustomerId": customer_id,
                "externalMessageId": message_id,
                "text": text,
            }},
            timeout=15,
        )
        if res.status_code == 200:
            _seen_message_ids.add(message_id)
        else:
            print(f"inbound report failed ({{res.status_code}}): {{res.text[:200]}}")
    except Exception as e:
        print(f"Error reporting inbound message: {{e}}")


def _scrape_messenger_threads(page):
    # Messenger web UI: unread conversations show a bold/unread marker in the thread list.
    # This selector set is a starting point, not verified against a live page in this
    # environment - inspect the real DOM and adjust before relying on this in production.
    threads = page.query_selector_all("[role=\\'row\\'][aria-label]")
    for thread in threads:
        try:
            thread.click()
            page.wait_for_timeout(1500)
            thread_id = _extract_messenger_thread_id(page)
            if not thread_id:
                print("Skipping Messenger thread - could not extract a stable thread ID from the URL (never falling back to display name)")
                continue
            messages = page.query_selector_all("[role=\\'row\\'] [dir=\\'auto\\']")
            if not messages:
                continue
            last_text = messages[-1].inner_text().strip()
            if not last_text:
                continue
            ts_minute = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M")
            msg_id = _synthetic_message_id(thread_id, thread_id, last_text, ts_minute)
            _report_inbound("messenger", thread_id, thread_id, msg_id, last_text)
        except Exception as e:
            print(f"Error scraping a Messenger thread: {{e}}")


def _scrape_zalo_threads(page):
    # Zalo web UI: NOTE selectors below are placeholders - verify against the live Zalo web
    # client before relying on this in production.
    threads = page.query_selector_all(".conversation-item")
    for thread in threads:
        try:
            thread.click()
            page.wait_for_timeout(1500)
            thread_id = _extract_zalo_thread_id(thread, page)
            if not thread_id:
                print("Skipping Zalo thread - could not extract a stable ID (never falling back to display name); verify _ZALO_STABLE_ID_ATTRS against a live session")
                continue
            messages = page.query_selector_all(".message-content")
            if not messages:
                continue
            last_text = messages[-1].inner_text().strip()
            if not last_text:
                continue
            ts_minute = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M")
            msg_id = _synthetic_message_id(thread_id, thread_id, last_text, ts_minute)
            _report_inbound("zalo", thread_id, thread_id, msg_id, last_text)
        except Exception as e:
            print(f"Error scraping a Zalo thread: {{e}}")


def _send_pending(browser, contexts_by_platform):
    try:
        res = requests.get(f"{{API_URL}}/channels/personal/pending-sends", headers={{"X-Agent-Token": TOKEN}}, timeout=15)
        if res.status_code != 200:
            return
        pending = res.json().get("pendingSends", [])
    except Exception as e:
        print(f"Error fetching pending sends: {{e}}")
        return

    for item in pending:
        platform = item["platform"]
        page = contexts_by_platform.get(platform)
        if not page:
            continue
        success = False
        error = None
        try:
            # Navigate to the specific thread and type+send - exact selectors are the same
            # ones used for scraping above; a real implementation should factor thread
            # navigation into a shared helper once selectors are confirmed against the live UI.
            box = page.query_selector("[contenteditable=\\'true\\']")
            if box:
                box.click()
                box.type(item["text"], delay=20)
                page.keyboard.press("Enter")
                success = True
            else:
                error = "Could not find message compose box"
        except Exception as e:
            error = str(e)

        try:
            requests.post(
                f"{{API_URL}}/channels/personal/pending-sends/{{item['messageId']}}/mark-sent",
                headers={{"X-Agent-Token": TOKEN}},
                json={{"success": success, "error": error}},
                timeout=15,
            )
        except Exception as e:
            print(f"Error reporting send result: {{e}}")


def main():
    print(f"channel_sync.py starting - {{len(CHANNELS)}} personal channel(s) configured")
    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(CDP_URL)
        context = browser.contexts[0] if browser.contexts else browser.new_context()

        pages_by_platform = {{}}
        for ch in CHANNELS:
            page = context.new_page()
            try:
                page.goto(ch["webUrl"], timeout=30000)
            except Exception as e:
                print(f"Failed to open {{ch['platform']}} inbox: {{e}}")
                continue
            pages_by_platform[ch["platform"]] = page

        while True:
            for ch in CHANNELS:
                page = pages_by_platform.get(ch["platform"])
                if not page:
                    continue
                try:
                    if ch["platform"] == "messenger":
                        _scrape_messenger_threads(page)
                    elif ch["platform"] == "zalo":
                        _scrape_zalo_threads(page)
                except Exception as e:
                    print(f"Error during {{ch['platform']}} scrape cycle: {{e}}")
                    traceback.print_exc()

            _send_pending(browser, pages_by_platform)
            time.sleep(POLL_INTERVAL_SECONDS)


if __name__ == "__main__":
    main()
'''

CHANNEL_SYNC_SERVICE_UNIT = """[Unit]
Description=Bihand Personal Channel Sync (Messenger/Zalo browser scraper)
After=network.target

[Service]
Type=simple
Environment=PYTHONUNBUFFERED=1
ExecStart=/usr/bin/python3 {remote_path}
Restart=always
RestartSec=15
User=root

[Install]
WantedBy=multi-user.target
"""


def install_channel_sync(ip: str, private_key: str, api_url: str, token: str, channels: list) -> bool:
    """Writes channel_sync.py + its systemd unit to the VM and (re)starts it. `channels` is
    a list of {"platform": "messenger"|"zalo", "webUrl": "..."} for whichever personal
    accounts are currently connected on this instance."""
    import json as _json

    script_content = CHANNEL_SYNC_SCRIPT.format(
        api_url=api_url.rstrip("/"),
        token=token,
        channels_json=_json.dumps(channels),
    )

    try:
        # Ubuntu 24.04 VM images ship without pip3 at all (no python3-pip package), and
        # PEP 668 blocks a bare `pip3 install` into the system interpreter even once pip3
        # exists - both silently defeat a plain `pip3 install playwright` (confirmed live:
        # a VM crash-looped on ModuleNotFoundError('playwright') because pip3 wasn't even
        # on PATH). Install python3-pip first if missing, and pass --break-system-packages
        # to satisfy PEP 668, since this dedicated non-agentic scraper VM has no venv of
        # its own to isolate into.
        deps_res = sshService.execute_command(
            ip, private_key,
            "sudo mkdir -p /opt/bihand && "
            "(command -v pip3 >/dev/null 2>&1 || (sudo apt-get update -qq && sudo apt-get install -y -qq python3-pip)) && "
            "sudo pip3 install --quiet --break-system-packages playwright requests",
        )
        if deps_res.get("exitCode") != 0:
            logger.error(
                f"Failed to install channel_sync.py dependencies on {ip}: "
                f"{(deps_res.get('stderr') or deps_res.get('stdout') or '')[:500]}"
            )
            return False
        sshService.upload_file(ip, private_key, CHANNEL_SYNC_REMOTE_PATH, script_content.encode("utf-8"))
        sshService.upload_file(
            ip, private_key,
            f"/etc/systemd/system/{CHANNEL_SYNC_SERVICE_NAME}",
            CHANNEL_SYNC_SERVICE_UNIT.format(remote_path=CHANNEL_SYNC_REMOTE_PATH).encode("utf-8"),
        )
        res = sshService.execute_command(
            ip, private_key,
            f"sudo systemctl daemon-reload && sudo systemctl enable {CHANNEL_SYNC_SERVICE_NAME} && sudo systemctl restart {CHANNEL_SYNC_SERVICE_NAME}",
        )
        return res.get("exitCode") == 0
    except Exception as e:
        logger.error(f"Failed to install channel_sync.py on {ip}: {e}")
        return False
