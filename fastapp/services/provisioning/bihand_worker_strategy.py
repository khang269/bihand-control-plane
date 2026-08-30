from typing import Optional, List, Dict, Any
from .base_strategy import BaseProvisioningStrategy
from fastapp.models.instanceModel import InstanceModel

class BihandWorkerStrategy(BaseProvisioningStrategy):
    
    def get_startup_script(self, provider: str, api_key: str, model: str, password: str, gateway_token: str, agent_type: str = "openclaw", api_url: str = "http://localhost:8501/api/internal") -> str:
        config = self.get_provider_config(provider)
        
        # We need a robust worker VM with Node.js, Docker, NoVNC, and CLI agents
        return rf"""#!/bin/bash
set -e
export HOME="/root"
export AGENT_TYPE="{agent_type}"
exec > >(tee -a /var/log/bihand-worker-startup.log /dev/ttyS1) 2>&1

echo "=== Bihand Fleet Worker Startup ==="
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
apt-get update -y
DEBIAN_FRONTEND=noninteractive apt-get install -y curl wget git jq nginx \
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

# --- Install Node.js & NPM ---
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# --- Install Docker ---
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker

# --- Install Generic Worker Utilities ---
echo "Configuring Generic Bihand Worker..."

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

# --- Setup Docker Capabilities ---
echo "Setting up Docker capabilities for generic worker..."
# User can spin up their own containers as needed.

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

echo "=== Startup script complete. Bihand Worker ready! ==="
"""

    async def extract_token(self, instance_id: str, vm_name: str, zone: str, external_ip: str, logger_func, gateway_token: str) -> Optional[str]:
        InstanceModel._updateToken(instance_id, gateway_token)
        logger_func(f"Worker initialized. Virtual Screen available at http://{external_ip}/screen/vnc.html")
        return gateway_token

    def get_workspace_path(self) -> str:
        return "/root/workspace"

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
