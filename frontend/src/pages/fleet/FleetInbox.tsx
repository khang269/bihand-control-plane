import React from 'react';
import { useParams } from 'react-router-dom';
import ApprovalsInbox from '../../components/ApprovalsInbox';
import { Inbox } from 'lucide-react';

const FleetInbox: React.FC = () => {
  const { fleetId } = useParams<{ fleetId?: string }>();
  
  return (
    <div className="p-8 h-full flex flex-col">
      <div className="mb-6 border-b border-border pb-4">
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Inbox className="text-amber-500" size={24} /> Approvals & Inbox
        </h1>
        <p className="text-muted-foreground text-sm mt-1">Review actions proposed by agents that require Board approval.</p>
      </div>
      <div className="flex-1 overflow-y-auto">
        <ApprovalsInbox fleetId={fleetId!} />
      </div>
    </div>
  );
};

export default FleetInbox;
