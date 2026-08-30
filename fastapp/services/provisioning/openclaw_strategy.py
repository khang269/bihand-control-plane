from typing import Optional, List, Dict, Any
from .base_strategy import BaseProvisioningStrategy
from fastapp.models.instanceModel import InstanceModel
from fastapp.services import sshService

class OpenClawStrategy(BaseProvisioningStrategy):
    def getInstructions(self, ip: str, private_key: str) -> List[Dict[str, Any]]:
        return self._get_specific_files_from_vm(ip, private_key, "/root/.openclaw/workspace", ["AGENTS.md", "HEARTBEAT.md", "SOUL.md", "TOOLS.md"])

    def editInstructions(self, ip: str, private_key: str, instructions: List[Dict[str, Any]]) -> bool:
        return self._edit_specific_files_on_vm(ip, private_key, "/root/.openclaw/workspace", instructions, ["AGENTS.md", "HEARTBEAT.md", "SOUL.md", "TOOLS.md"], "sudo docker restart openclaw-openclaw-gateway-1 || true")

    def getSkills(self, ip: str, private_key: str) -> List[Dict[str, Any]]:
        return self._get_skills_from_vm(ip, private_key, "/root/.openclaw/skills")

    def editSkills(self, ip: str, private_key: str, skills: List[Dict[str, Any]]) -> bool:
        res = self._edit_skills_on_vm(ip, private_key, "/root/.openclaw/skills", skills)
        if res:
            from fastapp.services import sshService
            sshService.execute_command(ip, private_key, "sudo chown -R 1000:1000 /root/.openclaw")
            sshService.execute_command(ip, private_key, "sudo docker restart openclaw-openclaw-gateway-1 || true")
        return res
    
    def get_startup_script(self, provider: str, api_key: str, model: str, password: str, gateway_token: str, agent_type: str = "openclaw", api_url: str = "http://localhost:8501/api/internal", agent_md_b64: str = "", mcp_config_b64: str = "", custom_base_url: str = "") -> str:
        config = self.get_provider_config(provider)
        actual_provider = config["provider"]

        # Normalize provider and key name according to LiteLLM standard
        # "remember change any google/ to gemini/ and GOOGLE_API_KEY to GEMINI_API_KEY"
        if provider.lower() == "custom":
            # Custom endpoints are called directly (models.providers.custom.baseUrl below),
            # never via the local litellm-proxy container, so these litellm_* vars are unused -
            # set to harmless defaults so the shared docker_env_lines/env_keys code below (which
            # every branch runs through) doesn't need its own custom-aware special case.
            litellm_provider_prefix = "openai"
            litellm_key_name = "OPENAI_API_KEY"
            litellm_model = f"openai/{model}"
            key_env = f'OPENAI_API_KEY="{api_key}"\nNVIDIA_API_KEY="{api_key}"'
        elif provider.lower() == "bihand":
            base_url = api_url.replace("/api/internal", "")
            litellm_provider_prefix = "openai"
            litellm_key_name = "OPENAI_API_KEY"
            litellm_model = "openai/gemini-3.5-flash"
            key_env = f'OPENAI_API_KEY="{api_key}"\nOPENAI_API_BASE="{base_url}/api/llm/v1"\nNVIDIA_API_KEY="{api_key}"'
        elif actual_provider in ("google", "gemini"):
            litellm_provider_prefix = "gemini"
            litellm_key_name = "GEMINI_API_KEY"
            litellm_model = f"gemini/{model}"
            key_env = f'GEMINI_API_KEY="{api_key}"\nGOOGLE_API_KEY="{api_key}"\nNVIDIA_API_KEY="{api_key}"\nOPENAI_API_KEY="{api_key}"'
        elif actual_provider == "anthropic":
            litellm_provider_prefix = "anthropic"
            litellm_key_name = "ANTHROPIC_API_KEY"
            litellm_model = f"anthropic/{model}"
            key_env = f'ANTHROPIC_API_KEY="{api_key}"\nOPENAI_API_KEY="{api_key}"\nNVIDIA_API_KEY="{api_key}"'
        elif actual_provider == "openai":
            litellm_provider_prefix = "openai"
            litellm_key_name = "OPENAI_API_KEY"
            litellm_model = model
            key_env = f'OPENAI_API_KEY="{api_key}"\nNVIDIA_API_KEY="{api_key}"'
        else:
            litellm_provider_prefix = actual_provider
            litellm_key_name = f"{actual_provider.upper()}_API_KEY"
            litellm_model = f"{actual_provider}/{model}"
            key_env = f'OPENAI_API_KEY="{api_key}"\nNVIDIA_API_KEY="{api_key}"'
            
        extra_envs = "\n".join([f'{k}="{v}"' for k, v in config.get("envVars", {}).items()])
        
        env_keys = []
        for line in key_env.split('\n'):
            if '=' in line:
                env_keys.append(line.split('=')[0])
        for k in config.get("envVars", {}).keys():
            env_keys.append(k)
            
        # Ensure our LiteLLM Key is passed to docker environment
        if litellm_key_name not in env_keys:
            env_keys.append(litellm_key_name)
            
        docker_env_lines = "\n".join([f"      - {k}=${{{k}}}" for k in env_keys])
        
        # Build litellm service only if not using a direct provider (bihand's own proxy, or a
        # user-supplied custom base URL)
        if provider.lower() in ("bihand", "custom"):
            litellm_service_yaml = ""
        else:
            litellm_service_yaml = f"""
  litellm:
    image: ghcr.io/berriai/litellm:main-stable
    restart: unless-stopped
    network_mode: host
    environment:
      - {litellm_key_name}=${{{litellm_key_name}}}
    command: ["--model", "{litellm_model}", "--alias", "{model}", "--port", "4000"]"""
        
        # Pre-build JSON structures in python to avoid escaping brackets in multiline string
        import json
        
        if provider.lower() == "bihand":
            base_url = api_url.replace("/api/internal", "")
            openclaw_json_dict = {
                "gateway": {
                    "controlUi": {
                        "dangerouslyDisableDeviceAuth": True
                    }
                },
                "agents": {
                    "defaults": {
                        "model": {
                            "primary": "bihand-proxy/gemini-3.5-flash"
                        }
                    }
                },
                "models": {
                    "mode": "merge",
                    "providers": {
                        "bihand-proxy": {
                            "baseUrl": f"{base_url}/api/llm/v1",
                            "apiKey": api_key,
                            "api": "openai-completions",
                            "models": [
                                {
                                    "id": "gemini-3.5-flash",
                                    "name": "Bihand Proxy Model",
                                    "contextWindow": 1048576,
                                    "maxTokens": 65536,
                                    "input": ["text", "image"]
                                }
                            ]
                        }
                    }
                }
            }
            auth_profiles_dict = {
                "bihand-proxy": {
                    "apiKey": api_key
                }
            }
        elif provider.lower() == "custom":
            openclaw_json_dict = {
                "gateway": {
                    "controlUi": {
                        "dangerouslyDisableDeviceAuth": True
                    }
                },
                "agents": {
                    "defaults": {
                        "model": {
                            "primary": f"custom/{model}"
                        }
                    }
                },
                "models": {
                    "mode": "merge",
                    "providers": {
                        "custom": {
                            "baseUrl": custom_base_url,
                            "apiKey": api_key,
                            "api": "openai-completions",
                            "models": [
                                {
                                    "id": model,
                                    "name": "Custom Provider Model",
                                    "contextWindow": 1048576,
                                    "maxTokens": 65536,
                                    "input": ["text", "image"]
                                }
                            ]
                        }
                    }
                }
            }
            auth_profiles_dict = {
                "custom": {
                    "apiKey": api_key
                }
            }
        else:
            openclaw_json_dict = {
                "gateway": {
                    "controlUi": {
                        "dangerouslyDisableDeviceAuth": True
                    }
                },
                "agents": {
                    "defaults": {
                        "model": {
                            "primary": f"litellm-proxy/{model}"
                        }
                    }
                },
                "models": {
                    "mode": "merge",
                    "providers": {
                        "litellm-proxy": {
                            "baseUrl": "http://127.0.0.1:4000/v1",
                            "apiKey": "custom-local",
                            "api": "openai-completions",
                            "models": [
                                {
                                    "id": model,
                                    "name": "LiteLLM Proxy Model",
                                    "contextWindow": 1048576,
                                    "maxTokens": 65536,
                                    "input": ["text", "image"]
                                }
                            ]
                        }
                    }
                }
            }
            auth_profiles_dict = {
                "litellm-proxy": {
                    "apiKey": "custom-local"
                }
            }

        openclaw_json_str = json.dumps(openclaw_json_dict, indent=2)
        auth_profiles_str = json.dumps(auth_profiles_dict, indent=2)
        
        return rf"""#!/bin/bash
set -e
export HOME="/root"
exec > >(tee -a /var/log/minerclaw-startup.log /dev/ttyS1) 2>&1

echo "=== minerClaw Autonomous Startup (OpenClaw) ==="
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
# Disable tmpfs on /tmp to prevent "No space left on device" during large Docker builds
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

# --- Dependencies ---
echo "Installing Docker, VNC, and system libraries..."
apt-get update -y
DEBIAN_FRONTEND=noninteractive apt-get install -y git curl ca-certificates nginx apache2-utils jq wget python3-requests \
    xvfb x11vnc novnc fluxbox x11-xserver-utils \
    libnss3 libatk-bridge2.0-0 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libgbm1 libasound2t64

# --- Install Google Chrome Stable ---
echo "Installing Google Chrome Stable..."
wget -q https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
apt-get install -y ./google-chrome-stable_current_amd64.deb || apt-get install -fy
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

# Configure Docker daemon
mkdir -p /etc/docker
cat <<EOF > /etc/docker/daemon.json
{{
  "default-cgroupns-mode": "host"
}}
EOF

curl -fsSL https://get.docker.com | sh
systemctl enable --now docker

# --- OpenClaw Directories ---
echo "Creating OpenClaw persistent directories..."
mkdir -p /root/.openclaw
mkdir -p /root/.openclaw/skills
mkdir -p /root/.openclaw/workspace
mkdir -p /root/.openclaw/agents/main/agent

# --- Nginx Security Proxy ---
echo "Generating Self-Signed SSL Certificate..."
mkdir -p /etc/ssl/private /etc/ssl/certs
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout /etc/ssl/private/nginx-selfsigned.key \
  -out /etc/ssl/certs/nginx-selfsigned.crt \
  -subj "/C=US/ST=State/L=City/O=MinerClaw/CN=localhost"

echo "Configuring Nginx with Dashboard Password..."
# We use 'admin' as the default user for htpasswd
htpasswd -bc /etc/nginx/.htpasswd admin "{password}"

cat <<'EOF' > /etc/nginx/sites-available/default
map $http_authorization $auth_realm {{
    default "NemoClaw Secure Workspace";
    ~^Bearer off;
}}

map $http_authorization $proxied_auth {{
    default "";
    ~^Bearer $http_authorization;
}}

server {{
    listen 80;
    server_name _;
    
    # noVNC Virtual Screen UI files (token-authenticated, bypass basic auth)
    location /screen/ {{
        auth_basic off;
        proxy_pass http://127.0.0.1:6080/;
        proxy_set_header Host $host;
    }}

    # noVNC WebSockets
    location /screen/websockify {{
        auth_basic off;
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
        auth_basic off;
        proxy_pass http://127.0.0.1:6080/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 3600s;
        proxy_buffering off;
    }}

    location / {{
        auth_basic $auth_realm;
        auth_basic_user_file /etc/nginx/.htpasswd;
        
        proxy_pass http://127.0.0.1:18789;
        proxy_set_header Host 127.0.0.1:18789;
        proxy_set_header Origin "http://127.0.0.1:18789";
        proxy_set_header Referer "http://127.0.0.1:18789/";
        proxy_set_header Authorization $proxied_auth;
        
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_read_timeout 86400;
        
        proxy_buffering off;
        client_max_body_size 100M;
    }}
}}

server {{
    listen 443 ssl;
    server_name _;

    ssl_certificate /etc/ssl/certs/nginx-selfsigned.crt;
    ssl_certificate_key /etc/ssl/private/nginx-selfsigned.key;

    # noVNC Virtual Screen UI files (token-authenticated, bypass basic auth)
    location /screen/ {{
        auth_basic off;
        proxy_pass http://127.0.0.1:6080/;
        proxy_set_header Host $host;
    }}

    # noVNC WebSockets
    location /screen/websockify {{
        auth_basic off;
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
        auth_basic off;
        proxy_pass http://127.0.0.1:6080/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 3600s;
        proxy_buffering off;
    }}

    location / {{
        auth_basic $auth_realm;
        auth_basic_user_file /etc/nginx/.htpasswd;
        
        proxy_pass http://127.0.0.1:18789;
        proxy_set_header Host 127.0.0.1:18789;
        proxy_set_header Origin "http://127.0.0.1:18789";
        proxy_set_header Referer "http://127.0.0.1:18789/";
        proxy_set_header Authorization $proxied_auth;
        
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_read_timeout 86400;
        
        proxy_buffering off;
        client_max_body_size 100M;
    }}
}}
EOF

rm -f /etc/nginx/sites-enabled/default
ln -s /etc/nginx/sites-available/default /etc/nginx/sites-enabled/default
# Do not start Nginx yet to avoid premature health check triggers from the control plane
systemctl stop nginx || true

# --- Setup Virtual Screen (noVNC) ---
echo "Setting up Virtual Screen..."
mkdir -p /root/.vnc
x11vnc -storepasswd "{password}" /root/.vnc/passwd
chmod 600 /root/.vnc/passwd

# Start Xvfb (Virtual Framebuffer)
Xvfb :99 -screen 0 1280x800x24 > /dev/null 2>&1 &
export DISPLAY=:99
sleep 3

# Start Fluxbox Window Manager
fluxbox > /dev/null 2>&1 &
sleep 1

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

# Start x11vnc with noxdamage and noxfixes to prevent crashes
x11vnc -display :99 -rfbauth /root/.vnc/passwd -noxdamage -noxfixes -bg -forever -shared > /dev/null 2>&1 || true
sleep 1

# Start noVNC Web UI on port 6080 with websockify heartbeat
websockify --web=/usr/share/novnc/ --heartbeat 30 6080 localhost:5900 > /dev/null 2>&1 &

# --- Prepare OpenClaw Directory ---
echo "Preparing OpenClaw directory..."
mkdir -p /opt/openclaw
cd /opt/openclaw

# --- Environment Variables ---
echo "Configuring environment variables..."
GOG_KEYRING_PASSWORD=$(openssl rand -hex 32)


cat <<EOF > .env
OPENCLAW_IMAGE=alpine/openclaw:2026.6.9
OPENCLAW_GATEWAY_TOKEN={gateway_token}
OPENCLAW_GATEWAY_BIND=lan
OPENCLAW_GATEWAY_PORT=18789
OPENCLAW_CONFIG_DIR=/home/node/.openclaw
OPENCLAW_WORKSPACE_DIR=/home/node/.openclaw/workspace
GOG_KEYRING_PASSWORD=$GOG_KEYRING_PASSWORD
GOG_KEYRING_BACKEND=file
GOG_HOME=/home/node/.openclaw/gog
XDG_CONFIG_HOME=/home/node/.openclaw
OPENCLAW_DISABLE_DEVICE_AUTH=1
OPENCLAW_ACCEPT_THIRD_PARTY_SOFTWARE=1
NEMOCLAW_DISABLE_DEVICE_AUTH=1
OPENCLAW_MODEL="{model}"
NEMOCLAW_MODEL="{model}"
{key_env}
{extra_envs}
EOF

cat <<'EOF' > docker-compose.yml
services:
  openclaw-gateway:
    image: ${{OPENCLAW_IMAGE}}
    restart: unless-stopped
    network_mode: host
    env_file:
      - .env
    environment:
      - HOME=/home/node
      - NODE_ENV=production
      - TERM=xterm-256color
      - OPENCLAW_GATEWAY_BIND=lan
      - OPENCLAW_GATEWAY_PORT=18789
      - OPENCLAW_GATEWAY_TOKEN={gateway_token}
      - XDG_CONFIG_HOME=/home/node/.openclaw
      - OPENCLAW_DISABLE_DEVICE_AUTH=1
      - OPENCLAW_ACCEPT_THIRD_PARTY_SOFTWARE=1
      - NEMOCLAW_DISABLE_DEVICE_AUTH=1
      - OPENCLAW_MODEL="{model}"
      - NEMOCLAW_MODEL="{model}"
      - PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/local/bin/google-chrome
      - DISPLAY=:99
      - PATH=/home/node/.openclaw/bin:/home/linuxbrew/.linuxbrew/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
{docker_env_lines}
    volumes:
      - /root/.openclaw:/home/node/.openclaw
      - /usr/local/bin/bihand:/usr/local/bin/bihand:ro
      - /usr/local/bin/google-chrome:/usr/local/bin/google-chrome:ro
      - /usr/local/bin/google-chrome-stable:/usr/local/bin/google-chrome-stable:ro
      - /usr/bin/google-chrome-stable:/usr/bin/google-chrome-stable:ro
      - /home/minerclaw/.chrome-profile:/home/minerclaw/.chrome-profile
      - /tmp/.X11-unix:/tmp/.X11-unix:ro
    command:
      [
        "node",
        "dist/index.js",
        "gateway",
        "--bind",
        "lan",
        "--port",
        "18789",
        "--allow-unconfigured"
      ]
{litellm_service_yaml}
EOF

echo "Configuring OpenClaw Agent settings..."
# Provide the default model via config
# openclaw.json:
cat <<'EOF' > /root/.openclaw/openclaw.json
{openclaw_json_str}
EOF

# --- Apply Custom MD and MCP Config ---
echo "Applying Custom Agent Configuration..."
echo "{agent_md_b64}" | base64 -d > /root/.openclaw/workspace/AGENTS.md
echo "{mcp_config_b64}" | base64 -d > /tmp/user_mcp.json
if jq -e . >/dev/null 2>&1 < /tmp/user_mcp.json; then
    jq -s '.[0] * .[1]' /root/.openclaw/openclaw.json /tmp/user_mcp.json > /tmp/merged.json
    mv /tmp/merged.json /root/.openclaw/openclaw.json
else
    echo "Invalid or empty MCP JSON provided. Skipping merge."
fi

# auth-profiles.json for the default agent:
# Using the API key directly for the provider in the auth profile.
cat <<'EOF' > /root/.openclaw/agents/main/agent/auth-profiles.json
{auth_profiles_str}
EOF


echo "Fixing directory permissions for Docker node user..."
chown -R 1000:1000 /root/.openclaw

# --- Bihand M2M Bridge CLI Tool ---
echo "Installing Bihand CLI..."
mkdir -p /opt/bihand
cat << 'EOF2' > /usr/local/bin/bihand
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
elif [ "$COMMAND" = "org" ]; then
    RES=$(bihand_curl -X GET "$API_URL/org" -H "X-Agent-Token: {gateway_token}")
    INFO=$(node -e "const res = JSON.parse(process.argv[1]); console.log(res.info || 'ERROR');" "$RES")
    echo "Active Subordinate Roles:"
    echo "$INFO"
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
EOF2
chmod +x /usr/local/bin/bihand

echo "Building and starting OpenClaw..."
docker compose up -d

echo "Waiting for local LiteLLM Proxy (port 4000) to start..."
for i in {{1..120}}; do
    if ss -lnt | grep -q ":4000"; then
        echo "LiteLLM is listening!"
        break
    fi
    echo "Still waiting for LiteLLM... (attempt $i)"
    sleep 5
done

echo "Waiting for OpenClaw container to initialize..."
for i in {{1..30}}; do
    if docker exec openclaw-openclaw-gateway-1 openclaw config validate >/dev/null 2>&1; then
        echo "OpenClaw container is responsive."
        break
    fi
    sleep 2
done

# Run openclaw doctor --fix to perform legacy auth-profiles.json SQLite migration and setup database cleanly on initial boot
docker exec openclaw-openclaw-gateway-1 openclaw doctor --fix || true

# Dynamically add VM's public IP to allowedOrigins for Control UI WebSocket connection (required since v2026.2.26)
IP=$(curl -s ifconfig.me || curl -s icanhazip.com || echo "")
if [ -n "$IP" ]; then
    echo "Adding public IP $IP to allowedOrigins..."
    docker exec openclaw-openclaw-gateway-1 openclaw config set gateway.controlUi.allowedOrigins '["http://localhost:18789", "http://127.0.0.1:18789", "http://'"$IP"':18789"]' || true
fi

docker restart openclaw-openclaw-gateway-1

# --- Python Heartbeat Daemon (Phase 3) ---
cat << 'EOF2' > /opt/bihand/heartbeat.py
import time
import requests
import subprocess
import os
import socket
import sys

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
    # OpenClaw's `node dist/index.js agent` invocation outputs plain text (no --json flag), so
    # the raw stdout tail IS the agent's final message.
    return (stdout_text or "").strip()

def reset_stale_inprogress():
    # Reset any in_progress tasks assigned to this agent back to todo so they get retried.
    try:
        res = requests.post(f"{{API_URL}}/tasks/reset-stale", headers={{"X-Agent-Token": TOKEN}}, timeout=15)
        if res.status_code == 200:
            count = res.json().get("reset", 0)
            if count:
                print(f"Reset {{count}} stale in_progress task(s) back to todo.")
    except Exception as e:
        print(f"Warning: could not reset stale tasks: {{e}}")

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
    
    print(f"Waking up OpenClaw for task {{task_id}}...")
    
    # Securely retrieve a fresh short-lived Google Access Token from the Bihand Control Plane proxy
    google_access_token = None
    try:
        token_res = requests.get(f"{{API_URL}}/google/token", headers={{"X-Agent-Token": TOKEN}}, timeout=10)
        if token_res.status_code == 200:
            google_access_token = token_res.json().get("access_token")
    except Exception as e:
        print(f"Warning: Failed to fetch Google Access Token proxy from Control Plane: {{e}}")
    
    def run_openclaw_once(run_prompt):
        # We execute OpenClaw CLI inside the Docker container to trigger the task
        cmd = [
            "docker", "exec", "-i"
        ]
        if google_access_token:
            cmd.extend(["-e", f"GOG_ACCESS_TOKEN={{google_access_token}}", "-e", f"GOOGLE_ACCESS_TOKEN={{google_access_token}}"])
        cmd.extend([
            "-e", "PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/local/bin/google-chrome",
            "-e", "DISPLAY=:99",
            "openclaw-openclaw-gateway-1",
            "node", "dist/index.js", "agent", "--session-id", "main", "--message", run_prompt
        ])
        run_error_msg = None
        run_res = subprocess.CompletedProcess(args=cmd, returncode=1, stdout="", stderr="")
        try:
            run_res = subprocess.run(cmd, timeout=3600, capture_output=True, text=True)
            if run_res.stdout:
                sys.stdout.write(run_res.stdout)
                sys.stdout.flush()
            if run_res.stderr:
                sys.stderr.write(run_res.stderr)
                sys.stderr.flush()
            if run_res.returncode != 0:
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
        except subprocess.TimeoutExpired:
            print(f"OpenClaw agent timed out for task {{task_id}} after 10 minutes.")
            run_error_msg = "Timeout Error: Agent execution timed out after 10 minutes."
        except Exception as e:
            print(f"Error running OpenClaw agent for task {{task_id}}: {{e}}")
            run_error_msg = f"Runtime Exception: {{str(e)}}"
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
        res, error_msg = run_openclaw_once(current_prompt)

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

def main():
    reset_stale_inprogress()
    while True:
        task = get_next_task()
        if task:
            execute_task(task)
        else:
            time.sleep(60)

if __name__ == "__main__":
    main()
EOF2

# 3. Setup Systemd Service
cat << 'EOF2' > /etc/systemd/system/bihand-heartbeat.service
[Unit]
Description=Bihand M2M Heartbeat Daemon
After=network.target docker.service

[Service]
ExecStart=/usr/bin/python3 /opt/bihand/heartbeat.py
Restart=always
User=root
Environment=HOME=/root

[Install]
WantedBy=multi-user.target
EOF2

systemctl daemon-reload

echo "Waiting for OpenClaw Dashboard (port 18789) to start..."
for i in {{1..120}}; do
    if ss -lnt | grep -q ":18789"; then
        echo "Dashboard is listening!"
        break
    fi
    echo "Still waiting... (attempt $i)"
    sleep 5
done

echo "Starting Nginx now that OpenClaw is ready..."
systemctl restart nginx

echo "Enabling and starting Bihand Heartbeat Service..."
systemctl enable --now bihand-heartbeat.service

echo "=== Startup script complete. OpenClaw ready on Port 80. ==="
"""

    async def extract_token(self, instance_id: str, vm_name: str, zone: str, external_ip: str, logger_func, gateway_token: str) -> Optional[str]:
        # For OpenClaw, we use the injected gateway_token
        InstanceModel._updateToken(instance_id, gateway_token)
        logger_func("Using pre-generated token for OpenClaw.")
        return gateway_token

    def get_workspace_path(self) -> str:
        return "/root/.openclaw/workspace"

    def getAgentConfig(self, ip: str, private_key: str) -> str:
        res = self._get_specific_files_from_vm(ip, private_key, "/root/.openclaw", ["openclaw.json"])
        return res[0]["content"] if res else ""

    def editAgentConfig(self, ip: str, private_key: str, config_content: str) -> bool:
        files = [{"name": "openclaw.json", "content": config_content}]
        return self._edit_specific_files_on_vm(ip, private_key, "/root/.openclaw", files, ["openclaw.json"])

    def getMcpConfig(self, ip: str, private_key: str) -> str:
        # Directly read and normalize the active openclaw.json on the VM
        from fastapp.utils import mcp_normalizer
        current_raw = self.getAgentConfig(ip, private_key)
        return mcp_normalizer.normalize_to_claudecode(current_raw)

    def editMcpConfig(self, ip: str, private_key: str, mcp_config: str) -> bool:
        from fastapp.utils import mcp_normalizer
        # Overwrite the openclaw.json on the VM with normalized OpenClaw MCP config
        openclaw_mcp_raw = mcp_normalizer.normalize_to_openclaw(mcp_config)
        import json
        try:
            openclaw_mcp = json.loads(openclaw_mcp_raw)
            # Read the current openclaw.json from the VM
            current_raw = self.getAgentConfig(ip, private_key)
            current_json = json.loads(current_raw) if current_raw else {}
            if not isinstance(current_json, dict):
                current_json = {}

            # new_servers (derived from the DB's mcpConfig) is the full authoritative set of
            # user-configured servers, so it replaces the current server set wholesale - a server
            # absent from it (e.g. after a disconnect) must actually be removed, not left behind
            # forever. chrome-devtools is the one exception: it's only ever injected into the VM's
            # startup script/boot-time config (see provisionerService.py), never persisted into the
            # DB's mcpConfig, so it must be explicitly preserved here or every push would silently
            # wipe it. A shallow top-level merge of the "mcp" key would ALSO wipe it (and every
            # other boot-time server) since "mcp" is a single nested key, not a flat one - merge
            # within mcp.servers specifically instead.
            current_mcp = current_json.get("mcp", {})
            if not isinstance(current_mcp, dict):
                current_mcp = {}
            current_servers = current_mcp.get("servers", {})
            if not isinstance(current_servers, dict):
                current_servers = {}
            new_servers = openclaw_mcp.get("mcp", {}).get("servers", {})

            merged_servers = dict(new_servers)
            if "chrome-devtools" in current_servers and "chrome-devtools" not in merged_servers:
                merged_servers["chrome-devtools"] = current_servers["chrome-devtools"]

            merged_mcp = {**current_mcp, "servers": merged_servers}
            merged_json = {**current_json, "mcp": merged_mcp}
            success = self.editAgentConfig(ip, private_key, json.dumps(merged_json, indent=2))
            if success:
                # Force recursive directory ownership fix and restart the container to apply changes
                from fastapp.services import sshService
                sshService.execute_command(ip, private_key, "sudo chown -R 1000:1000 /root/.openclaw")
                self.restartAgent(ip, private_key)
            return success
        except Exception:
            return False

    def restartAgent(self, ip: str, private_key: str) -> bool:
        res = sshService.execute_command(ip, private_key, "cd /opt/openclaw && sudo docker compose up -d --force-recreate")
        return res["exitCode"] == 0
