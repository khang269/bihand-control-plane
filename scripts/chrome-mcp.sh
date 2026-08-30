#!/bin/bash
# chrome-mcp.sh — start/stop a Chrome instance with CDP on port 9222 for the
# chrome-devtools MCP server (.mcp.json points CHROME_CDP_URL at it).
#
# Mirrors the on-VM pattern from fastapp/services/provisioning/claude_code_strategy.py,
# adapted for a desktop machine with a real display:
#   - dedicated PERSISTENT profile dir (cookies/logins survive kill + reopen)
#   - --remote-debugging-port=9222
#   - no Xvfb (uses the real display), no --no-sandbox (normal user session)
#
# Usage: chrome-mcp.sh {start|stop|restart|status}

set -u

PORT=9222
PROFILE_DIR="${HOME}/.chrome-mcp-profile"     # persistent: sign-ins survive restarts
LOG_FILE="${PROFILE_DIR}/chrome.log"
PID_FILE="${PROFILE_DIR}/chrome.pid"
CHROME_BIN="$(command -v google-chrome-stable || command -v google-chrome)"
export DISPLAY="${DISPLAY:-:1}"

cdp_alive() {
    curl -sf --max-time 2 "http://127.0.0.1:${PORT}/json/version" > /dev/null 2>&1
}

start() {
    if cdp_alive; then
        echo "Chrome CDP already listening on port ${PORT}."
        exit 0
    fi
    if [ -z "${CHROME_BIN}" ]; then
        echo "ERROR: google-chrome not found in PATH." >&2
        exit 1
    fi
    mkdir -p "${PROFILE_DIR}"
    # Note: Chrome refuses --remote-debugging-port on the *default* profile;
    # a dedicated --user-data-dir is required (and is what makes it persistent).
    nohup "${CHROME_BIN}" \
        --user-data-dir="${PROFILE_DIR}" \
        --remote-debugging-port=${PORT} \
        --no-first-run \
        --no-default-browser-check \
        --disable-session-crashed-bubble \
        --restore-last-session \
        >> "${LOG_FILE}" 2>&1 &
    echo $! > "${PID_FILE}"

    # Wait for CDP to come up (up to ~15s)
    for _ in $(seq 1 30); do
        if cdp_alive; then
            echo "Chrome started (pid $(cat "${PID_FILE}")), CDP on http://127.0.0.1:${PORT}"
            echo "Profile: ${PROFILE_DIR} (persistent — sign-ins survive restarts)"
            exit 0
        fi
        sleep 0.5
    done
    echo "ERROR: Chrome did not expose CDP on port ${PORT} within 15s. See ${LOG_FILE}" >&2
    exit 1
}

stop() {
    if [ -f "${PID_FILE}" ] && kill -0 "$(cat "${PID_FILE}")" 2>/dev/null; then
        kill "$(cat "${PID_FILE}")"
        rm -f "${PID_FILE}"
        echo "Chrome (MCP instance) stopped. Profile kept at ${PROFILE_DIR}."
    else
        # Fallback: kill whatever chrome owns our profile dir
        pkill -f -- "--user-data-dir=${PROFILE_DIR}" \
            && echo "Chrome (MCP instance) stopped. Profile kept at ${PROFILE_DIR}." \
            || echo "No MCP Chrome instance running."
        rm -f "${PID_FILE}"
    fi
}

status() {
    if cdp_alive; then
        echo "RUNNING — CDP on http://127.0.0.1:${PORT}"
        curl -s "http://127.0.0.1:${PORT}/json/version" | head -c 300; echo
    else
        echo "NOT RUNNING (no CDP on port ${PORT})"
        exit 1
    fi
}

case "${1:-}" in
    start)   start ;;
    stop)    stop ;;
    restart) stop; sleep 1; start ;;
    status)  status ;;
    *) echo "Usage: $0 {start|stop|restart|status}"; exit 2 ;;
esac
