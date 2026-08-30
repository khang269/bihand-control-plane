import React, { useEffect, useState } from 'react';
import { useOutletContext, useParams, useNavigate } from 'react-router-dom';
import { ExternalLink, Bot, Tv2, Settings, Users, LayoutDashboard, TerminalSquare, ShieldAlert, Trash2, PlusCircle, Server } from 'lucide-react';
import api from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import TasksView from '../components/TasksView';
import ActivityFeed from '../components/ActivityFeed';
import ApprovalsInbox from '../components/ApprovalsInbox';
import AgentConfigModal from '../components/AgentConfigModal';
import AgentLogsModal from '../components/AgentLogsModal';
import OrgChartFlow from '../components/OrgChartFlow';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { IconBadge } from '../components/ui/IconBadge';
import { cn } from '../lib/cn';

type TabType = 'orgchart' | 'tasks' | 'activity' | 'approvals';

const Dashboard: React.FC = () => {
  const { fleetId } = useParams<{ fleetId?: string }>();
  const { fleets, loadFleets } = useOutletContext<any>();
  const navigate = useNavigate();
  const { user, token } = useAuth();
  const { t, language } = useLanguage();
  const [fleetDetails, setFleetDetails] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<TabType>('orgchart');
  const [configuringAgent, setConfiguringAgent] = useState<any>(null);
  const [viewingLogsAgent, setViewingLogsAgent] = useState<any>(null);

  useEffect(() => {
    // Reload list of fleets dynamically upon displaying/navigating to the main dashboard
    if (!fleetId) {
      loadFleets().catch(console.error);
    }
  }, [fleetId]);

  useEffect(() => {
    if (fleetId) {
      fetchFleetDetails(fleetId);

      // Listen for live instance status updates
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/api/ws/fleet/${fleetId}/activity?token=${token}`;
      const ws = new WebSocket(wsUrl);

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'instance_status_change') {
            setFleetDetails((prev: any) => {
              if (!prev) return prev;
              const newInstances = prev.instances.map((inst: any) => {
                if (inst.id === data.data.instanceId) {
                  return { ...inst, status: data.data.status, ip: data.data.ip || inst.ip };
                }
                return inst;
              });
              return { ...prev, instances: newInstances };
            });
          }
        } catch (e) {
          console.error("Failed to parse status WS message", e);
        }
      };

      return () => ws.close();
    }
  }, [fleetId, token]);

  const fetchFleetDetails = async (id: string) => {
    try {
      const res = await api.get(`/fleets/${id}`);
      setFleetDetails(res.data);
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeleteAgent = async (instanceId: string, role: string) => {
    if (!fleetId) return;
    if (!window.confirm(`Are you sure you want to permanently destroy the ${role} agent?`)) return;
    try {
      await api.delete(`/fleets/${fleetId}/instances/${instanceId}`);
      fetchFleetDetails(fleetId);
    } catch (e) {
      console.error("Failed to delete agent");
    }
  };

  const handleDeleteFleet = async () => {
    if (!fleetId) return;
    if (!window.confirm("Are you sure you want to destroy this entire fleet and all its agents? This action is irreversible.")) return;
    try {
      await api.delete(`/fleets/${fleetId}`);
      await loadFleets();
      navigate('/dashboard');
    } catch (e) {
      console.error("Failed to delete fleet");
    }
  };

  // If no fleetId in the URL, render the Global Overview of all fleets
  if (!fleetId) {
    if (fleets.length === 0) {
      return (
        <Card className="border-dashed p-12 text-center">
          <IconBadge className="mx-auto mb-4">
            <Server size={24} />
          </IconBadge>
          <h3 className="text-lg font-medium mb-2">{t('dashboard.no_companies_found', 'No Fleets Found')}</h3>
          <p className="text-muted-foreground text-sm mb-6 max-w-sm mx-auto">{t('dashboard.no_companies_desc', "You haven't deployed any fleets yet. Click below to spin up your first fleet of autonomous agents.")}</p>
          <Button onClick={() => navigate('/wizard')}>
            {t('nav.incorporate_new', 'Deploy New Fleet')}
          </Button>
        </Card>
      );
    }

    return (
      <div className="space-y-8 p-4">
        {/* Welcome header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="text-left">
            <h1 className="text-2xl font-bold">
              {language === 'vi' ? `Chào mừng trở lại, ${user?.name || ''}` : `Welcome back${user?.name ? `, ${user.name}` : ''}`}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {language === 'vi'
                ? 'Đây là hạ tầng đám mây cho các hạm đội tác nhân AI của bạn.'
                : 'Here is your cloud infrastructure for your fleets of AI agents.'}
            </p>
          </div>
          <Button onClick={() => navigate('/wizard')} shape="pill" className="self-start sm:self-center">
            <PlusCircle size={16} /> {language === 'vi' ? 'Triển khai Hạm đội mới' : 'Deploy New Fleet'}
          </Button>
        </div>

        {/* Platform capability & usage */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <div className="text-[10px] uppercase font-semibold text-muted-foreground mb-1">
              {language === 'vi' ? 'Hạm đội của bạn' : 'Your fleets'}
            </div>
            <div className="text-2xl font-extrabold">{fleets.length}</div>
          </Card>
          <Card>
            <div className="text-[10px] uppercase font-semibold text-muted-foreground mb-1">
              {language === 'vi' ? 'Chi phí hằng ngày' : 'Daily compute cost'}
            </div>
            <div className="text-2xl font-extrabold text-purple-500">
              {fleets.reduce((acc: number, f: any) => acc + (f.infraBurn || 0), 0)} <span className="text-xs font-semibold text-muted-foreground">CR</span>
            </div>
          </Card>
          <Card>
            <div className="text-[10px] uppercase font-semibold text-muted-foreground mb-1">
              {language === 'vi' ? 'Tác nhân đang chạy' : 'Active agents'}
            </div>
            <div className="text-2xl font-extrabold text-blue-500">
              {fleets.reduce((acc: number, f: any) => acc + (f.instanceCount || 0), 0)}
            </div>
          </Card>
          <Card>
            <div className="text-[10px] uppercase font-semibold text-muted-foreground mb-1">
              {language === 'vi' ? 'Bảo mật' : 'Security'}
            </div>
            <Badge variant="success" className="mt-1.5">
              {language === 'vi' ? 'Đã mã hóa' : 'Encrypted'}
            </Badge>
          </Card>
        </div>

        {/* Fleet grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {fleets.map((f: any) => {
            const isActive = f.status === 'running' || f.status === 'provisioned' || f.status === 'active';
            const isTransitional = f.status === 'deleting' || f.status === 'stopping';
            return (
              <button
                key={f.id}
                className="text-left rounded-2xl border border-border hover:border-purple-500/40 bg-card p-5 hover:bg-secondary/50 cursor-pointer flex flex-col transition-colors group"
                onClick={() => navigate(`/fleet/${f.id}/dashboard`)}
              >
                <div className="flex justify-between items-start mb-6">
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-purple-500/10 text-purple-500 flex items-center justify-center flex-shrink-0">
                      <Server size={18} />
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-bold text-base truncate group-hover:text-purple-500 transition-colors">{f.name}</h3>
                      <p className="text-xs text-muted-foreground mt-0.5">{f.plan} Plan</p>
                    </div>
                  </div>

                  <Badge variant={isActive ? 'success' : isTransitional ? 'warning' : 'neutral'} className="flex-shrink-0">
                    {f.status || 'active'}
                  </Badge>
                </div>

                <div className="border-t border-border pt-4 mt-auto flex items-center justify-between">
                  <div className="text-sm text-muted-foreground">{f.infraBurn} CR/{language === 'vi' ? 'ngày' : 'day'}</div>
                  <div className="text-xs text-purple-500 font-semibold flex items-center gap-1 group-hover:gap-1.5 transition-all">
                    {language === 'vi' ? 'Mở' : 'Open dashboard'} <ExternalLink size={12} />
                  </div>
                </div>
              </button>
            );
          })}

          {/* Always-present, equally prominent "create new" card */}
          <button
            onClick={() => navigate('/wizard')}
            className="text-left border border-dashed border-border hover:border-purple-500/50 rounded-2xl p-5 flex flex-col items-center justify-center gap-2 text-center min-h-[168px] transition-colors group"
          >
            <div className="w-10 h-10 rounded-xl bg-secondary text-muted-foreground group-hover:text-purple-500 group-hover:bg-purple-500/10 flex items-center justify-center transition-colors">
              <PlusCircle size={18} />
            </div>
            <div className="text-sm font-semibold">
              {language === 'vi' ? 'Triển khai Hạm đội mới' : 'Deploy a new fleet'}
            </div>
            <p className="text-xs text-muted-foreground">
              {language === 'vi' ? 'Khởi chạy hạ tầng đám mây cho tác nhân AI trong vài phút' : 'Spin up cloud infrastructure for AI agents in minutes'}
            </p>
          </button>
        </div>
      </div>
    );
  }

  if (!fleetDetails) return <div className="text-muted-foreground text-sm">Loading...</div>;

  const isOnline = fleetDetails.status === 'running' || fleetDetails.status === 'provisioned';

  const tabs: { id: TabType; icon: React.ElementType; label: string }[] = [
    { id: 'orgchart', icon: Users, label: 'Org Chart' },
    { id: 'tasks', icon: LayoutDashboard, label: 'Goals & Tasks' },
    { id: 'activity', icon: TerminalSquare, label: 'Activity Feed' },
    { id: 'approvals', icon: ShieldAlert, label: 'Approvals' },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Fleet Overview</h1>
        {fleetDetails.dashboardUrl && (
          <a href={fleetDetails.dashboardUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 border border-border px-3 py-1.5 rounded-md text-sm hover:bg-secondary transition-colors">
            <ExternalLink size={16} /> Open Bihand HQ
          </a>
        )}
      </div>

      <div className="grid grid-cols-3 gap-4 mb-8">
        <Card>
          <div className="text-sm font-medium text-muted-foreground mb-1">Fleet Status</div>
          <div className="text-2xl font-bold flex items-center gap-2">
            <span className={`w-3 h-3 rounded-full ${isOnline ? 'bg-emerald-500' : 'bg-amber-500'}`}></span>
            {isOnline ? 'Online' : fleetDetails.status}
          </div>
        </Card>
        <Card>
          <div className="text-sm font-medium text-muted-foreground mb-1">Infrastructure Burn</div>
          <div className="text-2xl font-bold">{fleetDetails.infraBurn} <span className="text-sm font-normal text-muted-foreground">CR/mo</span></div>
        </Card>
        <Card>
          <div className="text-sm font-medium text-muted-foreground mb-1">Active Agents</div>
          <div className="text-2xl font-bold">{fleetDetails.instances?.length || 0}</div>
        </Card>
      </div>

      {/* TABS NAVIGATION */}
      <div className="flex items-center gap-6 border-b border-border mb-6">
        {tabs.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={cn(
              'pb-3 text-sm font-medium border-b-2 flex items-center gap-2 transition-colors',
              activeTab === id ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            <Icon size={16} /> {label}
          </button>
        ))}
      </div>

      {/* TAB CONTENT */}
      {activeTab === 'orgchart' && (
        <>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-xl font-semibold tracking-tight">Organization Chart</h2>
              <p className="text-muted-foreground text-sm mt-1">Manage your autonomous employees and their physical runtimes.</p>
            </div>
            <button
              onClick={handleDeleteFleet}
              className="flex items-center gap-2 border border-red-500/20 text-red-500 px-3 py-1.5 rounded-md text-sm hover:bg-red-500/10 transition-colors"
            >
              <Trash2 size={16} /> Destroy Fleet
            </button>
          </div>

          {/* New ReactFlow Visual Org Chart */}
          <div className="mb-6 h-[500px]">
            <OrgChartFlow fleetDetails={fleetDetails} ownerName={user?.name || 'Human Manager'} />
          </div>

          <div className="space-y-4">
            <h3 className="font-semibold text-lg border-b border-border pb-2 mb-4">Employee Directory</h3>
            {fleetDetails.instances?.map((inst: any) => (
              <Card key={inst.id} className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-secondary flex items-center justify-center text-muted-foreground">
                    <Bot size={24} />
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg">{inst.role}</h3>
                    <p className="text-sm text-muted-foreground uppercase">{inst.agentType} &middot; <span className={inst.status === 'running' || inst.status === 'provisioned' ? 'text-emerald-500' : (inst.status === 'error' ? 'text-red-500' : 'text-amber-500')}>{inst.status.replace('_', ' ')}</span></p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {inst.ip && (
                    <a href={inst.agentType === 'openclaw' ? `http://${inst.ip}/screen/vnc.html?chat=session&session=main${inst.token ? `&token=${inst.token}` : ''}` : `http://${inst.ip}/screen/vnc.html?path=screen/websockify${inst.token ? `&token=${inst.token}` : ''}`} target="_blank" rel="noreferrer" className="flex items-center gap-2 border border-border px-3 py-1.5 rounded-md text-xs hover:bg-secondary transition-colors text-blue-500">
                      <Tv2 size={14} /> Live Screen
                    </a>
                  )}
                  <button
                    onClick={() => setConfiguringAgent(inst)}
                    className="flex items-center gap-2 border border-border px-3 py-1.5 rounded-md text-xs hover:bg-secondary transition-colors"
                  >
                    <Settings size={14} /> Config
                  </button>
                  <button
                    onClick={() => setViewingLogsAgent(inst)}
                    className="flex items-center gap-2 border border-border px-3 py-1.5 rounded-md text-xs hover:bg-secondary transition-colors text-emerald-500"
                  >
                    <TerminalSquare size={14} /> Logs
                  </button>
                  <button
                    onClick={() => handleDeleteAgent(inst.id, inst.role)}
                    className="flex items-center gap-2 border border-transparent hover:border-red-500/20 px-3 py-1.5 rounded-md text-xs hover:bg-red-500/10 text-muted-foreground hover:text-red-500 transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </Card>
            ))}
            {(!fleetDetails.instances || fleetDetails.instances.length === 0) && (
              <div className="text-center p-8 border border-border rounded-lg text-muted-foreground">
                No agents found for this fleet.
              </div>
            )}
          </div>
        </>
      )}

      {activeTab === 'tasks' && <TasksView fleetId={fleetId} />}
      {activeTab === 'activity' && <ActivityFeed fleetId={fleetId} />}
      {activeTab === 'approvals' && <ApprovalsInbox fleetId={fleetId} />}

      {/* MODALS */}
      {configuringAgent && (
        <AgentConfigModal
          fleetId={fleetId}
          instance={configuringAgent}
          onClose={() => setConfiguringAgent(null)}
          onSuccess={() => {
            setConfiguringAgent(null);
            fetchFleetDetails(fleetId); // Reload to get updated config strings
          }}
        />
      )}

      {viewingLogsAgent && (
        <AgentLogsModal
          fleetId={fleetId}
          instance={viewingLogsAgent}
          onClose={() => setViewingLogsAgent(null)}
        />
      )}

    </div>
  );
};

export default Dashboard;
