from typing import Optional, List, Dict, Any
from .base_strategy import BaseProvisioningStrategy
from fastapp.models.instanceModel import InstanceModel

class HermesStrategy(BaseProvisioningStrategy):
    
    def get_startup_script(self, provider: str, api_key: str, model: str, password: str, gateway_token: str, agent_type: str = "openclaw", api_url: str = "http://localhost:8501/api/internal") -> str:
        config = self.get_provider_config(provider)
        actual_provider = config["provider"]
        
        if actual_provider == "google" or actual_provider == "gemini":
            key_env = f'GOOGLE_API_KEY="{api_key}"\nGEMINI_API_KEY="{api_key}"'
            hermes_provider = "google"
        elif actual_provider == "anthropic":
            key_env = f'ANTHROPIC_API_KEY="{api_key}"'
            hermes_provider = "anthropic"
        elif actual_provider == "openrouter":
            key_env = f'OPENROUTER_API_KEY="{api_key}"'
            hermes_provider = "openrouter"
        else:
            key_env = f'OPENAI_API_KEY="{api_key}"'
            hermes_provider = "openai"
            
        extra_envs = "\n".join([f'{k}="{v}"' for k, v in config.get("envVars", {}).items()])
        
        env_keys = []
        for line in key_env.split('\n'):
            if '=' in line:
                env_keys.append(line.split('=')[0])
        for k in config.get("envVars", {}).keys():
            env_keys.append(k)
            
        return rf"""#!/bin/bash
set -e
export HOME="/root"
exec > >(tee -a /var/log/minerclaw-startup.log /dev/ttyS1) 2>&1

echo "=== minerClaw Autonomous Startup (Hermes Agent) ==="
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
echo "Installing Docker and utils..."
apt-get update -y
apt-get install -y git curl ca-certificates nginx apache2-utils jq wget

# Configure Docker daemon
mkdir -p /etc/docker
cat <<EOF > /etc/docker/daemon.json
{{
  "default-cgroupns-mode": "host"
}}
EOF

curl -fsSL https://get.docker.com | sh
systemctl enable --now docker

# --- Clone Hermes Agent ---
echo "Cloning Hermes Agent repository..."
mkdir -p /opt/hermes-agent
git clone --branch v2026.5.16 https://github.com/NousResearch/Hermes-Agent.git /opt/hermes-agent
cd /opt/hermes-agent

# Create isolated data dir
mkdir -p /root/.hermes

echo "Configuring Environment Variables..."
cat <<EOF > /opt/hermes-agent/.env
HERMES_UID=0
HERMES_GID=0
API_SERVER_HOST=127.0.0.1
API_SERVER_KEY={gateway_token}
HERMES_INFERENCE_PROVIDER={hermes_provider}
HERMES_INFERENCE_MODEL={model}
{key_env}
{extra_envs}
EOF

cat <<EOF > /root/.hermes/config.yaml
# Hermes Agent Auto-Config
model:
  provider: "{hermes_provider}"
  default: "{model}"
terminal:
  backend: "local"
  cwd: "/root"
  timeout: 300
agent:
  max_turns: 60
  reasoning_effort: "high"
# Explicitly enable the browser toolset for API/gateway interactions
toolsets: ["browser", "hermes-cli"]
EOF

# Make sure docker-compose knows about the .env file in the same directory by default.

# --- Nginx Security Proxy ---
echo "Generating Self-Signed SSL Certificate..."
mkdir -p /etc/ssl/private /etc/ssl/certs
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout /etc/ssl/private/nginx-selfsigned.key \
  -out /etc/ssl/certs/nginx-selfsigned.crt \
  -subj "/C=US/ST=State/L=City/O=MinerClaw/CN=localhost"

echo "Configuring Nginx with Dashboard Password..."
htpasswd -bc /etc/nginx/.htpasswd admin "{password}"

cat <<'EOF' > /etc/nginx/sites-available/default
map \$http_authorization \$auth_realm {{
    default "NemoClaw Secure Workspace";
    ~^Bearer off;
}}

server {{
    listen 80;
    server_name _;
    
    # Dashboard Proxy
    location / {{
        auth_basic \$auth_realm;
        auth_basic_user_file /etc/nginx/.htpasswd;
        
        proxy_pass http://127.0.0.1:9119;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }}
    
    # API Gateway Proxy (SSE support)
    location /v1/ {{
        auth_basic \$auth_realm;
        auth_basic_user_file /etc/nginx/.htpasswd;
        
        proxy_pass http://127.0.0.1:8642/v1/;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        
        # Disable buffering for SSE
        proxy_buffering off;
        proxy_cache off;
        proxy_set_header Connection '';
        proxy_http_version 1.1;
        chunked_transfer_encoding off;
        proxy_read_timeout 86400;
    }}
}}

server {{
    listen 443 ssl;
    server_name _;

    ssl_certificate /etc/ssl/certs/nginx-selfsigned.crt;
    ssl_certificate_key /etc/ssl/private/nginx-selfsigned.key;

    # Dashboard Proxy
    location / {{
        auth_basic \$auth_realm;
        auth_basic_user_file /etc/nginx/.htpasswd;
        
        proxy_pass http://127.0.0.1:9119;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }}
    
    # API Gateway Proxy (SSE support)
    location /v1/ {{
        auth_basic \$auth_realm;
        auth_basic_user_file /etc/nginx/.htpasswd;
        
        proxy_pass http://127.0.0.1:8642/v1/;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        
        # Disable buffering for SSE
        proxy_buffering off;
        proxy_cache off;
        proxy_set_header Connection '';
        proxy_http_version 1.1;
        chunked_transfer_encoding off;
        proxy_read_timeout 86400;
    }}
}}
EOF

rm -f /etc/nginx/sites-enabled/default
ln -s /etc/nginx/sites-available/default /etc/nginx/sites-enabled/default

echo "Creating systemd service for Hermes Agent..."
cat <<EOF > /etc/systemd/system/hermes-agent.service
[Unit]
Description=Hermes Agent Docker Compose Service
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/hermes-agent
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now hermes-agent.service

echo "Waiting for Hermes Gateway (port 8642) and Dashboard (port 9119) to start..."
for i in {{1..120}}; do
    if ss -lnt | grep -q ":8642"; then
        echo "API Server is listening!"
        break
    fi
    # Use single quotes or escape \$i in f-strings where applicable, here escaping it.
    echo "Still waiting... (attempt \$i)"
    sleep 5
done

echo "Starting Nginx now that Hermes is ready..."
systemctl restart nginx

echo "=== Startup script complete. Hermes ready on Port 80/443. ==="
"""

    async def extract_token(self, instance_id: str, vm_name: str, zone: str, external_ip: str, logger_func, gateway_token: str) -> Optional[str]:
        # We use the injected gateway_token
        InstanceModel._updateToken(instance_id, gateway_token)
        logger_func("Using pre-generated token for Hermes Agent.")
        return gateway_token

    def get_workspace_path(self) -> str:
        return "/root/.openclaw/workspace"

    def getInstructions(self, ip: str, private_key: str) -> List[Dict[str, Any]]:
        return []

    def editInstructions(self, ip: str, private_key: str, instructions: List[Dict[str, Any]]) -> bool:
        return True

    def getSkills(self, ip: str, private_key: str) -> List[Dict[str, Any]]:
        return []

    def editSkills(self, ip: str, private_key: str, skills: List[Dict[str, Any]]) -> bool:
        return True

    def getAgentConfig(self, ip: str, private_key: str) -> str:
        return ""

    def editAgentConfig(self, ip: str, private_key: str, config_content: str) -> bool:
        return True

    def getMcpConfig(self, ip: str, private_key: str) -> str:
        return ""

    def editMcpConfig(self, ip: str, private_key: str, mcp_config: str) -> bool:
        return True

    def restartAgent(self, ip: str, private_key: str) -> bool:
        return True
