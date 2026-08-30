from typing import Optional, List, Dict, Any
from .base_strategy import BaseProvisioningStrategy
from fastapp.models.instanceModel import InstanceModel
from fastapp.services import sshService

# Plain (non-f-string) template for the on-VM interactive chat daemon, kept separate from
# get_startup_script's rf"""...""" body so its JS braces never have to be escaped as {{ }}.
# __GATEWAY_TOKEN__ / __API_KEY__ / __MODEL_FLAG__ are substituted at provision time, then the
# result is base64-embedded into the startup script (same pattern as agent_md_b64/mcp_config_b64).
_CHAT_DAEMON_JS_TEMPLATE = r'''
const http = require('http');
const { WebSocketServer } = require('ws');
const { spawn } = require('child_process');
const fs = require('fs');

const GATEWAY_TOKEN = '__GATEWAY_TOKEN__';
const API_KEY = '__API_KEY__';
const OAUTH_TOKEN = '__OAUTH_TOKEN__';
const MODEL_FLAG = '__MODEL_FLAG__';
const SESSION_FILE = '/home/minerclaw/.claude/chat_session_id';
const CLAUDE_MD_FILE = '/home/minerclaw/.claude/CLAUDE.md';
const IDLE_TIMEOUT_MS = 20 * 60 * 1000;

const server = http.createServer();
// Node's http.Server defaults keepAliveTimeout to 5000ms - it destroys the raw socket after 5s
// of inactivity, which would kill this WebSocket too since it rides the same socket post-upgrade.
server.keepAliveTimeout = 0;
server.headersTimeout = 0;
const wss = new WebSocketServer({ server });

const clients = new Set();
let claudeProc = null;
let idleTimer = null;
let heartbeatPaused = false;

function log(...args) { console.log(new Date().toISOString(), ...args); }

function broadcast(obj) {
  const msg = JSON.stringify(obj);
  for (const ws of clients) {
    try { ws.send(msg); } catch (e) {}
  }
}

// Chat turns can go minutes between messages. Several hops sit between the browser and this
// daemon (nginx, the backend's own bridge, whatever GKE ingress/LB fronts the API) and at least
// one of them idle-times-out a silent WebSocket well under a minute - keepAliveTimeout=0 above
// wasn't sufficient on its own. Sending real application traffic on a short interval defeats any
// byte-activity-based idle timeout regardless of which hop enforces it. ChatPanel.tsx already
// no-ops on unrecognized event types, so this is safe to add without a frontend change.
setInterval(() => broadcast({ type: 'ping' }), 3000);

function resetIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(onIdleTimeout, IDLE_TIMEOUT_MS);
}

function pauseHeartbeat() {
  if (heartbeatPaused) return;
  heartbeatPaused = true;
  spawn('systemctl', ['stop', 'bihand-heartbeat.service']);
  log('Paused bihand-heartbeat.service');
}

function resumeHeartbeat() {
  if (!heartbeatPaused) return;
  heartbeatPaused = false;
  spawn('systemctl', ['start', 'bihand-heartbeat.service']);
  log('Resumed bihand-heartbeat.service');
}

function stopClaude() {
  if (claudeProc) {
    try { claudeProc.kill(); } catch (e) {}
    claudeProc = null;
  }
}

function onIdleTimeout() {
  log('Idle timeout reached, tearing down claude session');
  stopClaude();
  resumeHeartbeat();
}

function handleClaudeLine(line) {
  let evt;
  try {
    evt = JSON.parse(line);
  } catch (e) {
    return;
  }

  if (evt.type === 'system' && evt.subtype === 'init' && evt.session_id) {
    try { fs.writeFileSync(SESSION_FILE, evt.session_id); } catch (e) {}
    broadcast({ type: 'session_ready', sessionId: evt.session_id });
    return;
  }

  if (evt.type === 'stream_event' && evt.event) {
    const inner = evt.event;
    if (inner.type === 'content_block_delta' && inner.delta && inner.delta.type === 'text_delta') {
      broadcast({ type: 'assistant_delta', text: inner.delta.text });
    }
    return;
  }

  if (evt.type === 'assistant' && evt.message && Array.isArray(evt.message.content)) {
    for (const block of evt.message.content) {
      if (block.type === 'tool_use') {
        broadcast({ type: 'tool_use', id: block.id, name: block.name, input: block.input });
      }
    }
    return;
  }

  if (evt.type === 'user' && evt.message && Array.isArray(evt.message.content)) {
    for (const block of evt.message.content) {
      if (block.type === 'tool_result') {
        broadcast({ type: 'tool_result', id: block.tool_use_id, output: block.content });
      }
    }
    return;
  }

  if (evt.type === 'result') {
    broadcast({ type: 'turn_complete' });
    resetIdleTimer();
  }
}

function startClaude() {
  if (claudeProc) return;
  pauseHeartbeat();

  // A CLAUDE_CODE_OAUTH_TOKEN (from `claude setup-token`, billed against the user's own
  // Claude Pro/Max/Team subscription) outranks ANTHROPIC_API_KEY in Claude Code's own auth
  // precedence, but only if the API key env vars are entirely absent - so when a subscription
  // token is configured, omit the API-key exports rather than setting both.
  const authEnv = OAUTH_TOKEN
    ? [`CLAUDE_CODE_OAUTH_TOKEN=${OAUTH_TOKEN}`]
    : [`ANTHROPIC_API_KEY=${API_KEY}`, `OPENAI_API_KEY=${API_KEY}`, `GEMINI_API_KEY=${API_KEY}`];

  const args = [
    '-u', 'minerclaw', 'env', 'HOME=/home/minerclaw',
    ...authEnv,
    'claude', '-p',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--include-partial-messages',
    '--verbose',
    '--model', MODEL_FLAG,
    '--dangerously-skip-permissions',
  ];

  // The task-execution loop (heartbeat.py) doesn't need this explicitly - a plain `claude -p
  // "<prompt text>"` invocation auto-discovers CLAUDE.md from cwd/user memory on its own. This
  // streaming stdin/stdout mode is more like a raw API session though, so don't rely on that
  // same auto-discovery kicking in - explicitly append the agent's own persona/instructions as
  // a system prompt so live chat reflects the same identity task execution does.
  try {
    if (fs.existsSync(CLAUDE_MD_FILE)) {
      const claudeMd = fs.readFileSync(CLAUDE_MD_FILE, 'utf8').trim();
      if (claudeMd) {
        // CLAUDE.md also carries the autonomous heartbeat's task-execution mandate (mandatory
        // `bihand complete`/`report`/`delegate` CLI calls, watchdog/timeout warnings) - injecting
        // it verbatim into live chat made the agent try to invoke those with no real task backing
        // it. Scope that mandate back to the heartbeat loop before appending the persona/context.
        const liveChatPreamble =
          "NOTE: You are in a live, interactive chat conversation with your human operator via the dashboard's Live Chat panel - this is NOT an autonomous task-execution run. " +
          'The operational rules below (mandatory `bihand complete`/`bihand report`/`bihand delegate` CLI invocations, task-completion requirements, watchdog/timeout warnings, etc.) apply only to your normal heartbeat loop when you have actually checked out a task. ' +
          'Do NOT run any `bihand` CLI command in this chat unless the operator explicitly asks you to act on a specific, real task ID they have given you. Simply respond conversationally and helpfully. ' +
          'Your configured persona, role, and company context below still apply:\n\n';
        args.push('--append-system-prompt', liveChatPreamble + claudeMd);
      }
    }
  } catch (e) {}

  let resumeId = null;
  try {
    if (fs.existsSync(SESSION_FILE)) {
      resumeId = fs.readFileSync(SESSION_FILE, 'utf8').trim();
    }
  } catch (e) {}
  if (resumeId) {
    args.push('--resume', resumeId);
  }

  claudeProc = spawn('sudo', args, { cwd: '/home/minerclaw/workspace' });

  let buffer = '';
  claudeProc.stdout.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (line) handleClaudeLine(line);
    }
  });

  claudeProc.stderr.on('data', (chunk) => {
    log('claude stderr:', chunk.toString('utf8').slice(0, 500));
  });

  claudeProc.on('exit', (code) => {
    log('claude process exited with code', code);
    claudeProc = null;
    broadcast({ type: 'error', message: `Claude process exited (code ${code}). Send a message to start a new session.` });
  });
}

function sendUserMessage(text) {
  startClaude();
  resetIdleTimer();
  const payload = {
    type: 'user',
    message: { role: 'user', content: [{ type: 'text', text }] },
  };
  if (claudeProc && claudeProc.stdin.writable) {
    claudeProc.stdin.write(JSON.stringify(payload) + '\n');
  }
}

wss.on('connection', (ws, req) => {
  const auth = req.headers['authorization'] || '';
  if (auth !== `Bearer ${GATEWAY_TOKEN}`) {
    ws.close(1008, 'Unauthorized');
    return;
  }

  clients.add(ws);
  resetIdleTimer();
  log('Client connected, total:', clients.size);

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data.toString('utf8')); } catch (e) { return; }
    if (msg.type === 'user_message' && typeof msg.text === 'string') {
      sendUserMessage(msg.text);
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    log('Client disconnected, total:', clients.size);
  });

  ws.on('error', (e) => {
    log('WS client error:', e && e.message);
  });
});

server.listen(18790, '127.0.0.1', () => {
  log('Claude chat daemon listening on 127.0.0.1:18790');
});
'''

