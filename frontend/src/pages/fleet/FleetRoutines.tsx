import React, { useEffect, useState, useRef, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Plus, X, Clock, PlayCircle, ChevronDown, Bot, Check, Pencil } from 'lucide-react';
import api from '../../lib/api';
import { useLanguage } from '../../context/LanguageContext';
import { cn } from '../../lib/cn';
import { Button, Modal, Input, Textarea, Select } from '../../components/ui';

const SCHEDULE_OPTIONS = [
  { label: 'Daily at 9:00 AM', value: '0 9 * * *' },
  { label: 'Every hour', value: '0 * * * *' },
  { label: 'Every Monday at 9:00 AM', value: '0 9 * * 1' },
  { label: 'Custom schedule...', value: 'custom' }
];

type ParsedCustomCron = {
  interval: 'hours' | 'days' | 'weeks';
  hoursCount: number;
  daysCount: number;
  hour: number;
  minute: number;
  dayOfWeek: number;
};

// Reverse-maps a cron expression back into the friendly custom-schedule builder fields,
// but only for the exact shapes that builder itself is capable of generating.
// Anything else (e.g. a cron hand-edited elsewhere) falls back to raw-text editing.
const parseCronToBuilder = (cronExpr: string): ParsedCustomCron | null => {
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minStr, hourStr, domStr, monthStr, dowStr] = parts;
  if (monthStr !== '*') return null;
  const minute = parseInt(minStr, 10);
  if (isNaN(minute)) return null;

  // Hours interval: "M */N * * *" or "M * * * *"
  if (domStr === '*' && dowStr === '*' && /^\*(\/\d+)?$/.test(hourStr)) {
    const stepMatch = hourStr.match(/^\*\/(\d+)$/);
    return { interval: 'hours', hoursCount: stepMatch ? parseInt(stepMatch[1], 10) : 1, daysCount: 1, hour: 9, minute, dayOfWeek: 1 };
  }

  const hour = parseInt(hourStr, 10);
  if (isNaN(hour)) return null;

  // Days interval: "M H */N * *" or "M H * * *"
  if (dowStr === '*' && /^\*(\/\d+)?$/.test(domStr)) {
    const stepMatch = domStr.match(/^\*\/(\d+)$/);
    return { interval: 'days', hoursCount: 1, daysCount: stepMatch ? parseInt(stepMatch[1], 10) : 1, hour, minute, dayOfWeek: 1 };
  }

  // Weekly: "M H * * D"
  if (domStr === '*') {
    const dayOfWeek = parseInt(dowStr, 10);
    if (!isNaN(dayOfWeek)) {
      return { interval: 'weeks', hoursCount: 1, daysCount: 1, hour, minute, dayOfWeek };
    }
  }

  return null;
};

