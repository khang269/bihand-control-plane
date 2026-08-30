from typing import Optional, List, Dict, Any
from .base_strategy import BaseProvisioningStrategy
from fastapp.models.instanceModel import InstanceModel
from fastapp.services import sshService

# Plain (non-f-string) template for the on-VM interactive Codex chat daemon, kept separate from
# get_startup_script's rf"""...""" body so its JS braces never have to be escaped as {{ }} - same
# pattern as claude_code_strategy.py's _CHAT_DAEMON_JS_TEMPLATE. __GATEWAY_TOKEN__ is substituted
# at provision time, then the result is base64-embedded into the startup script.
#
# Unlike Claude Code's `claude -p --input-format stream-json` (fire-and-forget stdin, no request
# ids), `codex app-server` speaks real JSON-RPC 2.0 over newline-delimited JSON on stdio - this
# daemon is a small JSON-RPC client: it calls `initialize`, then `thread/start`/`thread/resume`
# (session continuity, mirroring Claude's chat_session_id file), then `turn/start` per user
# message, and translates the server's notification stream into the same wire vocabulary the
# frontend/backend bridge already understand (session_ready/assistant_delta/tool_use/tool_result/
# turn_complete/error) so no other part of the stack needs to know which CLI is on the other end.
_CODEX_CHAT_DAEMON_JS_TEMPLATE = r'''
const http = require('http');
const { WebSocketServer } = require('ws');
const { spawn } = require('child_process');
const fs = require('fs');

const GATEWAY_TOKEN = '__GATEWAY_TOKEN__';
const THREAD_FILE = '/home/minerclaw/.codex/bihand_chat_thread_id';
const AGENTS_MD_FILE = '/home/minerclaw/.codex/AGENTS.md';
const IDLE_TIMEOUT_MS = 20 * 60 * 1000;

// The task-execution loop (heartbeat.py's `codex exec`) doesn't need this explicitly - it
// auto-discovers AGENTS.md from cwd on its own. Whether that same auto-discovery applies to
// app-server threads isn't guaranteed, so explicitly pass the agent's own persona/instructions
// as a developer-level instruction layer (additive, unlike baseInstructions which replaces the
// CLI's own default instructions) so live chat reflects the same identity task execution does.
function readAgentInstructions() {
  try {
    if (fs.existsSync(AGENTS_MD_FILE)) {
      const content = fs.readFileSync(AGENTS_MD_FILE, 'utf8').trim();
      if (content) {
        // AGENTS.md also carries the autonomous heartbeat's task-execution mandate (mandatory
        // `bihand complete`/`report`/`delegate` CLI calls, watchdog/timeout warnings) - injecting
        // it verbatim into live chat made the agent try to invoke those with no real task backing
        // it. Scope that mandate back to the heartbeat loop before returning the persona/context.
        const liveChatPreamble =
          "NOTE: You are in a live, interactive chat conversation with your human operator via the dashboard's Live Chat panel - this is NOT an autonomous task-execution run. " +
          'The operational rules below (mandatory `bihand complete`/`bihand report`/`bihand delegate` CLI invocations, task-completion requirements, watchdog/timeout warnings, etc.) apply only to your normal heartbeat loop when you have actually checked out a task. ' +
          'Do NOT run any `bihand` CLI command in this chat unless the operator explicitly asks you to act on a specific, real task ID they have given you. Simply respond conversationally and helpfully. ' +
          'Your configured persona, role, and company context below still apply:\n\n';
        return liveChatPreamble + content;
      }
    }
  } catch (e) {}
  return null;
}

const server = http.createServer();
// Same rationale as claude_code_strategy.py's chat_daemon.js: Node's http.Server default
// keepAliveTimeout would kill the WebSocket's underlying socket after 5s of inactivity.
server.keepAliveTimeout = 0;
server.headersTimeout = 0;
const wss = new WebSocketServer({ server });

const clients = new Set();
let appServerProc = null;
let idleTimer = null;
let heartbeatPaused = false;
let nextReqId = 1;
const pending = new Map(); // request id -> { resolve, reject }
let threadId = null;
let stdoutBuffer = '';
let starting = null; // in-flight startAppServer() promise, so concurrent callers share it

function log(...args) { console.log(new Date().toISOString(), ...args); }

function broadcast(obj) {
  const msg = JSON.stringify(obj);
  for (const ws of clients) {
    try { ws.send(msg); } catch (e) {}
  }
}

// See claude_code_strategy.py's chat_daemon.js for why: several hops between the browser and
// this daemon silently idle-time-out a WebSocket well under a minute without real traffic.
setInterval(() => broadcast({ type: 'ping' }), 3000);

function resetIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(onIdleTimeout, IDLE_TIMEOUT_MS);
}

function pauseHeartbeat() {
  if (heartbeatPaused) return;
  heartbeatPaused = true;
  spawn('sudo', ['systemctl', 'stop', 'bihand-heartbeat.service']);
  log('Paused bihand-heartbeat.service');
}

function resumeHeartbeat() {
  if (!heartbeatPaused) return;
  heartbeatPaused = false;
  spawn('sudo', ['systemctl', 'start', 'bihand-heartbeat.service']);
  log('Resumed bihand-heartbeat.service');
}

function rejectAllPending(reason) {
  for (const [, p] of pending) {
    try { p.reject(new Error(reason)); } catch (e) {}
  }
  pending.clear();
}

function stopAppServer() {
  if (appServerProc) {
    try { appServerProc.kill(); } catch (e) {}
    appServerProc = null;
  }
  starting = null;
  rejectAllPending('app-server stopped');
}

function onIdleTimeout() {
  log('Idle timeout reached, tearing down codex app-server');
  stopAppServer();
  resumeHeartbeat();
}

// Conversational/internal item types - everything else (commandExecution, fileChange,
// mcpToolCall, dynamicToolCall, webSearch, imageGeneration, ...) is treated as a generic
// tool-like item and mapped to tool_use/tool_result for the frontend's existing collapsible
// tool-call bubble, which just JSON.stringifies whatever input/output it's given.
const NON_TOOL_ITEM_TYPES = new Set(['userMessage', 'hookPrompt', 'agentMessage', 'plan', 'reasoning']);

function sendRequest(method, params) {
  return new Promise((resolve, reject) => {
    if (!appServerProc || !appServerProc.stdin.writable) {
      reject(new Error('app-server not running'));
      return;
    }
    const id = String(nextReqId++);
    pending.set(id, { resolve, reject });
    appServerProc.stdin.write(JSON.stringify({ id, method, params }) + '\n');
  });
}

function sendResponse(id, result) {
  if (appServerProc && appServerProc.stdin.writable) {
    appServerProc.stdin.write(JSON.stringify({ id, result }) + '\n');
  }
}

function handleServerLine(line) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch (e) {
    return;
  }

  // Response to one of our own client requests.
  if (msg.id !== undefined && !msg.method) {
    const key = String(msg.id);
    if (pending.has(key)) {
      const p = pending.get(key);
      pending.delete(key);
      if (msg.error) p.reject(new Error(msg.error.message || 'app-server error'));
      else p.resolve(msg.result);
    }
    return;
  }

  // Server-initiated request needing a response (approval-family methods). approvalPolicy is
  // already set to "never" on thread/start/resume, so this is a defensive fallback that should
  // rarely fire - but a turn must never hang waiting for a human approval prompt that has
  // nowhere to go in this headless context.
  if (msg.id !== undefined && msg.method) {
    let result = {};
    if (msg.method === 'execCommandApproval' || msg.method === 'applyPatchApproval') {
      result = { decision: 'approved' };
    } else if (msg.method === 'item/commandExecution/requestApproval' || msg.method === 'item/fileChange/requestApproval') {
      result = { decision: 'accept' };
    }
    sendResponse(msg.id, result);
    return;
  }

  // Notification (no id) - translate into the shared wire vocabulary.
  if (msg.method) {
    handleNotification(msg.method, msg.params || {});
  }
}

function handleNotification(method, params) {
  if (method === 'item/agentMessage/delta') {
    broadcast({ type: 'assistant_delta', text: params.delta || '' });
    return;
  }
  if (method === 'item/started') {
    const item = params.item || {};
    if (item.id && !NON_TOOL_ITEM_TYPES.has(item.type)) {
      broadcast({ type: 'tool_use', id: item.id, name: item.type, input: item });
    }
    return;
  }
  if (method === 'item/completed') {
    const item = params.item || {};
    if (item.id && !NON_TOOL_ITEM_TYPES.has(item.type)) {
      broadcast({ type: 'tool_result', id: item.id, output: item });
    }
    return;
  }
  if (method === 'turn/completed') {
    broadcast({ type: 'turn_complete' });
    resetIdleTimer();
    return;
  }
  if (method === 'error') {
    broadcast({ type: 'error', message: (params && params.message) || 'Codex error' });
  }
}

function startAppServer() {
  if (appServerProc) return Promise.resolve();
  if (starting) return starting;
  pauseHeartbeat();

  appServerProc = spawn('codex', ['app-server'], { cwd: '/home/minerclaw/workspace' });

  appServerProc.stdout.on('data', (chunk) => {
    stdoutBuffer += chunk.toString('utf8');
    let idx;
    while ((idx = stdoutBuffer.indexOf('\n')) >= 0) {
      const line = stdoutBuffer.slice(0, idx).trim();
      stdoutBuffer = stdoutBuffer.slice(idx + 1);
      if (line) handleServerLine(line);
    }
  });

  appServerProc.stderr.on('data', (chunk) => {
    log('codex app-server stderr:', chunk.toString('utf8').slice(0, 500));
  });

  appServerProc.on('exit', (code) => {
    log('codex app-server exited with code', code);
    const wasRunning = !!appServerProc;
    appServerProc = null;
    starting = null;
    rejectAllPending('app-server exited');
    if (wasRunning) {
      broadcast({ type: 'error', message: `Codex process exited (code ${code}). Send a message to start a new session.` });
    }
  });

  starting = sendRequest('initialize', { clientInfo: { name: 'bihand-codex-chat', version: '1.0' } })
    .then(() => {
      let savedThreadId = null;
      try {
        if (fs.existsSync(THREAD_FILE)) {
          savedThreadId = fs.readFileSync(THREAD_FILE, 'utf8').trim() || null;
        }
      } catch (e) {}

      const developerInstructions = readAgentInstructions();

      if (savedThreadId) {
        return sendRequest('thread/resume', { threadId: savedThreadId, approvalPolicy: 'never', developerInstructions })
          .then((result) => { threadId = (result && result.thread && result.thread.id) || savedThreadId; })
          .catch(() => sendRequest('thread/start', { cwd: '/home/minerclaw/workspace', approvalPolicy: 'never', developerInstructions })
            .then((result) => { threadId = result && result.thread && result.thread.id; }));
      }
      return sendRequest('thread/start', { cwd: '/home/minerclaw/workspace', approvalPolicy: 'never', developerInstructions })
        .then((result) => { threadId = result && result.thread && result.thread.id; });
    })
    .then(() => {
      if (threadId) {
        try { fs.writeFileSync(THREAD_FILE, threadId); } catch (e) {}
        broadcast({ type: 'session_ready', sessionId: threadId });
      }
      starting = null;
    })
    .catch((e) => {
      log('Failed to initialize codex app-server session:', e && e.message);
      broadcast({ type: 'error', message: 'Failed to start Codex session: ' + (e && e.message) });
      starting = null;
    });

  return starting;
}

function sendUserMessage(text) {
  resetIdleTimer();
  startAppServer().then(() => {
    if (!threadId) return;
    sendRequest('turn/start', { threadId, input: [{ type: 'text', text }] })
      .catch((e) => {
        broadcast({ type: 'error', message: 'Failed to send message: ' + (e && e.message) });
      });
  });
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

server.listen(18791, '127.0.0.1', () => {
  log('Codex chat daemon listening on 127.0.0.1:18791');
});
'''

