import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, MessageSquareOff } from 'lucide-react';
import { Avatar } from '../Avatar';
import { isChatCapable, FleetAgentInstance } from '../../lib/fleetAgents';
import { cn } from '../../lib/cn';

interface AgentSwitcherProps {
  instances: FleetAgentInstance[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export const AgentSwitcher: React.FC<AgentSwitcherProps> = ({ instances, selectedId, onSelect }) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedAgent = instances.find((a) => a.id === selectedId) || instances[0] || null;

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    window.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  if (!selectedAgent) return null;

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setIsOpen((v) => !v)}
        className="flex items-center gap-2 pl-1.5 pr-2.5 py-1.5 rounded-full border border-border text-foreground hover:bg-secondary transition-all duration-200 shrink-0"
      >
        <Avatar name={selectedAgent.title || selectedAgent.role} className="w-6 h-6 rounded-full object-cover border border-border" fallbackSize={12} />
        <span className="text-xs font-semibold truncate max-w-[140px]">{selectedAgent.title || selectedAgent.role}</span>
        <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', selectedAgent.status === 'running' ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500')} />
        {!isChatCapable(selectedAgent.agentType) && <MessageSquareOff size={11} className="shrink-0 text-muted-foreground" />}
        <ChevronDown size={13} className={cn('shrink-0 text-muted-foreground transition-transform', isOpen && 'rotate-180')} />
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full mt-1.5 z-40 min-w-[240px] max-h-80 overflow-y-auto rounded-xl border border-border bg-card shadow-2xl py-1.5">
          {instances.map((agent) => {
            const isSelected = agent.id === selectedAgent.id;
            const chatCapable = isChatCapable(agent.agentType);
            return (
              <button
                key={agent.id}
                onClick={() => {
                  onSelect(agent.id);
                  setIsOpen(false);
                }}
                className={cn(
                  'w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors',
                  isSelected ? 'bg-purple-500/10 text-foreground' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                )}
              >
                <Avatar name={agent.title || agent.role} className="w-7 h-7 rounded-full object-cover border border-border shrink-0" fallbackSize={14} />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold truncate">{agent.title || agent.role}</div>
                  <div className="text-[10px] text-muted-foreground truncate">{agent.role}</div>
                </div>
                <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', agent.status === 'running' ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500')} />
                {!chatCapable && <MessageSquareOff size={12} className="shrink-0 text-muted-foreground" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default AgentSwitcher;
