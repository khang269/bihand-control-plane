import React, { useEffect, useState, useMemo } from 'react';
import api from '../lib/api';
import { 
  Plus, Search, X, Circle, CheckCircle2, Clock, AlertCircle, PlayCircle, 
  Network, ArrowUpRight, Hourglass, Layers, RefreshCw, Sparkles, Send,
  Cpu, Coffee, Activity
} from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { Avatar } from './Avatar';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import OrgChartFlow from './OrgChartFlow';
import { cn } from '../lib/cn';
import { Button, Badge, Input, Textarea, Select } from './ui';

interface Task {
  _id: string;
  identifier?: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  assigneeId?: string;
  goalId?: string;
  parentTaskId?: string;
  result?: string;
  blockedByIds?: string[];
  createdAt: string;
  apiCreditsUsed?: number;
}

interface Instance {
  id: string;
  role: string;
  alias?: string;
  status: string;
  reportsTo?: string | null;
}

const getAgentZone = (role: string) => {
  const r = (role || "").toLowerCase();
  if (r.includes('ceo') || r.includes('founder') || r.includes('exec') || r.includes('director') || r.includes('chief')) {
    return 'executive';
  } else if (r.includes('engineer') || r.includes('dev') || r.includes('code') || r.includes('tech') || r.includes('qa') || r.includes('program')) {
    return 'engineering';
  } else if (r.includes('market') || r.includes('design') || r.includes('sales') || r.includes('grow') || r.includes('social') || r.includes('art')) {
    return 'creative';
  } else {
    return 'support';
  }
};

interface TasksViewProps {
  fleetId: string;
  compact?: boolean;
}

