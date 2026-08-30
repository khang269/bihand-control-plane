import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Send, Loader2, Wrench, ChevronRight, ChevronDown, Bot, AlertTriangle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import api from '../lib/api';
import { Textarea } from './ui/Input';
import { Button } from './ui/Button';

type ChatMessage =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; text: string }
  | { kind: 'tool'; id: string; name: string; input: unknown; output: unknown; status: 'running' | 'done'; expanded: boolean }
  | { kind: 'error'; id: string; text: string };

type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'closed';

// Wire format emitted by the on-VM chat daemon (chat_daemon.js) and relayed verbatim by the
// /ws/chat backend bridge - see websocketController.py's _bridge_claudecode_chat.
interface ChatWireEvent {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  output?: unknown;
  sessionId?: string;
  message?: string;
}

let idCounter = 0;
const nextId = () => `m${Date.now()}_${idCounter++}`;

const MAX_BACKOFF_MS = 15000;

const ChatPanel: React.FC<{ instanceId: string; fleetId: string }> = ({ instanceId, fleetId }) => {
  const { token } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const [turnInFlight, setTurnInFlight] = useState(false);
  const [inputText, setInputText] = useState('');

  const wsRef = useRef<WebSocket | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const currentAssistantIdRef = useRef<string | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffRef = useRef(1000);
  const unmountedRef = useRef(false);

  const appendAssistantDelta = (text: string) => {
    setMessages(prev => {
      if (currentAssistantIdRef.current) {
        const idx = prev.findIndex(m => m.id === currentAssistantIdRef.current);
        if (idx !== -1) {
          const next = [...prev];
          const target = next[idx];
          if (target.kind === 'assistant') {
            next[idx] = { ...target, text: target.text + text };
          }
          return next;
        }
      }
      const id = nextId();
      currentAssistantIdRef.current = id;
      return [...prev, { kind: 'assistant', id, text }];
    });
  };

  const upsertToolUse = (id: string, name: string, input: unknown) => {
    setMessages(prev => {
      if (prev.some(m => m.id === id)) return prev;
      return [...prev, { kind: 'tool', id, name, input, output: null, status: 'running', expanded: false }];
    });
  };

  const applyToolResult = (id: string, output: unknown) => {
    setMessages(prev => prev.map(m => (m.kind === 'tool' && m.id === id ? { ...m, output, status: 'done' } : m)));
  };

  const toggleToolExpanded = (id: string) => {
    setMessages(prev => prev.map(m => (m.kind === 'tool' && m.id === id ? { ...m, expanded: !m.expanded } : m)));
  };

  const connectRef = useRef<() => void>(() => {});

  const connect = useCallback(() => {
    if (!token || unmountedRef.current) return;
    setConnectionState(prev => (prev === 'connected' ? 'reconnecting' : 'connecting'));

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/ws/chat/${instanceId}?token=${token}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      backoffRef.current = 1000;
      setConnectionState('connected');
    };

    ws.onmessage = (event) => {
      let data: ChatWireEvent;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      switch (data.type) {
        case 'session_ready':
          break;
        case 'assistant_delta':
          setTurnInFlight(true);
          appendAssistantDelta(data.text || '');
          break;
        case 'tool_use':
          setTurnInFlight(true);
          upsertToolUse(data.id || nextId(), data.name || 'tool', data.input);
          break;
        case 'tool_result':
          if (data.id) applyToolResult(data.id, data.output);
          break;
        case 'turn_complete':
          currentAssistantIdRef.current = null;
          setTurnInFlight(false);
          break;
        case 'error':
          currentAssistantIdRef.current = null;
          setTurnInFlight(false);
          setMessages(prev => [...prev, { kind: 'error', id: nextId(), text: data.text || data.message || 'Unknown error' }]);
          break;
        default:
          break;
      }
    };

    ws.onclose = () => {
      if (unmountedRef.current) return;
      setConnectionState('reconnecting');
      const delay = backoffRef.current;
      backoffRef.current = Math.min(backoffRef.current * 2, MAX_BACKOFF_MS);
      reconnectTimerRef.current = setTimeout(() => connectRef.current(), delay);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [instanceId, token]);

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  useEffect(() => {
    unmountedRef.current = false;

    const loadHistoryThenConnect = async () => {
      try {
        const res = await api.get(`/fleets/${fleetId}/instances/${instanceId}/chat/history`, { params: { limit: 200 } });
        if (unmountedRef.current) return;
        const history: ChatMessage[] = res.data?.messages || [];
        if (history.length > 0) setMessages(history);
      } catch {
        // No prior history available (or fetch failed) - fall back to today's behavior and start empty.
      }
      if (!unmountedRef.current) connectRef.current();
    };
    loadHistoryThenConnect();

    return () => {
      unmountedRef.current = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [instanceId, fleetId, token]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = () => {
    const text = inputText.trim();
    if (!text || turnInFlight || connectionState !== 'connected' || !wsRef.current) return;
    setMessages(prev => [...prev, { kind: 'user', id: nextId(), text }]);
    wsRef.current.send(JSON.stringify({ type: 'user_message', text }));
    setInputText('');
    setTurnInFlight(true);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

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
          <Bot size={16} /> Live Chat
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className={`w-2 h-2 rounded-full ${statusColor[connectionState]}`}></span>
          {statusLabel[connectionState]}
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 ? (
          <div className="text-muted-foreground italic text-sm">
            Send a message to start an interactive session with this agent. Opening chat pauses its
            autonomous task queue until the conversation goes idle.
          </div>
        ) : (
          messages.map((m) => {
            if (m.kind === 'user') {
              return (
                <div key={m.id} className="flex justify-end">
                  <div className="max-w-[80%] bg-blue-600/90 text-white text-sm rounded-lg rounded-tr-sm px-3 py-2 whitespace-pre-wrap break-words">
                    {m.text}
                  </div>
                </div>
              );
            }
            if (m.kind === 'assistant') {
              return (
                <div key={m.id} className="flex justify-start gap-2">
                  <Bot size={16} className="shrink-0 mt-1.5 text-muted-foreground" />
                  <div className="max-w-[80%] bg-secondary border border-border text-foreground text-sm rounded-lg rounded-tl-sm px-3 py-2 whitespace-pre-wrap break-words">
                    {m.text || <span className="text-muted-foreground">...</span>}
                  </div>
                </div>
              );
            }
            if (m.kind === 'tool') {
              return (
                <div key={m.id} className="flex justify-start gap-2">
                  <Wrench size={16} className="shrink-0 mt-1.5 text-purple-500 dark:text-purple-400" />
                  <div className="max-w-[80%] border border-purple-500/20 bg-purple-500/5 rounded-lg text-xs overflow-hidden">
                    <button
                      type="button"
                      onClick={() => toggleToolExpanded(m.id)}
                      className="w-full flex items-center gap-1.5 px-3 py-2 text-left hover:bg-purple-500/10 transition-colors"
                    >
                      {m.expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      <span className="font-mono text-purple-600 dark:text-purple-300">{m.name}</span>
                      {m.status === 'running' ? (
                        <Loader2 size={12} className="animate-spin text-purple-500 dark:text-purple-400 ml-1" />
                      ) : (
                        <span className="text-[10px] text-muted-foreground ml-1">done</span>
                      )}
                    </button>
                    {m.expanded && (
                      <div className="px-3 pb-2 space-y-1.5 font-mono">
                        <div>
                          <div className="text-[10px] uppercase text-muted-foreground mb-0.5">Input</div>
                          <pre className="text-foreground whitespace-pre-wrap break-words">{JSON.stringify(m.input, null, 2)}</pre>
                        </div>
                        {m.status === 'done' && (
                          <div>
                            <div className="text-[10px] uppercase text-muted-foreground mb-0.5">Output</div>
                            <pre className="text-foreground whitespace-pre-wrap break-words">
                              {typeof m.output === 'string' ? m.output : JSON.stringify(m.output, null, 2)}
                            </pre>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            }
            return (
              <div key={m.id} className="flex justify-start gap-2">
                <AlertTriangle size={16} className="shrink-0 mt-1.5 text-red-500 dark:text-red-400" />
                <div className="max-w-[80%] bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-300 text-sm rounded-lg px-3 py-2 whitespace-pre-wrap break-words">
                  {m.text}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="border-t border-border bg-secondary/40 p-3 flex items-end gap-2">
        <Textarea
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={connectionState !== 'connected' || turnInFlight}
          rows={1}
          placeholder={connectionState !== 'connected' ? 'Waiting for connection...' : 'Message the agent...'}
          className="flex-1 resize-none max-h-32"
        />
        <Button
          type="button"
          onClick={handleSend}
          disabled={connectionState !== 'connected' || turnInFlight || !inputText.trim()}
          size="sm"
          className="h-9 px-3"
        >
          {turnInFlight ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
        </Button>
      </div>
    </div>
  );
};

export default ChatPanel;