class ClaudeCodeStrategy(BaseProvisioningStrategy):
    def get_instructions_matrix(self) -> Dict[str, str]:
        return {
            "agentMd": "CLAUDE.md"
        }

    def getInstructions(self, ip: str, private_key: str) -> List[Dict[str, Any]]:
        return self._get_specific_files_from_vm(ip, private_key, "/home/minerclaw/.claude", ["CLAUDE.md"])

    def editInstructions(self, ip: str, private_key: str, instructions: List[Dict[str, Any]]) -> bool:
        return self._edit_specific_files_on_vm(ip, private_key, "/home/minerclaw/.claude", instructions, ["CLAUDE.md"])

    def getSkills(self, ip: str, private_key: str) -> List[Dict[str, Any]]:
        return self._get_skills_from_vm(ip, private_key, "/home/minerclaw/.claude/skills")

    def editSkills(self, ip: str, private_key: str, skills: List[Dict[str, Any]]) -> bool:
        res = self._edit_skills_on_vm(ip, private_key, "/home/minerclaw/.claude/skills", skills)
        if res:
            from fastapp.services import sshService
            sshService.execute_command(ip, private_key, "sudo chown -R minerclaw:minerclaw /home/minerclaw/.claude/skills")
        return res

    def get_startup_script(self, provider: str, api_key: str, model: str, password: str, gateway_token: str, agent_type: str = "claudecode", api_url: str = "http://localhost:8501/api/internal", agent_md_b64: str = "", mcp_config_b64: str = "", oauth_token: str = "") -> str:
        config = self.get_provider_config(provider)

        # A Claude subscription (Pro/Max/Team) OAuth token from `claude setup-token` bills
        # inference against the user's own plan instead of api_key's metered Anthropic API
        # usage. It outranks ANTHROPIC_API_KEY in Claude Code's auth precedence, but only if
        # the API key env vars are absent entirely - so when present, every `claude` invocation
        # (bashrc, heartbeat.py, chat_daemon.js) omits the API-key exports rather than setting
        # both. See https://code.claude.com/docs/en/authentication - "Generate a long-lived token".
        use_subscription_auth = bool(oauth_token)

        # Same alias-mapping heartbeat.py computes internally, but hoisted out here so the
        # interactive chat daemon (which spawns `claude` outside of heartbeat.py's Python
        # process) can use the identical model flag without duplicating the branch logic.
        model_str = model
        model_flag = "sonnet"
        if "opus" in model_str.lower():
            model_flag = "opus"
        elif "haiku" in model_str.lower():
            model_flag = "haiku"
        elif "sonnet" in model_str.lower():
            model_flag = "sonnet"

        import base64
        chat_daemon_js = (_CHAT_DAEMON_JS_TEMPLATE
            .replace("__GATEWAY_TOKEN__", gateway_token)
            .replace("__API_KEY__", api_key)
            .replace("__OAUTH_TOKEN__", oauth_token)
            .replace("__MODEL_FLAG__", model_flag))
        chat_daemon_js_b64 = base64.b64encode(chat_daemon_js.encode('utf-8')).decode('utf-8')

        def _bashrc_auth_lines(bashrc_path: str) -> str:
            if use_subscription_auth:
                return f'echo "export CLAUDE_CODE_OAUTH_TOKEN=\\"{oauth_token}\\"" >> {bashrc_path}'
            return "\n".join([
                f'echo "export ANTHROPIC_API_KEY=\\"{api_key}\\"" >> {bashrc_path}',
                f'echo "export OPENAI_API_KEY=\\"{api_key}\\"" >> {bashrc_path}',
                f'echo "export GEMINI_API_KEY=\\"{api_key}\\"" >> {bashrc_path}',
            ])

        root_bashrc_auth = _bashrc_auth_lines("/root/.bashrc")
        minerclaw_bashrc_auth = _bashrc_auth_lines("/home/minerclaw/.bashrc")

        # Same subscription-vs-API-key choice, baked into the generated heartbeat.py source
        # (values are substituted here, at outer-script generation time, not at heartbeat.py
        # runtime - matching how the existing ANTHROPIC_API_KEY lines already work).
        if use_subscription_auth:
            heartbeat_module_env_line = f'env["CLAUDE_CODE_OAUTH_TOKEN"] = "{oauth_token}"'
            heartbeat_cmd_auth_lines = f'            f"CLAUDE_CODE_OAUTH_TOKEN={oauth_token}",'
        else:
            heartbeat_module_env_line = f'env["ANTHROPIC_API_KEY"] = "{api_key}"'
            heartbeat_cmd_auth_lines = "\n".join([
                f'            f"ANTHROPIC_API_KEY={api_key}",',
                f'            f"OPENAI_API_KEY={api_key}",',
                f'            f"GEMINI_API_KEY={api_key}",',
            ])

        return rf"""#!/bin/bash
set -e
export HOME="/root"
exec > >(tee -a /var/log/claudecode-startup.log /dev/ttyS1) 2>&1

echo "=== Claude Code Worker Startup ==="
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

# --- Install Claude Code ---
npm install -g @anthropic-ai/claude-code@2.1.224

# --- Install ws (websocket server library for the interactive chat daemon) ---
# Installed locally into /opt/bihand (not -g): a plain `node script.js` invocation only
# resolves require() against node_modules directories that are ancestors of the script's own
# path, so a global npm install (which lands in /usr/lib/node_modules under nodesource's
# prefix) is invisible to chat_daemon.js unless NODE_PATH is set - it isn't, in the systemd
# unit below. Installing into the same directory the daemon is later written to fixes this.
mkdir -p /opt/bihand
npm install --prefix /opt/bihand ws

# Setup environment variables
{root_bashrc_auth}
echo "export PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/local/bin/google-chrome" >> /root/.bashrc

{minerclaw_bashrc_auth}
echo "export PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/local/bin/google-chrome" >> /home/minerclaw/.bashrc

echo "PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/local/bin/google-chrome" >> /etc/environment

mkdir -p /home/minerclaw/workspace
mkdir -p /home/minerclaw/claude_config
mkdir -p /home/minerclaw/.claude
mkdir -p /home/minerclaw/.claude/skills

# Setup Claude Code settings.json
cat << 'EOF3' > /home/minerclaw/.claude/settings.json
{{
  "model": "sonnet",
  "autoApprove": false,
  "theme": "dark"
}}
EOF3

# --- Setup Custom Configurations ---
echo "{agent_md_b64}" | base64 -d > /home/minerclaw/.claude/CLAUDE.md

echo "{mcp_config_b64}" | base64 -d > /home/minerclaw/workspace/.mcp.json

chown -R minerclaw:minerclaw /home/minerclaw/workspace /home/minerclaw/claude_config /home/minerclaw/.claude

# Establish symlinks for seamless root/minerclaw compatibility
ln -sf /home/minerclaw/workspace /root/workspace
ln -sf /home/minerclaw/.claude /root/.claude
ln -sf /home/minerclaw/.claude.json /root/.claude.json
echo "{{}}" > /home/minerclaw/.claude.json
chown minerclaw:minerclaw /home/minerclaw/.claude.json

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

# --- Self-Signed SSL Certificate (needed so the backend's /ws/chat bridge can reach the
# interactive chat daemon over wss://, since GCP firewall blocks non-443 ports externally) ---
echo "Generating Self-Signed SSL Certificate..."
mkdir -p /etc/ssl/private /etc/ssl/certs
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout /etc/ssl/private/nginx-selfsigned.key \
  -out /etc/ssl/certs/nginx-selfsigned.crt \
  -subj "/C=US/ST=State/L=City/O=MinerClaw/CN=localhost"

# --- Nginx Proxy for VNC + Interactive Chat Daemon ---
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

    # Interactive Claude Code chat daemon (websocket)
    location /api/claudechat {{
        proxy_pass http://127.0.0.1:18790;
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

server {{
    listen 443 ssl;
    server_name _;

    ssl_certificate /etc/ssl/certs/nginx-selfsigned.crt;
    ssl_certificate_key /etc/ssl/private/nginx-selfsigned.key;

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

    # Interactive Claude Code chat daemon (websocket) - the backend's /ws/chat bridge
    # connects here over wss:// since the GCP firewall only opens port 443 externally.
    location /api/claudechat {{
        proxy_pass http://127.0.0.1:18790;
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

# --- Bihand M2M Bridge ---
echo "Installing Bihand M2M Bridge..."
mkdir -p /opt/bihand

# 1. Create the Custom Tool CLI for the Agent to use
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

if [ "$COMMAND" = "org" ]; then
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
    RES=$(bihand_curl -X POST "$API_URL/tasks/delegate" -H "X-Agent-Token: {gateway_token}" -H "Content-Type: application/json" -d "$PAYLOAD")
    SUBTASK_ID=$(node -e "const res = JSON.parse(process.argv[1]); console.log(res.taskId || 'ERROR');" "$RES")
    echo "Delegated successfully. Subtask ID: $SUBTASK_ID"
elif [ "$COMMAND" = "approve" ]; then
    SUBTASK_ID=$1
    shift
    FEEDBACK=$*
    PAYLOAD=$(node -e "console.log(JSON.stringify({{content: '✅ Approved. ' + process.argv[1]}}))" "$FEEDBACK")
    bihand_curl -X POST "$API_URL/tasks/$SUBTASK_ID/comments" -H "X-Agent-Token: {gateway_token}" -H "Content-Type: application/json" -d "$PAYLOAD" > /dev/null
    PAYLOAD_STATUS='{{"status": "done"}}'
    bihand_curl -X PATCH "$API_URL/tasks/$SUBTASK_ID/status" -H "X-Agent-Token: {gateway_token}" -H "Content-Type: application/json" -d "$PAYLOAD_STATUS"
    echo "Subtask $SUBTASK_ID approved and marked done."
elif [ "$COMMAND" = "reject" ]; then
    SUBTASK_ID=$1
    shift
    FEEDBACK=$*
    PAYLOAD=$(node -e "console.log(JSON.stringify({{content: '❌ Rejected. ' + process.argv[1]}}))" "$FEEDBACK")
    bihand_curl -X POST "$API_URL/tasks/$SUBTASK_ID/comments" -H "X-Agent-Token: {gateway_token}" -H "Content-Type: application/json" -d "$PAYLOAD" > /dev/null
    PAYLOAD_STATUS='{{"status": "todo"}}'
    bihand_curl -X PATCH "$API_URL/tasks/$SUBTASK_ID/status" -H "X-Agent-Token: {gateway_token}" -H "Content-Type: application/json" -d "$PAYLOAD_STATUS"
    echo "Subtask $SUBTASK_ID rejected and sent back to queue."
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
elif [ "$COMMAND" = "complete" ]; then
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
elif [ "$COMMAND" = "block" ]; then
    BLOCKER_ID=$1
    PAYLOAD=$(node -e "console.log(JSON.stringify({{blockedByTaskId: process.argv[1]}}))" "$BLOCKER_ID")
    bihand_curl -X POST "$API_URL/tasks/$TASK_ID/block" \
        -H "X-Agent-Token: {gateway_token}" \
        -H "Content-Type: application/json" \
        -d "$PAYLOAD"
    echo "Task $TASK_ID is now blocked by $BLOCKER_ID. It will auto-resume when that task completes."
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
    echo "Usage: bihand <complete|report|delegate|block|org|approve|reject|comment|post|google-token> [args...]"
fi
EOF2
chmod +x /usr/local/bin/bihand

# 2. Create the Python Heartbeat Daemon
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
    # Claude Code's `-p` print mode outputs plain text (no --output-format json flag is
    # passed), so the raw stdout tail IS the agent's final message - just trim obvious
    # leading/trailing noise.
    text = (stdout_text or "").strip()
    return text

def execute_task(task):
    task_id = task["_id"]
    title = task["title"]
    desc = task["description"]
    company_name = task.get("companyName", "Autonomous Company")
    mission = task.get("companyMission", "")
    comments = task.get("comments", [])
    subs_info = task.get("subordinatesInfo", "No roles currently report to you or they are offline.")
    delegated_subtasks = task.get("delegatedSubtasks", [])
    interactive_chat_history = task.get("interactiveChatHistory") or ""

    chat_history = ""
    if comments:
        chat_history = "Task Chat History:\\n"
        for c in comments:
            chat_history += f"[{{c['role']}}]: {{c['content']}}\\n"

    live_chat_context = ""
    if interactive_chat_history:
        live_chat_context = (
            "==================================================\\n"
            "Recent conversation with your operator (Live Chat panel - separate from task comments above):\\n"
            + interactive_chat_history +
            "\\n==================================================\\n\\n"
        )

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
        f"{{live_chat_context}}"
        f"{{subtasks_context}}"
        f"🔔 **IMPORTANT RUNTIME CONSTRAINT (READ CAREFULLY):**\n"
        f"You must systematically execute one of the custom CLI commands below to report your final progress before exiting your process. If your main loop, run, or script terminates while the task status is active, the control plane's process monitor will assume your run stalled and mark it as unresolved.\n\n"
        f"👉 **MANDATORY STATE-REPORTING CLI COMMANDS:**\n"
        f"1. To mark the task completely DONE: Run `bihand complete {{task_id}} \"<detailed_final_results_summary>\"`.\n"
        f"2. To delegate subtasks to subordinates: Run `bihand delegate {{task_id}} <subordinate_role> \"<subtask_title>\" \"<description_instructions>\"`.\n"
        f"3. To pause for comments or ask a human question: Run `bihand report {{task_id}} \"<your message/question>\"`.\n\n"
        f"Every command requires your current Task ID ({{task_id}}) as the second argument."
    )
    
    print(f"Waking up Claude Code for task {{task_id}}...")
    
    # Securely retrieve a fresh short-lived Google Access Token from the Bihand Control Plane proxy
    google_access_token = None
    try:
        token_res = requests.get(f"{{API_URL}}/google/token", headers={{"X-Agent-Token": TOKEN}}, timeout=10)
        if token_res.status_code == 200:
            google_access_token = token_res.json().get("access_token")
    except Exception as e:
        print(f"Warning: Failed to fetch Google Access Token proxy from Control Plane: {{e}}")
    
    env = os.environ.copy()
    {heartbeat_module_env_line}
    
    # Determine the model flag for Claude Code
    # Claude Code expects aliases like 'sonnet' or 'opus' rather than raw full identifiers
    model_str = "{model}"
    model_flag = "sonnet"
    if "opus" in model_str.lower():
        model_flag = "opus"
    elif "haiku" in model_str.lower():
        model_flag = "haiku"
    elif "sonnet" in model_str.lower():
        model_flag = "sonnet"

    def run_claude_once(run_prompt):
        cmd = [
            "sudo", "-u", "minerclaw", "env",
            "HOME=/home/minerclaw",
{heartbeat_cmd_auth_lines}
        ]
        if google_access_token:
            cmd.append(f"GOG_ACCESS_TOKEN={{google_access_token}}")
            cmd.append(f"GOOGLE_ACCESS_TOKEN={{google_access_token}}")
        for k in ["GOG_KEYRING_PASSWORD", "GOG_KEYRING_BACKEND", "GOG_HOME", "GOOGLE_WORKSPACE_EMAIL"]:
            if k in os.environ:
                cmd.append(k + "=" + os.environ[k])
        cmd.extend(["claude", "-p", run_prompt, "--model", model_flag, "--dangerously-skip-permissions"])

        run_error_msg = None
        try:
            run_res = subprocess.run(cmd, cwd="/home/minerclaw/workspace", timeout=3600, capture_output=True, text=True)
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
        res, error_msg = run_claude_once(current_prompt)

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
            time.sleep(10)  # Rate limit safety delay
        else:
            time.sleep(60)

if __name__ == "__main__":
    main()
EOF2

# 3. Setup Systemd Service
cat << 'EOF2' > /etc/systemd/system/bihand-heartbeat.service
[Unit]
Description=Bihand M2M Heartbeat Daemon
After=network.target

[Service]
ExecStart=/usr/bin/python3 /opt/bihand/heartbeat.py
Restart=always
User=root
Environment=HOME=/root
Environment=PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/local/bin/google-chrome
EnvironmentFile=-/root/.bihand/google_workspace.env

[Install]
WantedBy=multi-user.target
EOF2

# 4. Setup Interactive Chat Daemon (bridges live human<->agent chat to the /ws/chat proxy)
echo "{chat_daemon_js_b64}" | base64 -d > /opt/bihand/chat_daemon.js

cat << 'EOF2' > /etc/systemd/system/bihand-chat-daemon.service
[Unit]
Description=Bihand Claude Code Interactive Chat Daemon
After=network.target

[Service]
ExecStart=/usr/bin/node /opt/bihand/chat_daemon.js
Restart=always
User=root
Environment=HOME=/root

[Install]
WantedBy=multi-user.target
EOF2

systemctl daemon-reload
systemctl enable --now bihand-heartbeat.service
systemctl enable --now bihand-chat-daemon.service

echo "=== Startup script complete. Claude Code Worker ready! ==="
"""

    def getAgentConfig(self, ip: str, private_key: str) -> str:
        res = self._get_specific_files_from_vm(ip, private_key, "/home/minerclaw/.claude", ["settings.json"])
        return res[0]["content"] if res else ""

    def editAgentConfig(self, ip: str, private_key: str, config_content: str) -> bool:
        files = [{"name": "settings.json", "content": config_content}]
        return self._edit_specific_files_on_vm(ip, private_key, "/home/minerclaw/.claude", files, ["settings.json"])

    def getMcpConfig(self, ip: str, private_key: str) -> str:
        # Claude Code reads project scope configurations from .mcp.json in the workspace root
        from fastapp.utils import mcp_normalizer
        res = self._get_specific_files_from_vm(ip, private_key, "/home/minerclaw/workspace", [".mcp.json"])
        content = res[0]["content"] if res else ""
        return mcp_normalizer.normalize_to_claudecode(content)

    def editMcpConfig(self, ip: str, private_key: str, mcp_config: str) -> bool:
        import json
        from fastapp.utils import mcp_normalizer
        # Claude Code natively operates on the standard mcpServers schema
        standard_mcp_raw = mcp_normalizer.normalize_to_claudecode(mcp_config)
        try:
            new_mcp = json.loads(standard_mcp_raw).get("mcpServers", {})

            # new_mcp (derived from the DB's mcpConfig) is the full authoritative set of
            # user-configured servers, so it replaces the current file wholesale - a server absent
            # from it (e.g. after a disconnect) must actually be removed, not left behind forever.
            # chrome-devtools is the one exception: it's only ever injected into the VM's startup
            # script/boot-time config (see provisionerService.py), never persisted into the DB's
            # mcpConfig, so it must be explicitly preserved here or every push would silently wipe it.
            current_res = self._get_specific_files_from_vm(ip, private_key, "/home/minerclaw/workspace", [".mcp.json"])
            current_content = current_res[0]["content"] if current_res else ""
            current_mcp = {}
            if current_content:
                try:
                    current_mcp = json.loads(current_content).get("mcpServers", {})
                except Exception:
                    current_mcp = {}

            merged_mcp = dict(new_mcp)
            if "chrome-devtools" in current_mcp and "chrome-devtools" not in merged_mcp:
                merged_mcp["chrome-devtools"] = current_mcp["chrome-devtools"]

            standard_mcp = json.dumps({"mcpServers": merged_mcp}, indent=2)
        except Exception:
            standard_mcp = standard_mcp_raw

        files = [{"name": ".mcp.json", "content": standard_mcp}]
        # Overwrite the Project Scope .mcp.json file inside /home/minerclaw/workspace/
        success = self._edit_specific_files_on_vm(ip, private_key, "/home/minerclaw/workspace", files, [".mcp.json"])
        if success:
            # Fix ownership to minerclaw user
            from fastapp.services import sshService
            sshService.execute_command(ip, private_key, "sudo chown -R minerclaw:minerclaw /home/minerclaw/workspace")
        return success

    def restartAgent(self, ip: str, private_key: str) -> bool:
        from fastapp.services import sshService
        res = sshService.execute_command(ip, private_key, "sudo systemctl restart bihand-heartbeat.service")
        return res["exitCode"] == 0

    async def extract_token(self, instance_id: str, vm_name: str, zone: str, external_ip: str, logger_func, gateway_token: str) -> Optional[str]:
        InstanceModel._updateToken(instance_id, gateway_token)
        logger_func(f"ClaudeCode initialized. Virtual Screen available at http://{external_ip}/screen/vnc.html")
        return gateway_token

    def get_workspace_path(self) -> str:
        return "/home/minerclaw/workspace"