const TasksView: React.FC<TasksViewProps> = ({ fleetId, compact = false }) => {
  const { language } = useLanguage();
  const { user } = useAuth();
  const { issueId } = useParams<{ issueId?: string }>();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [goals, setGoals] = useState<any[]>([]);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [fleetDetails, setFleetDetails] = useState<any>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAgentId, setSelectedSkillAgentId] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<'all' | 'todo' | 'active' | 'review' | 'blocked'>('all');
  const [isSimulating, setIsSimulating] = useState(true);
  const [simulationLogs, setSimulationLogs] = useState<string[]>([]);
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);

  const handleBulkArchive = async () => {
    if (!window.confirm(language === 'vi' ? `Bạn có chắc muốn lưu trữ ${selectedTaskIds.length} sự cố đã chọn?` : `Are you sure you want to archive the ${selectedTaskIds.length} selected tasks?`)) return;
    try {
      await api.post(`/fleets/${fleetId}/tasks/archive`, { taskIds: selectedTaskIds });
      setSelectedTaskIds([]);
      fetchTasks();
    } catch (e: any) {
      alert(e.response?.data?.detail || "Failed to archive tasks");
    }
  };

  // Form states for creating a new issue
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assigneeId, setAssigneeId] = useState<string>('');
  const [goalId, setGoalId] = useState<string>('');
  const [parentTaskId, setParentTaskId] = useState<string>('');
  const [priority, setPriority] = useState<string>('none');
  const [status, setStatus] = useState<string>('todo');

  const fetchTasks = async () => {
    try {
      const res = await api.get(`/fleets/${fleetId}/tasks`);
      setTasks(res.data.tasks || []);
    } catch (e) {
      console.error('Failed to fetch tasks', e);
    }
  };

  const fetchInstances = async () => {
    try {
      const res = await api.get(`/fleets/${fleetId}`);
      setFleetDetails(res.data);
      setInstances(res.data.instances || []);
    } catch (e) {
      console.error('Failed to fetch instances', e);
    }
  };

  const fetchGoals = async () => {
    try {
      const res = await api.get(`/fleets/${fleetId}/goals`);
      setGoals(res.data.goals || []);
    } catch (e) {
      console.error('Failed to fetch goals', e);
    }
  };

  useEffect(() => {
    fetchTasks();
    fetchInstances();
    fetchGoals();
    const interval = setInterval(() => {
      fetchTasks();
      fetchInstances();
    }, 5000);
    return () => clearInterval(interval);
  }, [fleetId, issueId]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title) return;
    try {
      await api.post(`/fleets/${fleetId}/tasks`, { 
        title, 
        description,
        assigneeId: assigneeId === '' ? null : assigneeId,
        goalId: goalId === '' ? null : goalId,
        parentTaskId: parentTaskId === '' ? null : parentTaskId,
        priority,
        status
      });
      setTitle('');
      setDescription('');
      setAssigneeId('');
      setGoalId('');
      setParentTaskId('');
      setPriority('none');
      setStatus('todo');
      setIsModalOpen(false);
      fetchTasks();
    } catch (e) {
      console.error('Failed to create task', e);
    }
  };

  const getStatusIcon = (status: string, result?: string) => {
    switch (status) {
      case 'done': return <CheckCircle2 size={16} className="text-emerald-400" />;
      case 'in_progress': return <PlayCircle size={16} className="text-blue-400 animate-pulse" />;
      case 'in_review': return <Clock size={16} className="text-purple-400" />;
      case 'blocked': return <AlertCircle size={16} className={result?.startsWith('Waiting for delegated subtask') ? 'text-amber-400' : 'text-red-400'} />;
      case 'failed': return <AlertCircle size={16} className="text-red-500" />;
      default: return <Circle size={16} className="text-muted-foreground" />;
    }
  };

  const getTimeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    if (hours < 1) return 'just now';
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  const agentActivityMap = useMemo(() => {
    const map: Record<string, { activeTask: Task | null; status: 'idle' | 'busy' | 'waiting' | 'reviewing'; taskCount: number; message: string }> = {};
    
    instances.forEach(inst => {
      map[inst.id] = { activeTask: null, status: 'idle', taskCount: 0, message: "Awaiting instructions..." };
    });

    tasks.forEach(task => {
      if (task.assigneeId && map[task.assigneeId]) {
        map[task.assigneeId].taskCount += 1;
        
        if (task.status === 'in_progress') {
          map[task.assigneeId].activeTask = task;
          map[task.assigneeId].status = 'busy';
          map[task.assigneeId].message = `💻 Executing and writing workspace code...`;
        } else if (task.status === 'blocked') {
          if (map[task.assigneeId].status !== 'busy') {
            map[task.assigneeId].activeTask = task;
            map[task.assigneeId].status = 'waiting';
            const cleanResult = (task.result || "").replace("Waiting for delegated subtask(s):", "").trim();
            map[task.assigneeId].message = `⏳ Blocked: waiting on ${cleanResult || "subtasks"}...`;
          }
        } else if (task.status === 'failed') {
          if (map[task.assigneeId].status !== 'busy') {
            map[task.assigneeId].activeTask = task;
            map[task.assigneeId].status = 'waiting';
            map[task.assigneeId].message = `🛑 Failed: process exited on early exception.`;
          }
        } else if (task.status === 'in_review') {
          if (map[task.assigneeId].status !== 'busy' && map[task.assigneeId].status !== 'waiting') {
            map[task.assigneeId].activeTask = task;
            map[task.assigneeId].status = 'reviewing';
            map[task.assigneeId].message = `🚩 Completed. Awaiting human confirmation...`;
          }
        } else if (task.status === 'todo') {
          if (!map[task.assigneeId].activeTask) {
            map[task.assigneeId].activeTask = task;
            map[task.assigneeId].message = `📝 Spawning VM sandbox and loading tickets...`;
          }
        }
      }
    });

    return map;
  }, [tasks, instances]);

  // Setup simulated office events
  useEffect(() => {
    if (!isSimulating) return;

    // Prefill some introductory log lines
    const initLogs = [
      `[${new Date().toLocaleTimeString()}] 🏢 M2M Co-working mesh network online.`,
      `[${new Date().toLocaleTimeString()}] 📡 Scanning local workspace repositories... 100% active.`,
      `[${new Date().toLocaleTimeString()}] 🛡️ Security proxies and GKE ingress channels stable.`
    ];
    setSimulationLogs(initLogs);

    const logTimer = setInterval(() => {
      if (instances.length === 0) return;

      const inst = instances[Math.floor(Math.random() * instances.length)];
      const act = agentActivityMap[inst.id] || { status: 'idle', activeTask: null };
      const time = new Date().toLocaleTimeString();

      let newLog = '';
      if (act.status === 'busy') {
        const busyQuotes = [
          "is clacking away writing clean, resilient backend integration code...",
          "initiated recursive code scans inside their sandboxed workspace VM.",
          "is pulling model parameters and refining Prompt templates.",
          "just optimized an API request to bypass latency delays."
        ];
        newLog = `[${time}] 💻 ${inst.role}: ${busyQuotes[Math.floor(Math.random() * busyQuotes.length)]}`;
      } else if (act.status === 'waiting') {
        newLog = `[${time}] ⏳ ${inst.role} is holding: waiting on sibling delegated blockers to resolve.`;
      } else if (act.status === 'reviewing') {
        newLog = `[${time}] 🚩 ${inst.role}: submitted deliverables for manager approval audit.`;
      } else {
        const idleQuotes = [
          "is brewing a cup of hot espresso at the virtual breakroom ☕",
          "is syncing workspace archives and checking the fleet org chart.",
          "is resting CPU cores. Temp is stable at 36°C (Optimal).",
          "is reviewing fleet mission guidelines and checking task queues."
        ];
        newLog = `[${time}] 💤 ${inst.role}: ${idleQuotes[Math.floor(Math.random() * idleQuotes.length)]}`;
      }

      setSimulationLogs(prev => [newLog, ...prev.slice(0, 20)]);
    }, 6000);

    return () => clearInterval(logTimer);
  }, [instances, agentActivityMap, isSimulating]);

  const delegationPipelines = useMemo(() => {
    const flows: Array<{
      id: string;
      sourceId: string;
      sourceRole: string;
      targetId: string;
      targetRole: string;
      taskTitle: string;
      status: string;
    }> = [];

    tasks.forEach(t => {
      if (t.parentTaskId && t.assigneeId) {
        const parent = tasks.find(pt => pt._id === t.parentTaskId);
        if (parent && parent.assigneeId) {
          const sourceAgent = instances.find(i => i.id === t.assigneeId);
          const targetAgent = instances.find(i => i.id === parent.assigneeId);
          if (sourceAgent && targetAgent) {
            flows.push({
              id: t._id,
              sourceId: t.assigneeId,
              sourceRole: sourceAgent.role,
              targetId: parent.assigneeId,
              targetRole: targetAgent.role,
              taskTitle: t.title,
              status: t.status
            });
          }
        }
      }
    });

    return flows;
  }, [tasks, instances]);

  const processedTasks = useMemo(() => {
    let result = tasks;

    if (selectedAgentId) {
      result = result.filter(t => t.assigneeId === selectedAgentId);
    }

    if (searchQuery) {
      result = result.filter(t => 
        t.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
        (t.identifier && t.identifier.toLowerCase().includes(searchQuery.toLowerCase()))
      );
    }

    switch (activeCategory) {
      case 'todo':
        return result.filter(t => t.status === 'todo');
      case 'active':
        return result.filter(t => t.status === 'in_progress');
      case 'review':
        return result.filter(t => t.status === 'in_review');
      case 'blocked':
        return result.filter(t => t.status === 'blocked' || t.status === 'failed');
      default:
        return result;
    }
  }, [tasks, selectedAgentId, searchQuery, activeCategory]);

  return (
    <div className="space-y-8">
      {/* Dynamic Keyframe Animations for Gamified HUD */}
      <style>{`
        @keyframes office-dash {
          to {
            stroke-dashoffset: -40;
          }
        }
        @keyframes sonar-pulse {
          0% { transform: scale(0.9); opacity: 0.8; }
          100% { transform: scale(1.6); opacity: 0; }
        }
        @keyframes grid-pulse {
          0%, 100% { opacity: 0.15; }
          50% { opacity: 0.35; }
        }
      `}</style>
      
      {/* ===================== SIMULATOR OFFICE BOARD ===================== */}
      {!compact && (
        <>
          <div className="border border-border rounded-xl bg-card shadow-2xl relative overflow-hidden">
        {/* Glow ambient panels */}
        <div className="absolute top-0 right-0 w-[450px] h-[450px] bg-blue-500/5 rounded-full blur-[140px] pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-[450px] h-[450px] bg-purple-500/5 rounded-full blur-[140px] pointer-events-none" />

        {/* Simulator Control Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border p-6 bg-secondary/40 backdrop-blur-md">
          <div className="flex items-start gap-3">
            <div className="bg-blue-500/10 border border-blue-500/20 p-2.5 rounded-xl text-blue-400">
              <Network size={20} className="animate-spin-slow" />
            </div>
            <div>
              <div className="flex items-center gap-2 text-left">
                <h3 className="text-sm font-semibold tracking-wider text-foreground uppercase font-mono">
                  {language === 'vi' ? 'Hệ thống mô phỏng văn phòng làm việc Bihand AI' : 'Bihand AI Co-Working Office Simulator'}
                </h3>
                <span className="text-[10px] bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded-full border border-emerald-500/20 font-sans font-bold flex items-center gap-1 animate-pulse shrink-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  {language === 'vi' ? 'BẢN MÔ PHỎNG TRỰC TIẾP' : 'SIMULATOR LIVE'}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5 text-left">
                {language === 'vi'
                  ? 'Giám sát giao thức kết nối M2M thời gian thực, chuỗi quy trình trực quan và trạng thái xử lý của nhân viên AI.'
                  : 'Observe real-time M2M handshakes, visual workflow chains, and agent processing states.'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 self-end sm:self-center">
            {selectedAgentId && (
              <button
                onClick={() => setSelectedSkillAgentId(null)}
                className="text-xs bg-secondary border border-border text-muted-foreground px-3 py-1.5 rounded-lg hover:border-muted-foreground/40 hover:text-foreground transition-all font-mono"
              >
                {language === 'vi' ? 'Xóa Lọc ✕' : 'Reset Filter ✕'}
              </button>
            )}
            <button
              onClick={() => setIsSimulating(!isSimulating)}
              className={`text-xs px-3 py-1.5 rounded-lg font-mono font-bold border transition-all flex items-center gap-1.5 ${
                isSimulating
                  ? 'bg-blue-500/10 text-blue-400 border-blue-500/20 hover:bg-blue-500/20'
                  : 'bg-secondary text-muted-foreground border-border hover:bg-muted hover:text-foreground'
              }`}
            >
              <RefreshCw size={12} className={isSimulating ? "animate-spin" : ""} />
              {isSimulating
                ? (language === 'vi' ? 'Tạm dừng luồng' : 'Pause Feed')
                : (language === 'vi' ? 'Tiếp tục luồng' : 'Resume Feed')}
            </button>
          </div>
        </div>

        {/* Dynamic Co-Working Interactive Space */}
        <div className="p-6 grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-6">

          {/* Real Fleet Graph (Unified structure map) */}
          <div className="space-y-4 flex flex-col h-[580px]">
            <div className="flex items-center justify-between flex-shrink-0">
              <div className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground font-mono">
                {language === 'vi' ? 'Sơ đồ Sơ đồ Tổ chức Thực tế' : 'Actual Fleet Org Chart'}
              </div>
              <div className="text-[9px] text-muted-foreground/70 font-mono">
                {language === 'vi' ? 'Nhấp vào nút nhân viên AI để lọc danh sách sự cố' : 'Click agent node to filter issues list'}
              </div>
            </div>

            {/* Real Org Chart Container */}
            <div className="relative w-full h-full min-h-[480px] bg-background border border-border rounded-2xl overflow-hidden shadow-inner flex-1">
              {fleetDetails && (
                <OrgChartFlow 
                  fleetDetails={fleetDetails} 
                  ownerName={user?.name || "Human Manager"} 
                  onNodeClick={(nodeId: string) => setSelectedSkillAgentId(selectedAgentId === nodeId ? null : nodeId)} 
                  agentActivity={agentActivityMap}
                  activePipelines={delegationPipelines}
                />
              )}
            </div>
            <div className="hidden">
            {/* The Blueprint Map Body */}
            <div className="relative w-full min-h-[580px] grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-[#050507] border border-[#1b1b1f] rounded-2xl overflow-hidden shadow-inner">
              {/* Grid blueprint pattern */}
              <div className="absolute inset-0 bg-[linear-gradient(to_right,#141416_1px,transparent_1px),linear-gradient(to_bottom,#141416_1px,transparent_1px)] bg-[size:30px_30px] opacity-40 pointer-events-none" />

              {/* Dynamic SVG Holographic Beams Layer */}
              <svg className="absolute inset-0 w-full h-full pointer-events-none z-10" viewBox="0 0 1000 1000" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="neon-blue-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.8" />
                    <stop offset="50%" stopColor="#60a5fa" stopOpacity="1" />
                    <stop offset="100%" stopColor="#2563eb" stopOpacity="0.8" />
                  </linearGradient>
                  <linearGradient id="neon-purple-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.8" />
                    <stop offset="100%" stopColor="#d946ef" stopOpacity="0.8" />
                  </linearGradient>
                  <linearGradient id="neon-emerald-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#10b981" stopOpacity="0.8" />
                    <stop offset="100%" stopColor="#059669" stopOpacity="0.8" />
                  </linearGradient>
                  <filter id="neon-glow" x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur stdDeviation="4" result="blur" />
                    <feMerge>
                      <feMergeNode in="blur" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                </defs>

                {delegationPipelines.map(flow => {
                  const sourceZone = getAgentZone(flow.sourceRole);
                  const targetZone = getAgentZone(flow.targetRole);
                  
                  const zoneCoords: Record<string, { x: number; y: number }> = {
                    executive: { x: 250, y: 250 },
                    engineering: { x: 750, y: 250 },
                    support: { x: 250, y: 750 },
                    creative: { x: 750, y: 750 }
                  };
                  
                  const p1 = zoneCoords[targetZone] || { x: 250, y: 250 };
                  const p2 = zoneCoords[sourceZone] || { x: 750, y: 250 };
                  const isDone = flow.status === 'done';
                  const strokeGradient = isDone ? 'url(#neon-emerald-gradient)' : 'url(#neon-blue-gradient)';
                  
                  // Helper curves for horizontal, vertical or diagonal flows
                  const dx = p2.x - p1.x;
                  const dy = p2.y - p1.y;
                  let pathD = `M ${p1.x} ${p1.y} C ${p1.x + dx * 0.4} ${p1.y}, ${p1.x + dx * 0.6} ${p2.y}, ${p2.x} ${p2.y}`;
                  if (Math.abs(dy) < 10) {
                    pathD = `M ${p1.x} ${p1.y} Q ${(p1.x + p2.x) / 2} ${p1.y + 40}, ${p2.x} ${p2.y}`;
                  } else if (Math.abs(dx) < 10) {
                    pathD = `M ${p1.x} ${p1.y} Q ${p1.x + 40} ${(p1.y + p2.y) / 2}, ${p2.x} ${p2.y}`;
                  }

                  return (
                    <g key={flow.id}>
                      {/* Laser shadow glow */}
                      <path
                        d={pathD}
                        stroke={isDone ? '#10b981' : '#3b82f6'}
                        strokeWidth="5"
                        strokeOpacity="0.12"
                        fill="none"
                        filter="url(#neon-glow)"
                      />
                      {/* Core glowing line */}
                      <path
                        d={pathD}
                        stroke={strokeGradient}
                        strokeWidth="2.5"
                        fill="none"
                        strokeLinecap="round"
                        style={{
                          strokeDasharray: isDone ? 'none' : '10, 15',
                          animation: isDone ? 'none' : 'office-dash 2s linear infinite'
                        }}
                      />
                      {/* Pulse flow packet */}
                      {!isDone && (
                        <circle r="4.5" fill="#60a5fa" filter="url(#neon-glow)">
                          <animateMotion
                            dur="2.5s"
                            repeatCount="indefinite"
                            path={pathD}
                          />
                        </circle>
                      )}
                    </g>
                  );
                })}
              </svg>

              {/* Room 1: Executive Suite */}
              <div className="border border-[#8b5cf6]/10 bg-[#0c0a12]/60 rounded-xl p-4 flex flex-col relative overflow-hidden group/room min-h-[260px] z-20">
                <div className="absolute top-0 right-0 w-24 h-24 bg-[#8b5cf6]/5 rounded-full blur-2xl pointer-events-none" />
                <div className="flex items-center justify-between border-b border-[#8b5cf6]/10 pb-2 mb-3">
                  <div className="flex items-center gap-1.5 text-xs font-bold font-mono text-purple-400">
                    <span>{language === 'vi' ? '🏛️ PHÒNG HỘI NGHỊ BAN GIÁM ĐỐC' : '🏛️ EXECUTIVE BOARDROOM'}</span>
                  </div>
                  <span className="text-[9px] text-[#52525b] font-mono uppercase tracking-wider">Suite 1A</span>
                </div>
                <div className="flex-1 grid grid-cols-1 gap-3 content-start">
                  {instances.filter(inst => getAgentZone(inst.role) === 'executive').map(inst => (
                    <DeskItem
                      key={inst.id}
                      inst={inst}
                      act={agentActivityMap[inst.id] || { activeTask: null, status: 'idle', taskCount: 0, message: "Awaiting instructions..." }}
                      isSelected={selectedAgentId === inst.id}
                      onClick={() => setSelectedSkillAgentId(selectedAgentId === inst.id ? null : inst.id)}
                    />
                  ))}
                  {instances.filter(inst => getAgentZone(inst.role) === 'executive').length === 0 && (
                    <div className="h-full flex items-center justify-center text-center p-4">
                      <p className="text-[10px] text-[#52525b] italic">
                        {language === 'vi' ? 'Bàn giám đốc đang trống' : 'Executive Desk Vacant'}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Room 2: Engineering Lab */}
              <div className="border border-[#3b82f6]/10 bg-[#0a0c12]/60 rounded-xl p-4 flex flex-col relative overflow-hidden group/room min-h-[260px] z-20">
                <div className="absolute top-0 right-0 w-24 h-24 bg-[#3b82f6]/5 rounded-full blur-2xl pointer-events-none" />
                <div className="flex items-center justify-between border-b border-[#3b82f6]/10 pb-2 mb-3">
                  <div className="flex items-center gap-1.5 text-xs font-bold font-mono text-blue-400">
                    <span>{language === 'vi' ? '💻 PHÒNG LẬP TRÌNH PHẦN MỀM' : '💻 SOFTWARE ENGINEERING CORE'}</span>
                  </div>
                  <span className="text-[9px] text-[#52525b] font-mono uppercase tracking-wider">Suite 1B</span>
                </div>
                <div className="flex-1 grid grid-cols-1 gap-3 content-start">
                  {instances.filter(inst => getAgentZone(inst.role) === 'engineering').map(inst => (
                    <DeskItem
                      key={inst.id}
                      inst={inst}
                      act={agentActivityMap[inst.id] || { activeTask: null, status: 'idle', taskCount: 0, message: "Awaiting instructions..." }}
                      isSelected={selectedAgentId === inst.id}
                      onClick={() => setSelectedSkillAgentId(selectedAgentId === inst.id ? null : inst.id)}
                    />
                  ))}
                  {instances.filter(inst => getAgentZone(inst.role) === 'engineering').length === 0 && (
                    <div className="h-full flex items-center justify-center text-center p-4">
                      <p className="text-[10px] text-[#52525b] italic">
                        {language === 'vi' ? 'Bàn lập trình viên đang trống' : 'Engineering Desks Vacant'}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Room 3: Support & Operations Lounge */}
              <div className="border border-[#10b981]/10 bg-[#0a120e]/60 rounded-xl p-4 flex flex-col relative overflow-hidden group/room min-h-[260px] z-20">
                <div className="absolute top-0 right-0 w-24 h-24 bg-[#10b981]/5 rounded-full blur-2xl pointer-events-none" />
                <div className="flex items-center justify-between border-b border-[#10b981]/10 pb-2 mb-3">
                  <div className="flex items-center gap-1.5 text-xs font-bold font-mono text-emerald-400">
                    <span>{language === 'vi' ? '📡 PHÒNG VẬN HÀNH & HỖ TRỢ' : '📡 SUPPORT & OPERATIONS Lounge'}</span>
                  </div>
                  <span className="text-[9px] text-[#52525b] font-mono uppercase tracking-wider">Suite 2A</span>
                </div>
                <div className="flex-1 grid grid-cols-1 gap-3 content-start">
                  {instances.filter(inst => getAgentZone(inst.role) === 'support').map(inst => (
                    <DeskItem
                      key={inst.id}
                      inst={inst}
                      act={agentActivityMap[inst.id] || { activeTask: null, status: 'idle', taskCount: 0, message: "Awaiting instructions..." }}
                      isSelected={selectedAgentId === inst.id}
                      onClick={() => setSelectedSkillAgentId(selectedAgentId === inst.id ? null : inst.id)}
                    />
                  ))}
                  {instances.filter(inst => getAgentZone(inst.role) === 'support').length === 0 && (
                    <div className="h-full flex items-center justify-center text-center p-4">
                      <p className="text-[10px] text-[#52525b] italic">
                        {language === 'vi' ? 'Bàn vận hành đang trống' : 'Operations Desks Vacant'}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Room 4: Creative Studio */}
              <div className="border border-[#ec4899]/10 bg-[#120a11]/60 rounded-xl p-4 flex flex-col relative overflow-hidden group/room min-h-[260px] z-20">
                <div className="absolute top-0 right-0 w-24 h-24 bg-[#ec4899]/5 rounded-full blur-2xl pointer-events-none" />
                <div className="flex items-center justify-between border-b border-[#ec4899]/10 pb-2 mb-3">
                  <div className="flex items-center gap-1.5 text-xs font-bold font-mono text-pink-400">
                    <span>{language === 'vi' ? '🎨 PHÒNG SÁNG TẠO & TRUYỀN THÔNG' : '🎨 CREATIVE & SOCIAL STUDIO'}</span>
                  </div>
                  <span className="text-[9px] text-[#52525b] font-mono uppercase tracking-wider">Suite 2B</span>
                </div>
                <div className="flex-1 grid grid-cols-1 gap-3 content-start">
                  {instances.filter(inst => getAgentZone(inst.role) === 'creative').map(inst => (
                    <DeskItem
                      key={inst.id}
                      inst={inst}
                      act={agentActivityMap[inst.id] || { activeTask: null, status: 'idle', taskCount: 0, message: "Awaiting instructions..." }}
                      isSelected={selectedAgentId === inst.id}
                      onClick={() => setSelectedSkillAgentId(selectedAgentId === inst.id ? null : inst.id)}
                    />
                  ))}
                  {instances.filter(inst => getAgentZone(inst.role) === 'creative').length === 0 && (
                    <div className="h-full flex items-center justify-center text-center p-4">
                      <p className="text-[10px] text-[#52525b] italic">
                        {language === 'vi' ? 'Bàn marketing đang trống' : 'Marketing Desks Vacant'}
                      </p>
                    </div>
                  )}
                </div>
              </div>

            </div>
          </div>
          </div>

          {/* Real-time M2M Pipelines & handshakes tracker */}
          <div className="border border-border bg-card/80 rounded-xl p-4 flex flex-col justify-between max-h-[640px] overflow-hidden">
            <div className="space-y-4 flex flex-col h-full overflow-hidden">
              <div className="flex items-center gap-1.5 text-[10px] uppercase font-bold tracking-wider text-muted-foreground font-mono border-b border-border pb-2 text-left">
                <Layers size={12} className="text-purple-400" />
                <span>{language === 'vi' ? 'Bảng thống kê kết nối M2M' : 'M2M Diagnostics Dashboard'}</span>
              </div>

              {/* Simulated KPI Grid for Gamification */}
              <div className="grid grid-cols-2 gap-2 text-[10px] font-mono bg-muted/50 border border-border rounded-lg p-2.5 text-left">
                <div className="border-r border-border pr-2">
                  <span className="text-muted-foreground block">{language === 'vi' ? 'NHÂN VIÊN HOẠT ĐỘNG' : 'ACTIVE STAFF'}</span>
                  <span className="text-foreground font-bold flex items-center gap-1">
                    <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-ping" />
                    {instances.filter(i => i.status === 'running').length} / {instances.length} {language === 'vi' ? 'Đang chạy' : 'Online'}
                  </span>
                </div>
                <div className="pl-2">
                  <span className="text-muted-foreground block">{language === 'vi' ? 'ĐỘ TRỄ ĐỒNG BỘ' : 'SYNC LATENCY'}</span>
                  <span className="text-blue-400 font-bold">480ms (M2M)</span>
                </div>
                <div className="border-t border-border pt-2 border-r pr-2 mt-1">
                  <span className="text-muted-foreground block">{language === 'vi' ? 'TẢI HỆ THỐNG M2M' : 'M2M STACK LOAD'}</span>
                  <span className="text-purple-400 font-bold">{tasks.filter(t => t.status === 'in_progress').length * 25 + 10}% {language === 'vi' ? 'tải' : 'load'}</span>
                </div>
                <div className="border-t border-border pt-2 pl-2 mt-1">
                  <span className="text-muted-foreground block">{language === 'vi' ? 'MỨC ĐỘ CÀ PHÊ' : 'COFFEE LEVEL'}</span>
                  <span className="text-orange-400 font-bold">85% ({language === 'vi' ? 'Tối ưu' : 'Optimal'})</span>
                </div>
              </div>

              {/* Handshakes Flows List */}
              <div className="flex-1 overflow-y-auto scrollbar-thin space-y-3 pr-0.5">
                <div className="flex items-center gap-1 text-[9px] text-muted-foreground/70 font-mono uppercase">
                  <span>{language === 'vi' ? 'Kênh Khóa Hoạt động' : 'Active Blocker Channels'}</span>
                  <span className="h-[1px] flex-1 bg-border" />
                </div>

                {delegationPipelines.length === 0 ? (
                  <div className="py-6 flex flex-col items-center justify-center text-center text-muted-foreground/70">
                    <Network size={20} className="text-border mb-1.5" />
                    <p className="text-[10px] italic leading-relaxed">
                      {language === 'vi' ? 'Không có luồng cộng tác M2M nào đang hoạt động.' : 'No active M2M collaboration pipelines.'}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {delegationPipelines.map(flow => (
                      <div key={flow.id} className="bg-muted/40 border border-border rounded-lg p-2.5 space-y-1.5 relative overflow-hidden group">
                        {/* Flow glow bar */}
                        <div className={`absolute top-0 bottom-0 left-0 w-[2.5px] ${
                          flow.status === 'done' ? 'bg-emerald-500' : 'bg-blue-500 animate-pulse'
                        }`} />

                        <div className="flex items-center justify-between gap-1 text-[8px] font-mono text-muted-foreground/70">
                          <span>FLOW-{flow.id.substring(0,4).toUpperCase()}</span>
                          <span className={`uppercase font-bold ${
                            flow.status === 'done' ? 'text-emerald-500' : 'text-blue-500'
                          }`}>{flow.status}</span>
                        </div>

                        {/* Delegation Connection text */}
                        <div className="text-[11px] flex items-center justify-between gap-2 text-foreground">
                          <span className="font-bold font-mono text-muted-foreground">{flow.targetRole.split(' ')[0]}</span>
                          <div className="flex-1 border-b border-dashed border-border h-1 flex items-center justify-center relative">
                            <span className={`w-1 h-1 rounded-full bg-blue-400 absolute ${
                              flow.status === 'done' ? 'right-0' : 'animate-ping'
                            }`} />
                          </div>
                          <span className="font-bold font-mono text-blue-400">{flow.sourceRole.split(' ')[0]}</span>
                        </div>

                        <p className="text-[10px] text-muted-foreground font-medium leading-relaxed truncate">
                          {language === 'vi' ? 'Nhiệm vụ:' : 'Task:'} "{flow.taskTitle}"
                        </p>
                      </div>
                    ))}
                  </div>
                )}

                {/* Simulated Log Terminal Feed */}
                <div className="flex items-center gap-1 text-[9px] text-muted-foreground/70 font-mono uppercase pt-2">
                  <span>{language === 'vi' ? 'Nhật ký Âm thanh Văn phòng' : 'Live Office Audio Log'}</span>
                  <span className="h-[1px] flex-1 bg-border" />
                </div>
                <div className="bg-muted/60 border border-border rounded-lg p-2.5 font-mono text-[9px] leading-relaxed text-muted-foreground h-[130px] overflow-y-auto scrollbar-thin space-y-1.5">
                  {simulationLogs.map((log, i) => (
                    <div key={i} className="truncate select-none hover:text-foreground transition-colors">
                      {log}
                    </div>
                  ))}
                  {simulationLogs.length === 0 && (
                    <div className="text-center italic py-8 text-muted-foreground/70">
                      {language === 'vi' ? 'Đang tải nhật ký văn phòng...' : 'Loading audio logs...'}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Quick action guidelines */}
            <div className="bg-blue-500/5 border border-blue-500/10 p-2.5 rounded-lg text-[10px] leading-relaxed text-muted-foreground mt-3 shrink-0 text-left">
              <span className="font-bold text-foreground block mb-0.5">
                {language === 'vi' ? '🎮 Quy trình Gamified:' : '🎮 Gamified Flow:'}
              </span>
              {language === 'vi'
                ? 'Phân bổ nhiệm vụ gốc cho **CEO**. CEO sẽ tự động giao việc, hiển thị luồng tia laser neon và phát trực tuyến kết quả!'
                : 'Deploy parent tickets to the **CEO**. CEO auto-delegates, opening neon lasers and streaming workspace deliverables!'}
            </div>
          </div>

        </div>
      </div>

      {/* ===================== DIRECT ASSISTANT VOICE CHAT AND ISSUE PROMPTER ===================== */}
      <div className="border border-border rounded-xl bg-card p-6 shadow-2xl relative overflow-hidden text-left">
        <div className="absolute top-0 right-0 w-[200px] h-[200px] bg-emerald-500/5 rounded-full blur-[80px] pointer-events-none" />

        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="space-y-1">
            <h3 className="text-sm font-semibold tracking-wider text-foreground uppercase font-mono flex items-center gap-2">
              <Sparkles className="text-emerald-400" size={16} />
              {language === 'vi' ? 'Trình nhắc Lệnh Trực tiếp' : 'Instant Command Prompter'}
            </h3>
            <p className="text-xs text-muted-foreground">
              {language === 'vi'
                ? 'Nhập sứ mệnh, vấn đề trực tiếp hoặc mục tiêu phần mềm. Hạm đội AI sẽ tiếp nhận, phân chia và thực thi ngay lập tức.'
                : 'Type a mission, direct issue, or software goal. Your active fleet will triage, delegate, and begin execution instantly.'}
            </p>
          </div>

          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={() => setIsModalOpen(true)}
          >
            <Plus size={14} /> {language === 'vi' ? 'Mở Trình nhắc Chi tiết' : 'Open Full Form prompter'}
          </Button>
        </div>

        {/* Quick Command Box */}
        <div className="mt-5 relative border border-border rounded-xl bg-background/60 focus-within:border-emerald-500/40 focus-within:ring-1 focus-within:ring-emerald-500/20 transition-all p-2.5">
          <Textarea
            value={description}
            onChange={e => {
              setDescription(e.target.value);
              // Auto-fill title if empty
              if (!title && e.target.value) {
                const words = e.target.value.split(' ').slice(0, 5).join(' ');
                setTitle(words + (e.target.value.split(' ').length > 5 ? '...' : ''));
              }
            }}
            placeholder={language === 'vi' ? 'Nhập hướng dẫn của bạn... (ví dụ: "Xây dựng website portfolio cá nhân phản hồi đẹp mắt chạy trên cổng 8080 và báo cáo URL")' : 'Type your instruction... (e.g. \'Build a beautifully responsive static portfolio website on Port 8080 and report the URL\')'}
            className="w-full border-0 bg-transparent p-2.5 text-sm focus:outline-none focus:ring-0 resize-none h-20"
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (!title) {
                  const words = description.split(' ').slice(0, 5).join(' ');
                  setTitle(words + (description.split(' ').length > 5 ? '...' : ''));
                }
                const form = document.getElementById('instant-prompt-form') as HTMLFormElement;
                if (form) form.requestSubmit();
              }
            }}
          />
          <form id="instant-prompt-form" onSubmit={handleCreate} className="flex justify-between items-center border-t border-border pt-2.5 px-1 flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <Select
                value={assigneeId}
                onChange={e => setAssigneeId(e.target.value)}
                className="text-[11px] font-semibold px-2.5 py-1.5 w-auto"
              >
                <option value="">{language === 'vi' ? 'Giao tự động (CEO)' : 'Auto-Assign (CEO)'}</option>
                {instances.map(inst => (
                  <option key={inst.id} value={inst.id}>{inst.role}</option>
                ))}
              </Select>
              <Select
                value={priority}
                onChange={e => setPriority(e.target.value)}
                className="text-[11px] font-semibold px-2.5 py-1.5 w-auto"
              >
                <option value="none">{language === 'vi' ? 'Ưu tiên Tiêu chuẩn' : 'Standard Priority'}</option>
                <option value="low">{language === 'vi' ? 'Thấp' : 'Low'}</option>
                <option value="medium">{language === 'vi' ? 'Trung bình' : 'Medium'}</option>
                <option value="high">{language === 'vi' ? 'Cao' : 'High'}</option>
                <option value="critical">{language === 'vi' ? 'Khẩn cấp' : 'Critical'}</option>
              </Select>
            </div>

            <Button
              type="submit"
              size="sm"
              disabled={!description.trim()}
              className="bg-emerald-500 text-black hover:bg-emerald-400 disabled:hover:bg-emerald-500"
            >
              <Send size={12} /> {language === 'vi' ? 'Gửi Nhiệm vụ' : 'Dispatch Issue'}
            </Button>
          </form>
        </div>
      </div>
        </>
      )}

      {/* ===================== TASKS PIPELINE ===================== */}
      <div className="space-y-6">
        
        {/* Filter Toolbar / Category Tabs */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-card border border-border p-3 rounded-xl shadow-md">
          <div className="flex items-center gap-1 overflow-x-auto scrollbar-none">
            <button
              onClick={() => setActiveCategory('all')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                activeCategory === 'all'
                  ? 'bg-primary text-primary-foreground font-semibold'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
              }`}
            >
              {language === 'vi' ? 'Tất cả Sự cố' : 'All Issues'}
            </button>
            <button
              onClick={() => setActiveCategory('todo')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                activeCategory === 'todo'
                  ? 'bg-secondary text-foreground border border-border'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
              }`}
            >
              {language === 'vi' ? 'Cần làm' : 'To Do'}
            </button>
            <button
              onClick={() => setActiveCategory('active')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                activeCategory === 'active'
                  ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
              }`}
            >
              {language === 'vi' ? 'Đang thực hiện' : 'In Progress'}
            </button>
            <button
              onClick={() => setActiveCategory('review')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                activeCategory === 'review'
                  ? 'bg-purple-500/10 text-purple-400 border border-purple-500/20'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
              }`}
            >
              {language === 'vi' ? 'Chờ kiểm duyệt' : 'Awaiting Review'}
            </button>
            <button
              onClick={() => setActiveCategory('blocked')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                activeCategory === 'blocked'
                  ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
              }`}
            >
              {language === 'vi' ? 'Bị Khóa / Thất bại' : 'Blocked / Failed'}
            </button>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {selectedTaskIds.length > 0 && (
              <button
                type="button"
                onClick={handleBulkArchive}
                className="bg-destructive/10 border border-destructive/20 text-destructive hover:bg-destructive/20 px-3 py-1 rounded-lg font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                🗑️ {language === 'vi' ? `Lưu trữ (${selectedTaskIds.length})` : `Archive (${selectedTaskIds.length})`}
              </button>
            )}
            <Select
              value={selectedAgentId || ''}
              onChange={e => setSelectedSkillAgentId(e.target.value || null)}
              className="px-2.5 py-1 text-xs w-auto"
            >
              <option value="">{language === 'vi' ? 'Lọc theo Nhân sự...' : 'Filter by Agent...'}</option>
              {instances.map(inst => (
                <option key={inst.id} value={inst.id}>{inst.role}</option>
              ))}
            </Select>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <Input
                type="text"
                placeholder={language === 'vi' ? 'Tìm kiếm sự cố...' : 'Search issues...'}
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-48 pl-8 pr-3 py-1 text-xs"
              />
            </div>
            <Button
              onClick={() => setIsModalOpen(true)}
              size="sm"
            >
              <Plus size={14} /> {language === 'vi' ? 'Tạo mới' : 'Create'}
            </Button>
          </div>
        </div>

        {/* Task Cards Pipeline List */}
        <div className="space-y-3 text-left">
          {processedTasks.length === 0 ? (
            <div className="border border-dashed border-border rounded-xl py-12 text-center text-muted-foreground text-sm">
              {language === 'vi' ? 'Không có sự cố nào khớp với bộ lọc hiện tại.' : 'No issues match current filters.'}
            </div>
          ) : (
            processedTasks.map(task => {
              const assignee = instances.find(i => i.id === task.assigneeId);
              const parentTask = tasks.find(t => t._id === task.parentTaskId);
              const isUnarchivable = task.status === 'in_progress' || task.status === 'blocked';

              return (
                <div
                  key={task._id}
                  className="bg-card border border-border hover:border-muted-foreground/30 rounded-xl hover:bg-secondary/40 transition-all p-4 relative group overflow-hidden flex items-start gap-3"
                >
                  <input
                    type="checkbox"
                    checked={selectedTaskIds.includes(task._id)}
                    disabled={isUnarchivable}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedTaskIds([...selectedTaskIds, task._id]);
                      } else {
                        setSelectedTaskIds(selectedTaskIds.filter(id => id !== task._id));
                      }
                    }}
                    title={isUnarchivable ? (language === 'vi' ? "Không thể lưu trữ nhiệm vụ đang chạy hoặc bị khóa" : "Running/blocked tasks cannot be archived") : ""}
                    className="mt-1.5 rounded border-border bg-secondary text-blue-500 focus:ring-0 focus:ring-offset-0 disabled:opacity-30 disabled:cursor-not-allowed shrink-0 cursor-pointer"
                  />
                  <Link
                    to={`/fleet/${fleetId}/issues/${task._id}`}
                    className="flex-1 min-w-0"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">

                      {/* Main Ticket Info */}
                      <div className="flex items-start gap-3 min-w-0">
                        <span className="mt-0.5 shrink-0">{getStatusIcon(task.status, task.result)}</span>
                        <div className="space-y-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-mono font-bold text-purple-400 bg-purple-500/5 border border-purple-500/10 px-1.5 py-0.25 rounded">
                              {task.identifier}
                            </span>
                            <span className="text-xs text-muted-foreground/70 font-mono">
                              {getTimeAgo(task.createdAt)}
                            </span>
                            {parentTask && (
                              <span className="text-[10px] text-blue-400 bg-blue-500/5 px-2 py-0.5 rounded border border-blue-500/10 flex items-center gap-1 font-mono">
                                <Network size={10} />
                                Delegated subtask of {parentTask.identifier}
                              </span>
                            )}
                            {task.apiCreditsUsed !== undefined && (
                              <span className="text-[10px] text-emerald-400 bg-emerald-500/5 px-2 py-0.5 rounded border border-emerald-500/10 flex items-center gap-1 font-mono font-bold">
                                {(task.apiCreditsUsed || 0).toFixed(2)} CR
                              </span>
                            )}
                          </div>
                          <h4 className="text-sm font-semibold text-foreground group-hover:text-blue-400 transition-colors leading-snug">
                            {task.title}
                          </h4>
                          <p className="text-xs text-muted-foreground truncate max-w-xl">
                            {task.description || "No description."}
                          </p>
                        </div>
                      </div>

                      {/* Assignee / Dependency Indicators */}
                      <div className="flex items-center gap-3 shrink-0 self-end sm:self-center">
                        {task.priority !== 'none' && (
                          <span className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded border ${
                            task.priority === 'critical'
                              ? 'text-red-400 border-red-500/20 bg-red-400/10'
                              : task.priority === 'high'
                                ? 'text-orange-400 border-orange-500/20 bg-orange-400/10'
                                : task.priority === 'medium'
                                  ? 'text-yellow-400 border-yellow-500/20 bg-yellow-400/10'
                                  : 'text-blue-400 border-blue-500/20 bg-blue-400/10'
                          }`}>
                            {task.priority}
                          </span>
                        )}

                        {/* Blocker chains */}
                        {task.blockedByIds && task.blockedByIds.length > 0 && (
                          <span className="text-[10px] font-bold text-amber-400 bg-amber-400/10 border border-amber-500/20 px-2 py-0.5 rounded-full flex items-center gap-1">
                            <Hourglass size={10} />
                            Blocked by {task.blockedByIds.length}
                          </span>
                        )}

                        {/* Assignee Visual Chip */}
                        <div className="flex items-center gap-2 bg-muted/40 border border-border pl-2.5 pr-2 py-1 rounded-lg">
                          <span className="text-xs font-mono font-bold text-foreground">
                            {assignee ? assignee.role : 'Unassigned Pool'}
                          </span>
                          <Avatar name={assignee?.role} className="w-6 h-6 rounded-md object-cover border border-border" fallbackSize={12} />
                        </div>

                        <ArrowUpRight size={16} className="text-muted-foreground group-hover:text-foreground transition-colors group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                      </div>

                    </div>
                  </Link>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ===================== CREATE NEW ISSUE MODAL ===================== */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-xl w-full max-w-3xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between p-4 border-b border-border shrink-0">
              <div className="flex items-center gap-2">
                <span className="text-xs bg-secondary text-muted-foreground font-mono px-2 py-1 rounded border border-border">NEW ISSUE</span>
                <h3 className="font-semibold text-sm text-foreground">Create Actionable Issue</h3>
              </div>
              <button onClick={() => setIsModalOpen(false)} className="text-muted-foreground hover:text-foreground transition-colors p-1">
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleCreate} className="flex flex-col flex-1 overflow-hidden">
              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                <div>
                  <input
                    type="text"
                    placeholder="Issue title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full bg-transparent text-xl font-medium text-foreground focus:outline-none placeholder:text-muted-foreground/70"
                    required
                    autoFocus
                  />
                </div>

                <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
                  <div className="flex items-center gap-2">
                    <span>For</span>
                    <Select
                      value={assigneeId}
                      onChange={(e) => setAssigneeId(e.target.value)}
                      className="px-2 py-1 text-xs w-auto"
                    >
                      <option value="">Unassigned Pool</option>
                      {instances.map(inst => (
                        <option key={inst.id} value={inst.id}>{inst.role} ({inst.alias || 'Agent'})</option>
                      ))}
                    </Select>
                  </div>

                  <div className="flex items-center gap-2">
                    <span>in</span>
                    <Select
                      value={goalId}
                      onChange={(e) => setGoalId(e.target.value)}
                      className="px-2 py-1 text-xs w-auto"
                    >
                      <option value="">No Goal</option>
                      {goals.map(g => (
                        <option key={g._id} value={g._id}>{g.title}</option>
                      ))}
                    </Select>
                  </div>
                </div>

                <div>
                  <Textarea
                    placeholder="Add description... Supporting full Markdown format."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="w-full border-0 bg-transparent text-sm focus:outline-none focus:ring-0 placeholder:text-muted-foreground/70 min-h-[150px] resize-y p-0"
                  />
                </div>
              </div>

              <div className="p-4 border-t border-border bg-secondary flex items-center justify-between shrink-0 flex-wrap gap-3">
                <div className="flex items-center gap-3">
                  <Select
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                    className="bg-card px-3 py-1.5 text-xs w-auto"
                  >
                    <option value="backlog">Backlog</option>
                    <option value="todo">Todo</option>
                    <option value="in_progress">In Progress</option>
                    <option value="in_review">In Review</option>
                    <option value="done">Done</option>
                  </Select>
                  <Select
                    value={priority}
                    onChange={(e) => setPriority(e.target.value)}
                    className="bg-card px-3 py-1.5 text-xs w-auto"
                  >
                    <option value="none">Priority</option>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="critical">Critical</option>
                  </Select>
                  <Select
                    value={parentTaskId}
                    onChange={(e) => setParentTaskId(e.target.value)}
                    className="bg-card px-3 py-1.5 text-xs w-auto max-w-[150px] truncate"
                  >
                    <option value="">Parent Issue</option>
                    {tasks.map(t => (
                      <option key={t._id} value={t._id}>{t.title}</option>
                    ))}
                  </Select>
                </div>
                <div className="flex items-center gap-3 ml-auto">
                  <button type="button" onClick={() => setIsModalOpen(false)} className="text-muted-foreground text-xs hover:text-foreground transition-colors">
                    Discard Draft
                  </button>
                  <Button type="submit" size="sm">
                    Create Issue
                  </Button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