const FleetRoutines: React.FC = () => {
  const { fleetId } = useParams<{ fleetId?: string }>();
  const { language } = useLanguage();
  const [routines, setRoutines] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'routines' | 'runs'>('routines');
  const [instances, setInstances] = useState<any[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRoutineId, setEditingRoutineId] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [scheduleType, setScheduleType] = useState('0 9 * * *');

  // Custom friendly builder states
  const [customInterval, setCustomInterval] = useState<'hours' | 'days' | 'weeks'>('days');
  const [customHoursCount, setCustomHoursCount] = useState(1);
  const [customDaysCount, setCustomDaysCount] = useState(1);
  const [customHour, setCustomHour] = useState(9);
  const [customMinute, setCustomMinute] = useState(0);
  const [customDayOfWeek, setCustomDayOfWeek] = useState(1); // 1 = Monday

  // When editing a routine whose cron doesn't match anything the friendly builder can
  // itself produce, fall back to letting the user edit the raw cron expression directly.
  const [useRawCron, setUseRawCron] = useState(false);
  const [rawCronExpr, setRawCronExpr] = useState('0 9 * * *');

  const computedCron = useMemo(() => {
    if (scheduleType !== 'custom') return scheduleType;
    if (useRawCron) return rawCronExpr;
    if (customInterval === 'hours') {
      const step = customHoursCount > 1 ? `/${customHoursCount}` : '';
      return `${customMinute} *${step} * * *`;
    } else if (customInterval === 'days') {
      const step = customDaysCount > 1 ? `/${customDaysCount}` : '';
      return `${customMinute} ${customHour} *${step} * *`;
    } else {
      return `${customMinute} ${customHour} * * ${customDayOfWeek}`;
    }
  }, [scheduleType, useRawCron, rawCronExpr, customInterval, customHoursCount, customDaysCount, customHour, customMinute, customDayOfWeek]);


  const [assigneeId, setAssigneeId] = useState('');
  const [assigneeSearch, setAssigneeSearch] = useState('');
  const [isAssigneeDropdownOpen, setIsAssigneeDropdownOpen] = useState(false);

  const [runs, setRuns] = useState<any>({});

  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsAssigneeDropdownOpen(false);
        setAssigneeSearch('');
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const fetchData = async () => {
    try {
      const [rRes, iRes] = await Promise.all([
        api.get(`/fleets/${fleetId}/routines`),
        api.get(`/fleets/${fleetId}`)
      ]);
      setRoutines(rRes.data.routines || []);
      setInstances(iRes.data.instances || []); console.log("FETCHED INSTANCES:", iRes.data.instances);
    } catch (e) {
      console.error(e);
    }
  };

  const fetchRunsForRoutine = async (routineId: string) => {
      try {
          const res = await api.get(`/fleets/${fleetId}/routines/${routineId}/runs`);
          setRuns((prev: any) => ({...prev, [routineId]: res.data.runs}));
      } catch(e) { console.error(e); }
  }

  useEffect(() => {
      fetchData();
  }, [fleetId]);

  useEffect(() => {
      if (activeTab === 'runs') {
          routines.forEach(r => fetchRunsForRoutine(r._id));
      }
  }, [activeTab, routines]);

  const resetForm = () => {
    setEditingRoutineId(null);
    setTitle('');
    setDescription('');
    setScheduleType('0 9 * * *');
    setCustomInterval('days');
    setCustomHoursCount(1);
    setCustomDaysCount(1);
    setCustomHour(9);
    setCustomMinute(0);
    setCustomDayOfWeek(1);
    setUseRawCron(false);
    setRawCronExpr('0 9 * * *');
    setAssigneeId('');
  };

  const openCreateModal = () => {
    resetForm();
    setIsModalOpen(true);
  };

  const openEditModal = (r: any) => {
    setEditingRoutineId(r._id);
    setTitle(r.title || '');
    setDescription(r.description || '');
    setAssigneeId(r.assigneeId || '');

    const preset = SCHEDULE_OPTIONS.find(opt => opt.value !== 'custom' && opt.value === r.cronExpr);
    if (preset) {
      setScheduleType(preset.value);
      setUseRawCron(false);
    } else {
      setScheduleType('custom');
      const parsed = parseCronToBuilder(r.cronExpr || '');
      if (parsed) {
        setCustomInterval(parsed.interval);
        setCustomHoursCount(parsed.hoursCount);
        setCustomDaysCount(parsed.daysCount);
        setCustomHour(parsed.hour);
        setCustomMinute(parsed.minute);
        setCustomDayOfWeek(parsed.dayOfWeek);
        setUseRawCron(false);
      } else {
        setUseRawCron(true);
        setRawCronExpr(r.cronExpr || '0 9 * * *');
      }
    }
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    resetForm();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalCron = computedCron;
    if (!title || !description || !finalCron) return;
    try {
      if (editingRoutineId) {
        await api.patch(`/fleets/${fleetId}/routines/${editingRoutineId}`, {
          title, description, cronExpr: finalCron, assigneeId: assigneeId || ''
        });
      } else {
        await api.post(`/fleets/${fleetId}/routines`, {
          title, description, cronExpr: finalCron, assigneeId: assigneeId || null
        });
      }
      setIsModalOpen(false);
      resetForm();
      fetchData();
    } catch (e: any) {
      alert(e.response?.data?.detail || e.message);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.delete(`/fleets/routines/${id}`);
      fetchData();
    } catch (e) {
      console.error(e);
    }
  };

  const toggleStatus = async (id: string, currentStatus: string) => {
      const newStatus = currentStatus === 'active' ? 'paused' : 'active';
      try {
          await api.patch(`/fleets/${fleetId}/routines/${id}`, { status: newStatus });
          fetchData();
      } catch (e) { console.error(e); }
  }

  const triggerRun = async (id: string) => {
      try {
          await api.post(`/fleets/${fleetId}/routines/${id}/trigger`);
          alert("Routine triggered! A new task has been added to the queue.");
          fetchData();
          if (activeTab === 'runs') fetchRunsForRoutine(id);
      } catch (e) { console.error(e); }
  }

  const selectedAssignee = instances.find(i => i.id === assigneeId);

  return (
    <div className="p-8 h-full flex flex-col max-w-7xl mx-auto w-full text-left">
      <div className="mb-6 flex justify-between items-start border-b border-border pb-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground mb-1">
              {language === 'vi' ? 'Lịch trình hằng ngày' : 'Routines'}
            </h1>
            <p className="text-muted-foreground text-sm">
              {language === 'vi'
                ? 'Các định nghĩa công việc định kỳ sẽ tự động tạo thành các nhiệm vụ cụ thể.'
                : 'Recurring work definitions that materialize into auditable execution issues.'}
            </p>
          </div>
          <Button onClick={openCreateModal}>
            <Plus size={16} /> {language === 'vi' ? 'Tạo lịch trình' : 'Create routine'}
          </Button>
      </div>

      <div className="flex items-center gap-6 border-b border-border mb-6">
        <button
          onClick={() => setActiveTab('routines')}
          className={cn('pb-3 text-sm font-medium border-b-2 flex items-center gap-2 transition-colors', activeTab === 'routines' ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}
        >
          {language === 'vi' ? 'Danh sách Lịch trình' : 'Routines'}
        </button>
        <button
          onClick={() => setActiveTab('runs')}
          className={cn('pb-3 text-sm font-medium border-b-2 flex items-center gap-2 transition-colors', activeTab === 'runs' ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}
        >
          {language === 'vi' ? 'Lịch sử hoạt động' : 'Recent Runs'}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {activeTab === 'routines' && (
            <div className="space-y-4">
              <div className="text-sm text-muted-foreground mb-4">
                {routines.length} {language === 'vi' ? 'lịch trình được cấu hình' : `routine${routines.length !== 1 ? 's' : ''}`}
              </div>
              {routines.length === 0 ? (
                <div className="text-muted-foreground text-sm">
                  {language === 'vi' ? 'Chưa có lịch trình hằng ngày nào.' : 'No routines configured.'}
                </div>
              ) : (
                routines.map(r => (
                  <div key={r._id} className="border border-border p-4 rounded-xl bg-card flex items-center justify-between group hover:border-foreground/20 transition-colors">
                    <div className="flex-1">
                      <h3 className="font-semibold text-foreground mb-2">{r.title}</h3>
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1.5"><Clock size={12} className="text-purple-500" /> {r.cronExpr}</span>
                        {r.assigneeId && (
                           <span className="bg-secondary px-2 py-0.5 rounded text-foreground">{instances.find(i => i.id === r.assigneeId)?.role || 'Agent'}</span>
                        )}
                        <span>
                          {r.lastRunAt
                            ? `${language === 'vi' ? 'Lần chạy cuối:' : 'Last run:'} ${new Date(r.lastRunAt).toLocaleString()}`
                            : (language === 'vi' ? 'Chưa bao giờ chạy' : 'Never run')}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <button
                        onClick={() => triggerRun(r._id)}
                        className="flex items-center gap-1.5 text-xs border border-border px-3 py-1.5 rounded-md hover:bg-secondary transition-colors"
                      >
                         <PlayCircle size={14} /> {language === 'vi' ? 'Chạy ngay' : 'Run now'}
                      </button>
                      <div className="flex items-center gap-2">
                        <button
                           onClick={() => toggleStatus(r._id, r.status)}
                           className={cn('w-10 h-5 rounded-full relative transition-colors', r.status === 'active' ? 'bg-emerald-500' : 'bg-muted')}
                        >
                           <div className={cn('w-3.5 h-3.5 rounded-full bg-white absolute top-0.5 transition-all', r.status === 'active' ? 'right-0.5' : 'left-0.5')}></div>
                        </button>
                        <span className="text-xs text-muted-foreground w-8">{r.status === 'active' ? (language === 'vi' ? 'Bật' : 'On') : (language === 'vi' ? 'Tắt' : 'Off')}</span>
                      </div>
                      <button onClick={() => openEditModal(r)} className="text-muted-foreground hover:text-foreground transition-colors p-2">
                        <Pencil size={16} />
                      </button>
                      <button onClick={() => handleDelete(r._id)} className="text-muted-foreground hover:text-red-500 transition-colors p-2">
                        <X size={16} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
        )}

        {activeTab === 'runs' && (
            <div className="space-y-8">
               {routines.map(r => (
                   <div key={r._id} className="space-y-2">
                       <h3 className="text-sm font-semibold text-foreground mb-3">{r.title}</h3>
                       {(!runs[r._id] || runs[r._id].length === 0) ? (
                           <div className="text-xs text-muted-foreground italic pl-4">
                             {language === 'vi' ? 'Chưa có hoạt động nào' : 'No runs yet'}
                           </div>
                       ) : (
                           runs[r._id].map((run: any) => (
                               <Link to={`/fleet/${fleetId}/issues/${run._id}`} key={run._id} className="flex items-center justify-between border border-border bg-card p-3 rounded-lg hover:border-foreground/20 transition-colors ml-4">
                                   <div className="flex items-center gap-3">
                                       <span className={cn('w-2 h-2 rounded-full', run.status === 'done' ? 'bg-emerald-500' : run.status === 'in_progress' ? 'bg-blue-500' : run.status === 'blocked' ? (run.result?.startsWith('Waiting for delegated subtask') ? 'bg-amber-500' : 'bg-red-500') : 'bg-yellow-500')}></span>
                                       <span className="text-xs font-mono text-purple-600 dark:text-purple-400">{run.identifier}</span>
                                       <span className="text-sm text-foreground">{run.title}</span>
                                   </div>
                                   <span className="text-xs text-muted-foreground">{new Date(run.createdAt).toLocaleString()}</span>
                               </Link>
                           ))
                       )}
                   </div>
               ))}
               {routines.length === 0 && <div className="text-muted-foreground text-sm">{language === 'vi' ? 'Chưa cấu hình lịch trình nào.' : 'No routines configured.'}</div>}
            </div>
        )}
      </div>

      <Modal
        open={isModalOpen}
        onClose={closeModal}
        widthClassName="max-w-2xl"
        title={editingRoutineId
          ? (language === 'vi' ? 'Chỉnh sửa lịch trình' : 'Edit Routine')
          : (language === 'vi' ? 'Lịch trình tự động mới' : 'New Routine')}
      >
        <p className="text-xs text-muted-foreground -mt-2 mb-6">
          {language === 'vi'
            ? 'Xác định công việc lặp đi lặp lại. Dự án và tác nhân mặc định là tùy chọn cho các lịch trình nháp.'
            : 'Define the recurring work first. Default project and agent are optional for draft routines.'}
        </p>

        <form onSubmit={handleSubmit} className="space-y-6 text-left">
           <div>
              <input
                type="text"
                placeholder={language === 'vi' ? 'Tiêu đề lịch trình' : 'Routine title'}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full bg-transparent text-xl font-medium text-foreground focus:outline-none placeholder:text-muted-foreground"
                required
                autoFocus
              />
           </div>

           <div className="flex items-center gap-2 text-sm text-muted-foreground border-b border-border pb-6 relative" ref={dropdownRef}>
              <span>{language === 'vi' ? 'Dành cho' : 'For'}</span>
              <button
                type="button"
                onClick={() => setIsAssigneeDropdownOpen(!isAssigneeDropdownOpen)}
                className="flex items-center gap-1.5 bg-secondary border border-border hover:border-foreground/20 px-3 py-1.5 rounded-full text-foreground transition-colors"
              >
                {selectedAssignee ? <span className="flex items-center gap-1.5"><Bot size={14}/> {selectedAssignee.role}</span> : (language === 'vi' ? 'Chưa chỉ định' : 'No assignee')}
                <ChevronDown size={14} className="text-muted-foreground" />
              </button>

              {isAssigneeDropdownOpen && (
                <div className="absolute top-full left-8 mt-2 w-64 bg-card border border-border rounded-xl shadow-2xl overflow-hidden z-10">
                  <div className="p-2 border-b border-border">
                    <input
                      type="text"
                      placeholder={language === 'vi' ? 'Tìm kiếm người chỉ định...' : 'Search assignees...'}
                      value={assigneeSearch}
                      onChange={(e) => setAssigneeSearch(e.target.value)}
                      className="w-full bg-transparent text-sm focus:outline-none text-foreground px-2"
                    />
                  </div>
                  <div className="max-h-60 overflow-y-auto p-1">
                    <button
                      type="button"
                      onClick={() => { setAssigneeId(''); setIsAssigneeDropdownOpen(false); setAssigneeSearch(''); }}
                      className="w-full flex items-center justify-between px-3 py-2 text-sm text-left hover:bg-secondary rounded-lg transition-colors"
                    >
                      <span className={!assigneeId ? 'text-foreground font-medium' : 'text-muted-foreground'}>
                        {language === 'vi' ? 'Chưa chỉ định' : 'No assignee'}
                      </span>
                      {!assigneeId && <Check size={14} className="text-foreground" />}
                    </button>
                    {instances.filter(i => (i.role || "").toLowerCase().includes(assigneeSearch.toLowerCase())).map(inst => (
                      <button
                        key={inst.id}
                        type="button"
                        onClick={() => { setAssigneeId(inst.id); setIsAssigneeDropdownOpen(false); setAssigneeSearch(''); }}
                        className="w-full flex items-center justify-between px-3 py-2 text-sm text-left hover:bg-secondary rounded-lg transition-colors mt-1"
                      >
                        <span className="flex items-center gap-2 text-foreground">
                          <Bot size={14} className="text-muted-foreground" /> {inst.role}
                        </span>
                        {assigneeId === inst.id && <Check size={14} className="text-foreground" />}
                      </button>
                    ))}
                  </div>
                </div>
              )}
           </div>

           <div className="pt-2">
              <Textarea
                placeholder={language === 'vi' ? 'Thêm mô tả chi tiết và hướng dẫn...' : 'Add description and instructions...'}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="min-h-[120px]"
                required
              />
           </div>

           <div className="bg-secondary/40 border border-border rounded-xl p-4">
              <h4 className="text-xs font-semibold text-foreground mb-1">
                {language === 'vi' ? 'Thời gian chạy định kỳ' : 'Execution Schedule'}
              </h4>
              <p className="text-xs text-muted-foreground mb-3">
                {language === 'vi' ? 'Khi nào lịch trình này sẽ tạo một nhiệm vụ mới hằng ngày?' : 'When should this routine generate a new issue?'}
              </p>

              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <Select
                    value={scheduleType}
                    onChange={(e) => setScheduleType(e.target.value)}
                    className="flex-1"
                  >
                    {SCHEDULE_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>
                        {language === 'vi'
                          ? (opt.value === '0 9 * * *' ? 'Hằng ngày lúc 9:00 AM'
                             : opt.value === '0 * * * *' ? 'Mỗi giờ'
                             : opt.value === '0 9 * * 1' ? 'Mỗi Thứ Hai lúc 9:00 AM'
                             : 'Tùy chỉnh lịch trình...')
                          : opt.label}
                      </option>
                    ))}
                  </Select>
                </div>

                {scheduleType === 'custom' && (
                  <div className="p-4 rounded-xl border border-border bg-card space-y-4 text-xs text-muted-foreground">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-foreground">
                        {useRawCron
                          ? (language === 'vi' ? 'Cú pháp Cron tùy chỉnh' : 'Raw cron expression')
                          : (language === 'vi' ? 'Trình xây dựng có hướng dẫn' : 'Guided builder')}
                      </span>
                      <button
                        type="button"
                        onClick={() => setUseRawCron(!useRawCron)}
                        className="text-blue-600 dark:text-blue-400 hover:underline text-[11px]"
                      >
                        {useRawCron
                          ? (language === 'vi' ? 'Dùng trình xây dựng có hướng dẫn' : 'Use guided builder instead')
                          : (language === 'vi' ? 'Nhập cú pháp Cron trực tiếp' : 'Enter raw cron expression instead')}
                      </button>
                    </div>

                    {useRawCron ? (
                      <div>
                        <Input
                          type="text"
                          value={rawCronExpr}
                          onChange={(e) => setRawCronExpr(e.target.value)}
                          placeholder="0 9 * * *"
                          className="font-mono py-1.5"
                        />
                        <p className="text-[11px] text-muted-foreground mt-1.5">
                          {language === 'vi' ? 'Định dạng: phút giờ ngày tháng thứ (vd: "0 9 * * *" = 9:00 sáng mỗi ngày).' : 'Format: minute hour day-of-month month day-of-week (e.g. "0 9 * * *" = daily at 9:00 AM).'}
                        </p>
                      </div>
                    ) : (
                    <>
                    <div className="flex items-center gap-2.5">
                      <span>{language === 'vi' ? 'Lặp lại mỗi:' : 'Repeat every:'}</span>
                      <select
                        value={customInterval}
                        onChange={(e: any) => setCustomInterval(e.target.value)}
                        className="bg-secondary border border-border rounded px-2.5 py-1 text-foreground focus:outline-none"
                      >
                        <option value="hours">{language === 'vi' ? 'Giờ' : 'Hour(s)'}</option>
                        <option value="days">{language === 'vi' ? 'Ngày' : 'Day(s)'}</option>
                        <option value="weeks">{language === 'vi' ? 'Tuần' : 'Week(s)'}</option>
                      </select>

                      {customInterval === 'hours' && (
                        <div className="flex items-center gap-1.5">
                          <span>{language === 'vi' ? 'mỗi' : 'every'}</span>
                          <input
                            type="number"
                            min={1}
                            max={23}
                            value={customHoursCount}
                            onChange={(e) => setCustomHoursCount(Math.max(1, Math.min(23, parseInt(e.target.value) || 1)))}
                            className="bg-secondary border border-border rounded w-14 px-2 py-1 text-center text-foreground focus:outline-none font-mono"
                          />
                          <span>{language === 'vi' ? 'giờ' : 'hour(s)'}</span>
                        </div>
                      )}

                      {customInterval === 'days' && (
                        <div className="flex items-center gap-1.5">
                          <span>{language === 'vi' ? 'mỗi' : 'every'}</span>
                          <input
                            type="number"
                            min={1}
                            max={30}
                            value={customDaysCount}
                            onChange={(e) => setCustomDaysCount(Math.max(1, parseInt(e.target.value) || 1))}
                            className="bg-secondary border border-border rounded w-14 px-2 py-1 text-center text-foreground focus:outline-none font-mono"
                          />
                          <span>{language === 'vi' ? 'ngày' : 'day(s)'}</span>
                        </div>
                      )}
                    </div>

                    {customInterval === 'weeks' && (
                      <div className="flex items-center gap-2">
                        <span>{language === 'vi' ? 'Vào Thứ hằng tuần:' : 'On day of week:'}</span>
                        <select
                          value={customDayOfWeek}
                          onChange={(e) => setCustomDayOfWeek(parseInt(e.target.value))}
                          className="bg-secondary border border-border rounded px-2.5 py-1 text-foreground focus:outline-none"
                        >
                          <option value={1}>{language === 'vi' ? 'Thứ Hai' : 'Monday'}</option>
                          <option value={2}>{language === 'vi' ? 'Thứ Ba' : 'Tuesday'}</option>
                          <option value={3}>{language === 'vi' ? 'Thứ Tư' : 'Wednesday'}</option>
                          <option value={4}>{language === 'vi' ? 'Thứ Năm' : 'Thursday'}</option>
                          <option value={5}>{language === 'vi' ? 'Thứ Sáu' : 'Friday'}</option>
                          <option value={6}>{language === 'vi' ? 'Thứ Bảy' : 'Saturday'}</option>
                          <option value={0}>{language === 'vi' ? 'Chủ Nhật' : 'Sunday'}</option>
                        </select>
                      </div>
                    )}

                    {customInterval !== 'hours' && (
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1.5">
                          <span>{language === 'vi' ? 'Vào Lúc Giờ:' : 'At Hour:'}</span>
                          <select
                            value={customHour}
                            onChange={(e) => setCustomHour(parseInt(e.target.value))}
                            className="bg-secondary border border-border rounded px-2.5 py-1 text-foreground focus:outline-none font-mono"
                          >
                            {Array.from({ length: 24 }).map((_, h) => (
                              <option key={h} value={h}>{String(h).padStart(2, '0')}</option>
                            ))}
                          </select>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <span>{language === 'vi' ? 'Phút:' : 'Minute:'}</span>
                          <select
                            value={customMinute}
                            onChange={(e) => setCustomMinute(parseInt(e.target.value))}
                            className="bg-secondary border border-border rounded px-2.5 py-1 text-foreground focus:outline-none font-mono"
                          >
                            {Array.from({ length: 60 }).map((_, m) => (
                              <option key={m} value={m}>{String(m).padStart(2, '0')}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    )}

                    {customInterval === 'hours' && (
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1.5">
                          <span>{language === 'vi' ? 'Vào Lúc Phút:' : 'At Minute:'}</span>
                          <select
                            value={customMinute}
                            onChange={(e) => setCustomMinute(parseInt(e.target.value))}
                            className="bg-secondary border border-border rounded px-2.5 py-1 text-foreground focus:outline-none font-mono"
                          >
                            {Array.from({ length: 60 }).map((_, m) => (
                              <option key={m} value={m}>{String(m).padStart(2, '0')}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    )}
                    </>
                    )}

                    <div className="pt-2 border-t border-border flex items-center justify-between text-[11px] text-muted-foreground">
                      <span>{language === 'vi' ? 'Cú pháp Cron được tạo:' : 'Generated Cron Expression:'}</span>
                      <span className="font-mono text-foreground bg-secondary px-2 py-0.5 rounded border border-border">{computedCron}</span>
                    </div>
                  </div>
                )}
              </div>
           </div>

           <div className="pt-4 flex justify-between items-center border-t border-border mt-6">
              <button type="button" onClick={closeModal} className="text-muted-foreground text-sm hover:text-foreground transition-colors">
                {language === 'vi' ? 'Hủy bỏ' : 'Cancel'}
              </button>
              <Button type="submit">
                {editingRoutineId
                  ? (<>{language === 'vi' ? 'Lưu thay đổi' : 'Save changes'}</>)
                  : (<><Plus size={16} /> {language === 'vi' ? 'Tạo lịch trình' : 'Create routine'}</>)}
              </Button>
           </div>
        </form>
      </Modal>
    </div>
  );
}

export default FleetRoutines;
