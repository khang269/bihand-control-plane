import React, { useEffect, useRef, useState, useCallback } from 'react';
import { TerminalSquare } from 'lucide-react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { useAuth } from '../context/AuthContext';

type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'closed';

// Wire format spoken by /ws/terminal (websocketController.py:terminal_stream) - a direct
// paramiko PTY bridge, no on-VM daemon involved.
interface TerminalWireEvent {
  type: string;
  data?: string;
  text?: string;
}

const MAX_BACKOFF_MS = 15000;

const TerminalPanel: React.FC<{ instanceId: string; fleetId: string }> = ({ instanceId }) => {
  const { token } = useAuth();
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');

  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffRef = useRef(1000);
  const unmountedRef = useRef(false);
  const connectRef = useRef<() => void>(() => {});

  const sendResize = useCallback(() => {
    const term = termRef.current;
    const ws = wsRef.current;
    if (!term || !ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
  }, []);

  const connect = useCallback(() => {
    if (!token || unmountedRef.current || !termRef.current) return;
    setConnectionState(prev => (prev === 'connected' ? 'reconnecting' : 'connecting'));

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/ws/terminal/${instanceId}?token=${token}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      backoffRef.current = 1000;
    };

    ws.onmessage = (event) => {
      let data: TerminalWireEvent;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      switch (data.type) {
        case 'session_ready':
          setConnectionState('connected');
          sendResize();
          break;
        case 'output':
          termRef.current?.write(data.data || '');
          break;
        case 'error':
          termRef.current?.write(`\r\n\x1b[31m[error] ${data.text || 'Unknown error'}\x1b[0m\r\n`);
          break;
        default:
          break;
      }
    };

    ws.onclose = () => {
      if (unmountedRef.current) return;
      setConnectionState('reconnecting');
      termRef.current?.write('\r\n\x1b[33m[disconnected - reconnecting...]\x1b[0m\r\n');
      const delay = backoffRef.current;
      backoffRef.current = Math.min(backoffRef.current * 2, MAX_BACKOFF_MS);
      reconnectTimerRef.current = setTimeout(() => connectRef.current(), delay);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [instanceId, token, sendResize]);

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  useEffect(() => {
    unmountedRef.current = false;
    if (!containerRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      theme: {
        background: '#000000',
        foreground: '#e4e4e7',
        cursor: '#fafafa',
        selectionBackground: '#3f3f46',
      },
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();
    termRef.current = term;
    fitAddonRef.current = fitAddon;

    term.onData((data) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }));
      }
    });
    term.onResize(() => sendResize());

    connectRef.current();

    const resizeObserver = new ResizeObserver(() => {
      try {
        fitAddonRef.current?.fit();
      } catch {
        // container not yet laid out; ignore
      }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      unmountedRef.current = true;
      resizeObserver.disconnect();
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
      wsRef.current = null;
      term.dispose();
      termRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId, token]);

  const statusLabel: Record<ConnectionState, string> = {
    connecting: 'Connecting...',
    connected: 'Live',
    reconnecting: 'Reconnecting...',
    closed: 'Disconnected',
  };
  const statusColor: Record<ConnectionState, string> = {
    connecting: 'bg-blue-500 animate-pulse',
    connected: 'bg-emerald-500',
    reconnecting: 'bg-amber-500 animate-pulse',
    closed: 'bg-red-500',
  };

  return (
    <div className="border border-border rounded-xl overflow-hidden bg-card flex flex-col h-full min-h-0">
      <div className="bg-secondary border-b border-border p-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-mono text-muted-foreground">
          <TerminalSquare size={16} /> Terminal
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className={`w-2 h-2 rounded-full ${statusColor[connectionState]}`}></span>
          {statusLabel[connectionState]}
        </div>
      </div>
      {/* The terminal itself keeps xterm's fixed dark theme (configured above) regardless of site theme. */}
      <div ref={containerRef} className="flex-1 min-h-0 p-2 bg-black" />
    </div>
  );
};

export default TerminalPanel;