class CodexStrategy(BaseProvisioningStrategy):
    def get_instructions_matrix(self) -> Dict[str, str]:
        return {
            "agentMd": "AGENTS.md"
        }

    def getInstructions(self, ip: str, private_key: str) -> List[Dict[str, Any]]:
        return self._get_specific_files_from_vm(ip, private_key, "/home/minerclaw/.codex", ["AGENTS.md"])

    def editInstructions(self, ip: str, private_key: str, instructions: List[Dict[str, Any]]) -> bool:
        res = self._edit_specific_files_on_vm(ip, private_key, "/home/minerclaw/.codex", instructions, ["AGENTS.md"])
        if res:
            sshService.execute_command(ip, private_key, "sudo chown -R minerclaw:minerclaw /home/minerclaw/.codex")
            sshService.execute_command(ip, private_key, "sudo cp /home/minerclaw/.codex/AGENTS.md /home/minerclaw/workspace/AGENTS.md || true")
            sshService.execute_command(ip, private_key, "sudo chown minerclaw:minerclaw /home/minerclaw/workspace/AGENTS.md || true")
        return res

    def getSkills(self, ip: str, private_key: str) -> List[Dict[str, Any]]:
        return self._get_skills_from_vm(ip, private_key, "/home/minerclaw/.agents/skills")

    def editSkills(self, ip: str, private_key: str, skills: List[Dict[str, Any]]) -> bool:
        res = self._edit_skills_on_vm(ip, private_key, "/home/minerclaw/.agents/skills", skills)
        if res:
            sshService.execute_command(ip, private_key, "sudo chown -R minerclaw:minerclaw /home/minerclaw/.agents/skills")
        return res

    def get_workspace_path(self) -> str:
        return "/home/minerclaw/workspace"

    async def extract_token(self, instance_id: str, vm_name: str, zone: str, external_ip: str, logger_func, gateway_token: str) -> Optional[str]:
        InstanceModel._updateToken(instance_id, gateway_token)
        logger_func(f"Codex initialized. Virtual Screen available at http://{external_ip}/screen/vnc.html")
        return gateway_token

    def get_startup_script(self, provider: str, api_key: str, model: str, password: str, gateway_token: str, agent_type: str = "codex", api_url: str = "http://localhost:8501/api/internal", agent_md_b64: str = "", mcp_config_b64: str = "", custom_base_url: str = "", oauth_token: str = "") -> str:
        config = self.get_provider_config(provider)
        actual_provider = config["provider"]

        # A ChatGPT/Codex subscription auth.json (pasted from `codex login`, or `codex login
        # --device-auth` on a headless machine, run somewhere with a browser) bills inference
        # against the user's own OpenAI plan instead of api_key's metered API usage. It bypasses
        # the provider/model_provider config entirely - Codex resolves auth from
        # ~/.codex/auth.json on its own once cli_auth_credentials_store="file" is set.
        # See https://developers.openai.com/codex/auth.
        use_subscription_auth = bool(oauth_token)
        import base64 as _base64
        auth_json_b64 = _base64.b64encode(oauth_token.encode('utf-8')).decode('utf-8') if use_subscription_auth else ""

        codex_chat_daemon_js = _CODEX_CHAT_DAEMON_JS_TEMPLATE.replace("__GATEWAY_TOKEN__", gateway_token)
        codex_chat_daemon_js_b64 = _base64.b64encode(codex_chat_daemon_js.encode('utf-8')).decode('utf-8')

        # Normalize provider and key name according to LiteLLM standard
        if use_subscription_auth:
            extra_bashrc_envs = ""
            codex_config_toml = """approval_policy = "never"
sandbox_mode = "danger-full-access"
web_search = "disabled"
stream = false
cli_auth_credentials_store = "file"
"""
        elif provider.lower() == "custom":
            extra_bashrc_envs = f'echo "export OPENAI_BASE_URL=\\"{custom_base_url}\\"" >> /root/.bashrc\necho "export OPENAI_BASE_URL=\\"{custom_base_url}\\"" >> /home/minerclaw/.bashrc\necho "OPENAI_BASE_URL=\\"{custom_base_url}\\"" >> /etc/environment'
            codex_config_toml = f"""model_provider = "custom"
model = "openai/{model}"
approval_policy = "never"
sandbox_mode = "danger-full-access"
web_search = "disabled"
stream = false

[model_providers.custom]
name = "Custom Provider"
base_url = "{custom_base_url}"
wire_api = "chat"
supports_websockets = false
env_key = "OPENAI_API_KEY"
"""
        elif provider.lower() == "bihand":
            base_url = api_url.replace("/api/internal", "")
            litellm_provider_prefix = "openai"
            litellm_key_name = "OPENAI_API_KEY"
            litellm_model = "openai/gemini-3.5-flash"
            key_env = f'OPENAI_API_KEY="{api_key}"\nOPENAI_API_BASE="{base_url}/api/llm/v1"\nNVIDIA_API_KEY="{api_key}"'
            
            codex_model_provider = "bihand-proxy"
            codex_model = "openai/gemini-3.5-flash"
            
            extra_bashrc_envs = f'echo "export OPENAI_BASE_URL=\\"{base_url}/api/llm/v1\\"" >> /root/.bashrc\necho "export OPENAI_BASE_URL=\\"{base_url}/api/llm/v1\\"" >> /home/minerclaw/.bashrc\necho "OPENAI_BASE_URL=\\"{base_url}/api/llm/v1\\"" >> /etc/environment'
            codex_config_toml = f"""model_provider = "bihand-proxy"
model = "openai/gemini-3.5-flash"
approval_policy = "never"
sandbox_mode = "danger-full-access"
web_search = "disabled"
stream = false

[model_providers.bihand-proxy]
name = "Bihand Proxy"
base_url = "{base_url}/api/llm/v1"
wire_api = "responses"
supports_websockets = false
env_key = "OPENAI_API_KEY"
"""
        else:
            if actual_provider in ("google", "gemini"):
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

            codex_model_provider = "litellm-proxy"
            codex_model = f"openai/{model}"

            extra_bashrc_envs = f'echo "export OPENAI_BASE_URL=\\"http://127.0.0.1:4000/v1\\"" >> /root/.bashrc\necho "export OPENAI_BASE_URL=\\"http://127.0.0.1:4000/v1\\"" >> /home/minerclaw/.bashrc\necho "OPENAI_BASE_URL=\\"http://127.0.0.1:4000/v1\\"" >> /etc/environment'
            codex_config_toml = f"""model_provider = "litellm-proxy"
model = "openai/{model}"
approval_policy = "never"
sandbox_mode = "danger-full-access"
web_search = "disabled"
stream = false

[model_providers.litellm-proxy]
name = "Local LiteLLM Proxy"
base_url = "http://127.0.0.1:4000/v1"
wire_api = "responses"
supports_websockets = false
env_key = "OPENAI_API_KEY"
"""

        # Build litellm service only if not using a direct provider (bihand's own proxy, a
        # user-supplied custom base URL, or ChatGPT subscription auth)
        if use_subscription_auth or provider.lower() in ("bihand", "custom"):
            litellm_service_yaml = ""
        else:
            litellm_service_yaml = f"""
  litellm:
    image: ghcr.io/berriai/litellm:main-stable
    restart: unless-stopped
    network_mode: host
    environment:
      - {litellm_key_name}={api_key}
    command: ["--model", "{litellm_model}", "--alias", "{model}", "--port", "4000"]"""

        # ChatGPT/Codex subscription auth outranks any API key: when set, every place that
        # would otherwise export OPENAI_API_KEY/ANTHROPIC_API_KEY/GEMINI_API_KEY (bashrc,
        # heartbeat.py, the systemd unit) omits them entirely so `codex exec` falls through to
        # ~/.codex/auth.json instead. Same shape as claude_code_strategy.py's
        # use_subscription_auth handling.
        if use_subscription_auth:
            root_bashrc_auth = ""
            minerclaw_bashrc_auth = ""
            heartbeat_env_block = "pass  # Subscription auth: codex resolves ~/.codex/auth.json automatically"
            systemd_env_lines = ""
            auth_json_write_block = (
                f'echo "{auth_json_b64}" | base64 -d > /home/minerclaw/.codex/auth.json\n'
                "chmod 600 /home/minerclaw/.codex/auth.json"
            )
        else:
            root_bashrc_auth = "\n".join([
                f'echo "export OPENAI_API_KEY=\\"{api_key}\\"" >> /root/.bashrc',
                f'echo "export ANTHROPIC_API_KEY=\\"{api_key}\\"" >> /root/.bashrc',
                f'echo "export GEMINI_API_KEY=\\"{api_key}\\"" >> /root/.bashrc',
            ])
            minerclaw_bashrc_auth = "\n".join([
                f'echo "export OPENAI_API_KEY=\\"{api_key}\\"" >> /home/minerclaw/.bashrc',
                f'echo "export ANTHROPIC_API_KEY=\\"{api_key}\\"" >> /home/minerclaw/.bashrc',
                f'echo "export GEMINI_API_KEY=\\"{api_key}\\"" >> /home/minerclaw/.bashrc',
            ])
            heartbeat_env_block = "\n    ".join([
                f'env["OPENAI_API_KEY"] = "{api_key}"',
                f'env["ANTHROPIC_API_KEY"] = "{api_key}"',
                f'env["GEMINI_API_KEY"] = "{api_key}"',
            ])
            systemd_env_lines = "\n".join([
                f"Environment=OPENAI_API_KEY={api_key}",
                f"Environment=ANTHROPIC_API_KEY={api_key}",
                f"Environment=GEMINI_API_KEY={api_key}",
            ])
            auth_json_write_block = "# No subscription auth.json - using API key auth"

        return rf"""#!/bin/bash
set -e
export HOME="/root"
exec > >(tee -a /var/log/codex-startup.log /dev/ttyS1) 2>&1

echo "=== Codex Worker Startup ==="
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

# --- System Dependencies ---
export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a
export UCF_FORCE_CONFFOLD=1

apt-get update -y
apt-get install -y -o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold" curl wget git jq nginx \
    xvfb x11vnc novnc fluxbox python3-requests x11-xserver-utils \
    libnss3 libatk-bridge2.0-0 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libgbm1 libasound2t64

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

# --- Install @openai/codex CLI ---
echo "Installing OpenAI Codex..."
npm install -g @openai/codex@0.147.0 || true
if ! command -v codex &> /dev/null; then
    npm install -g @openai/codex || true
fi

# --- Install ws (websocket server library for the interactive chat daemon) ---
# Installed locally into /opt/bihand (not -g): a plain `node script.js` invocation only
# resolves require() against node_modules directories that are ancestors of the script's own
# path, so a global npm install (which lands in /usr/lib/node_modules under nodesource's
# prefix) is invisible to codex_chat_daemon.js unless NODE_PATH is set - it isn't, in the
# systemd unit below. Installing into the same directory the daemon is later written to fixes
# this - same pattern as claude_code_strategy.py's chat_daemon.js.
mkdir -p /opt/bihand
npm install --prefix /opt/bihand ws

# Setup environment variables
{root_bashrc_auth}
echo "export PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/local/bin/google-chrome" >> /root/.bashrc

{minerclaw_bashrc_auth}
echo "export PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/local/bin/google-chrome" >> /home/minerclaw/.bashrc

echo "PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/local/bin/google-chrome" >> /etc/environment

{extra_bashrc_envs}

# --- Setup local LiteLLM service container inside Docker Compose if user-provider ---
if [ ! -z "{litellm_service_yaml}" ]; then
    echo "Installing Docker..."
    curl -fsSL https://get.docker.com | sh
    systemctl enable --now docker
    
    mkdir -p /opt/litellm
    cat << 'EOF_COMPOSE' > /opt/litellm/docker-compose.yml
version: '3.8'
services:{litellm_service_yaml}
EOF_COMPOSE
    
    # Run LiteLLM proxy container
    docker compose -f /opt/litellm/docker-compose.yml up -d
fi

mkdir -p /home/minerclaw/workspace
mkdir -p /home/minerclaw/.codex
mkdir -p /home/minerclaw/.agents/skills
echo "{agent_md_b64}" | base64 -d > /home/minerclaw/.codex/AGENTS.md
cp /home/minerclaw/.codex/AGENTS.md /home/minerclaw/workspace/AGENTS.md || true

# Subscription auth.json (ChatGPT/Codex subscription only)
{auth_json_write_block}

# Setup Codex TOML config file
cat << 'EOF3' > /home/minerclaw/.codex/config.toml
{codex_config_toml}
EOF3

# --- Apply Custom MD and MCP Config ---
echo "Applying Custom MCP Configuration..."
echo "{mcp_config_b64}" | base64 -d > /tmp/user_mcp.json
if jq -e . >/dev/null 2>&1 < /tmp/user_mcp.json; then
    # Merge custom MCP commands directly into the TOML configuration block
    node -e "
    const fs = require('fs');
    try {{
        const userMcp = JSON.parse(fs.readFileSync('/tmp/user_mcp.json', 'utf8'));
        let tomlConfig = fs.readFileSync('/home/minerclaw/.codex/config.toml', 'utf8');
        const mcpServers = userMcp.mcpServers || (userMcp.mcp ? userMcp.mcp.servers : null) || userMcp.mcp || {{}};
        
        for (const [name, srv] of Object.entries(mcpServers)) {{
            if (srv) {{
                let cmd_args = [];
                if (Array.isArray(srv.command)) {{
                    cmd_args = [...srv.command];
                }} else if (typeof srv.command === 'string' && srv.command) {{
                    cmd_args = [srv.command, ...(srv.args || [])];
                }}
                if (cmd_args.length > 0) {{
                    const argsStr = JSON.stringify(cmd_args);
                    tomlConfig += '\n[mcp_servers.' + name + ']\ntype = \"local\"\ncommand = ' + argsStr + '\n';
                    const env = srv.env || srv.environment;
                    if (env) {{
                        for (const [k, v] of Object.entries(env)) {{
                            tomlConfig += 'env.' + k + ' = \"' + v + '\"\n';
                        }}
                    }}
                }}
            }}
        }}
        fs.writeFileSync('/home/minerclaw/.codex/config.toml', tomlConfig, 'utf8');
    }} catch(e) {{
        console.error('TOML MCP merge error:', e);
    }}
    "
fi

# Fix ownership so minerclaw user owns everything
chown -R minerclaw:minerclaw /home/minerclaw/workspace /home/minerclaw/.codex /home/minerclaw/.agents

# Symlink compatibility with root user just in case
ln -sf /home/minerclaw/workspace /root/workspace
mkdir -p /root/.codex
ln -sf /home/minerclaw/.codex/config.toml /root/.codex/config.toml

# --- Setup Virtual Screen (noVNC) ---
echo "Setting up Virtual Screen..."
mkdir -p /root/.vnc
x11vnc -storepasswd "{password}" /root/.vnc/passwd
chmod 600 /root/.vnc/passwd

# Start Xvfb
Xvfb :99 -screen 0 1280x800x24 > /dev/null 2>&1 &
export DISPLAY=:99

# Start Fluxbox Window Manager
fluxbox > /dev/null 2>&1 &

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

sleep 3

# Start x11vnc with noxdamage and noxfixes to prevent crashes
x11vnc -display :99 -rfbauth /root/.vnc/passwd -noxdamage -noxfixes -bg -forever -shared > /dev/null 2>&1 || true

# Start noVNC Web UI
websockify --web=/usr/share/novnc/ --heartbeat 30 6080 localhost:5900 > /dev/null 2>&1 &

# --- Bihand M2M Bridge ---
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
elif [ "$COMMAND" = "credentials" ]; then
    TYPE_FILTER=""
    while [ $# -gt 0 ]; do
        case "$1" in
            --type)
                TYPE_FILTER="$2"
                shift 2
                ;;
            *)
                shift 1
                ;;
        esac
    done
    if [ -n "$TYPE_FILTER" ]; then
        RES=$(bihand_curl -X GET "$API_URL/credentials?type=$TYPE_FILTER" -H "X-Agent-Token: {gateway_token}")
    else
        RES=$(bihand_curl -X GET "$API_URL/credentials" -H "X-Agent-Token: {gateway_token}")
    fi
    echo "$RES"
elif [ "$COMMAND" = "flow-create" ]; then
    NAME=""
    PLATFORM=""
    CHANNEL_TYPE=""
    PAGE_ID=""
    OA_ID=""
    CREDENTIAL_ID=""
    STAGES_JSON=""
    while [ $# -gt 0 ]; do
        case "$1" in
            --name)
                NAME="$2"
                shift 2
                ;;
            --platform)
                PLATFORM="$2"
                shift 2
                ;;
            --channel-type)
                CHANNEL_TYPE="$2"
                shift 2
                ;;
            --page-id)
                PAGE_ID="$2"
                shift 2
                ;;
            --oa-id)
                OA_ID="$2"
                shift 2
                ;;
            --credential-id)
                CREDENTIAL_ID="$2"
                shift 2
                ;;
            --stages-json)
                STAGES_JSON="$2"
                shift 2
                ;;
            *)
                shift 1
                ;;
        esac
    done
    PAYLOAD=$(node -e "
        const payload = {{
            name: process.argv[1],
            platform: process.argv[2],
            channelType: process.argv[3],
        }};
        if (process.argv[4]) payload.pageId = process.argv[4];
        if (process.argv[5]) payload.oaId = process.argv[5];
        if (process.argv[6]) payload.credentialId = process.argv[6];
        if (process.argv[7]) payload.stages = JSON.parse(process.argv[7]);
        console.log(JSON.stringify(payload));
    " "$NAME" "$PLATFORM" "$CHANNEL_TYPE" "$PAGE_ID" "$OA_ID" "$CREDENTIAL_ID" "$STAGES_JSON")
    RES=$(bihand_curl -X POST "$API_URL/flows" \
        -H "X-Agent-Token: {gateway_token}" \
        -H "Content-Type: application/json" \
        -d "$PAYLOAD")
    echo "$RES"
else
    echo "Usage: bihand <complete|report|delegate|block|comment|post|google-token|credentials|flow-create> <taskId> [args...]"
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
    # Parses Codex's --json event stream for the agent's own final agent_message text, so it
    # can be handed back to the agent verbatim when nudging it to finalize.
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
                    item = data.get("item", {{}})
                    if data.get("type") == "item.completed" and isinstance(item, dict) and item.get("type") == "agent_message":
                        text = item.get("text", "")
                        if isinstance(text, str):
                            parts.append(text)
        except Exception:
            pass
    return "\n".join([p for p in parts if p.strip()]).strip()

def run_codex_once(prompt, env):
    error_msg = None
    try:
        res = subprocess.run([
            "codex", "exec",
            "--sandbox", "danger-full-access",
            "--json",
            "--skip-git-repo-check",
            "--ephemeral",
            prompt
        ], cwd="/home/minerclaw/workspace", stdin=subprocess.DEVNULL, env=env, timeout=3600, capture_output=True, text=True)
    except subprocess.TimeoutExpired:
        res = subprocess.CompletedProcess(args=[], returncode=124, stdout="", stderr="Execution timed out after 1 hour.")
        error_msg = "Execution timed out after 1 hour (3600s)."
    if res.stdout:
        sys.stdout.write(res.stdout)
        sys.stdout.flush()
    if res.stderr:
        sys.stderr.write(res.stderr)
        sys.stderr.flush()

    if res.returncode != 0 and not error_msg:
        combined = (res.stderr or "") + "\n" + (res.stdout or "")
        if "Credit balance is too low" in combined:
            error_msg = "Credit balance is too low to access the Anthropic API."
        else:
            lines = [l.strip() for l in combined.splitlines() if l.strip()]
            if lines:
                error_msg = "Error: " + " | ".join(lines[-3:])
            else:
                error_msg = f"Agent process exited with non-zero code {{res.returncode}}."
    return res, error_msg

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
    
    print(f"Waking up Codex for task {{task_id}}...")

    env = os.environ.copy()
    # Set active API keys to environment explicitly so Codex subprocess resolves it
    {heartbeat_env_block}

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
        res, error_msg = run_codex_once(current_prompt, env)

        status = get_task_status(task_id)
        if status != "in_progress":
            # Agent finalized (or the task was otherwise resolved) - nothing more to do.
            break

        if original_answer is None:
            candidate = extract_final_answer(res.stdout or "")
            if len(candidate) > 100:
                original_answer = candidate

        if original_answer is None:
            # Nothing salvageable at all - no point nudging with empty content.
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

    # Watchdog Check - only reached if the task is still unresolved after all attempts
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

if __name__ == '__main__':
    main()
EOF

# 3. Create the Systemd service to auto-restart the daemon
cat << 'EOF' > /etc/systemd/system/bihand-heartbeat.service
[Unit]
Description=Bihand Codex Worker Agent Process Monitor
After=network.target

[Service]
ExecStart=/usr/bin/python3 /opt/bihand/heartbeat.py
Restart=always
User=minerclaw
Environment=HOME=/home/minerclaw
{systemd_env_lines}
Environment=PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/local/bin/google-chrome
EnvironmentFile=-/home/minerclaw/.bihand/google_workspace.env

[Install]
WantedBy=multi-user.target
EOF

# 4. Setup Interactive Chat Daemon (bridges live human<->agent chat to the /ws/chat proxy) -
# mirrors Claude Code's bihand-chat-daemon.service, but runs directly as minerclaw (no sudo -u
# wrapper needed, since this whole unit already runs as that user) and speaks Codex's own
# app-server JSON-RPC protocol instead of Claude's stream-json stdin/stdout protocol.
echo "{codex_chat_daemon_js_b64}" | base64 -d > /opt/bihand/codex_chat_daemon.js

cat << 'EOF2' > /etc/systemd/system/bihand-codex-chat-daemon.service
[Unit]
Description=Bihand Codex Interactive Chat Daemon
After=network.target

[Service]
ExecStart=/usr/bin/node /opt/bihand/codex_chat_daemon.js
Restart=always
User=minerclaw
Environment=HOME=/home/minerclaw
{systemd_env_lines}

[Install]
WantedBy=multi-user.target
EOF2

systemctl daemon-reload
systemctl enable --now bihand-heartbeat.service
systemctl enable --now bihand-codex-chat-daemon.service

# --- Self-signed cert for the wss:// chat proxy (backend connects over 443; the GCP firewall
# only opens that port externally - same as claude_code_strategy.py's nginx setup) ---
mkdir -p /etc/ssl/private
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout /etc/ssl/private/nginx-selfsigned.key \
  -out /etc/ssl/certs/nginx-selfsigned.crt \
  -subj "/CN=bihand-codex-worker"

# --- Nginx Proxy for VNC + Interactive Chat ---
cat <<'EOF2' > /etc/nginx/sites-available/default
server {{
    listen 80;
    server_name _;

    location /screen/ {{
        proxy_pass http://127.0.0.1:6080/;
        proxy_set_header Host $host;
    }}

    location /screen/websockify {{
        proxy_pass http://127.0.0.1:6080/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 3600s;
        proxy_buffering off;
    }}

    location /websockify {{
        proxy_pass http://127.0.0.1:6080/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 3600s;
        proxy_buffering off;
    }}

    # Interactive Codex chat daemon (websocket)
    location /api/codexchat {{
        proxy_pass http://127.0.0.1:18791;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 3600s;
        proxy_buffering off;
    }}

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

    location /screen/ {{
        proxy_pass http://127.0.0.1:6080/;
        proxy_set_header Host $host;
    }}

    location /screen/websockify {{
        proxy_pass http://127.0.0.1:6080/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 3600s;
        proxy_buffering off;
    }}

    location /websockify {{
        proxy_pass http://127.0.0.1:6080/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 3600s;
        proxy_buffering off;
    }}

    # Interactive Codex chat daemon (websocket) - the backend's /ws/chat bridge connects here
    # over wss:// since the GCP firewall only opens port 443 externally.
    location /api/codexchat {{
        proxy_pass http://127.0.0.1:18791;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 3600s;
        proxy_buffering off;
    }}

    location / {{
        proxy_pass http://127.0.0.1:8080/;
        proxy_set_header Host $host;
    }}
}}
EOF2

rm -f /etc/nginx/sites-enabled/default
ln -s /etc/nginx/sites-available/default /etc/nginx/sites-enabled/default
systemctl restart nginx

echo "=== Startup script complete. Codex Worker ready! ==="
"""

    def getAgentConfig(self, ip: str, private_key: str) -> str:
        res = self._get_specific_files_from_vm(ip, private_key, "/home/minerclaw/.codex", ["config.toml"])
        return res[0]["content"] if res else ""

    def editAgentConfig(self, ip: str, private_key: str, config_content: str) -> bool:
        files = [{"name": "config.toml", "content": config_content}]
        return self._edit_specific_files_on_vm(ip, private_key, "/home/minerclaw/.codex", files, ["config.toml"])

    def getMcpConfig(self, ip: str, private_key: str) -> str:
        # Standardize and map TOML key mcp_servers to Standard JSON using mcp_normalizer
        import tomli
        import json
        from fastapp.utils import mcp_normalizer
        try:
            current_raw = self.getAgentConfig(ip, private_key)
            if not current_raw:
                return "{}"
            parsed = tomli.loads(current_raw)
            return mcp_normalizer.normalize_to_claudecode(json.dumps(parsed))
        except Exception:
            return "{}"

    def editMcpConfig(self, ip: str, private_key: str, mcp_config: str) -> bool:
        import json
        import tomli_w
        import tomli
        from fastapp.utils import mcp_normalizer
        try:
            # Normalize to Codex specific JSON format: {"mcp_servers": ...}
            codex_mcp_raw = mcp_normalizer.normalize_to_codex(mcp_config)
            codex_mcp = json.loads(codex_mcp_raw)
            new_mcp_servers = codex_mcp.get("mcp_servers", {})
            
            # Read current TOML
            current_raw = self.getAgentConfig(ip, private_key)
            parsed = tomli.loads(current_raw) if current_raw else {}
            
            # Reconstruct mcp_servers TOML section
            current_mcp = parsed.get("mcp_servers", {}) if isinstance(parsed.get("mcp_servers"), dict) else {}

            # new_mcp_servers (derived from the DB's mcpConfig) is the full authoritative set of
            # user-configured servers, so it replaces current_mcp wholesale - a server absent from
            # it (e.g. after a disconnect) must actually be removed, not left behind forever.
            # chrome-devtools is the one exception: it's only ever injected into the VM's startup
            # script/boot-time config (see provisionerService.py), never persisted into the DB's
            # mcpConfig, so it must be explicitly preserved here or every push would silently wipe it.
            merged_mcp = dict(new_mcp_servers)
            if "chrome-devtools" in current_mcp and "chrome-devtools" not in merged_mcp:
                merged_mcp["chrome-devtools"] = current_mcp["chrome-devtools"]
            parsed["mcp_servers"] = merged_mcp
            updated_toml = tomli_w.dumps(parsed)
            
            success = self.editAgentConfig(ip, private_key, updated_toml)
            if success:
                sshService.execute_command(ip, private_key, "sudo chown -R minerclaw:minerclaw /home/minerclaw/.codex")
            return success
        except Exception:
            return False

    def restartAgent(self, ip: str, private_key: str) -> bool:
        # Codex runs as a systemd service bihand-heartbeat. Restarting it triggers configuration pick-up.
        res = sshService.execute_command(ip, private_key, "sudo systemctl restart bihand-heartbeat.service")
        return res["exitCode"] == 0
