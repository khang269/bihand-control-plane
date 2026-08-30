import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Settings } from 'lucide-react';
import ChatPanel from '../../components/ChatPanel';
import { AgentSwitcher } from '../../components/fleet/AgentSwitcher';
import { ChatUnavailablePlaceholder } from '../../components/fleet/ChatUnavailablePlaceholder';
import { FleetEmptyState } from '../../components/fleet/FleetEmptyState';
import { pickDefaultAgent, isChatCapable, FleetAgentInstance } from '../../lib/fleetAgents';
import { useLanguage } from '../../context/LanguageContext';
import { Button } from '../../components/ui/Button';

interface FleetChatLandingProps {
  fleetDetails: { instances?: FleetAgentInstance[]; [key: string]: unknown } | null;
  fleetId: string;
  instanceId?: string;
  onOpenHireWizard: () => void;
}

export const FleetChatLanding: React.FC<FleetChatLandingProps> = ({ fleetDetails, fleetId, instanceId, onOpenHireWizard }) => {
  const navigate = useNavigate();
  const { language } = useLanguage();
  const instances: FleetAgentInstance[] = useMemo(() => fleetDetails?.instances || [], [fleetDetails]);

  const selectedAgent = useMemo(() => {
    if (instanceId) {
      const match = instances.find((i) => i.id === instanceId);
      if (match) return match;
    }
    return pickDefaultAgent(instances);
  }, [instances, instanceId]);

  if (instances.length === 0) {
    return <FleetEmptyState onOpenHireWizard={onOpenHireWizard} />;
  }

  if (!selectedAgent) return null;

  return (
    <div className="h-full w-full flex flex-col overflow-hidden">
      <div className="border-b border-border bg-background px-4 sm:px-8 py-3 flex items-center gap-3 flex-shrink-0">
        <div className="flex-1 min-w-0">
          <AgentSwitcher
            instances={instances}
            selectedId={selectedAgent.id}
            onSelect={(id) => navigate(`/fleet/${fleetId}/agents/${id}`)}
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => navigate(`/fleet/${fleetId}/agents/${selectedAgent.id}/settings`)}
          title={language === 'vi' ? 'Cài đặt Tác nhân' : 'Agent Settings'}
          className="shrink-0"
        >
          <Settings size={14} />
          <span className="hidden sm:inline">{language === 'vi' ? 'Cài đặt' : 'Settings'}</span>
        </Button>
      </div>

      <div className="flex-1 min-h-0 p-4 sm:p-6 max-w-4xl w-full mx-auto flex flex-col">
        {isChatCapable(selectedAgent.agentType) ? (
          <ChatPanel instanceId={selectedAgent.id} fleetId={fleetId} />
        ) : (
          <ChatUnavailablePlaceholder agentType={selectedAgent.agentType || 'unknown'} />
        )}
      </div>
    </div>
  );
};

export default FleetChatLanding;
