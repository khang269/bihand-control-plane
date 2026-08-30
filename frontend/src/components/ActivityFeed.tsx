import React, { useEffect, useState, useRef } from 'react';
import api from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { Terminal } from 'lucide-react';

interface ActivityEvent {
  _id: string;
  instanceId: string;
  taskId: string;
  eventType: string;
  content: any;
  timestamp: string;
  role?: string;
}

const ActivityFeed: React.FC<{ fleetId: string }> = ({ fleetId }) => {
  const { token } = useAuth();
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Initial fetch of history
    api.get(`/fleets/${fleetId}/activity?limit=50`)
      .then(res => setEvents(res.data.activity.reverse() || []))
      .catch(err => console.error("Failed to load activity history", err));

    // Connect to WebSocket
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/ws/fleet/${fleetId}/activity?token=${token}`;
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => setIsConnected(true);
    ws.onclose = () => setIsConnected(false);

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'agent_activity' || data.type === 'task_status_change') {
          setEvents(prev => [...prev, data.data]);
        }
      } catch (e) {
        console.error("Failed to parse WS message", e);
      }
    };

    return () => ws.close();
  }, [fleetId, token]);

  useEffect(() => {
    // Auto scroll to bottom
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events]);

  const renderEventContent = (event: ActivityEvent) => {
    if (event.eventType === 'message') {
      return <span className="text-foreground">{event.content.message}</span>;
    }
    if (event.eventType === 'thought') {
      return <span className="text-purple-600 dark:text-purple-400 italic">Thinking: {event.content.thought}</span>;
    }
    if (event.eventType === 'tool_call') {
      return (
        <span className="text-blue-600 dark:text-blue-400">
          Executed <span className="font-mono bg-blue-500/10 px-1 rounded">{event.content.tool}</span>
          <span className="text-muted-foreground ml-2">Args: {JSON.stringify(event.content.args)}</span>
        </span>
      );
    }
    if (event.eventType === 'status_change') {
      return <span className="text-emerald-600 dark:text-emerald-400 font-bold">Task Status Changed to: {event.content.newStatus}</span>;
    }
    return <span className="text-muted-foreground">{JSON.stringify(event.content)}</span>;
  };

  return (
    <div className="border border-border rounded-xl overflow-hidden bg-card flex flex-col h-[600px]">
      <div className="bg-secondary border-b border-border p-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-mono text-muted-foreground">
          <Terminal size={16} /> Live Audit Trail
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-500' : 'bg-red-500'}`}></span>
          {isConnected ? 'Connected' : 'Disconnected'}
        </div>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 font-mono text-xs space-y-2">
        {events.length === 0 ? (
          <div className="text-muted-foreground italic">Waiting for agent activity...</div>
        ) : (
          events.map((event, idx) => (
            <div key={event._id || idx} className="flex gap-4 group hover:bg-secondary p-1 rounded">
              <div className="text-muted-foreground shrink-0 w-20">
                {new Date(event.timestamp).toLocaleTimeString([], { hour12: false })}
              </div>
              <div className="text-amber-600 dark:text-yellow-500 shrink-0 w-24 truncate font-bold" title={event.role || event.instanceId}>
                [{event.role || 'Agent'}]
              </div>
              <div className="flex-1 break-words">
                {renderEventContent(event)}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default ActivityFeed;
