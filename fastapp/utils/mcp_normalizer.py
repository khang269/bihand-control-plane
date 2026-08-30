import json
from typing import Dict, Any

def _get_remote_headers(config: Dict[str, Any]) -> Dict[str, Any]:
    """Remote MCP header dict, accepting either the generic "headers" key used by the
    Standard/OpenClaw/OpenCode shapes or Codex's own "http_headers" key - so an auth header
    survives round-tripping regardless of which runtime's shape the source entry came from."""
    return config.get("headers") or config.get("http_headers") or {}

def extract_all_servers(mcp_config_str: str) -> Dict[str, Any]:
    """
    Extracts all MCP servers from any of the three formats: Standard, OpenClaw, or OpenCode.
    Returns a unified flat dictionary of server definitions.
    """
    servers = {}
    try:
        data = json.loads(mcp_config_str) if mcp_config_str else {}
        if not isinstance(data, dict):
            return {}
        
        # 1. Standard format: "mcpServers" key or "mcp_servers" key (Codex)
        if "mcpServers" in data and isinstance(data["mcpServers"], dict):
            for name, s_config in data["mcpServers"].items():
                if isinstance(s_config, dict):
                    servers[name] = s_config
        elif "mcp_servers" in data and isinstance(data["mcp_servers"], dict):
            for name, s_config in data["mcp_servers"].items():
                if isinstance(s_config, dict):
                    servers[name] = s_config

        # 2. OpenClaw format: "mcp" -> "servers" key
        if "mcp" in data and isinstance(data["mcp"], dict):
            mcp_data = data["mcp"]
            if "servers" in mcp_data and isinstance(mcp_data["servers"], dict):
                for name, s_config in mcp_data["servers"].items():
                    if isinstance(s_config, dict):
                        servers[name] = s_config
            # 3. OpenCode format: "mcp" -> direct children (which are server objects)
            else:
                for name, s_config in mcp_data.items():
                    # Skip 'servers' key just in case
                    if name == "servers":
                        continue
                    if isinstance(s_config, dict):
                        servers[name] = s_config

    except Exception:
        pass
    return servers

def normalize_to_claudecode(mcp_config_str: str) -> str:
    """
    Normalizes any MCP config string to the Standard/ClaudeCode format:
    {"mcpServers": { "server-name": { "command": "...", "args": [...], "env": {...} } }}
    """
    servers = extract_all_servers(mcp_config_str)
    normalized_servers = {}
    
    for name, config in servers.items():
        # If it's in OpenCode format, convert type: local with command array to command + args
        if "type" in config and config["type"] == "local" and "command" in config and isinstance(config["command"], list):
            cmd_arr = config["command"]
            if cmd_arr:
                normalized_servers[name] = {
                    "command": cmd_arr[0],
                    "args": cmd_arr[1:],
                    "env": config.get("environment", {})
                }
        else:
            # Already standard or openclaw-compatible stdio
            normalized_servers[name] = {
                "command": config.get("command", ""),
                "args": config.get("args", []),
                "env": config.get("env", {})
            }
            # For remote servers, preserve URL and other details
            if "url" in config:
                normalized_servers[name]["url"] = config["url"]
            headers = _get_remote_headers(config)
            if headers:
                normalized_servers[name]["headers"] = headers

    return json.dumps({"mcpServers": normalized_servers}, indent=2)

def normalize_to_openclaw(mcp_config_str: str) -> str:
    """
    Normalizes any MCP config string to the OpenClaw format:
    {"mcp": { "servers": { "server-name": { "command": "...", "args": [...], "env": {...} } } }}
    """
    servers = extract_all_servers(mcp_config_str)
    normalized_servers = {}
    
    for name, config in servers.items():
        if "type" in config and config["type"] == "local" and "command" in config and isinstance(config["command"], list):
            cmd_arr = config["command"]
            if cmd_arr:
                normalized_servers[name] = {
                    "command": cmd_arr[0],
                    "args": cmd_arr[1:],
                    "env": config.get("environment", {})
                }
        else:
            normalized_servers[name] = {
                "command": config.get("command", ""),
                "args": config.get("args", []),
                "env": config.get("env", {})
            }
            if "url" in config:
                normalized_servers[name]["url"] = config["url"]
            headers = _get_remote_headers(config)
            if headers:
                normalized_servers[name]["headers"] = headers

    return json.dumps({"mcp": {"servers": normalized_servers}}, indent=2)

def normalize_to_opencode(mcp_config_str: str) -> str:
    """
    Normalizes any MCP config string to the OpenCode format:
    {"mcp": { "server-name": { "type": "local", "command": ["cmd", "arg1", "arg2"], "enabled": true, "environment": {...} } }}
    """
    servers = extract_all_servers(mcp_config_str)
    normalized_servers = {}
    
    for name, config in servers.items():
        # If it's already in OpenCode local format
        if "type" in config and config["type"] == "local" and "command" in config:
            normalized_servers[name] = config
        elif "url" in config: # remote server
            normalized_servers[name] = {
                "type": "remote",
                "url": config["url"],
                "headers": _get_remote_headers(config),
                "enabled": config.get("enabled", True)
            }
        else: # convert from stdio (command + args) to OpenCode command array
            cmd = config.get("command")
            args = config.get("args", []) or []
            cmd_arr = [cmd] if cmd else []
            if isinstance(args, list):
                cmd_arr.extend(args)
            normalized_servers[name] = {
                "type": "local",
                "command": cmd_arr,
                "environment": config.get("env", {}),
                "enabled": config.get("enabled", True)
            }
            
    return json.dumps({"mcp": normalized_servers}, indent=2)

def normalize_to_codex(mcp_config_str: str) -> str:
    """
    Normalizes any MCP config string to the Codex format:
    {"mcp_servers": { "server-name": { "command": "cmd", "args": ["arg1", "arg2"], "env": {...} } }}

    Codex's real ~/.codex/config.toml schema (confirmed against OpenAI's Codex CLI docs)
    requires "command" to be a scalar string with "args" as a separate list, and has no
    "type" field - unlike this codebase's other normalize_to_* variants. Getting this wrong
    is fatal: `codex exec` refuses to even start if command is an array ("invalid type:
    sequence, expected a string"), breaking every task on the agent, not just MCP tool use.

    Remote MCP auth headers must land under Codex's own "http_headers" key, not a generic
    "headers" key - Codex's config.toml schema doesn't recognize the latter at all, so it was
    previously silently dropped here, leaving a "connected" remote MCP server with no
    Authorization header ever reaching the VM (confirmed live: a real ${cred:...}-resolved
    bearer token vanished between Mongo's mcpConfig and the pushed config.toml).
    """
    servers = extract_all_servers(mcp_config_str)
    normalized_servers = {}

    for name, config in servers.items():
        if "url" in config:
            entry = {"url": config["url"]}
            headers = _get_remote_headers(config)
            if headers:
                entry["http_headers"] = headers
            normalized_servers[name] = entry
            continue

        env = config.get("env", {}) or config.get("environment", {})
        cmd = config.get("command")
        args = list(config.get("args", []) or [])
        if isinstance(cmd, list):
            # Array-form command (e.g. from an OpenCode-shaped entry) - split first element
            # out as the scalar command, prepending any remaining elements onto args.
            if cmd:
                args = list(cmd[1:]) + args
                cmd = cmd[0]
            else:
                cmd = ""

        normalized_servers[name] = {
            "command": cmd or "",
            "args": args,
            "env": env,
        }

    return json.dumps({"mcp_servers": normalized_servers}, indent=2)
