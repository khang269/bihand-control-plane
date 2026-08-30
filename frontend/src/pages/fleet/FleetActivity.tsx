import React from 'react';
import { useParams } from 'react-router-dom';
import ActivityFeed from '../../components/ActivityFeed';
import { Activity } from 'lucide-react';

const FleetActivity: React.FC = () => {
  const { fleetId } = useParams<{ fleetId?: string }>();
  
  return (
    <div className="p-8 h-full flex flex-col">
      <div className="mb-6 border-b border-border pb-4">
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Activity className="text-emerald-500" size={24} /> Activity
        </h1>
        <p className="text-muted-foreground text-sm mt-1">Live audit trail of all agent thoughts, decisions, and tool calls.</p>
      </div>
      <div className="flex-1 overflow-hidden">
        <ActivityFeed fleetId={fleetId!} />
      </div>
    </div>
  );
};

export default FleetActivity;
