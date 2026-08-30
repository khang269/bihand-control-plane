import React, { useEffect, useState } from 'react';
import api from '../lib/api';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';

interface Approval {
  _id: string;
  taskId: string;
  actionType: string;
  payload: any;
  reason: string;
  status: string;
  createdAt: string;
}

const ApprovalsInbox: React.FC<{ fleetId: string }> = ({ fleetId }) => {
  const [approvals, setApprovals] = useState<Approval[]>([]);

  const fetchApprovals = async () => {
    try {
      const res = await api.get(`/fleets/${fleetId}/approvals/pending`);
      setApprovals(res.data.approvals || []);
    } catch (e) {
      console.error('Failed to fetch approvals', e);
    }
  };

  useEffect(() => {
    fetchApprovals();
    const interval = setInterval(fetchApprovals, 10000);
    return () => clearInterval(interval);
  }, [fleetId]);

  const handleResolve = async (id: string, status: 'approved' | 'rejected') => {
    try {
      await api.post(`/fleets/approvals/${id}/resolve`, { status });
      fetchApprovals();
    } catch (e) {
      console.error('Failed to resolve approval', e);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between border-b border-border pb-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Governance Inbox</h2>
          <p className="text-muted-foreground text-sm mt-1">Review actions proposed by agents that require board approval.</p>
        </div>
      </div>

      {approvals.length === 0 ? (
        <div className="text-center p-12 border border-dashed border-border rounded-xl text-muted-foreground">
          Inbox is empty. Agents are working autonomously.
        </div>
      ) : (
        <div className="space-y-4">
          {approvals.map(approval => (
            <div key={approval._id} className="border border-amber-500/20 bg-amber-500/5 rounded-xl p-5">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant="warning" dot={false} className="uppercase tracking-wider">
                      Approval Required
                    </Badge>
                    <span className="text-xs text-muted-foreground">Task ID: {approval.taskId}</span>
                  </div>
                  <h3 className="font-semibold text-lg">{approval.actionType.replace('_', ' ').toUpperCase()}</h3>
                </div>
                <span className="text-xs text-muted-foreground">{new Date(approval.createdAt).toLocaleString()}</span>
              </div>

              <div className="bg-secondary/50 border border-border rounded-lg p-4 mb-4">
                <p className="text-sm font-medium mb-2">Agent Reason:</p>
                <p className="text-sm text-muted-foreground mb-4">{approval.reason}</p>
                {approval.actionType === 'flow_access_request' ? (
                  <p className="text-sm text-muted-foreground">
                    Requesting <span className="text-foreground font-semibold">{approval.payload?.requestedRole}</span> access to flow{' '}
                    <span className="text-foreground font-semibold">{approval.payload?.flowName || approval.payload?.flowId}</span>
                  </p>
                ) : approval.actionType === 'send_reply' ? (
                  <>
                    <p className="text-sm font-medium mb-2">Draft Reply:</p>
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">{approval.payload?.draftText}</p>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-medium mb-2">Payload:</p>
                    <pre className="text-xs text-muted-foreground overflow-x-auto">
                      {JSON.stringify(approval.payload, null, 2)}
                    </pre>
                  </>
                )}
              </div>

              <div className="flex gap-3 justify-end">
                <Button
                  variant="outline"
                  onClick={() => handleResolve(approval._id, 'rejected')}
                  className="border-red-500/20 text-red-500 hover:bg-red-500/10"
                >
                  Reject & Block
                </Button>
                <Button
                  onClick={() => handleResolve(approval._id, 'approved')}
                  className="bg-emerald-500 text-white hover:bg-emerald-400 hover:opacity-100"
                >
                  Approve Execution
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ApprovalsInbox;
