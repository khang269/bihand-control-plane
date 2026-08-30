import React from 'react';
import { useParams } from 'react-router-dom';
import TasksView from '../../components/TasksView';
import { CircleDot } from 'lucide-react';

const FleetIssues: React.FC = () => {
  const { fleetId } = useParams<{ fleetId?: string }>();
  
  return (
    <div className="p-8 h-full flex flex-col">
      <div className="mb-6 border-b border-border pb-4">
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <CircleDot className="text-blue-500" size={24} /> Issues
        </h1>
        <p className="text-muted-foreground text-sm mt-1">Manage actionable tickets and assign them to specific agents.</p>
      </div>
      <div className="flex-1 overflow-y-auto">
        <TasksView fleetId={fleetId!} />
      </div>
    </div>
  );
};

export default FleetIssues;
