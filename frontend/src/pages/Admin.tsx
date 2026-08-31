import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import {
  Settings, Users, Server, HardDrive, Trash2, Power, RotateCcw,
  Play, Search, ArrowLeft, RefreshCw, Eye, MessageSquare,
  AlertCircle
} from 'lucide-react';
import api from '../lib/api';
import { Badge, Button, Card, Input, WindowFrame } from '../components/ui';
import { cn } from '../lib/cn';

const Admin: React.FC = () => {
  const { user, token, isLoading } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'instances' | 'users' | 'logs'>('instances');

  // Data lists
  const [instances, setInstances] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [searchEmail, setSearchEmail] = useState('');
  const [logs, setLogs] = useState('');

  // Loading states
  const [isTabLoading, setIsTabLoading] = useState(false);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);

  // Drilldown states for detailed inspection
  const [selectedUserEmail, setSelectedUserEmail] = useState<string | null>(null);
  const [userFleets, setUserFleets] = useState<any[]>([]);
  const [fleetsLoading, setFleetsLoading] = useState(false);

  const [selectedFleetId, setSelectedFleetId] = useState<string | null>(null);
  const [selectedFleetDetail, setSelectedFleetDetail] = useState<any | null>(null);
  const [fleetTasks, setFleetTasks] = useState<any[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [taskComments, setTaskComments] = useState<any[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);

  const [inspectInstanceId, setInspectInstanceId] = useState<string | null>(null);
  const [inspectLogs, setInspectLogs] = useState<any | null>(null);
  const [inspectLogsLoading, setInspectLogsLoading] = useState(false);

  useEffect(() => {
    if (!isLoading) {
      if (!token) {
        navigate('/');
      } else if (user && user.role !== 'admin') {
        navigate('/dashboard');
      }
    }
  }, [user, token, isLoading, navigate]);

  useEffect(() => {
    if (user?.role === 'admin') {
      // Reset drilldowns when tab changes
      setSelectedUserEmail(null);
      setSelectedFleetId(null);
      setSelectedTaskId(null);
      setInspectInstanceId(null);

      if (activeTab === 'instances') {
        loadInstances();
      } else if (activeTab === 'users') {
        setSearchEmail('');
        setIsTabLoading(true);
        api.get('/admin/users?q=')
          .then(res => setUsers(res.data.users || []))
          .catch(console.error)
          .finally(() => setIsTabLoading(false));
      } else if (activeTab === 'logs') {
        loadServerLogs();
      }
    }
  }, [activeTab, user]);

  const loadInstances = async () => {
    setIsTabLoading(true);
    try {
      const res = await api.get('/admin/instances');
      setInstances(res.data.instances || []);
    } catch (e) {
      console.error(e);
    } finally {
      setIsTabLoading(false);
    }
  };

  const searchUser = async () => {
    setIsTabLoading(true);
    try {
      const res = await api.get(`/admin/users?q=${encodeURIComponent(searchEmail)}`);
      setUsers(res.data.users || []);
    } catch (e) {
      console.error(e);
      setUsers([]);
    } finally {
      setIsTabLoading(false);
    }
  };

  const handleAction = async (action: string, instanceId: string) => {
    if (!confirm(`Are you sure you want to ${action} this instance?`)) return;

    setActionInProgress(`${action}:${instanceId}`);
    try {
      await api.post(`/admin/instances/${instanceId}/${action}`);
      alert(`Action '${action}' queued.`);
      loadInstances();
    } catch (e: any) {
      alert(e.response?.data?.detail || e.message);
    } finally {
      setActionInProgress(null);
    }
  };

  const loadServerLogs = async () => {
    setIsTabLoading(true);
    try {
      const res = await api.get('/admin/server-logs');
      setLogs(res.data.logs);
    } catch (e) {
      console.error(e);
    } finally {
      setIsTabLoading(false);
    }
  };

  const handleAdminDeleteFleet = async (fleetId: string, fleetName: string) => {
    if (!confirm(`WARNING: Are you sure you want to permanently delete the fleet "${fleetName}" and all associated VM instances? This action is irreversible.`)) {
      return;
    }
    try {
      await api.delete(`/admin/users/${selectedUserEmail}/fleets/${fleetId}`);
      alert(`Fleet destruction initiated successfully.`);
      setSelectedFleetId(null);
      if (selectedUserEmail) {
        handleInspectUser(selectedUserEmail);
      }
    } catch (err: any) {
      console.error(err);
      alert(err.response?.data?.detail || "Failed to delete fleet");
    }
  };

  // --- Drilldown API fetches ---

  const handleInspectUser = async (email: string) => {
    setSelectedUserEmail(email);
    setSelectedFleetId(null);
    setSelectedTaskId(null);
    setInspectInstanceId(null);
    setFleetsLoading(true);
    try {
      const res = await api.get(`/admin/users/${email}/fleets`);
      setUserFleets(res.data.fleets || []);
    } catch (e) {
      console.error(e);
      setUserFleets([]);
    } finally {
      setFleetsLoading(false);
    }
  };

  const handleInspectFleet = async (fleetId: string) => {
    setSelectedFleetId(fleetId);
    setSelectedTaskId(null);
    setInspectInstanceId(null);
    setTasksLoading(true);
    try {
      // 1. Fetch fleet specific instances & details
      const detailRes = await api.get(`/admin/fleets/${fleetId}`);
      setSelectedFleetDetail(detailRes.data);

      // 2. Fetch fleet tasks backlog
      const tasksRes = await api.get(`/admin/fleets/${fleetId}/tasks`);
      setFleetTasks(tasksRes.data.tasks || []);
    } catch (e) {
      console.error(e);
      setSelectedFleetDetail(null);
      setFleetTasks([]);
    } finally {
      setTasksLoading(false);
    }
  };

  const handleInspectTask = async (taskId: string) => {
    setSelectedTaskId(taskId);
    setCommentsLoading(true);
    try {
      const res = await api.get(`/admin/tasks/${taskId}/comments`);
      setTaskComments(res.data.comments || []);
    } catch (e) {
      console.error(e);
      setTaskComments([]);
    } finally {
      setCommentsLoading(false);
    }
  };

  const handleInspectInstanceLogs = async (instanceId: string) => {
    setInspectInstanceId(instanceId);
    setInspectLogsLoading(true);
    try {
      const res = await api.get(`/admin/instances/${instanceId}/logs`);
      setInspectLogs(res.data);
    } catch (e) {
      console.error(e);
      setInspectLogs(null);
    } finally {
      setInspectLogsLoading(false);
    }
  };

  if (isLoading || !user) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center bg-background text-muted-foreground gap-4">
        <RefreshCw className="animate-spin text-purple-500" size={32} />
        <span className="font-semibold tracking-wide uppercase text-xs">Loading Admin HQ...</span>
      </div>
    );
  }
  if (user.role !== 'admin') return null;

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      {/* Sidebar */}
      <aside className="w-64 border-r border-border bg-background flex flex-col h-full flex-shrink-0">
        <div className="p-4 border-b border-border flex items-center gap-3">
          <Settings size={24} className="text-foreground animate-pulse" />
          <h2 className="text-xl font-bold tracking-tight">Admin HQ</h2>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-6">
          <nav className="space-y-1 mt-4">
            <button
              onClick={() => setActiveTab('instances')}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors',
                activeTab === 'instances' ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
              )}
            >
              <HardDrive size={18} /> Orchestration
            </button>
            <button
              onClick={() => setActiveTab('users')}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors',
                activeTab === 'users' ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
              )}
            >
              <Users size={18} /> User Management
            </button>
            <button
              onClick={() => setActiveTab('logs')}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors',
                activeTab === 'logs' ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
              )}
            >
              <Server size={18} /> Server Logs
            </button>
          </nav>
        </div>

        <div className="p-4 border-t border-border">
          <Button onClick={() => navigate('/dashboard')} variant="outline" size="sm" className="w-full">
            <RotateCcw size={14} /> Back to App
          </Button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col h-full overflow-hidden">
        <header className="h-14 border-b border-border flex items-center justify-between px-6 bg-background">
          <h1 className="text-lg font-medium tracking-tight flex items-center gap-2">
            {activeTab === 'instances' ? 'Infrastructure Orchestration' :
             activeTab === 'users' ? 'User Management' : 'Server Logs'}
            {isTabLoading && <RefreshCw size={14} className="animate-spin text-purple-400" />}
          </h1>
        </header>

        <div className="flex-1 overflow-y-auto p-8">
          <div className="max-w-7xl mx-auto space-y-6">

            {/* ORCHESTRATION TAB */}
            {activeTab === 'instances' && (
              <div className="space-y-6">
                {inspectInstanceId ? (
                  // Instance Logs / Inspection Panel
                  <Card className="space-y-4">
                    <div className="flex items-center justify-between pb-3 border-b border-border">
                      <button onClick={() => setInspectInstanceId(null)} className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground font-bold transition-colors">
                        <ArrowLeft size={14} /> Back to Instances
                      </button>
                      <h3 className="text-sm font-bold text-purple-500">VM Agent Instance Diagnostics</h3>
                    </div>
                    {inspectLogsLoading ? (
                      <div className="flex items-center gap-2 py-8 justify-center text-xs text-muted-foreground">
                        <RefreshCw size={14} className="animate-spin" /> Loading run snapshots...
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {inspectLogs?.errorMessage && (
                          <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-600 dark:text-red-400 text-xs flex items-start gap-2">
                            <AlertCircle size={16} className="shrink-0 mt-0.5" />
                            <div>
                              <div className="font-bold uppercase tracking-wider text-[10px]">Error Output:</div>
                              <p className="mt-1 font-mono">{inspectLogs.errorMessage}</p>
                            </div>
                          </div>
                        )}
                        <div className="space-y-1">
                          <label className="text-[10px] font-extrabold uppercase tracking-widest text-muted-foreground">Live VM Logs:</label>
                          <WindowFrame className="h-[450px] flex flex-col">
                            <div className="flex-1 min-h-0 overflow-y-auto p-4 font-mono text-[11px] text-green-400 whitespace-pre-wrap leading-relaxed">
                              {inspectLogs?.provisionLogs && inspectLogs.provisionLogs.length > 0 ? (
                                inspectLogs.provisionLogs.map((logLine: string, idx: number) => (
                                  <div key={idx} className="hover:bg-zinc-800/50 py-0.5">{logLine}</div>
                                ))
                              ) : (
                                "No provisioning logs captured for this agent VM."
                              )}
                            </div>
                          </WindowFrame>
                        </div>
                      </div>
                    )}
                  </Card>
                ) : (
                  <div className="border border-border rounded-xl overflow-hidden bg-card shadow-sm">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-secondary border-b border-border text-muted-foreground uppercase text-xs">
                        <tr>
                          <th className="px-6 py-4 font-medium">Status</th>
                          <th className="px-6 py-4 font-medium">User & VM</th>
                          <th className="px-6 py-4 font-medium">Provider/Model</th>
                          <th className="px-6 py-4 font-medium">IP Address</th>
                          <th className="px-6 py-4 font-medium text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {instances.map(inst => {
                          const isActing = actionInProgress && actionInProgress.endsWith(inst._id);
                          return (
                            <tr key={inst._id} className="hover:bg-secondary/40 transition-colors">
                              <td className="px-6 py-4">
                                <Badge
                                  variant={
                                    inst.status === 'running' || inst.status === 'provisioned' ? 'success' :
                                    inst.status === 'error' ? 'error' : 'warning'
                                  }
                                  className="uppercase"
                                >
                                  {inst.status}
                                </Badge>
                              </td>
                              <td className="px-6 py-4">
                                <div className="font-semibold text-foreground">{inst.alias || 'Agent'}</div>
                                <div className="text-xs text-muted-foreground mt-1">{inst.userId}</div>
                                <div className="text-[10px] font-mono text-muted-foreground mt-1">{inst.vmName}</div>
                              </td>
                              <td className="px-6 py-4">
                                <div className="text-foreground text-xs font-semibold">{inst.provider.toUpperCase()}</div>
                                <div className="text-[10px] text-muted-foreground mt-1">{inst.model || 'default'}</div>
                                <span className="inline-block px-1.5 py-0.5 mt-1.5 text-[8px] font-extrabold bg-purple-500/10 text-purple-600 dark:text-purple-300 border border-purple-500/20 rounded font-mono uppercase tracking-wider">
                                  {inst.iteration}
                                </span>
                              </td>
                              <td className="px-6 py-4 font-mono text-xs text-foreground">
                                {inst.externalIp || '-'}
                              </td>
                              <td className="px-6 py-4 text-right">
                                <div className="flex items-center justify-end gap-1">
                                  {isActing ? (
                                    <RefreshCw className="animate-spin text-purple-400 mr-2" size={14} />
                                  ) : (
                                    <>
                                      <button onClick={() => handleInspectInstanceLogs(inst._id)} className="p-2 text-muted-foreground hover:text-purple-500 hover:bg-secondary rounded-lg transition-colors" title="Inspect runtime logs">
                                        <Eye size={14} />
                                      </button>
                                      {inst.status === 'stopped' ? (
                                        <button onClick={() => handleAction('start', inst._id)} className="p-2 text-muted-foreground hover:text-emerald-500 hover:bg-secondary rounded-lg transition-colors" title="Start VM">
                                          <Play size={14} />
                                        </button>
                                      ) : (
                                        <button onClick={() => handleAction('stop', inst._id)} className="p-2 text-muted-foreground hover:text-amber-500 hover:bg-secondary rounded-lg transition-colors" title="Suspend VM">
                                          <Power size={14} />
                                        </button>
                                      )}
                                      <button onClick={() => handleAction('destroy', inst._id)} className="p-2 text-muted-foreground hover:text-red-500 hover:bg-secondary rounded-lg transition-colors" title="Destroy & Decom">
                                        <Trash2 size={14} />
                                      </button>
                                    </>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {instances.length === 0 && !isTabLoading && (
                      <div className="p-12 text-center text-muted-foreground font-bold text-xs uppercase tracking-wider">No workspace agent instances running.</div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* USERS TAB WITH DYNAMIC INSPECTIONS */}
            {activeTab === 'users' && (
              <div className="grid grid-cols-12 gap-6">

                {/* User Search & List Panel (Left/All column when not inspecting) */}
                <div className={`${selectedUserEmail ? 'col-span-4' : 'col-span-12'} space-y-6 transition-all`}>
                  <div className="flex gap-4">
                    <div className="relative flex-1">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
                      <Input
                        type="text"
                        placeholder="Search users..."
                        className="pl-10 text-xs"
                        value={searchEmail}
                        onChange={e => setSearchEmail(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && searchUser()}
                      />
                    </div>
                    <Button onClick={searchUser} variant="secondary" size="sm">
                      <Search size={12} /> Search
                    </Button>
                  </div>

                  {users.length > 0 ? (
                    <div className="border border-border rounded-xl overflow-hidden bg-card shadow-sm">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-secondary border-b border-border text-muted-foreground uppercase text-[10px] font-bold">
                          <tr>
                            <th className="px-4 py-3">User Email</th>
                            {!selectedUserEmail && <th className="px-4 py-3">Role</th>}
                            <th className="px-4 py-4 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {users.map(u => {
                            const isSelected = selectedUserEmail === u.email;
                            return (
                              <tr key={u._id} onClick={() => { setSearchEmail(''); setSelectedTaskId(null); }} className={cn('hover:bg-secondary/40 cursor-pointer', isSelected && 'bg-purple-500/10')}>
                                <td className="px-4 py-3">
                                  <div className="font-semibold text-foreground">{u.name || 'Anonymous User'}</div>
                                  <div className="text-[10px] text-muted-foreground font-mono mt-0.5">{u.email}</div>
                                </td>
                                {!selectedUserEmail && <td className="px-4 py-3 uppercase font-extrabold text-[9px] text-purple-600 dark:text-purple-400">{u.role}</td>}
                                <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                                  <div className="flex items-center justify-end gap-1">
                                    <button onClick={() => handleInspectUser(u.email)} className="p-1.5 text-muted-foreground hover:text-purple-500 hover:bg-secondary rounded-md" title="Inspect user fleets">
                                      <Eye size={14} />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    !isTabLoading && (
                      <div className="p-8 text-center text-muted-foreground border border-dashed border-border rounded-xl text-xs uppercase tracking-wider font-bold">No users matches.</div>
                    )
                  )}
                </div>

                {/* Inspect User panel (Right column when active) */}
                {selectedUserEmail && (
                  <div className="col-span-8 space-y-6">
                    <Card className="min-h-[400px] flex flex-col justify-stretch">
                      <div className="flex items-center justify-between pb-3 border-b border-border mb-4">
                        <h2 className="text-sm font-extrabold tracking-wider text-purple-500 uppercase">Inspecting: {selectedUserEmail}</h2>
                        <button onClick={() => setSelectedUserEmail(null)} className="text-muted-foreground hover:text-foreground"><ArrowLeft size={16} /></button>
                      </div>

                      {fleetsLoading ? (
                        <div className="flex items-center gap-1.5 py-12 justify-center text-xs text-muted-foreground flex-1">
                          <RefreshCw size={14} className="animate-spin text-purple-500" /> Querying User Fleets...
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 gap-4 flex-1">
                          {/* Fleets column */}
                          <div className="space-y-3">
                            <div className="flex justify-between items-center pb-1 border-b border-border">
                              <span className="text-[10px] font-extrabold text-muted-foreground uppercase tracking-widest block">Fleets ({userFleets.length})</span>
                              <button
                                onClick={() => navigate(`/wizard?email=${encodeURIComponent(selectedUserEmail || '')}`)}
                                className="px-2 py-0.5 bg-purple-600 hover:bg-purple-500 text-[9px] font-bold text-white rounded transition-colors"
                              >
                                + Provision Fleet
                              </button>
                            </div>
                            <div className="space-y-2 max-h-[350px] overflow-y-auto">
                              {userFleets.map(f => (
                                <div
                                  key={f._id}
                                  onClick={() => handleInspectFleet(f._id)}
                                  className={cn(
                                    'p-3 border rounded-xl cursor-pointer text-left transition-all',
                                    selectedFleetId === f._id ? 'border-purple-500 bg-purple-500/10 shadow-lg' : 'border-border hover:border-muted-foreground/40'
                                  )}
                                >
                                  <div className="flex items-center justify-between">
                                    <span className="font-bold text-xs text-foreground">{f.name}</span>
                                    <div className="flex items-center gap-1.5">
                                      <Badge variant={f.status === 'provisioned' ? 'success' : 'warning'} className="text-[8px] px-1.5 py-0.5 uppercase">{f.status}</Badge>
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleAdminDeleteFleet(f._id, f.name);
                                        }}
                                        className="p-1 text-muted-foreground hover:text-red-500 rounded hover:bg-secondary transition-colors"
                                        title="Destroy Fleet & VM instances"
                                      >
                                        <Trash2 size={12} />
                                      </button>
                                    </div>
                                  </div>
                                  <div className="text-[9px] text-muted-foreground font-mono mt-1 leading-snug truncate">Mission: {f.mission}</div>
                                  <div className="text-[8px] font-bold text-muted-foreground mt-1">
                                    Created: {new Date(f.createdAt).toLocaleDateString()} {new Date(f.createdAt).toLocaleTimeString()}
                                  </div>
                                  <div className="flex justify-between text-[8px] font-bold text-muted-foreground mt-2">
                                    <span>Plan: {f.plan.toUpperCase()}</span>
                                    <span>Spent: ${f.apiSpend?.toFixed(2) || '0.00'} / ${f.apiBudget?.toFixed(2) || '0.00'}</span>
                                  </div>
                                </div>
                              ))}
                              {userFleets.length === 0 && (
                                <div className="p-8 text-center text-muted-foreground text-xs">No active fleets registered.</div>
                              )}
                            </div>
                          </div>

                          {/* Fleet details & Tasks column */}
                          <div className="space-y-3 text-left">
                            <span className="text-[10px] text-muted-foreground font-bold block mb-1 uppercase tracking-wider border-b border-border pb-1">Fleet Details & Backlog</span>

                            {!selectedFleetId ? (
                              <div className="p-8 text-center text-muted-foreground text-xs">Select a fleet from the left to audit.</div>
                            ) : tasksLoading ? (
                              <div className="p-8 text-center text-muted-foreground text-xs flex items-center justify-center gap-1.5">
                                <RefreshCw size={12} className="animate-spin text-purple-500" />
                                <span>Loading fleet details...</span>
                              </div>
                            ) : (
                              <div className="space-y-4">
                                {selectedFleetDetail && (
                                  <div className="p-3 bg-secondary/40 border border-border rounded-xl space-y-3">
                                    <div className="flex justify-between items-center border-b border-border/60 pb-1.5">
                                      <div className="text-[10px] font-extrabold text-purple-500 uppercase tracking-wider">Active Fleet Agents ({selectedFleetDetail.instances?.length || 0})</div>
                                      <button
                                        onClick={() => navigate(`/fleet/${selectedFleetId}/dashboard`)}
                                        className="px-3 py-1 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-[10px] font-bold text-white rounded-lg shadow-md transition-all flex items-center gap-1 uppercase"
                                      >
                                        🏢 View Cockpit Dashboard ➔
                                      </button>
                                    </div>
                                    <div className="flex flex-wrap gap-1.5">
                                      {selectedFleetDetail.instances?.map((inst: any) => (
                                        <div key={inst._id} className="px-2 py-1 bg-background border border-border rounded-lg flex flex-col items-start gap-1">
                                          <div className="flex items-center gap-1.5">
                                            <span className={`w-1.5 h-1.5 rounded-full ${inst.status === 'running' ? 'bg-emerald-500' : 'bg-muted-foreground'}`}></span>
                                            <span className="text-[10px] font-bold text-foreground">{inst.fleetRole || inst.role}</span>
                                            <span className="text-[8px] font-mono text-muted-foreground">({inst.iteration})</span>
                                          </div>
                                          <div className="text-[9px] text-muted-foreground font-medium leading-none pl-3 font-mono">
                                            Model: {inst.model || 'default'}
                                          </div>
                                        </div>
                                      ))}
                                      {(!selectedFleetDetail.instances || selectedFleetDetail.instances.length === 0) && (
                                        <span className="text-[10px] text-muted-foreground font-medium">No agents running in this fleet.</span>
                                      )}
                                    </div>
                                  </div>
                                )}

                                <div className="text-[10px] font-extrabold text-muted-foreground uppercase tracking-widest block pb-1 border-b border-border">Task Backlog ({fleetTasks.length})</div>
                                {fleetTasks.length === 0 ? (
                                  <div className="p-4 text-center text-muted-foreground text-xs border border-border rounded-lg">No tasks created yet in this backlog.</div>
                                ) : (
                                  <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                                    {fleetTasks.map((tsk: any) => (
                                      <div key={tsk._id} className="p-2.5 bg-secondary/40 border border-border rounded-lg text-left space-y-1 hover:border-muted-foreground/40 transition-all">
                                        <div className="flex items-center justify-between">
                                          <span className="text-[10px] font-bold text-muted-foreground">{tsk.identifier}</span>
                                          <Badge
                                            variant={
                                              tsk.status === 'done' ? 'success' :
                                              tsk.status === 'in_progress' ? 'info' :
                                              tsk.status === 'blocked' ? 'error' : 'neutral'
                                            }
                                            className="text-[8px] px-1.5 py-0.5 uppercase"
                                          >
                                            {tsk.status}
                                          </Badge>
                                        </div>
                                        <p className="font-semibold text-xs text-foreground leading-snug line-clamp-1">{tsk.title}</p>
                                        <p className="text-[10px] text-muted-foreground line-clamp-2 mt-0.5">{tsk.description}</p>

                                        {/* Task Logs/Comments drilldown button */}
                                        <button
                                          onClick={() => handleInspectTask(tsk._id)}
                                          className="mt-1.5 flex items-center gap-1 text-[9px] font-extrabold uppercase text-purple-500 hover:text-purple-400 font-sans tracking-wide"
                                        >
                                          <MessageSquare size={10} /> Inspect Chat Logs
                                        </button>

                                        {selectedTaskId === tsk._id && (
                                          <div className="mt-2 pt-2 border-t border-border space-y-1.5 max-h-[150px] overflow-y-auto">
                                            {commentsLoading ? (
                                              <span className="text-[9px] text-muted-foreground flex items-center gap-1"><RefreshCw size={8} className="animate-spin" /> Fetching comments...</span>
                                            ) : (
                                              taskComments.map((c: any, cIdx) => (
                                                <div key={cIdx} className="bg-background border border-border p-1.5 rounded text-[10px]">
                                                  <div className="flex justify-between font-bold text-[8px] text-purple-500">
                                                    <span>{c.authorRole || 'User'}</span>
                                                    <span className="text-muted-foreground font-normal">{new Date(c.createdAt).toLocaleTimeString()}</span>
                                                  </div>
                                                  <p className="text-foreground leading-snug mt-0.5 font-sans whitespace-pre-wrap">{c.content}</p>
                                                </div>
                                              ))
                                            )}
                                            {taskComments.length === 0 && !commentsLoading && (
                                              <span className="text-[8px] text-muted-foreground block">No activity logs recorded inside this issue thread.</span>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </Card>
                  </div>
                )}

              </div>
            )}

            {/* LOGS TAB */}
            {activeTab === 'logs' && (
              <div className="border border-border rounded-xl bg-card p-5 h-[650px] flex flex-col shadow-sm">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-sm font-bold text-muted-foreground flex items-center gap-2">
                    <Server size={16} className="text-green-500" /> Container Server Logs (miner-api)
                  </h3>
                  <button onClick={loadServerLogs} className="text-muted-foreground hover:text-foreground transition-colors bg-secondary p-1.5 border border-border rounded-lg">
                    <RotateCcw size={14}/>
                  </button>
                </div>
                <WindowFrame className="flex-1 flex flex-col min-h-0">
                  <div className="flex-1 min-h-0 overflow-y-auto p-5 font-mono text-xs text-green-400 whitespace-pre-wrap leading-relaxed">
                    {logs || "Retrieving live container outputs..."}
                  </div>
                </WindowFrame>
              </div>
            )}

          </div>
        </div>
      </main>
    </div>
  );
};

export default Admin;
