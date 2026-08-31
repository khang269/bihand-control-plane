import React, { useMemo } from 'react';
import { Background, Controls, ReactFlow, Node, Edge, Handle, Position } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Bot, UserRound } from 'lucide-react';

interface CustomNodeProps {
  data: {
    label: string;
    subLabel: string;
    status: string;
    isHuman?: boolean;
    activity?: {
      activeTask: any;
      status: 'idle' | 'busy' | 'waiting' | 'reviewing';
      taskCount: number;
      message: string;
    } | null;
  };
}

const OrgNodeComponent = ({ data }: CustomNodeProps) => {
  const isOnline = data.status === 'running' || data.status === 'provisioned';
  const activity = data.activity;

  return (
    <div className="bg-card border border-border rounded-lg p-3 shadow-xl relative flex items-stretch min-w-[200px] h-[85px]">
      {!data.isHuman && (
        <Handle
          type="target"
          position={Position.Top}
          style={{ background: 'hsl(var(--color-muted-foreground))', border: '1px solid hsl(var(--color-border))', width: '8px', height: '8px' }}
        />
      )}

      {/* Speech / Thought Bubble (Bouncing SIM-game effect) */}
      {activity && activity.message && (
        <div className="absolute -top-14 left-1/2 -translate-x-1/2 bg-card/95 border border-purple-500/40 text-purple-600 dark:text-purple-300 text-[10px] px-3 py-1.5 rounded-xl shadow-lg shadow-purple-500/10 max-w-[240px] text-center font-bold animate-bounce z-50 pointer-events-none whitespace-normal leading-snug">
          <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-card border-r border-b border-purple-500/40 rotate-45" />
          <span className="line-clamp-2">{activity.message}</span>
        </div>
      )}

      {/* Left section: Identity */}
      <div className="flex flex-col justify-between flex-1 min-w-0 pr-2 text-left">
        <div className="flex items-center gap-3">
          <div className={`w-12 h-12 rounded-full overflow-hidden flex items-center justify-center shrink-0 ${data.isHuman ? 'bg-blue-500/20 text-blue-500' : 'bg-muted text-muted-foreground border border-border'}`}>
            {data.isHuman ? (
              <UserRound size={24} />
            ) : (
              <Bot size={24} />
            )}
          </div>
          <div className="min-w-0 text-left">
            <div className="font-semibold text-sm text-foreground truncate">{data.label}</div>
            <div className="text-xs text-muted-foreground uppercase truncate">{data.subLabel}</div>
          </div>
        </div>

        {!data.isHuman && (
          <div className="mt-1.5 pt-1.5 border-t border-border flex items-center gap-2 text-xs font-medium">
            <span className={`w-2 h-2 rounded-full ${activity?.status === 'busy' ? 'bg-blue-500 animate-pulse' : activity?.status === 'waiting' ? 'bg-red-500 animate-ping' : activity?.status === 'reviewing' ? 'bg-purple-500' : isOnline ? 'bg-emerald-500' : 'bg-amber-500'}`}></span>
            <span className={`truncate text-[11px] ${activity?.status === 'busy' ? 'text-blue-500 dark:text-blue-400 font-bold' : activity?.status === 'waiting' ? 'text-red-500 dark:text-red-400 font-bold' : activity?.status === 'reviewing' ? 'text-purple-500 dark:text-purple-400' : isOnline ? 'text-emerald-500' : 'text-amber-500'}`}>
              {activity?.status === 'busy' ? '💻 WORKING' : activity?.status === 'waiting' ? '⏳ BLOCKED' : activity?.status === 'reviewing' ? '🚩 IN REVIEW' : isOnline ? '💤 BREAKTIME' : data.status.replace('_', ' ')}
            </span>
          </div>
        )}
      </div>


      <Handle
        type="source"
        position={Position.Bottom}
        style={{ background: 'hsl(var(--color-muted-foreground))', border: '1px solid hsl(var(--color-border))', width: '8px', height: '8px' }}
      />
    </div>
  );
};

const nodeTypes = {
  orgNode: OrgNodeComponent,
};

interface OrgChartProps {
  fleetDetails: any;
  ownerName: string;
  agentActivity?: any;
  activePipelines?: any[];
}

