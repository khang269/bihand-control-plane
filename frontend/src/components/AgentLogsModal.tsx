import React, { useEffect, useState, useRef } from 'react';
import { Terminal, Loader2 } from 'lucide-react';
import api from '../lib/api';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';

interface AgentLogsModalProps {
  fleetId: string;
  instance: any;
  onClose: () => void;
}

const AgentLogsModal: React.FC<AgentLogsModalProps> = ({ fleetId, instance, onClose }) => {
  const [logs, setLogs] = useState<string>('');
  const [provisionEvents, setProvisionEvents] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fetchLogs = async () => {
      try {
        const res = await api.get(`/fleets/${fleetId}/instances/${instance.id}/logs`);
        setLogs(res.data.logs || 'No startup logs found.');
        setProvisionEvents(res.data.provisionLog || []);
      } catch (e) {
        console.error("Failed to fetch logs", e);
        setLogs('Error fetching logs from server.');
      } finally {
        setIsLoading(false);
      }
    };
    fetchLogs();
  }, [fleetId, instance.id]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <Modal
      open
      onClose={onClose}
      widthClassName="max-w-5xl"
      title={
        <div>
          <div className="font-semibold">{instance.role} Startup Logs</div>
          <div className="text-xs font-normal text-muted-foreground mt-0.5">GCP VM Console & Provisioning Events</div>
        </div>
      }
    >
      <div className="flex flex-col h-[70vh] -m-6">
        {/* Log Viewer */}
        <div className="flex-1 overflow-hidden flex flex-col relative bg-secondary/30 min-h-0">
          {isLoading && (
            <div className="absolute inset-0 bg-card/90 flex flex-col items-center justify-center z-10">
              <Loader2 className="animate-spin text-muted-foreground mb-3" size={32} />
              <div className="text-foreground font-medium">Fetching GCP Serial Logs</div>
              <div className="text-muted-foreground text-xs mt-1">This may take a moment...</div>
            </div>
          )}

          <div className="flex-1 p-4 overflow-y-auto" ref={scrollRef}>
            <div className="mb-6">
              <h3 className="text-sm font-semibold text-emerald-600 dark:text-emerald-500 mb-2 font-mono flex items-center gap-2">
                <Terminal size={14} /> Backend Provisioning Trace
              </h3>
              {/* Raw console/log content stays on a fixed dark treatment regardless of site theme. */}
              <div className="bg-zinc-950 border border-zinc-800 rounded-md p-3 font-mono text-xs text-zinc-400 space-y-1">
                {provisionEvents.length === 0 ? 'No events recorded.' : provisionEvents.map((evt, i) => (
                  <div key={i}>{evt}</div>
                ))}
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-blue-600 dark:text-blue-400 mb-2 font-mono flex items-center gap-2">
                <Terminal size={14} /> VM Bash Startup Script (ttyS1)
              </h3>
              <pre className="bg-zinc-950 border border-zinc-800 rounded-md p-3 font-mono text-xs text-zinc-100 overflow-x-auto whitespace-pre-wrap">
                {logs}
              </pre>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border flex justify-end bg-secondary/30 shrink-0">
          <Button onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default AgentLogsModal;
