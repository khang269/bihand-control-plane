from typing import Optional, List, Dict, Any
from typing import Optional, List, Dict, Any
from .base_strategy import BaseProvisioningStrategy
from fastapp.models.instanceModel import InstanceModel
from fastapp.services import sshService

class OpenCodeStrategy(BaseProvisioningStrategy):
    def get_instructions_matrix(self) -> Dict[str, str]:
        return {
            "agentMd": "AGENTS.md"
        }

    def getInstructions(self, ip: str, private_key: str) -> List[Dict[str, Any]]:
        return self._get_specific_files_from_vm(ip, private_key, "/home/minerclaw/.config/opencode", ["AGENTS.md"])

    def editInstructions(self, ip: str, private_key: str, instructions: List[Dict[str, Any]]) -> bool:
        res = self._edit_specific_files_on_vm(ip, private_key, "/home/minerclaw/.config/opencode", instructions, ["AGENTS.md"])
        if res:
            sshService.execute_command(ip, private_key, "sudo chown -R minerclaw:minerclaw /home/minerclaw/.config/opencode")
        return res

    def getSkills(self, ip: str, private_key: str) -> List[Dict[str, Any]]:
        return self._get_skills_from_vm(ip, private_key, "/home/minerclaw/.config/opencode/skills")

    def editSkills(self, ip: str, private_key: str, skills: List[Dict[str, Any]]) -> bool:
        res = self._edit_skills_on_vm(ip, private_key, "/home/minerclaw/.config/opencode/skills", skills)
        if res:
            sshService.execute_command(ip, private_key, "sudo chown -R minerclaw:minerclaw /home/minerclaw/.config/opencode/skills")
        return res
    
    def get_startup_script(self, provider: str, api_key: str, model: str, password: str, gateway_token: str, agent_type: str = "opencode", api_url: str = "http://localhost:8501/api/internal", agent_md_b64: str = "", mcp_config_b64: str = "", custom_base_url: str = "") -> str:
        config = self.get_provider_config(provider)
        if provider.lower() == "custom":
            opencode_provider = "openai"
            extra_bashrc_envs = f'echo "export OPENAI_BASE_URL=\\"{custom_base_url}\\"" >> /root/.bashrc\necho "export OPENAI_BASE_URL=\\"{custom_base_url}\\"" >> /home/minerclaw/.bashrc\necho "OPENAI_BASE_URL=\\"{custom_base_url}\\"" >> /etc/environment'
            opencode_config_json = f"""{{
  "provider": {{
    "openai": {{
      "disabled": false,
      "options": {{
        "baseURL": "{custom_base_url}",
        "streaming": false
      }}
    }}
  }},
  "model": "openai/{model}"
}}"""
        elif provider.lower() == "bihand":
            opencode_provider = "openai"
            model = "gpt-4o-mini"
            base_url = api_url.replace("/api/internal", "")
            extra_bashrc_envs = f'echo "export OPENAI_BASE_URL=\\"{base_url}/api/llm/v1\\"" >> /root/.bashrc\necho "export OPENAI_BASE_URL=\\"{base_url}/api/llm/v1\\"" >> /home/minerclaw/.bashrc\necho "OPENAI_BASE_URL=\\"{base_url}/api/llm/v1\\"" >> /etc/environment'
            opencode_config_json = f"""{{
  "provider": {{
    "openai": {{
      "disabled": false,
      "options": {{
        "baseURL": "{base_url}/api/llm/v1",
        "streaming": false
      }}
    }}
  }},
  "model": "openai/gpt-4o-mini"
}}"""
        else:
            opencode_provider = "google" if provider.lower() == "gemini" else provider
            extra_bashrc_envs = ""
            opencode_config_json = f"""{{
  "provider": {{
    "{opencode_provider}": {{
      "disabled": false,
      "options": {{
        "streaming": false
      }}
    }}
  }},
  "model": "{opencode_provider}/{model}"
}}"""
        
        return rf"""#!/bin/bash
set -e
export HOME="/root"
exec > >(tee -a /var/log/opencode-startup.log /dev/ttyS1) 2>&1

echo "=== OpenCode Worker Startup ==="
echo "Timestamp: $(date -u)"

# --- Solve GCP Boot Egress Delay: Wait for Internet ---
echo "Waiting for internet connectivity..."
for i in {{1..30}}; do
    if curl -s --connect-timeout 3 http://www.google.com > /dev/null; then
        echo "Internet is up!"
        break
    fi
    sleep 2
done

# --- System Optimization: Swap ---
# Disable tmpfs on /tmp to prevent "No space left on device" during large builds
systemctl mask tmp.mount || true
umount /tmp || true

if [ ! -f /swapfile ]; then
    echo "Configuring 8GB swap..."
    fallocate -l 8G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# --- Hourly Disk Space and Cache Cleanup Cron Setup ---
echo "=== Configuring hourly disk space and cache cleanup cron ==="
cat << 'EOF' > /usr/local/bin/bihand-cleanup.sh
#!/bin/bash
docker system prune -af --volumes || true
npm cache clean --force || true
bun pm cache clean || true
yarn cache clean --force || true
pip cache purge || true
find /tmp -mindepth 1 -maxdepth 2 -mmin +120 -exec rm -rf {{}} + || true
journalctl --vacuum-size=100M || true
EOF
chmod +x /usr/local/bin/bihand-cleanup.sh
/usr/local/bin/bihand-cleanup.sh || true
(crontab -l 2>/dev/null; echo "0 * * * * /usr/local/bin/bihand-cleanup.sh >/dev/null 2>&1") | crontab - || true

# --- System Dependencies ---
export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a
export UCF_FORCE_CONFFOLD=1

apt-get update -y
apt-get install -y -o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold" curl wget git jq nginx \
    xvfb x11vnc novnc fluxbox python3-requests x11-xserver-utils \
    libnss3 libatk-bridge2.0-0 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libgbm1 libasound2t64

# Stop Nginx immediately after install to prevent the provisioner from marking the VM as running prematurely
systemctl stop nginx || true

# --- Install Google Chrome Stable ---
echo "Installing Google Chrome Stable..."
wget -q https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
apt-get install -y -o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold" ./google-chrome-stable_current_amd64.deb || apt-get install -fy -o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold"
rm -f google-chrome-stable_current_amd64.deb

# --- Setup Shared Headful Chrome Wrapper ---
echo "Creating Google Chrome system-wide wrapper..."
cat << 'EOF_CHROME' > /usr/local/bin/google-chrome
#!/bin/bash
export DISPLAY=:99
ARGS=()
for arg in "$@"; do
    if [[ "$arg" == --headless* ]]; then
        continue
    fi
    ARGS+=("$arg")
done
mkdir -p /home/minerclaw/.chrome-profile
chown -R minerclaw:minerclaw /home/minerclaw/.chrome-profile || true
exec /usr/bin/google-chrome-stable \
    --user-data-dir=/home/minerclaw/.chrome-profile \
    --remote-debugging-port=9222 \
    --no-sandbox \
    --no-first-run \
    --no-default-browser-check \
    "${{ARGS[@]}}"
EOF_CHROME
chmod +x /usr/local/bin/google-chrome
ln -sf /usr/local/bin/google-chrome /usr/local/bin/google-chrome-stable

# --- Install Node.js & NPM ---
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y -o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold" nodejs

# --- Install OpenCode ---
echo "Installing OpenCode..."
npm install -g opencode-ai@1.18.2

# Setup environment variables
echo "export OPENAI_API_KEY=\"{api_key}\"" >> /root/.bashrc
echo "export ANTHROPIC_API_KEY=\"{api_key}\"" >> /root/.bashrc
echo "export GEMINI_API_KEY=\"{api_key}\"" >> /root/.bashrc
echo "export PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/local/bin/google-chrome" >> /root/.bashrc

echo "export OPENAI_API_KEY=\"{api_key}\"" >> /home/minerclaw/.bashrc
echo "export ANTHROPIC_API_KEY=\"{api_key}\"" >> /home/minerclaw/.bashrc
echo "export GEMINI_API_KEY=\"{api_key}\"" >> /home/minerclaw/.bashrc
echo "export PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/local/bin/google-chrome" >> /home/minerclaw/.bashrc

echo "PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/local/bin/google-chrome" >> /etc/environment

{extra_bashrc_envs}

mkdir -p /home/minerclaw/workspace
mkdir -p /home/minerclaw/.config/opencode/skills
echo "{agent_md_b64}" | base64 -d > /home/minerclaw/.config/opencode/AGENTS.md

mkdir -p /home/minerclaw/.local/share/opencode
cat << 'EOF3' > /home/minerclaw/.local/share/opencode/auth.json
{{
  "{opencode_provider}": {{
    "type": "api",
    "key": "{api_key}"
  }}
}}
EOF3

# Setup OpenCode config file
cat << 'EOF3' > /home/minerclaw/.config/opencode/opencode.json
{opencode_config_json}
EOF3

# --- Apply Custom MD and MCP Config ---
echo "Applying Custom MCP Configuration..."
echo "{mcp_config_b64}" | base64 -d > /tmp/user_mcp.json
if jq -e . >/dev/null 2>&1 < /tmp/user_mcp.json; then
    jq -s '.[0] * .[1]' /home/minerclaw/.config/opencode/opencode.json /tmp/user_mcp.json > /tmp/merged.json
    mv /tmp/merged.json /home/minerclaw/.config/opencode/opencode.json
else
    echo "Invalid or empty MCP JSON provided. Skipping merge."
fi

# Fix ownership so minerclaw user owns everything
chown -R minerclaw:minerclaw /home/minerclaw/workspace /home/minerclaw/.config /home/minerclaw/.local

# Symlink compatibility with root user just in case
ln -sf /home/minerclaw/workspace /root/workspace
mkdir -p /root/.config
ln -sf /home/minerclaw/.config/opencode /root/.config/opencode
mkdir -p /root/.local/share
ln -sf /home/minerclaw/.local/share/opencode /root/.local/share/opencode

# --- Setup Virtual Screen (noVNC) ---
echo "Setting up Virtual Screen..."
mkdir -p /root/.vnc
x11vnc -storepasswd "{password}" /root/.vnc/passwd
chmod 600 /root/.vnc/passwd

# Start Xvfb (Virtual Framebuffer)
Xvfb :99 -screen 0 1280x800x24 > /dev/null 2>&1 &
export DISPLAY=:99

# Start Fluxbox Window Manager
fluxbox > /dev/null 2>&1 &

# Allow connections to X Server and start Shared Chrome inside the screen (managed by systemd for keep-alive robustness)
xhost + || true
mkdir -p /home/minerclaw/.chrome-profile
chown -R minerclaw:minerclaw /home/minerclaw/.chrome-profile

cat << 'EOF_CHROME_SERVICE' > /etc/systemd/system/google-chrome.service
[Unit]
Description=Keep-Alive Google Chrome on Virtual Display :99
After=network.target

[Service]
Type=simple
User=minerclaw
Environment=DISPLAY=:99
ExecStart=/usr/local/bin/google-chrome
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF_CHROME_SERVICE

systemctl daemon-reload
systemctl enable google-chrome.service
systemctl start google-chrome.service

# Wait for Xvfb to be ready before starting x11vnc
sleep 3

# Start x11vnc with noxdamage and noxfixes to prevent crashes
x11vnc -display :99 -rfbauth /root/.vnc/passwd -noxdamage -noxfixes -bg -forever -shared > /dev/null 2>&1 || true

# Start noVNC Web UI on port 6080 with websockify heartbeat
websockify --web=/usr/share/novnc/ --heartbeat 30 6080 localhost:5900 > /dev/null 2>&1 &

# --- Bihand M2M Bridge (Phase 3) ---
echo "Installing Bihand M2M Bridge..."
mkdir -p /opt/bihand

# 1. Create the Custom Tool CLI for the Agent to use
cat << 'EOF' > /usr/local/bin/bihand
#!/bin/bash
COMMAND=$1
TASK_ID=$2
shift 2

API_URL="{api_url}"

# Retries backend calls on network failures (DNS blips, connection refused) and 5xx
# responses (e.g. a control-plane pod mid-rollout/restart), with exponential backoff.
# Does NOT retry 4xx - those are real client errors that won't be fixed by retrying.
bihand_curl() {{
    local max_attempts=8
    local delay=2
    local max_delay=30
    local attempt=1
    local response http_code body curl_exit
    while true; do
        response=$(curl -s -w '\n%{{http_code}}' --connect-timeout 5 --max-time 15 "$@")
        curl_exit=$?
        http_code=$(printf '%s' "$response" | tail -n1)
        body=$(printf '%s' "$response" | sed '$d')
        if [ "$curl_exit" -eq 0 ] && [ -n "$http_code" ] && [ "${{http_code:0:1}}" != "5" ]; then
            printf '%s' "$body"
            return 0
        fi
        if [ "$attempt" -ge "$max_attempts" ]; then
            printf '%s' "$body"
            return 1
        fi
        sleep "$delay"
        delay=$((delay * 2))
        if [ "$delay" -gt "$max_delay" ]; then
            delay=$max_delay
        fi
        attempt=$((attempt + 1))
    done
}}

if [ "$COMMAND" = "complete" ]; then
    if [ $# -eq 0 ] || [ "${{1:-}}" = "-" ]; then
        RESULT=$(cat)
    else
        RESULT=$*
    fi
    if [ -z "$RESULT" ]; then
        PAYLOAD='{{"status":"done"}}'
    else
        PAYLOAD=$(printf '%s' "$RESULT" | node -e "let d='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>process.stdout.write(JSON.stringify({{status:'done',result:d}})));")
    fi
    bihand_curl -X PATCH "$API_URL/tasks/$TASK_ID/status" \
        -H "X-Agent-Token: {gateway_token}" \
        -H "Content-Type: application/json" \
        -d "$PAYLOAD"
    echo "Task marked as done with result."
elif [ "$COMMAND" = "report" ]; then
    if [ "${{1:-}}" = "-" ]; then
        MESSAGE=$(cat)
    else
        MESSAGE=$*
    fi
    PAYLOAD=$(printf '%s' "$MESSAGE" | node -e "let d='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>process.stdout.write(JSON.stringify({{content:d}})));")
    bihand_curl -X POST "$API_URL/tasks/$TASK_ID/comments" \
        -H "X-Agent-Token: {gateway_token}" \
        -H "Content-Type: application/json" \
        -d "$PAYLOAD"
    
    PAYLOAD_STATUS='{{"status": "in_review"}}'
    bihand_curl -X PATCH "$API_URL/tasks/$TASK_ID/status" \
        -H "X-Agent-Token: {gateway_token}" \
        -H "Content-Type: application/json" \
        -d "$PAYLOAD_STATUS"
    echo "Reported progress to issue thread and marked task for review."
elif [ "$COMMAND" = "delegate" ]; then
    ROLE=$1
    TITLE=$2
    shift 2
    
    DESC=""
    BLOCKED_BY=""
    while [ $# -gt 0 ]; do
        if [ "$1" = "--blocked-by" ]; then
            BLOCKED_BY=$2
            shift 2
        else
            if [ -z "$DESC" ]; then
                DESC="$1"
            else
                DESC="${{DESC}} $1"
            fi
            shift 1
        fi
    done
    
    PAYLOAD=$(node -e "
        const role = process.argv[1];
        const title = process.argv[2];
        const desc = process.argv[3];
        const parentId = process.argv[4];
        const blockersRaw = process.argv[5];
        const blockedByTaskIds = blockersRaw ? blockersRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
        console.log(JSON.stringify({{
            role,
            title,
            description: desc,
            parentTaskId: parentId,
            blockedByTaskIds
        }}));
    " "$ROLE" "$TITLE" "$DESC" "$TASK_ID" "$BLOCKED_BY")
    RES=$(bihand_curl -X POST "$API_URL/tasks/delegate" \
        -H "X-Agent-Token: {gateway_token}" \
        -H "Content-Type: application/json" \
        -d "$PAYLOAD")
    SUBTASK_ID=$(node -e "const res = JSON.parse(process.argv[1]); console.log(res.taskId || res.error || 'ERROR');" "$RES")
    echo "Delegated to $ROLE. Subtask ID: $SUBTASK_ID"
elif [ "$COMMAND" = "block" ]; then
    BLOCKER_ID=$1
    PAYLOAD=$(node -e "console.log(JSON.stringify({{blockedByTaskId: process.argv[1]}}))" "$BLOCKER_ID")
    bihand_curl -X POST "$API_URL/tasks/$TASK_ID/block" \
        -H "X-Agent-Token: {gateway_token}" \
        -H "Content-Type: application/json" \
        -d "$PAYLOAD"
    echo "Task $TASK_ID is now blocked by $BLOCKER_ID. It will auto-resume when that task completes."
elif [ "$COMMAND" = "comment" ]; then
    if [ "${{1:-}}" = "-" ]; then
        MESSAGE=$(cat)
    else
        MESSAGE=$*
    fi
    PAYLOAD=$(printf '%s' "$MESSAGE" | node -e "let d='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>process.stdout.write(JSON.stringify({{content:d}})));")
    bihand_curl -X POST "$API_URL/tasks/$TASK_ID/comments" \
        -H "X-Agent-Token: {gateway_token}" \
        -H "Content-Type: application/json" \
        -d "$PAYLOAD"
    echo "Comment posted to issue thread."
elif [ "$COMMAND" = "post" ]; then
    PLATFORM=$1
    shift
    IMAGE_URL=""
    VIDEO_URL=""
    MEDIA_URLS=""
    while [ $# -gt 0 ]; do
        case "$1" in
            --image)
                IMAGE_URL="$2"
                shift 2
                ;;
            --video)
                VIDEO_URL="$2"
                shift 2
                ;;
            --media)
                MEDIA_URLS="$2"
                shift 2
                ;;
            *)
                break
                ;;
        esac
    done
    TEXT="$*"
    PAYLOAD=$(node -e "
      const payload = {{
        platform: process.argv[1],
        text: process.argv[2]
      }};
      if (process.argv[3]) payload.imageUrl = process.argv[3];
      if (process.argv[4]) payload.videoUrl = process.argv[4];
      if (process.argv[5]) payload.mediaUrls = process.argv[5].split(',');
      console.log(JSON.stringify(payload));
    " "$PLATFORM" "$TEXT" "$IMAGE_URL" "$VIDEO_URL" "$MEDIA_URLS")
     bihand_curl -X POST "$API_URL/social/post" \
         -H "X-Agent-Token: {gateway_token}" \
         -H "Content-Type: application/json" \
         -d "$PAYLOAD"
     echo "Social media post requested on $PLATFORM."
 elif [ "$COMMAND" = "google-token" ]; then
     RES=$(bihand_curl -X GET "$API_URL/google/token" -H "X-Agent-Token: {gateway_token}")
    TOKEN=$(node -e "const res = JSON.parse(process.argv[1]); console.log(res.access_token || 'ERROR');" "$RES")
    echo "$TOKEN"
else
    echo "Usage: bihand <complete|report|delegate|block|comment|post|google-token> <taskId> [args...]"
fi
EOF
chmod +x /usr/local/bin/bihand

# 2. Create the Python Heartbeat Daemon
cat << 'EOF' > /opt/bihand/heartbeat.py
import time
import requests
import subprocess
import os
import socket
import sys
import json as _json
import re as _re

# Force IPv4-only address resolution to bypass IPv6 connection hangs on IPv4-only VMs
orig_getaddrinfo = socket.getaddrinfo
def getaddrinfo_ipv4_only(host, port, family=0, type=0, proto=0, flags=0):
    return orig_getaddrinfo(host, port, socket.AF_INET, type, proto, flags)
socket.getaddrinfo = getaddrinfo_ipv4_only

API_URL = "{api_url}"
TOKEN = "{gateway_token}"
AGENT_TYPE = "{agent_type}"
MAX_NUDGE_ATTEMPTS = 3

def get_next_task():
    try:
        res = requests.get(f"{{API_URL}}/tasks/next", headers={{"X-Agent-Token": TOKEN}}, timeout=15)
        if res.status_code == 200:
            return res.json().get("task")
    except Exception as e:
        print(f"Error checking tasks: {{e}}")
    return None

def get_task_status(task_id):
    # Ground-truth check: did the last run actually call bihand complete/report/delegate/block?
    # Text-matching stdout for a success-looking line is not reliable, since bihand_curl's retry
    # wrapper always echoes that line whether or not the underlying request truly succeeded.
    try:
        res = requests.get(f"{{API_URL}}/tasks/{{task_id}}/status", headers={{"X-Agent-Token": TOKEN}}, timeout=15)
        if res.status_code == 200:
            return res.json().get("status")
    except Exception as e:
        print(f"Error checking task status: {{e}}")
    return None

def extract_final_answer(stdout_text):
    # Parses OpenCode's --format json event stream ({{"part": {{"content": [...]}}}} shape) for
    # the agent's own final message text, so it can be handed back verbatim when nudging it.
    parts = []
    for line in (stdout_text or "").splitlines():
        line_str = line.strip()
        if not line_str:
            continue
        try:
            m = _re.search(r'(\{{.*\}})', line_str)
            if m:
                data = _json.loads(m.group(1))
                if isinstance(data, dict):
                    part = data.get("part", {{}})
                    if isinstance(part, dict) and "content" in part:
                        content_list = part["content"]
                        if isinstance(content_list, list):
                            for c in content_list:
                                if isinstance(c, dict) and c.get("type") == "text":
                                    parts.append(c.get("text", ""))
                    elif "content" in data:
                        c = data["content"]
                        if isinstance(c, str):
                            parts.append(c)
                    elif "delta" in data:
                        d = data["delta"]
                        if isinstance(d, str):
                            parts.append(d)
        except Exception:
            pass
    return "\n".join([p for p in parts if p.strip()]).strip()

def execute_task(task):
    task_id = task["_id"]
    title = task["title"]
    desc = task["description"]
    company_name = task.get("companyName", "Autonomous Company")
    mission = task.get("companyMission", "")
    comments = task.get("comments", [])
    subs_info = task.get("subordinatesInfo", "No roles currently report to you or they are offline.")
    delegated_subtasks = task.get("delegatedSubtasks", [])
    
    chat_history = ""
    if comments:
        chat_history = "Task Chat History:\\n"
        for c in comments:
            chat_history += f"[{{c['role']}}]: {{c['content']}}\\n"

    subtasks_context = ""
    if delegated_subtasks:
        subtasks_context = (
            "==================================================\n"
            "🔔 DELEGATED SUBTASK RESULTS (You are being re-woken because all subtasks you delegated are now terminal):\n\n"
        )
        for st in delegated_subtasks:
            emoji = "✅" if st.get("status") == "done" else "❌"
            subtasks_context += (
                f"{{emoji}} **Subtask Title:** {{st.get('title', 'Untitled')}}\n"
                f"   **Status:** {{st.get('status', 'unknown')}}\n"
                f"   **Subordinate Deliverables & Result:**\n"
                f"   {{st.get('result', 'No result provided')}}\n"
                "--------------------------------------------------\n"
            )
        subtasks_context += (
            "\n"
            "👉 **MANDATORY PARENT AUDIT INSTRUCTIONS:**\n"
            "1. Run a thorough quality audit on the deliverables above.\n"
            "2. If deliverables are missing, broken, or substandard, DO NOT mark this task complete. Explain the issues and run `bihand delegate` to command subordinates to make corrections.\n"
            "3. If all results are verified, merge/integrate them and run the final `bihand complete` command.\n\n"
            "🔔 **IMPORTANT STATUS REPORTING REQUIREMENT:**\n"
            "Now that you are awake, your task status is once again `in_progress`. You must execute either `bihand complete`, `bihand delegate`, or `bihand report` before exiting your main loop/process! Failure to invoke the `bihand` CLI tool will bypass status tracking, trigger a timeout, and mark your task as unresolved.\n"
            "==================================================\n\n"
        )
            
    prompt = (
        f"==================================================\n"
        f"🚨 MANDATORY USER REQUEST TO EXECUTE:\n"
        f"'{{title}}'\n\n"
        f"DESCRIPTION / REQUIREMENTS:\n"
        f"{{desc}}\n"
        f"==================================================\n\n"
        f"Your Company: '{{company_name}}'\n"
        f"Your Company Mission: '{{mission}}'\n\n"
        f"LIVE ORG CHART (Subordinate roles currently online & reporting to you): {{subs_info}}\n"
        f"*(Note: You are strictly forbidden from delegating tasks to any roles not listed above)*\n\n"
        f"{{chat_history}}"
        f"{{subtasks_context}}"
        f"🔔 **IMPORTANT RUNTIME CONSTRAINT (READ CAREFULLY):**\n"
        f"You must systematically execute one of the custom CLI commands below to report your final progress before exiting your process. If your main loop, run, or script terminates while the task status is active, the control plane's process monitor will assume your run stalled and mark it as unresolved.\n\n"
        f"👉 **MANDATORY STATE-REPORTING CLI COMMANDS:**\n"
        f"1. To mark the task completely DONE: Run `bihand complete {{task_id}} \"<detailed_final_results_summary>\"`.\n"
        f"2. To delegate subtasks to subordinates: Run `bihand delegate {{task_id}} <subordinate_role> \"<subtask_title>\" \"<description_instructions>\"`.\n"
        f"3. To pause for comments or ask a human question: Run `bihand report {{task_id}} \"<your message/question>\"`.\n\n"
        f"Every command requires your current Task ID ({{task_id}}) as the second argument."
    )
    
    print(f"Waking up OpenCode for task {{task_id}}...")
    
    # Securely retrieve a fresh short-lived Google Access Token from the Bihand Control Plane proxy
    google_access_token = None
    try:
        token_res = requests.get(f"{{API_URL}}/google/token", headers={{"X-Agent-Token": TOKEN}}, timeout=10)
        if token_res.status_code == 200:
            google_access_token = token_res.json().get("access_token")
    except Exception as e:
        print(f"Warning: Failed to fetch Google Access Token proxy from Control Plane: {{e}}")
    
    env = os.environ.copy()
    if google_access_token:
        env["GOG_ACCESS_TOKEN"] = google_access_token
        env["GOOGLE_ACCESS_TOKEN"] = google_access_token

    def run_opencode_once(run_prompt):
        run_error_msg = None
        try:
            run_res = subprocess.run(["opencode", "run", "--pure", "--dangerously-skip-permissions", "--format", "json", run_prompt], cwd="/home/minerclaw/workspace", stdin=subprocess.DEVNULL, env=env, timeout=3600, capture_output=True, text=True)
        except subprocess.TimeoutExpired:
            run_res = subprocess.CompletedProcess(args=[], returncode=124, stdout="", stderr="Execution timed out after 1 hour.")
            run_error_msg = "Execution timed out after 1 hour (3600s)."
        if run_res.stdout:
            sys.stdout.write(run_res.stdout)
            sys.stdout.flush()
        if run_res.stderr:
            sys.stderr.write(run_res.stderr)
            sys.stderr.flush()

        if run_res.returncode != 0 and not run_error_msg:
            combined = (run_res.stderr or "") + "\n" + (run_res.stdout or "")
            if "Credit balance is too low" in combined:
                run_error_msg = "Credit balance is too low to access the Anthropic API. Please check your billing settings."
            elif "Authentication Failed" in combined or "invalid x-api-key" in combined or "authentication_error" in combined:
                run_error_msg = "Authentication Failed: Invalid API Key or Credentials."
            else:
                lines = [l.strip() for l in combined.splitlines() if l.strip()]
                if lines:
                    run_error_msg = "Error: " + " | ".join(lines[-3:])
                else:
                    run_error_msg = f"Agent process exited with non-zero code {{run_res.returncode}}."
        return run_res, run_error_msg

    # This mechanism lives entirely on the VM: if the agent exits without calling bihand
    # complete/report/delegate/block, we re-invoke it directly (in a tight loop, up to
    # MAX_NUDGE_ATTEMPTS times) with its own prior response and an explicit instruction to
    # finalize - instead of asking the backend to guess a disposition on its behalf. Only if
    # the agent still hasn't finalized after all nudges do we call the watchdog, which then
    # just records the failure using the agent's own last answer as the result.
    current_prompt = prompt
    original_answer = None
    res = None
    error_msg = None

    for attempt in range(MAX_NUDGE_ATTEMPTS + 1):
        res, error_msg = run_opencode_once(current_prompt)

        status = get_task_status(task_id)
        if status != "in_progress":
            break

        if original_answer is None:
            candidate = extract_final_answer(res.stdout or "")
            if len(candidate) > 100:
                original_answer = candidate

        if original_answer is None:
            break

        if attempt >= MAX_NUDGE_ATTEMPTS:
            break

        print(f"Task {{task_id}} still in_progress after attempt {{attempt + 1}} - nudging agent to finalize (retry {{attempt + 1}}/{{MAX_NUDGE_ATTEMPTS}})...")
        current_prompt = (
            f"You previously produced the response below for task {{task_id}}, but exited without calling "
            f"bihand complete, bihand report, or bihand delegate to finalize it:\n\n"
            f"---\n{{original_answer}}\n---\n\n"
            f"Do NOT redo the work. Immediately call the correct command now:\n"
            f"- bihand complete {{task_id}} \"<summary>\" if this is finished\n"
            f"- bihand report {{task_id}} \"<summary>\" if it needs human review\n"
            f"- bihand delegate {{task_id}} <role> \"<title>\" \"<description>\" if it should be delegated\n"
        )

    # Paperclip-style Watchdog Check - only reached if still unresolved after all attempts
    final_status = get_task_status(task_id)
    if final_status == "in_progress":
        try:
            run_id = task.get("runId")
            if run_id:
                print(f"Agent process ended without a disposition. Notifying watchdog for run {{run_id}}...")
                watchdog_payload = {{}}
                if original_answer:
                    watchdog_payload["originalAnswer"] = original_answer
                    watchdog_payload["errorDetails"] = f"Agent did not finalize the task after {{MAX_NUDGE_ATTEMPTS}} retries."
                elif error_msg:
                    watchdog_payload["errorDetails"] = error_msg
                if res is not None and res.stdout:
                    watchdog_payload["stdout"] = res.stdout
                if res is not None and res.stderr:
                    watchdog_payload["stderr"] = res.stderr

                requests.post(
                    f"{{API_URL}}/tasks/{{task_id}}/runs/{{run_id}}/watchdog",
                    headers={{"X-Agent-Token": TOKEN}},
                    json=watchdog_payload,
                    timeout=15
                )
        except Exception as e:
            print(f"Error calling watchdog: {{e}}")

def reset_stale_tasks():
    try:
        print("Agent booting. Resetting any stale in_progress tasks...")
        res = requests.post(f"{{API_URL}}/tasks/reset-stale", headers={{"X-Agent-Token": TOKEN}}, timeout=15)
        if res.status_code == 200:
            count = res.json().get("reset", 0)
            if count > 0:
                print(f"Successfully reset {{count}} stale task(s) back to todo.")
    except Exception as e:
        print(f"Warning: Failed to reset stale tasks: {{e}}")

def main():
    reset_stale_tasks()
    while True:
        task = get_next_task()
        if task:
            execute_task(task)
        else:
            time.sleep(60)

if __name__ == "__main__":
    main()
EOF

# 3. Setup Systemd Service
cat << 'EOF' > /etc/systemd/system/bihand-heartbeat.service
[Unit]
Description=Bihand M2M Heartbeat Daemon
After=network.target

[Service]
ExecStart=/usr/bin/python3 /opt/bihand/heartbeat.py
Restart=always
User=minerclaw
Environment=HOME=/home/minerclaw
Environment=OPENAI_API_KEY={api_key}
Environment=ANTHROPIC_API_KEY={api_key}
Environment=GEMINI_API_KEY={api_key}
Environment=PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/local/bin/google-chrome
EnvironmentFile=-/home/minerclaw/.bihand/google_workspace.env

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now bihand-heartbeat.service

# --- Nginx Proxy for VNC ---
cat <<'EOF2' > /etc/nginx/sites-available/default
server {{
    listen 80;
    server_name _;
    
    # noVNC Virtual Screen UI files
    location /screen/ {{
        proxy_pass http://127.0.0.1:6080/;
        proxy_set_header Host $host;
    }}
    
    # noVNC WebSockets
    location /screen/websockify {{
        proxy_pass http://127.0.0.1:6080/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 3600s;
        proxy_buffering off;
    }}

    # Fallback websockify route
    location /websockify {{
        proxy_pass http://127.0.0.1:6080/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 3600s;
        proxy_buffering off;
    }}
    
    # Wildcard user webapps
    location / {{
        proxy_pass http://127.0.0.1:8080/;
        proxy_set_header Host $host;
    }}
}}
EOF2

rm -f /etc/nginx/sites-enabled/default
ln -s /etc/nginx/sites-available/default /etc/nginx/sites-enabled/default
systemctl restart nginx

echo "=== Startup script complete. OpenCode Worker ready! ==="
"""
    def getAgentConfig(self, ip: str, private_key: str) -> str:
        # OpenCode uses /home/minerclaw/.config/opencode/opencode.json for its primary settings.
        # Ensure we read the active configurations instead of isolated files.
        res = self._get_specific_files_from_vm(ip, private_key, "/home/minerclaw/.config/opencode", ["opencode.json"])
        return res[0]["content"] if res else ""

    def editAgentConfig(self, ip: str, private_key: str, config_content: str) -> bool:
        files = [{"name": "opencode.json", "content": config_content}]
        return self._edit_specific_files_on_vm(ip, private_key, "/home/minerclaw/.config/opencode", files, ["opencode.json"])

    def getMcpConfig(self, ip: str, private_key: str) -> str:
        # Directly read and normalize the active opencode.json on the VM
        from fastapp.utils import mcp_normalizer
        current_raw = self.getAgentConfig(ip, private_key)
        return mcp_normalizer.normalize_to_claudecode(current_raw)

    def editMcpConfig(self, ip: str, private_key: str, mcp_config: str) -> bool:
        from fastapp.utils import mcp_normalizer
        # Overwrite the opencode.json on the VM with normalized OpenCode MCP config
        opencode_mcp_raw = mcp_normalizer.normalize_to_opencode(mcp_config)
        import json
        try:
            opencode_mcp = json.loads(opencode_mcp_raw)
            # Read current opencode.json
            current_raw = self.getAgentConfig(ip, private_key)
            current_json = json.loads(current_raw) if current_raw else {}
            if not isinstance(current_json, dict):
                current_json = {}
            
            # new_mcp (derived from the DB's mcpConfig) is the full authoritative set of
            # user-configured servers, so it replaces current_mcp wholesale - a server absent from
            # it (e.g. after a disconnect) must actually be removed, not left behind forever.
            # chrome-devtools is the one exception: it's only ever injected into the VM's startup
            # script/boot-time config (see provisionerService.py), never persisted into the DB's
            # mcpConfig, so it must be explicitly preserved here or every push would silently wipe it.
            current_mcp = current_json.get("mcp", {})
            new_mcp = opencode_mcp.get("mcp", {})
            merged_mcp = dict(new_mcp)
            if "chrome-devtools" in current_mcp and "chrome-devtools" not in merged_mcp:
                merged_mcp["chrome-devtools"] = current_mcp["chrome-devtools"]

            merged_json = {**current_json, "mcp": merged_mcp}
            success = self.editAgentConfig(ip, private_key, json.dumps(merged_json, indent=2))
            if success:
                # Align ownership of newly touched files to minerclaw user
                from fastapp.services import sshService
                sshService.execute_command(ip, private_key, "sudo chown -R minerclaw:minerclaw /home/minerclaw/workspace /home/minerclaw/.config")
            return success
        except Exception:
            return False

    def restartAgent(self, ip: str, private_key: str) -> bool:
        # Opencode doesn't currently have a dedicated service restart that is easily reachable via SSH command
        # as it usually runs in a screen or directly. But we can kill and let the heartbeat/process manager restart it if one exists.
        # For now, we'll just return True as config is usually picked up or not needed to restart for.
        return True

    async def extract_token(self, instance_id: str, vm_name: str, zone: str, external_ip: str, logger_func, gateway_token: str) -> Optional[str]:
        InstanceModel._updateToken(instance_id, gateway_token)
        logger_func(f"OpenCode initialized. Virtual Screen available at http://{external_ip}/screen/vnc.html")
        return gateway_token

    def get_workspace_path(self) -> str:
        return "/home/minerclaw/workspace"