const OrgChartFlow: React.FC<OrgChartProps & { onNodeClick?: (nodeId: string) => void }> = ({ fleetDetails, ownerName, onNodeClick, agentActivity, activePipelines }) => {
  
  const { nodes, edges } = useMemo(() => {
    const initialNodes: Node[] = [];
    const initialEdges: Edge[] = [];

    // The Human Manager Node (Root)
    initialNodes.push({
      id: 'human_manager',
      type: 'orgNode',
      position: { x: 400, y: 50 },
      data: {
        label: ownerName || 'Human Manager',
        subLabel: 'Board of Directors',
        status: 'active',
        isHuman: true
      }
    });

    if (!fleetDetails?.instances) return { nodes: initialNodes, edges: initialEdges };

    // Layout math recursively centering and spacing nodes for a clean tree
    const instances = fleetDetails.instances;
    
    // Group by parent
    const childrenMap: Record<string, any[]> = {};
    instances.forEach((inst: any) => {
      if (inst.reportsTo && inst.reportsTo !== 'human_manager') {
        if (!childrenMap[inst.reportsTo]) childrenMap[inst.reportsTo] = [];
        childrenMap[inst.reportsTo].push(inst);
      }
    });

    const positions: Record<string, { x: number, y: number }> = {};
    const roots = instances.filter((i: any) => !i.reportsTo || i.reportsTo === 'human_manager');
    const rootY = 200;

    // Position roots
    roots.forEach((root: any, idx: number) => {
      const rootX = 400 + (idx - (roots.length - 1) / 2) * 380;
      positions[root.id] = { x: rootX, y: rootY };

      // Position children recursively
      const layoutChildren = (parentId: string, parentX: number, parentY: number) => {
        const children = childrenMap[parentId] || [];
        const childY = parentY + 180;
        children.forEach((child: any, cIdx: number) => {
          const childX = parentX + (cIdx - (children.length - 1) / 2) * 360;
          positions[child.id] = { x: childX, y: childY };
          layoutChildren(child.id, childX, childY);
        });
      };
      
      layoutChildren(root.id, rootX, rootY);
    });

    // Add nodes & edges
    instances.forEach((inst: any) => {
      const pos = positions[inst.id] || { x: 400, y: 200 };
      const activity = agentActivity ? agentActivity[inst.id] : null;

      initialNodes.push({
        id: inst.id,
        type: 'orgNode',
        position: pos,
        data: {
          label: inst.role,
          subLabel: inst.agentType,
          status: inst.status,
          activity: activity
        }
      });

      const parentId = inst.reportsTo && inst.reportsTo !== 'human_manager' ? inst.reportsTo : 'human_manager';
      const parentRole = parentId === 'human_manager' ? ownerName : instances.find((i: any) => i.id === parentId)?.role;
      const childRole = inst.role;

      // Check if there is an active communication/delegation pipeline between them
      const isCommunicating = activePipelines?.some((flow: any) => 
        flow.status !== 'done' && 
        ((flow.sourceRole === parentRole && flow.targetRole === childRole) || 
         (flow.sourceRole === childRole && flow.targetRole === parentRole))
      );

      initialEdges.push({
        id: `e-${parentId}-${inst.id}`,
        source: parentId,
        target: inst.id,
        animated: isCommunicating,
        style: isCommunicating
          ? { stroke: '#a855f7', strokeWidth: 3.5, filter: 'drop-shadow(0 0 8px rgba(168,85,247,0.6))' }
          : { stroke: 'hsl(var(--color-border))', strokeWidth: 1.5, strokeDasharray: '5,5' }
      });
    });

    return { nodes: initialNodes, edges: initialEdges };
  }, [fleetDetails, ownerName, agentActivity, activePipelines]);

  return (
    <div className="w-full h-full min-h-0 border border-border rounded-xl bg-card overflow-hidden">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={(_, node) => {
          if (node.id !== 'human_manager' && onNodeClick) {
            onNodeClick(node.id);
          }
        }}
        fitView
        proOptions={{ hideAttribution: true }}
        className="bg-card"
      >
        <Background color="hsl(var(--color-border))" gap={16} />
        <Controls className="bg-secondary border-border fill-muted-foreground stroke-muted-foreground [&>button]:border-b-border" />
      </ReactFlow>
    </div>
  );
};

export default OrgChartFlow;
