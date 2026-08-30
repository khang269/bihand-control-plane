from typing import Optional, List, Dict, Any
import asyncio
from .base_strategy import BaseProvisioningStrategy
from fastapp.services import gcpService
from fastapp.models.instanceModel import InstanceModel

class NemoClawStrategy(BaseProvisioningStrategy):

    def get_startup_script(self, provider: str, api_key: str, model: str, password: str, gateway_token: str, agent_type: str = "openclaw", api_url: str = "http://localhost:8501/api/internal") -> str:
        config = self.get_provider_config(provider)
        actual_provider = config["provider"]
        
        # Force provider to gemini if it is google since NemoClaw doesn't recognize google
        if actual_provider == "google":
            actual_provider = "gemini"
            
        if actual_provider == "google" or actual_provider == "gemini":
            key_env = f'export GEMINI_API_KEY="{api_key}"\nexport GOOGLE_API_KEY="{api_key}"\nexport NVIDIA_API_KEY="{api_key}"\nexport OPENAI_API_KEY="{api_key}"'
            etc_env = f'echo "GEMINI_API_KEY=\\"{api_key}\\"" >> /etc/environment\necho "GOOGLE_API_KEY=\\"{api_key}\\"" >> /etc/environment\necho "NVIDIA_API_KEY=\\"{api_key}\\"" >> /etc/environment\necho "OPENAI_API_KEY=\\"{api_key}\\"" >> /etc/environment'
        elif actual_provider == "anthropic":
            key_env = f'export ANTHROPIC_API_KEY="{api_key}"\nexport OPENAI_API_KEY="{api_key}"\nexport NVIDIA_API_KEY="{api_key}"'
            etc_env = f'echo "ANTHROPIC_API_KEY=\\"{api_key}\\"" >> /etc/environment\necho "OPENAI_API_KEY=\\"{api_key}\\"" >> /etc/environment\necho "NVIDIA_API_KEY=\\"{api_key}\\"" >> /etc/environment'
        else:
            key_env = f'export OPENAI_API_KEY="{api_key}"\nexport NVIDIA_API_KEY="{api_key}"'
            etc_env = f'echo "OPENAI_API_KEY=\\"{api_key}\\"" >> /etc/environment\necho "NVIDIA_API_KEY=\\"{api_key}\\"" >> /etc/environment'

        extra_envs = "\n".join([f'export {k}="{v}"' for k, v in config.get("envVars", {}).items()])
        etc_extra_envs = "\n".join([f'echo "{k}=\\"{v}\\"" >> /etc/environment' for k, v in config.get("envVars", {}).items()])
        bashrc_extra_envs = "\n".join([f'echo "export {k}=\\"{v}\\"" >> /root/.bashrc' for k, v in config.get("envVars", {}).items()])

        return rf"""#!/bin/bash
set -e
export HOME="/root"
export NVM_DIR="$HOME/.nvm"
exec > >(tee -a /var/log/minerclaw-startup.log /dev/ttyS1) 2>&1

echo "=== minerClaw Autonomous Startup (NemoClaw) ==="
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

# --- System Optimization: Swap & File Watchers ---
export NEMOCLAW_DISABLE_DEVICE_AUTH=1
export NEMOCLAW_ACCEPT_THIRD_PARTY_SOFTWARE=1

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

sysctl -w fs.inotify.max_user_instances=2048
sysctl -w fs.inotify.max_user_watches=524288

# --- Dependencies ---
echo "Installing Nginx and utils..."
apt-get update -y
apt-get install -y ca-certificates curl gnupg nginx apache2-utils wget

# Configure Docker daemon
mkdir -p /etc/docker
cat <<EOF > /etc/docker/daemon.json
{{
  "default-cgroupns-mode": "host"
}}
EOF

# Install Docker
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker
systemctl restart docker

export NEMOCLAW_PROVIDER="{actual_provider}"
export NEMOCLAW_MODEL="{model}"
EXTERNAL_IP=$(curl -s -H "Metadata-Flavor: Google" "http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip")
export NEMOCLAW_CORS_ORIGIN="https://$EXTERNAL_IP"
{key_env}
{extra_envs}

# Persist to system-wide environment so daemons/pods can read it
echo "NEMOCLAW_PROVIDER=\"{actual_provider}\"" >> /etc/environment
echo "NEMOCLAW_MODEL=\"{model}\"" >> /etc/environment
echo "NEMOCLAW_CORS_ORIGIN=\"https://$EXTERNAL_IP\"" >> /etc/environment
{etc_env}
{etc_extra_envs}

# --- NemoClaw Installation (Specific Version v0.0.23) ---
echo "Clearing ports to ensure OpenShell gateway and dashboard can bind successfully..."
fuser -k 18789/tcp 8080/tcp || true

echo "Installing NemoClaw v0.0.23..."
apt-get install -y git
git clone --branch v0.0.23 https://github.com/NVIDIA/NemoClaw.git /opt/nemoclaw
cd /opt/nemoclaw
bash install.sh --non-interactive
cd /

# Ensure path availability
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
export PATH="/root/.local/bin:$(npm config get prefix)/bin:$PATH"

# Persist PATH for interactive SSH sessions
echo 'export NVM_DIR="$HOME/.nvm"' >> /root/.bashrc
echo '[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"' >> /root/.bashrc
echo 'export PATH="$PATH:$HOME/.local/bin:$(npm config get prefix)/bin"' >> /root/.bashrc
echo "export NEMOCLAW_PROVIDER=\"{actual_provider}\"" >> /root/.bashrc
echo "export NEMOCLAW_MODEL=\"{model}\"" >> /root/.bashrc
echo '{key_env}' >> /root/.bashrc
{bashrc_extra_envs}

# Source it immediately for the rest of this script, just like the video suggests
source /root/.bashrc

# Create global aliases so any SSH user can run nemoclaw/openshell as root seamlessly
echo 'alias nemoclaw="sudo -i nemoclaw"' > /etc/profile.d/nemoclaw_alias.sh
echo 'alias openshell="sudo -i openshell"' >> /etc/profile.d/nemoclaw_alias.sh

echo "Waiting for NemoClaw Dashboard (port 18789) to start..."
for i in {{1..60}}; do
    if ss -lnt | grep -q ":18789"; then
        echo "Dashboard is listening!"
        break
    fi
    echo "Still waiting... (attempt $i)"
    sleep 2
done

# --- Nginx Security Proxy & Password Setup ---
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

    location / {{
        auth_basic $auth_realm;
        auth_basic_user_file /etc/nginx/.htpasswd;
        
        # Point to the HTTP local dashboard
        proxy_pass http://127.0.0.1:18789;

        # Stealth: Mimic local browser to bypass loopback-only restrictions
        proxy_set_header Host 127.0.0.1:18789;
        proxy_set_header Origin "http://127.0.0.1:18789";
        proxy_set_header Referer "http://127.0.0.1:18789/";
        proxy_set_header Authorization $proxied_auth;
        
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # WebSockets support
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

    location / {{
        auth_basic $auth_realm;
        auth_basic_user_file /etc/nginx/.htpasswd;
        
        # Point to the HTTP local dashboard
        proxy_pass http://127.0.0.1:18789;

        # Stealth: Mimic local browser to bypass loopback-only restrictions
        proxy_set_header Host 127.0.0.1:18789;
        proxy_set_header Origin "http://127.0.0.1:18789";
        proxy_set_header Referer "http://127.0.0.1:18789/";
        proxy_set_header Authorization $proxied_auth;
        
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        
        # WebSockets support
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
systemctl restart nginx

# Extract OpenClaw Token for Dashboard
echo "===OPENCLAW_TOKEN==="
set +e
CONFIG_FILE=$(find /root /var/lib/docker -name openclaw.json 2>/dev/null | head -n 1)
if [ -z "$CONFIG_FILE" ]; then
    sleep 10
    CONFIG_FILE=$(find /root /var/lib/docker -name openclaw.json 2>/dev/null | head -n 1)
fi

if [ -n "$CONFIG_FILE" ]; then
    TOKEN=$(grep -h '"token":' "$CONFIG_FILE" | sed 's/.*"token": "\([^"]*\)".*/\1/' | head -n 1)
    echo "$TOKEN"
else
    echo ""
fi
set -e
echo "===END_TOKEN==="

echo "=== Startup script complete. NemoClaw ready on Port 80. ==="
"""

    async def extract_token(self, instance_id: str, vm_name: str, zone: str, external_ip: str, logger_func, gateway_token: str) -> Optional[str]:
        logger_func("Extracting NemoClaw session token from VM logs...")
        try:
            vm_logs = await asyncio.to_thread(gcpService.get_instance_serial_port_output, vm_name, zone, 1)
            token = None
            if vm_logs:
                lines = vm_logs.split('\n')
                capture = False
                for line in lines:
                    if "===OPENCLAW_TOKEN===" in line:
                        capture = True
                        continue
                    if "===END_TOKEN===" in line:
                        capture = False
                        continue
                    if capture and line.strip() != "":
                        token = line.strip()
                        # It might be capturing empty strings or other noises, take the first non-empty valid looking token
                        if len(token) > 10: 
                            break
                            
            if token:
                InstanceModel._updateToken(instance_id, token)
                logger_func("Successfully securely extracted NemoClaw session token.")
                return token
            else:
                logger_func("WARNING: Could not extract NemoClaw token from logs. User may not be able to connect to the dashboard.")
                return None
        except Exception as e:
            logger_func(f"WARNING: Failed to extract NemoClaw token: {e}")
            return None

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