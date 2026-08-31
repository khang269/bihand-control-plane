import React, { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate, useOutletContext, Link, useLocation } from 'react-router-dom';
import { Trash2, Play, Square, Loader2, ChevronLeft, CircleDot, Plus, Menu } from 'lucide-react';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import AgentSetupWizard from '../../components/AgentSetupWizard';

// Sub-views rendered dynamically as tabs
import FleetGoals from './FleetGoals';
import FleetRoutines from './FleetRoutines';
import FleetSupport from './FleetSupport';
import FleetInbox from './FleetInbox';
import FleetActivity from './FleetActivity';
import FleetCosts from './FleetCosts';
import FleetChatLanding from './FleetChatLanding';
import Credentials from '../Credentials';
import TasksView from '../../components/TasksView';
import FleetIssueDetail from './FleetIssueDetail';
import OrgChartFlow from '../../components/OrgChartFlow';
import { Avatar } from '../../components/Avatar';
import Drawer from '../../components/Drawer';
import FleetNavDrawer from '../../components/fleet/FleetNavDrawer';
import AgentSettingsDrawer from '../../components/fleet/AgentSettingsDrawer';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { Input, Select } from '../../components/ui/Input';

const FleetDashboard: React.FC = () => {
  const { fleetId, instanceId, issueId } = useParams<{ fleetId?: string; instanceId?: string; issueId?: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { language } = useLanguage();
  const { loadFleets } = useOutletContext<any>();
  const [fleetDetails, setFleetDetails] = useState<any>(null);
  const [opLoading, setOpLoading] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isNavDrawerOpen, setIsNavDrawerOpen] = useState(false);

  // State for hiring (adding) a new agent - the actual form lives in AgentSetupWizard
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isAddingAgent, setIsAddingAgent] = useState(false);

  // States for editing agent structure (reporting, title, role)
  const [isEditStructureModalOpen, setIsEditStructureModalOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<any>(null);
  const [editReportsTo, setEditReportsTo] = useState('');
  const [editRole, setEditRole] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [isUpdatingStructure, setIsUpdatingStructure] = useState(false);

  // Synchronize Tab selection from URL subpath. Chat is the default landing - everything
  // else (org/roster, ops board, automations, etc.) is a "second-tier" destination reached
  // via the nav drawer instead of a visible tab ribbon.
  const activeTab = useMemo(() => {
    if (location.pathname.endsWith('/org')) return 'org';
    if (location.pathname.includes('/issues')) return 'issues';
    if (location.pathname.endsWith('/routines')) return 'routines';
    if (location.pathname.endsWith('/support')) return 'support';
    if (location.pathname.endsWith('/goals')) return 'goals';
    if (location.pathname.endsWith('/inbox')) return 'inbox';
    if (location.pathname.endsWith('/activity')) return 'activity';
    if (location.pathname.endsWith('/costs')) return 'costs';
    if (location.pathname.endsWith('/credentials')) return 'credentials';
    // /dashboard, /agents, /agents/:instanceId, /agents/:instanceId/settings
    return 'chat';
  }, [location.pathname]);

  const isSettingsDrawerOpen = !!instanceId && location.pathname.endsWith('/settings');

  const loadDashboardData = () => {
    if (!fleetId) return;
    api.get(`/fleets/${fleetId}`)
      .then(res => setFleetDetails(res.data))
      .catch(err => {
        console.error("Error fetching fleet details:", err);
        if (err.response?.status === 404) {
          navigate('/dashboard');
        }
      })
      .finally(() => setIsLoading(false));
  };

  const handleAddAgentSubmit = async (agent: Record<string, any>) => {
    setIsAddingAgent(true);
    try {
      await api.post(`/fleets/${fleetId}/instances`, { agent });
      setIsAddModalOpen(false);
      loadDashboardData();
    } catch (err: any) {
      alert(err.response?.data?.detail || "Failed to add agent to fleet.");
    } finally {
      setIsAddingAgent(false);
    }
  };

  const handleDeleteAgent = async (instanceId: string, role: string) => {
    if (!window.confirm(`Are you sure you want to permanently terminate the ${role} agent?`)) return;
    try {
      await api.delete(`/fleets/${fleetId}/instances/${instanceId}`);
      loadDashboardData();
    } catch (e: any) {
      alert(e.response?.data?.detail || "Failed to destroy agent");
    }
  };

  const handleOpenEditStructure = (agent: any) => {
    setEditingAgent(agent);
    setEditReportsTo(agent.reportsTo || '');
    setEditRole(agent.role || '');
    setEditTitle(agent.title || '');
    setIsEditStructureModalOpen(true);
  };

  const handleEditStructureSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAgent) return;
    setIsUpdatingStructure(true);
    try {
      await api.put(`/fleets/${fleetId}/instances/${editingAgent.id}/structure`, {
        reportsTo: editReportsTo || null,
        role: editRole,
        title: editTitle
      });
      setIsEditStructureModalOpen(false);
      setEditingAgent(null);
      loadDashboardData();
    } catch (err: any) {
      alert(err.response?.data?.detail || "Failed to update agent structure.");
    } finally {
      setIsUpdatingStructure(false);
    }
  };

  useEffect(() => {
    if (fleetId) {
      setIsLoading(true);
      loadDashboardData();
      // Periodically poll agent details (such as status) when active in workspace
      const interval = setInterval(() => {
        if (document.hasFocus()) {
          loadDashboardData();
        }
      }, 5000);

      return () => clearInterval(interval);
    }
  }, [fleetId]);

  const getAgentRole = (instId: string) => {
    if (!fleetDetails?.instances) return 'System';
    const inst = fleetDetails.instances.find((i: any) => i.id === instId);
    return inst ? inst.role : 'System';
  };

  const handleStop = async () => {
    if (!window.confirm("Are you sure you want to stop all agents in this fleet?")) return;
    setOpLoading(true);
    try {
      await api.post(`/fleets/${fleetId}/stop`);
      loadDashboardData();
    } catch (e: any) {
      alert(e.response?.data?.detail || "Failed to stop fleet");
    } finally {
      setOpLoading(false);
    }
  };

  const handleStart = async () => {
    setOpLoading(true);
    try {
      await api.post(`/fleets/${fleetId}/start`);
      loadDashboardData();
    } catch (e: any) {
      alert(e.response?.data?.detail || "Failed to start fleet");
    } finally {
      setOpLoading(false);
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

  // Online is strictly defined as active and not in provisional/installing states
  const isOnline = useMemo(() => {
    if (!fleetDetails) return false;
    return fleetDetails.status === 'running' || fleetDetails.status === 'provisioned';
  }, [fleetDetails]);

  // A fleet is transitional if the fleet's status itself is transient OR if any of its individual agents are in transient states
  const isTransitional = useMemo(() => {
    if (!fleetDetails) return false;
    const fleetStatus = fleetDetails.status;
    if (fleetStatus === 'provisioning' || fleetStatus === 'installing' || fleetStatus === 'stopping' || fleetStatus === 'deleting') {
      return true;
    }
    const instances = fleetDetails.instances || [];
    if (instances.length === 0 && fleetStatus === 'provisioning') {
      return true;
    }
    return instances.some((inst: any) =>
      inst.status === 'provisioning' ||
      inst.status === 'installing' ||
      inst.status === 'deleting' ||
      inst.status === 'stopping_queued' ||
      inst.status === 'provisioning_queued' ||
      inst.status === 'deleting_queued'
    );
  }, [fleetDetails]);

  if (isLoading || !fleetDetails) {
    return (
      <div className="p-8 flex flex-col items-center justify-center h-full min-h-[400px] text-muted-foreground space-y-4">
        <svg className="animate-spin h-8 w-8 text-foreground" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        <span className="text-sm font-medium animate-pulse">Establishing secure link to Fleet Cockpit...</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full w-full overflow-hidden bg-background">
      {/* Persistent Top Bar - replaces the old tab ribbon; always visible, hosts the nav-drawer trigger */}
      <div className="border-b border-border bg-background px-4 py-2.5 flex items-center justify-between gap-3 flex-shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => setIsNavDrawerOpen(true)}
            className="shrink-0 p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
            title={language === 'vi' ? 'Điều hướng' : 'Navigate'}
          >
            <Menu size={18} />
          </button>
          <div className="min-w-0">
            <h1 className="text-sm font-bold tracking-tight truncate">
              {fleetDetails.name || (language === 'vi' ? 'Hạm đội' : 'Fleet Cockpit')}
            </h1>
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-emerald-500' : 'bg-amber-500'}`} />
              <span className="capitalize">
                {isTransitional
                  ? (language === 'vi' ? 'Đang xử lý...' : 'Processing...')
                  : isOnline
                  ? (language === 'vi' ? 'Đang chạy' : 'Online')
                  : fleetDetails.status}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isTransitional ? (
            <Badge variant="info">
              <Loader2 className="animate-spin" size={13} />
              {language === 'vi' ? 'Đang xử lý' : 'Processing'}
            </Badge>
          ) : isOnline ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={handleStop}
              disabled={opLoading || fleetDetails.status === 'deleting' || fleetDetails.status === 'deleted'}
            >
              <Square size={14} /> {language === 'vi' ? 'Dừng' : 'Stop'}
            </Button>
          ) : (
            <button
              onClick={handleStart}
              disabled={opLoading || fleetDetails.status === 'deleting' || fleetDetails.status === 'deleted'}
              className="flex items-center gap-1.5 bg-emerald-500/20 text-emerald-500 border border-emerald-500/20 px-3 py-1.5 rounded-lg text-xs hover:bg-emerald-500/30 transition-colors font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Play size={14} /> {language === 'vi' ? 'Chạy' : 'Start'}
            </button>
          )}
          <Button
            variant="destructive"
            size="sm"
            className="bg-transparent border border-red-500/20 text-red-500 hover:bg-red-500/10"
            onClick={handleDeleteFleet}
            disabled={opLoading || fleetDetails.status === 'deleting' || fleetDetails.status === 'deleted'}
          >
            <Trash2 size={14} /> {language === 'vi' ? 'Hủy' : 'Destroy'}
          </Button>
        </div>
      </div>

      {/* Dynamic Main Workspace Container */}
      <div className="flex-1 overflow-hidden relative">
        {/* 💬 Chat-first landing (default) */}
        {activeTab === 'chat' && (
          <FleetChatLanding
            fleetDetails={fleetDetails}
            fleetId={fleetId!}
            instanceId={instanceId}
            onOpenHireWizard={() => setIsAddModalOpen(true)}
          />
        )}

        {/* 🧬 Org & Roster Tab (formerly "Mission Control") */}
        {activeTab === 'org' && (
          <div className="h-full flex flex-col overflow-y-auto w-full">
            {/* Interactive Org Chart Map */}
            <div className="h-[320px] border-b border-border bg-secondary/30 flex-shrink-0 relative">
              <OrgChartFlow
                fleetDetails={fleetDetails}
                ownerName={user?.name || "Human Manager"}
                onNodeClick={(nodeId) => navigate(`/fleet/${fleetId}/agents/${nodeId}`)}
              />
            </div>

            {/* Grid of Roster Dossier Cards */}
            <div className="p-6 flex-1">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-lg font-bold tracking-tight">
                    {language === 'vi' ? 'Hồ sơ Nhân sự' : 'Team Dossier'}
                  </h2>
                  <p className="text-muted-foreground text-xs mt-1">
                    {language === 'vi'
                      ? 'Chọn nhân viên, chỉnh sửa cấu trúc báo cáo hoặc tuyển thêm nhân viên mới.'
                      : 'Select an agent, edit their reporting structure, or hire new employees.'}
                  </p>
                </div>
                <Button size="sm" onClick={() => setIsAddModalOpen(true)}>
                  <Plus size={14} /> {language === 'vi' ? 'Tuyển Nhân viên' : 'Hire Agent'}
                </Button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {fleetDetails.instances?.map((agent: any) => {
                  const isTransitionalAgent = ["provisioning_queued", "provisioning", "installing", "starting_queued", "stopping_queued", "restarting_queued", "deleting_queued", "deleting"].includes(agent.status);
                  return (
                    <div
                      key={agent.id}
                      className="flex flex-col border rounded-xl bg-card border-border transition-all duration-200"
                    >
                      <div className="flex items-start gap-4 p-4 flex-1">
                        <Link to={`/fleet/${fleetId}/agents/${agent.id}`} className="block shrink-0">
                          <Avatar name={agent.role} className="w-11 h-12 rounded-xl object-cover border border-border" />
                        </Link>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 justify-between">
                            <Link to={`/fleet/${fleetId}/agents/${agent.id}`} className="font-bold text-sm truncate hover:text-purple-500">
                              {agent.role}
                            </Link>
                            <span className={`w-2 h-2 rounded-full ${agent.status === 'running' ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
                          </div>
                          <p className="text-[11px] text-muted-foreground truncate mt-0.5">{agent.title || (language === 'vi' ? 'Tác nhân Hạm đội' : 'Fleet Agent')}</p>

                          <div className="flex items-center gap-2 mt-1.5 text-[10px] text-purple-500 font-medium">
                            <span className="bg-secondary text-foreground px-1.5 py-0.5 rounded text-[9px] uppercase">{agent.agentType}</span>
                            {agent.reportsTo ? (
                              <span className="truncate">{language === 'vi' ? 'Báo cáo cho:' : 'Reports to:'} {getAgentRole(agent.reportsTo)}</span>
                            ) : (
                              <span>{language === 'vi' ? 'Báo cáo cho: Ban giám đốc (CEO)' : 'Reports to: Board (CEO)'}</span>
                            )}
                          </div>
                          {agent.apiCreditsUsed > 0 && (
                            <div className="text-[10px] text-muted-foreground mt-1.5 font-semibold">
                              🔌 API Usage: <span className="text-emerald-500">{agent.apiCreditsUsed.toFixed(3)} Credits</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Card Actions Footer */}
                      <div className="border-t border-border px-4 py-2 flex items-center justify-between bg-secondary/20 text-[11px] text-muted-foreground">
                        <button
                          onClick={() => handleOpenEditStructure(agent)}
                          className="hover:text-foreground transition-colors font-medium text-purple-500"
                        >
                          {language === 'vi' ? 'Sửa Cấu trúc' : 'Edit Structure'}
                        </button>
                        <button
                          onClick={() => handleDeleteAgent(agent.id, agent.role)}
                          disabled={isTransitionalAgent}
                          className="hover:text-red-500 transition-colors p-1 disabled:opacity-50 text-muted-foreground"
                          title={language === 'vi' ? 'Hủy hợp đồng' : 'Terminate Employee'}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* 📋 Operations Board (Task Matrix) Tab */}
        {activeTab === 'issues' && (
          <div className="flex h-full w-full overflow-hidden">
            <div className={`h-full flex flex-col overflow-y-auto ${issueId ? 'hidden md:flex md:w-5/12 border-r border-border' : 'w-full md:w-5/12 border-r border-border'}`}>
              <div className="flex-1 h-full overflow-y-auto">
                <TasksView fleetId={fleetId!} compact={!!issueId} />
              </div>
            </div>
             {issueId ? (
              <div className="flex-1 h-full overflow-hidden flex flex-col bg-background">
                <div className="p-4 border-b border-border bg-background flex items-center md:hidden flex-shrink-0">
                  <Link to={`/fleet/${fleetId}/issues`} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
                    <ChevronLeft size={16} /> {language === 'vi' ? 'Quay lại Bảng Sự cố' : 'Back to Task Board'}
                  </Link>
                </div>
                <div className="flex-1 overflow-y-auto pr-1">
                  <FleetIssueDetail />
                </div>
              </div>
            ) : (
              <div className="hidden md:flex flex-1 h-full flex-col items-center justify-center p-8 text-center text-muted-foreground border-l border-border bg-secondary/20">
                <div className="max-w-sm flex flex-col items-center">
                  <div className="w-16 h-16 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-500 mb-4 animate-pulse">
                    <CircleDot size={28} />
                  </div>
                  <h3 className="text-sm font-bold uppercase tracking-wider mb-1 font-mono">
                    {language === 'vi' ? 'Trung tâm Sự cố Đang hoạt động' : 'Active Incident Center'}
                  </h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {language === 'vi'
                      ? 'Chọn một thẻ hoặc sự cố từ danh sách bên trái để mở bảng thảo luận trực tiếp, kiểm duyệt kết quả hoặc phê duyệt yêu cầu.'
                      : 'Select a ticket or incident from the operations list on the left to activate the live discussion board, review agent deliverables, or authorize approvals.'}
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 📥 Governance Tab */}
        {activeTab === 'inbox' && (
          <div className="h-full w-full overflow-y-auto p-8">
            <div className="max-w-5xl mx-auto w-full">
              <FleetInbox />
            </div>
          </div>
        )}

        {/* 🔄 Automations Tab */}
        {activeTab === 'routines' && (
          <div className="h-full w-full overflow-y-auto p-8">
            <div className="max-w-5xl mx-auto w-full">
              <FleetRoutines />
            </div>
          </div>
        )}

        {/* 💬 Customer Support Tab */}
        {activeTab === 'support' && (
          <div className="h-full w-full overflow-y-auto">
            <FleetSupport />
          </div>
        )}

        {/* 🎯 Roadmap Milestones Tab */}
        {activeTab === 'goals' && (
          <div className="h-full w-full overflow-y-auto p-8">
            <div className="max-w-5xl mx-auto w-full">
              <FleetGoals />
            </div>
          </div>
        )}

        {/* 💸 Ledger Tab */}
        {activeTab === 'costs' && (
          <div className="h-full w-full overflow-y-auto p-8">
            <div className="max-w-5xl mx-auto w-full">
              <FleetCosts />
            </div>
          </div>
        )}

        {/* 📈 Live Feed Tab */}
        {activeTab === 'activity' && (
          <div className="h-full w-full overflow-y-auto p-8">
            <div className="max-w-5xl mx-auto w-full">
              <FleetActivity />
            </div>
          </div>
        )}

        {/* 🔒 Credentials Vault Tab */}
        {activeTab === 'credentials' && (
          <div className="h-full w-full overflow-y-auto p-8">
            <div className="max-w-5xl mx-auto w-full">
              <Credentials />
            </div>
          </div>
        )}
      </div>

      {isAddModalOpen && (
        <AgentSetupWizard
          reportsToOptions={fleetDetails?.instances}
          credentialsUserId={fleetDetails?.userId}
          onClose={() => setIsAddModalOpen(false)}
          onSubmit={handleAddAgentSubmit}
          isSubmitting={isAddingAgent}
        />
      )}

      {/* Edit Structure Modal */}
      <Modal
        open={isEditStructureModalOpen && !!editingAgent}
        onClose={() => { setIsEditStructureModalOpen(false); setEditingAgent(null); }}
        title={language === 'vi' ? 'Chỉnh sửa Cấu trúc Nhân viên' : 'Edit Agent Structure'}
      >
        {editingAgent && (
          <form onSubmit={handleEditStructureSubmit} className="space-y-4 text-left">
            <div>
              <label className="block text-xs font-semibold uppercase text-muted-foreground mb-1.5">
                {language === 'vi' ? 'Vai trò / Định danh' : 'Role / Identifier'}
              </label>
              <Input
                type="text"
                required
                value={editRole}
                onChange={e => setEditRole(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase text-muted-foreground mb-1.5">
                {language === 'vi' ? 'Chức danh công việc' : 'Job Title'}
              </label>
              <Input
                type="text"
                required
                value={editTitle}
                onChange={e => setEditTitle(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase text-muted-foreground mb-1.5">
                {language === 'vi' ? 'Quản lý báo cáo' : 'Reports To Manager'}
              </label>
              <Select
                value={editReportsTo}
                onChange={e => setEditReportsTo(e.target.value)}
              >
                <option value="">
                  {language === 'vi' ? 'Không có quản lý (CEO báo cáo Hội đồng)' : 'No Manager (Top level / CEO reports to Board)'}
                </option>
                {fleetDetails?.instances?.filter((i: any) => i.id !== editingAgent.id).map((i: any) => (
                  <option key={i.id} value={i.id}>{i.role} ({i.title})</option>
                ))}
              </Select>
            </div>

            <div className="pt-2 flex justify-end gap-3 border-t border-border">
              <Button
                type="button"
                variant="outline"
                onClick={() => { setIsEditStructureModalOpen(false); setEditingAgent(null); }}
              >
                {language === 'vi' ? 'Hủy bỏ' : 'Cancel'}
              </Button>
              <Button type="submit" disabled={isUpdatingStructure}>
                {isUpdatingStructure && <Loader2 className="animate-spin" size={14} />}
                {language === 'vi' ? 'Cập nhật Cấu trúc' : 'Update Structure'}
              </Button>
            </div>
          </form>
        )}
      </Modal>

      {/* Second-tier feature navigation drawer */}
      <Drawer
        open={isNavDrawerOpen}
        onClose={() => setIsNavDrawerOpen(false)}
        side="left"
        widthClassName="w-72"
        title={language === 'vi' ? 'Điều hướng' : 'Navigate'}
      >
        <FleetNavDrawer fleetId={fleetId!} activeTab={activeTab} onClose={() => setIsNavDrawerOpen(false)} />
      </Drawer>

      {/* Per-agent settings drawer (instructions/skills/configuration/integrations/mcp/runs) */}
      <AgentSettingsDrawer
        open={isSettingsDrawerOpen}
        onClose={() => navigate(`/fleet/${fleetId}/agents/${instanceId}`)}
      />
    </div>
  );
};

export default FleetDashboard;
