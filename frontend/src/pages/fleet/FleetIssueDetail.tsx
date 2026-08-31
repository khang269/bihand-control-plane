import React, { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  ChevronLeft, MessageSquare, Activity as ActivityIcon, Link as LinkIcon, Send,
  CircleDot, AlertCircle, Cpu, ChevronRight, Trash2
} from 'lucide-react';
import api from '../../lib/api';
import { MarkdownRenderer } from '../../components/MarkdownRenderer';
import { Avatar } from '../../components/Avatar';
import { cn } from '../../lib/cn';
import { Button, Select } from '../../components/ui';

interface Task {
  _id: string;
  identifier?: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  assigneeId?: string;
  assigneeRole?: string;
  assigneeTitle?: string;
  parentTaskId?: string;
  result?: string;
  blockedByIds?: string[];
  createdAt: string;
  apiCreditsUsed?: number;
}

const FleetIssueDetail: React.FC = () => {
  const { fleetId, issueId } = useParams<{ fleetId: string; issueId: string }>();
  const navigate = useNavigate();
  const [task, setTask] = useState<Task | null>(null);
  const [subtasks, setSubtasks] = useState<Task[]>([]);
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [comments, setComments] = useState<any[]>([]);
  const [newComment, setNewComment] = useState("");
  const [activeTab, setActiveTab] = useState<'chat' | 'activity' | 'related'>('chat');

  const handleArchiveSingleTask = async () => {
    if (!window.confirm("Are you sure you want to archive this task?")) return;
    try {
      await api.post(`/fleets/${fleetId}/tasks/archive`, { taskIds: [issueId] });
      navigate(`/fleet/${fleetId}/issues`);
    } catch (e: any) {
      alert(e.response?.data?.detail || "Failed to archive task");
    }
  };

  const fetchDetail = async () => {
    try {
      const res = await api.get(`/fleets/${fleetId}/tasks/${issueId}`);
      setTask(res.data.task);
    } catch (e) {
      console.error(e);
    }
  };

  const fetchAllTasks = async () => {
    try {
      const res = await api.get(`/fleets/${fleetId}/tasks`);
      const list = res.data.tasks || [];
      setAllTasks(list);
      // Filter subtasks representing delegations
      setSubtasks(list.filter((t: any) => t.parentTaskId === issueId));
    } catch (e) {
      console.error(e);
    }
  };

  const fetchComments = async () => {
    try {
      const res = await api.get(`/fleets/${fleetId}/tasks/${issueId}/comments`);
      setComments(res.data.comments);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchDetail();
    fetchAllTasks();
    fetchComments();
    const interval = setInterval(() => {
      fetchDetail();
      fetchAllTasks();
      fetchComments();
    }, 5000);
    return () => clearInterval(interval);
  }, [fleetId, issueId]);

  const handlePostComment = async () => {
    if (!newComment.trim()) return;
    try {
      await api.post(`/fleets/${fleetId}/tasks/${issueId}/comments`, { content: newComment });
      setNewComment("");
      fetchComments();
      fetchDetail(); // Fetch details again in case backend implicitly reopened the task
    } catch (e) {
      console.error(e);
    }
  };

  const updateStatus = async (status: string) => {
    try {
      await api.patch(`/fleets/${fleetId}/tasks/${issueId}`, { status });
      fetchDetail();
    } catch(e: any) {
      console.error(e);
      alert(e.response?.data?.detail || "Failed to update status");
    }
  };

  const updatePriority = async (priority: string) => {
    try {
      await api.patch(`/fleets/${fleetId}/tasks/${issueId}`, { priority });
      fetchDetail();
    } catch(e) { console.error(e); }
  };

  if (!task) return <div className="p-8 text-muted-foreground">Loading...</div>;

  const getStatusStyle = (status: string) => {
    switch (status) {
      case 'done': return { text: 'text-emerald-600 dark:text-emerald-400', border: 'border-emerald-500/20', bg: 'bg-emerald-500/5', dot: 'bg-emerald-500' };
      case 'in_progress': return { text: 'text-blue-600 dark:text-blue-400 animate-pulse', border: 'border-blue-500/20', bg: 'bg-blue-500/5', dot: 'bg-blue-500 animate-ping' };
      case 'in_review': return { text: 'text-purple-600 dark:text-purple-400', border: 'border-purple-500/20', bg: 'bg-purple-500/5', dot: 'bg-purple-500' };
      case 'blocked': return { text: 'text-amber-600 dark:text-amber-400', border: 'border-amber-500/20', bg: 'bg-amber-500/5', dot: 'bg-amber-500' };
      case 'failed': return { text: 'text-red-600 dark:text-red-400', border: 'border-red-500/20', bg: 'bg-red-500/5', dot: 'bg-red-500' };
      default: return { text: 'text-muted-foreground', border: 'border-border', bg: 'bg-secondary/50', dot: 'bg-muted-foreground' };
    }
  };

  const currentStyle = getStatusStyle(task.status);
  const parentTask = allTasks.find(t => t._id === task.parentTaskId);

  return (
    <div className="p-8 flex flex-col max-w-5xl mx-auto w-full space-y-6">

      {/* Header Bar */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <Link to={`/fleet/${fleetId}/issues`} className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-xs font-semibold px-3 py-2 bg-card border border-border rounded-lg hover:border-foreground/20 transition-all">
          <ChevronLeft size={14} /> Back to Issues
        </Link>
        <div className="flex items-center gap-2">
            <Select
              value={task.status}
              onChange={e => updateStatus(e.target.value)}
              className="text-xs font-semibold py-1.5 w-auto"
            >
              {task.status === 'backlog' && (
                <>
                  <option value="backlog">Backlog</option>
                  <option value="todo">Todo</option>
                </>
              )}
              {['todo', 'in_progress', 'blocked', 'failed'].includes(task.status) && (
                <>
                  <option value={task.status}>{task.status === 'blocked' ? 'Blocked' : task.status === 'failed' ? 'Failed' : task.status === 'in_progress' ? 'In Progress' : 'Todo'}</option>
                  <option value="cancelled">Cancel</option>
                </>
              )}
              {task.status === 'in_review' && (
                <>
                  <option value="in_review">In Review</option>
                  <option value="todo">Todo</option>
                  <option value="done">Done</option>
                </>
              )}
              {['done', 'cancelled'].includes(task.status) && (
                <option value={task.status}>{task.status === 'done' ? 'Done' : 'Cancelled'}</option>
              )}
            </Select>

            <Select
              value={task.priority}
              onChange={e => updatePriority(e.target.value)}
              className="text-xs font-semibold py-1.5 w-auto"
            >
                <option value="none">Priority: Standard</option>
                <option value="low">Priority: Low</option>
                <option value="medium">Priority: Medium</option>
                <option value="high">Priority: High</option>
                <option value="critical">Priority: Critical</option>
            </Select>
            {task.status !== 'in_progress' && task.status !== 'blocked' && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleArchiveSingleTask}
                className="bg-red-600/10 text-red-600 dark:text-red-400 border-red-500/20 hover:bg-red-500/20"
              >
                <Trash2 size={14} /> Archive Task
              </Button>
            )}
        </div>
      </div>

      {/* Title block */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-mono font-bold text-purple-600 dark:text-purple-400 bg-purple-500/5 border border-purple-500/10 px-2 py-0.5 rounded">
            {task.identifier}
          </span>
          {task.assigneeRole && (
            <span className="text-xs font-mono font-bold text-blue-600 dark:text-blue-400 bg-blue-500/5 border border-blue-500/10 px-2 py-0.5 rounded">
              Assigned: {task.assigneeRole}
            </span>
          )}
          {task.apiCreditsUsed !== undefined && (
            <span className="text-xs font-mono font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/5 border border-emerald-500/10 px-2 py-0.5 rounded">
              Cost: {(task.apiCreditsUsed || 0).toFixed(2)} CR
            </span>
          )}
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground leading-snug">
          {task.title}
        </h1>
      </div>

      {/* ===================== VIRTUAL TASK CO-WORKING GRAPH ===================== */}
      <div className="border border-border rounded-xl bg-card p-6 shadow-sm relative overflow-hidden">
        <div className="absolute top-0 right-0 w-[300px] h-[300px] bg-purple-500/5 rounded-full blur-[100px] pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-[300px] h-[300px] bg-blue-500/5 rounded-full blur-[100px] pointer-events-none" />

        <div className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground font-mono mb-6 flex items-center gap-1.5 border-b border-border pb-3">
          <Cpu size={12} className="text-blue-500 animate-pulse" />
          <span>Active Delegation Pipeline Simulator</span>
        </div>

        {/* Handshake Simulation Node Display */}
        <div className="flex flex-col md:flex-row items-center justify-center gap-8 relative z-10 py-4">

          {/* Target / Parent Agent (The Assigner) */}
          {parentTask ? (
            <div className="flex flex-col items-center text-center max-w-[200px]">
              <div className="relative">
                <Avatar name={parentTask.assigneeRole} className="w-16 h-16 rounded-2xl object-cover border-2 border-border" fallbackSize={22} />
                <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-indigo-500 border border-card flex items-center justify-center text-[8px]">👑</span>
              </div>
              <span className="text-xs font-bold text-foreground mt-2 block font-mono">
                {parentTask.assigneeRole || 'CEO'}
              </span>
              <span className="text-[10px] text-muted-foreground block mt-0.5 line-clamp-1 italic">
                "{parentTask.title}"
              </span>
              <span className="inline-flex items-center gap-1 text-[9px] uppercase font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-500/5 px-1.5 py-0.5 rounded mt-2 border border-indigo-500/10">
                Waiting on subtasks
              </span>
            </div>
          ) : task.parentTaskId ? (
            <div className="flex flex-col items-center text-center max-w-[200px]">
              <div className="relative">
                <Avatar name="CEO" className="w-16 h-16 rounded-2xl object-cover border-2 border-border" fallbackSize={22} />
                <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-indigo-500 border border-card flex items-center justify-center text-[8px]">👑</span>
              </div>
              <span className="text-xs font-bold text-foreground mt-2 block font-mono">CEO / Assigner</span>
              <span className="text-[10px] text-muted-foreground block mt-0.5 italic">Awaiting completion</span>
            </div>
          ) : (
            <div className="flex flex-col items-center text-center max-w-[200px]">
              <div className="relative">
                <Avatar name={task.assigneeRole} className="w-16 h-16 rounded-2xl object-cover border-2 border-border" fallbackSize={22} />
                <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-primary border border-card flex items-center justify-center text-[8px] text-primary-foreground font-extrabold">👑</span>
              </div>
              <span className="text-xs font-bold text-foreground mt-2 block font-mono">{task.assigneeRole || 'Primary Owner'}</span>
              <span className="text-[10px] text-muted-foreground block mt-0.5">Top-level Root Agent</span>
              <span className={cn('inline-flex items-center gap-1.5 text-[9px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full mt-2 border', currentStyle.text, currentStyle.bg, currentStyle.border)}>
                <span className={cn('w-1.5 h-1.5 rounded-full', currentStyle.dot)} />
                {task.status.replace('_', ' ')}
              </span>
            </div>
          )}

          {/* Transfer visual arrow */}
          <div className="flex flex-col items-center justify-center w-full max-w-[120px] py-2">
            <div className="text-[9px] font-mono text-muted-foreground uppercase font-bold tracking-wide animate-pulse">
              {subtasks.length > 0 ? `DELEGATED FLOW` : 'PROCESSING'}
            </div>
            <div className="w-full border-b border-dashed border-border h-1.5 flex items-center justify-center relative my-2">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-400 absolute animate-ping" />
              <ChevronRight size={14} className="text-muted-foreground absolute right-0" />
            </div>
          </div>

          {/* Subordinate / Working Node */}
          {subtasks.length > 0 ? (
            <div className="flex flex-col gap-3 max-w-[340px] w-full bg-secondary/40 border border-border rounded-xl p-3">
              <span className="text-[9px] font-mono font-bold text-muted-foreground block uppercase border-b border-border pb-1.5">
                Subordinates Workloads ({subtasks.length})
              </span>
              <div className="space-y-2 max-h-[140px] overflow-y-auto scrollbar-thin pr-1">
                {subtasks.map(sub => {
                  const subStyle = getStatusStyle(sub.status);
                  return (
                    <Link
                      key={sub._id}
                      to={`/fleet/${fleetId}/issues/${sub._id}`}
                      className="flex items-center justify-between gap-3 p-2 bg-card hover:bg-secondary border border-border rounded-lg transition-colors group/sub"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Avatar name={sub.assigneeRole} className="w-7 h-7 rounded-lg object-cover border border-border" fallbackSize={14} />
                        <div className="min-w-0">
                          <span className="text-xs font-bold text-foreground block font-mono truncate">{sub.assigneeRole}</span>
                          <span className="text-[10px] text-muted-foreground block truncate leading-none">"{sub.title}"</span>
                        </div>
                      </div>
                      <span className={cn('text-[9px] uppercase font-bold px-1.5 py-0.5 rounded border flex items-center gap-1 shrink-0', subStyle.text, subStyle.bg, subStyle.border)}>
                        <span className={cn('w-1 h-1 rounded-full', subStyle.dot)} />
                        {sub.status.replace('_', ' ')}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center text-center max-w-[200px]">
              <div className="relative">
                <Avatar name={task.assigneeRole} className="w-16 h-16 rounded-2xl object-cover border-2 border-blue-500/20" fallbackSize={22} />
                <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-blue-500 border border-card flex items-center justify-center text-[8px]">⚙️</span>
              </div>
              <span className="text-xs font-bold text-foreground mt-2 block font-mono">{task.assigneeRole || 'Unassigned'}</span>
              <span className="text-[10px] text-muted-foreground block mt-0.5">Executer Node</span>
              <span className={cn('inline-flex items-center gap-1.5 text-[9px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full mt-2 border', currentStyle.text, currentStyle.bg, currentStyle.border)}>
                <span className={cn('w-1.5 h-1.5 rounded-full', currentStyle.dot)} />
                {task.status.replace('_', ' ')}
              </span>
            </div>
          )}

        </div>
      </div>

      {/* Task Alerts */}
      <div>
        {task.status === 'in_review' && (
          <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
            <div className="flex items-start gap-3 text-amber-600 dark:text-amber-500 text-sm">
              <span className="mt-0.5 text-lg">🚩</span>
              <div>
                <span className="font-bold">In Review — The assigned agent has submitted work and paused.</span><br/>
                Comments will wake the assignee for questions or triage. Or you can mark the task as done.
              </div>
            </div>
            <div className="flex gap-2 shrink-0">
              <Button variant="outline" size="sm" onClick={() => updateStatus('in_progress')}>
                Resume Agent
              </Button>
              <Button size="sm" onClick={() => updateStatus('done')} className="bg-emerald-500 text-black hover:bg-emerald-400">
                Accept & Complete
              </Button>
            </div>
          </div>
        )}

        {task.status === 'blocked' && (
          <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl flex items-start gap-3">
            <span className="text-amber-600 dark:text-amber-500 mt-0.5 text-lg">⏳</span>
            <div className="text-amber-600 dark:text-amber-500 text-sm">
              <span className="font-bold">Blocked by dependency — {task.result || "Waiting for blocker task(s) to complete before starting."}</span><br/>
              The agent is paused and waiting for a subtask or blocker to complete before continuing.
            </div>
          </div>
        )}

        {task.status === 'failed' && (
          <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-start gap-3">
            <span className="text-red-600 dark:text-red-500 mt-0.5 text-lg">🛑</span>
            <div className="text-red-600 dark:text-red-500 text-sm">
              <span className="font-bold">Failed — {task.result || "The agent process exited early without resolving the task."}</span><br/>
              Check the chat or activity log for details. Switch status back to "todo" to retry.
            </div>
          </div>
        )}
      </div>

      {/* Description block */}
      <div className="mb-6 bg-card border border-border p-5 rounded-xl shadow-sm">
        <div className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground font-mono mb-3">Issue Requirements</div>
        <MarkdownRenderer content={task.description || "No description provided."} />
      </div>

      {/* Final Result Block */}
      {task.result && (
        <div className="p-5 bg-emerald-500/5 border border-emerald-500/20 rounded-xl">
          <h4 className="text-emerald-600 dark:text-emerald-400 text-xs font-bold uppercase tracking-wider mb-3 flex items-center gap-2"><CircleDot size={14}/> Final Result</h4>
          <div className="text-sm text-foreground">
            <MarkdownRenderer content={task.result} />
          </div>
        </div>
      )}

      {/* Chat & logs tabs */}
      <div className="flex items-center gap-6 border-b border-border">
        <button
          onClick={() => setActiveTab('chat')}
          className={cn('pb-3 text-sm font-medium border-b-2 flex items-center gap-2 transition-colors', activeTab === 'chat' ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}
        >
          <MessageSquare size={16} /> Chat
        </button>
        <button
          onClick={() => setActiveTab('activity')}
          className={cn('pb-3 text-sm font-medium border-b-2 flex items-center gap-2 transition-colors', activeTab === 'activity' ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}
        >
          <ActivityIcon size={16} /> Activity
        </button>
        <button
          onClick={() => setActiveTab('related')}
          className={cn('pb-3 text-sm font-medium border-b-2 flex items-center gap-2 transition-colors', activeTab === 'related' ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}
        >
          <LinkIcon size={16} /> Related work
        </button>
      </div>

      {/* Tab bodies */}
      <div className="flex-1 overflow-y-auto pb-20">
        {activeTab === 'chat' && (
          <div className="space-y-6">
            <div className="space-y-4 mb-8">
              {comments.map(c => (
                <div key={c._id} className="flex gap-4">
                  <div className={cn('w-8 h-8 rounded-full flex items-center justify-center shrink-0', c.authorRole === 'human' ? 'bg-blue-500/20 text-blue-600 dark:text-blue-400 border border-blue-500/30' : 'bg-purple-500/20 text-purple-600 dark:text-purple-400 border border-purple-500/30')}>
                    <span className="text-xs font-bold">{c.authorRole.substring(0, 2).toUpperCase()}</span>
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-sm">{c.authorRole === 'human' ? 'You' : c.authorRole}</span>
                      <span className="text-xs text-muted-foreground">{new Date(c.createdAt).toLocaleTimeString()}</span>
                    </div>
                    <div className="text-sm bg-secondary border border-border p-4 rounded-xl rounded-tl-none">
                      <MarkdownRenderer content={c.content} />
                    </div>
                  </div>
                </div>
              ))}
              {comments.length === 0 && (
                <div className="text-center py-8 text-muted-foreground text-sm">No comments yet. Start the conversation!</div>
              )}
            </div>

            <div className="relative border border-border rounded-xl bg-card focus-within:border-foreground/30 transition-colors p-2">
              <textarea
                value={newComment}
                onChange={e => setNewComment(e.target.value)}
                placeholder="Message Assistant (Enter to send)"
                className="w-full bg-transparent p-2 text-sm text-foreground focus:outline-none resize-none h-20 placeholder:text-muted-foreground"
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handlePostComment();
                  }
                }}
              />
              <div className="flex justify-between items-center border-t border-border pt-2">
                 <div className="text-xs text-muted-foreground px-2 flex items-center gap-1"><AlertCircle size={12}/> Comments will wake the assigned agent</div>
                 <Button size="sm" onClick={handlePostComment}>
                  <Send size={14} /> Send
                 </Button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'activity' && (
           <div className="text-muted-foreground text-sm italic py-4">Activity log will appear here...</div>
        )}

        {activeTab === 'related' && (
           <div className="text-muted-foreground text-sm italic py-4">Related tasks will appear here...</div>
        )}
      </div>
    </div>
  );
};

export default FleetIssueDetail;