// ===================== DYNAMIC 3D DESK ITEM COMPONENT =====================
const DeskItem: React.FC<{
  inst: Instance;
  act: any;
  isSelected: boolean;
  onClick: () => void;
}> = ({ inst, act, isSelected, onClick }) => {
  const statusConfig = {
    busy: { border: 'border-blue-500/30', bg: 'bg-blue-500/5 animate-pulse', barColor: 'bg-blue-500', emote: '💻', stateName: 'Deep Focus' },
    waiting: { border: 'border-amber-500/30', bg: 'bg-amber-500/5', barColor: 'bg-amber-500', emote: '⏳', stateName: 'Syncing Files' },
    reviewing: { border: 'border-purple-500/30', bg: 'bg-purple-500/5', barColor: 'bg-purple-500', emote: '🚩', stateName: 'In Review' },
    idle: { border: 'border-border', bg: 'bg-muted/30', barColor: 'bg-emerald-500', emote: '☕', stateName: 'Brewing Coffee' }
  }[act.status as 'busy' | 'waiting' | 'reviewing' | 'idle'] || { border: 'border-border', bg: 'bg-muted/30', barColor: 'bg-emerald-500', emote: '☕', stateName: 'Brewing Coffee' };

  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        'group/desk relative rounded-xl border p-3.5 transition-all flex flex-col justify-between overflow-hidden cursor-pointer',
        isSelected
          ? 'border-blue-500 bg-blue-500/10 ring-1 ring-blue-500/30 shadow-lg'
          : `${statusConfig.border} ${statusConfig.bg} hover:border-muted-foreground/40 hover:bg-secondary/60`
      )}
    >
      {/* Neon indicator top border bar */}
      <div className={`absolute top-0 left-0 right-0 h-[2px] transition-all ${
        isSelected ? 'bg-blue-400' : statusConfig.barColor
      }`} />

      <div className="flex gap-4 items-stretch min-h-[110px]">
        {/* Agent avatar + state badge */}
        <div className="w-24 h-28 shrink-0 relative bg-muted/50 rounded-lg overflow-hidden border border-border shadow-inner flex flex-col items-center justify-center p-1">
          <div className="w-full flex-1 relative flex items-center justify-center">
            <Avatar name={inst.role} className="w-14 h-14 rounded-lg" fallbackSize={24} />
          </div>

          {/* State sub-badge */}
          <div className="w-full border-t border-border pt-1 flex items-center justify-center gap-1 bg-muted/30">
            <span className="text-[10px]">{statusConfig.emote}</span>
            <span className="text-[8px] font-mono font-bold text-muted-foreground tracking-tight uppercase">{statusConfig.stateName}</span>
          </div>
        </div>

        {/* Info & metric graphs */}
        <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
          <div>
            <div className="flex items-center justify-between gap-1">
              <span className="font-mono text-xs font-bold text-foreground tracking-wide truncate group-hover/desk:text-blue-400 transition-colors">
                {inst.role}
              </span>
              <span className="text-[9px] text-muted-foreground/70 font-mono shrink-0">
                DESK-{inst.id.substring(0,3).toUpperCase()}
              </span>
            </div>

            {/* Thought speech bubble */}
            <div className="mt-1.5 bg-muted/60 border border-border rounded-lg p-2 relative">
              <div className="absolute top-2.5 -left-1 w-1.5 h-1.5 bg-muted/60 border-l border-b border-border rotate-45" />
              <p className="text-[10px] text-foreground font-medium leading-relaxed line-clamp-2 pl-0.5">
                {act.message}
              </p>
            </div>
          </div>

          {/* Micro PC Stats Dashboard */}
          <div className="mt-2.5 space-y-1 bg-muted/30 border border-border rounded px-2 py-1.5">
            <div className="flex items-center justify-between text-[8px] font-mono text-muted-foreground">
              <span className="flex items-center gap-0.5"><Cpu size={8} /> PC Focus</span>
              <span className="text-foreground font-bold">{act.status === 'busy' ? '88%' : act.status === 'waiting' ? '12%' : '4%'}</span>
            </div>
            <div className="w-full bg-secondary h-1 rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all duration-500 ${
                act.status === 'busy' ? 'bg-blue-400 w-[88%]' : act.status === 'waiting' ? 'bg-amber-400 w-[12%]' : 'bg-emerald-400 w-[4%]'
              }`} />
            </div>

            <div className="flex items-center justify-between text-[8px] font-mono text-muted-foreground mt-1">
              <span className="flex items-center gap-0.5"><Coffee size={8} /> Coffee</span>
              <span className="text-foreground font-bold">{act.status === 'busy' ? '35%' : '95%'}</span>
            </div>
            <div className="w-full bg-secondary h-1 rounded-full overflow-hidden">
              <div className="h-full bg-orange-400 rounded-full transition-all duration-500" style={{ width: act.status === 'busy' ? '35%' : '95%' }} />
            </div>
          </div>
        </div>
      </div>

      {/* Embedded active ticket metadata */}
      {act.activeTask && (
        <div className="mt-2.5 bg-muted/40 border border-border p-2 rounded-lg flex items-center justify-between gap-3">
          <div className="min-w-0">
            <span className="text-[8px] font-mono font-bold text-blue-400 block mb-0.5 uppercase tracking-wide flex items-center gap-0.5">
              <Activity size={8} className="animate-pulse" /> Live Ticket
            </span>
            <span className="text-[11px] text-foreground font-semibold block truncate leading-tight">
              {act.activeTask.identifier} — {act.activeTask.title}
            </span>
          </div>
          <Badge variant={act.activeTask.priority === 'critical' ? 'error' : 'neutral'} dot={false} className={cn('text-[8px] uppercase font-extrabold px-1.5 py-0.5 rounded', act.activeTask.priority === 'critical' && 'animate-pulse')}>
            {act.activeTask.priority !== 'none' ? act.activeTask.priority : 'std'}
          </Badge>
        </div>
      )}
    </div>
  );
};

export default TasksView;
