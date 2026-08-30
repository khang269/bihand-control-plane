import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { MessageCircle, MessageSquare, Plus, Loader2, Trash2, ChevronLeft, ChevronUp, ChevronDown, Shield, Users, MessagesSquare, Milestone, Webhook, Copy, AlertTriangle, Zap } from 'lucide-react';
import api from '../../lib/api';
import { useLanguage } from '../../context/LanguageContext';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Input, Textarea, Select } from '../../components/ui/Input';
import { cn } from '../../lib/cn';

type StageDef = {
  key: string;
  name: string;
  goal: string;
  exitCriteria: string;
  escalateToHuman: boolean;
  maxTurns?: number | null;
};

type Flow = {
  _id: string;
  name: string;
  platform: string;
  channelType: string;
  pageId?: string | null;
  oaId?: string | null;
  verifyToken?: string | null;
  label?: string | null;
  credentialId?: string | null;
  assignedInstanceId?: string | null;
  createdBy: string;
  access: { instanceId: string; role: string; grantedAt: string }[];
  status: string;
  stages?: StageDef[];
  supportPolicy: {
    mode: string;
    maxMessagesPerDayPerCustomer?: number | null;
    spamKeywords?: string[];
    optOutPhrases?: string[];
    vipTags?: string[];
  };
};

type Conversation = {
  _id: string;
  flowId: string;
  platform: string;
  channelType: string;
  externalThreadId: string;
  status: string;
  mode: string;
  currentStageKey?: string | null;
  lastMessageAt: string;
};

const CHANNEL_TYPE_LABEL: Record<string, string> = {
  page_webhook: 'Facebook Page (Messenger)',
  oa_webhook: 'Zalo Official Account',
  personal_browser: 'Personal Account (browser)',
};

type CardType = 'messenger_page' | 'messenger_personal' | 'zalo_oa' | 'zalo_personal';

const FacebookIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 24 24" className={className}><path fill="#1877F2" d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
);

const CARD_DEFS: { type: CardType; platform: 'messenger' | 'zalo'; channelType: 'page_webhook' | 'oa_webhook' | 'personal_browser'; title: string; description: string; badge: string; badgeTone: 'emerald' | 'amber'; risky: boolean }[] = [
  { type: 'messenger_page', platform: 'messenger', channelType: 'page_webhook', title: 'Messenger — Business Page', description: 'Connect a Facebook Page inbox via Meta\'s official webhook. Replies send instantly through the Send API.', badge: 'Webhook · instant', badgeTone: 'emerald', risky: false },
  { type: 'messenger_personal', platform: 'messenger', channelType: 'personal_browser', title: 'Messenger — Personal Account', description: 'No API exists for personal accounts. An agent\'s VM scrapes and replies through the browser instead.', badge: 'Browser automation', badgeTone: 'amber', risky: true },
  { type: 'zalo_oa', platform: 'zalo', channelType: 'oa_webhook', title: 'Zalo — Official Account', description: 'Connect a Zalo OA inbox via Zalo\'s webhook. Replies send instantly through the OA Send Message API.', badge: 'Webhook · instant', badgeTone: 'emerald', risky: false },
  { type: 'zalo_personal', platform: 'zalo', channelType: 'personal_browser', title: 'Zalo — Personal Account', description: 'No API exists for personal accounts. An agent\'s VM scrapes and replies through the browser instead.', badge: 'Browser automation', badgeTone: 'amber', risky: true },
];

const FleetSupport: React.FC = () => {
  const { fleetId } = useParams<{ fleetId?: string }>();
  const { language } = useLanguage();

  const [flows, setFlows] = useState<Flow[]>([]);
  const [isLoadingFlows, setIsLoadingFlows] = useState(false);
  const [instances, setInstances] = useState<any[]>([]);
  const [credentials, setCredentials] = useState<any[]>([]);

  const [selectedFlowId, setSelectedFlowId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<any | null>(null);

  const [isCreating, setIsCreating] = useState(false);
  const [selectedCardType, setSelectedCardType] = useState<CardType | null>(null);
  const [newPlatform, setNewPlatform] = useState<'messenger' | 'zalo'>('messenger');
  const [newChannelType, setNewChannelType] = useState<'page_webhook' | 'oa_webhook' | 'personal_browser'>('page_webhook');
  const [newName, setNewName] = useState('');
  const [newCredentialId, setNewCredentialId] = useState('');
  const [newPageOrOaId, setNewPageOrOaId] = useState('');
  const [newVerifyToken, setNewVerifyToken] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newAssignedInstanceId, setNewAssignedInstanceId] = useState('');
  const [creating, setCreating] = useState(false);

  const fetchFlows = async () => {
    if (!fleetId) return;
    setIsLoadingFlows(true);
    try {
      const res = await api.get(`/fleets/${fleetId}/flows`);
      setFlows(res.data.flows || []);
    } catch (e) {
      console.error('Failed to fetch flows', e);
    } finally {
      setIsLoadingFlows(false);
    }
  };

  const fetchInstances = async () => {
    if (!fleetId) return;
    try {
      const res = await api.get(`/fleets/${fleetId}`);
      setInstances(res.data.instances || []);
    } catch (e) {
      console.error('Failed to fetch instances', e);
    }
  };

  const fetchCredentials = async () => {
    try {
      const res = await api.get('/credentials');
      setCredentials((res.data.credentials || []).filter((c: any) => c.type === 'social_facebook' || c.type === 'social_zalo'));
    } catch (e) {
      console.error('Failed to fetch credentials', e);
    }
  };

  useEffect(() => {
    fetchFlows();
    fetchInstances();
    fetchCredentials();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fleetId]);

  const fetchConversations = async (flowId: string) => {
    if (!fleetId) return;
    try {
      const res = await api.get(`/fleets/${fleetId}/conversations`);
      const all: Conversation[] = res.data.conversations || [];
      setConversations(all.filter(c => c.flowId === flowId));
    } catch (e) {
      console.error('Failed to fetch conversations', e);
    }
  };

  useEffect(() => {
    if (selectedFlowId) {
      fetchConversations(selectedFlowId);
      setSelectedConversation(null);
      const flow = flows.find(f => f._id === selectedFlowId);
      setStagesDraft(flow?.stages ? flow.stages.map(s => ({ ...s })) : []);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFlowId]);

  const openConversation = async (conversationId: string) => {
    if (!fleetId) return;
    try {
      const res = await api.get(`/fleets/${fleetId}/conversations/${conversationId}`);
      setSelectedConversation(res.data);
    } catch (e) {
      console.error('Failed to load conversation detail', e);
    }
  };

  const resetCreateForm = () => {
    setIsCreating(false);
    setSelectedCardType(null);
    setNewName('');
    setNewCredentialId('');
    setNewPageOrOaId('');
    setNewVerifyToken('');
    setNewLabel('');
    setNewAssignedInstanceId('');
  };

  const selectCard = (card: CardType) => {
    const def = CARD_DEFS.find(c => c.type === card)!;
    setNewPlatform(def.platform);
    setNewChannelType(def.channelType);
    setNewName('');
    setNewCredentialId('');
    setNewPageOrOaId('');
    setNewVerifyToken('');
    setNewLabel('');
    setNewAssignedInstanceId('');
    setSelectedCardType(card);
  };

  const handleCreateFlow = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fleetId) return;
    if (!newName.trim()) {
      alert('Name is required.');
      return;
    }
    if (newChannelType === 'personal_browser' && !newAssignedInstanceId) {
      alert('Personal-account flows require an assigned agent (the channel_sync.py script installs on that agent\'s VM).');
      return;
    }
    if (newChannelType !== 'personal_browser' && !newCredentialId) {
      alert('A credential is required for business (Page/OA) flows.');
      return;
    }

    setCreating(true);
    try {
      const payload: any = {
        name: newName,
        platform: newPlatform,
        channelType: newChannelType,
      };
      if (newChannelType === 'personal_browser') {
        payload.assignedInstanceId = newAssignedInstanceId;
        payload.label = newLabel;
      } else {
        payload.credentialId = newCredentialId;
        payload.verifyToken = newVerifyToken;
        if (newPlatform === 'messenger') {
          payload.pageId = newPageOrOaId;
        } else {
          payload.oaId = newPageOrOaId;
        }
        if (newAssignedInstanceId) {
          payload.assignedInstanceId = newAssignedInstanceId;
        }
      }
      await api.post(`/fleets/${fleetId}/flows`, payload);
      resetCreateForm();
      fetchFlows();
    } catch (e: any) {
      console.error(e);
      alert(e.response?.data?.detail || 'Failed to create flow.');
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteFlow = async (flowId: string) => {
    if (!fleetId) return;
    if (!window.confirm('Delete this flow? Its conversation history is kept, but the channel connection is removed.')) return;
    try {
      await api.delete(`/fleets/${fleetId}/flows/${flowId}`);
      if (selectedFlowId === flowId) setSelectedFlowId(null);
      fetchFlows();
    } catch (e: any) {
      console.error(e);
      alert(e.response?.data?.detail || 'Failed to delete flow.');
    }
  };

  const handleReassign = async (flowId: string, instanceId: string) => {
    if (!fleetId || !instanceId) return;
    try {
      await api.post(`/fleets/${fleetId}/flows/${flowId}/reassign`, { instanceId });
      fetchFlows();
    } catch (e: any) {
      console.error(e);
      alert(e.response?.data?.detail || 'Failed to reassign flow.');
    }
  };

  const handleUpdatePolicy = async (flowId: string, supportPolicy: Flow['supportPolicy']) => {
    if (!fleetId) return;
    try {
      await api.patch(`/fleets/${fleetId}/flows/${flowId}`, { supportPolicy });
      fetchFlows();
    } catch (e: any) {
      console.error(e);
      alert(e.response?.data?.detail || 'Failed to update policy.');
    }
  };

  const [stagesDraft, setStagesDraft] = useState<StageDef[] | null>(null);
  const [savingStages, setSavingStages] = useState(false);

  const newStageKey = () => `stage_${Date.now().toString(36)}`;

  const addStage = () => {
    setStagesDraft(prev => [...(prev || []), { key: newStageKey(), name: '', goal: '', exitCriteria: '', escalateToHuman: false, maxTurns: null }]);
  };

  const updateStageField = (index: number, field: keyof StageDef, value: any) => {
    setStagesDraft(prev => {
      if (!prev) return prev;
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const moveStage = (index: number, direction: -1 | 1) => {
    setStagesDraft(prev => {
      if (!prev) return prev;
      const target = index + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const removeStage = (index: number) => {
    setStagesDraft(prev => (prev ? prev.filter((_, i) => i !== index) : prev));
  };

  const handleSaveStages = async (flowId: string) => {
    if (!fleetId || !stagesDraft) return;
    const names = stagesDraft.map(s => s.key);
    if (new Set(names).size !== names.length) {
      alert('Stage keys must be unique.');
      return;
    }
    if (stagesDraft.some(s => !s.name.trim())) {
      alert('Every stage needs a name.');
      return;
    }
    setSavingStages(true);
    try {
      await api.patch(`/fleets/${fleetId}/flows/${flowId}`, { stages: stagesDraft });
      await fetchFlows();
    } catch (e: any) {
      console.error(e);
      alert(e.response?.data?.detail || 'Failed to save funnel.');
    } finally {
      setSavingStages(false);
    }
  };

  const handleGrantAccess = async (flowId: string, instanceId: string, role: string) => {
    if (!fleetId || !instanceId) return;
    try {
      await api.post(`/fleets/${fleetId}/flows/${flowId}/access`, { instanceId, role });
      fetchFlows();
    } catch (e: any) {
      console.error(e);
      alert(e.response?.data?.detail || 'Failed to grant access.');
    }
  };

  const handleRevokeAccess = async (flowId: string, instanceId: string) => {
    if (!fleetId) return;
    try {
      await api.delete(`/fleets/${fleetId}/flows/${flowId}/access/${instanceId}`);
      fetchFlows();
    } catch (e: any) {
      console.error(e);
      alert(e.response?.data?.detail || 'Failed to revoke access.');
    }
  };

  const stageName = (stageKey?: string | null) => {
    if (!stageKey) return 'No funnel';
    const stage = (selectedFlow?.stages || []).find(s => s.key === stageKey);
    return stage ? stage.name : stageKey;
  };

  const webhookUrl = (platform: string) => `${window.location.origin}/api/webhooks/${platform}`;

  const copyToClipboard = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
    } catch (e) {
      console.error('Failed to copy to clipboard', e);
    }
  };

  const instanceLabel = (instanceId?: string | null) => {
    if (!instanceId) return 'Unassigned';
    const inst = instances.find((i: any) => i.id === instanceId);
    if (!inst) return instanceId;
    return inst.title ? `${inst.role} (${inst.title})` : inst.role;
  };

  const selectedFlow = flows.find(f => f._id === selectedFlowId) || null;

  if (selectedFlowId && selectedFlow) {
    return (
      <div className="p-8 h-full flex flex-col text-left overflow-hidden">
        <div className="mb-6 border-b border-border pb-4 flex items-center gap-3">
          <button onClick={() => setSelectedFlowId(null)} className="text-muted-foreground hover:text-foreground">
            <ChevronLeft size={20} />
          </button>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
              <MessageCircle className="text-purple-500" size={22} /> {selectedFlow.name}
            </h1>
            <p className="text-muted-foreground text-sm mt-1">{CHANNEL_TYPE_LABEL[selectedFlow.channelType] || selectedFlow.channelType}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 overflow-hidden">
          {/* Policy + assignment + access column */}
          <div className="col-span-1 h-full overflow-y-auto pr-2 space-y-6">
            {(selectedFlow.channelType === 'page_webhook' || selectedFlow.channelType === 'oa_webhook') && (
              <Card className="space-y-3">
                <h3 className="font-semibold text-foreground text-sm flex items-center gap-2"><Webhook size={16} className="text-purple-500" /> Webhook Setup</h3>
                <p className="text-xs text-muted-foreground">
                  Paste these into {selectedFlow.platform === 'messenger' ? "Meta's App Dashboard (Messenger > Settings > Webhooks)" : "the Zalo OA developer console"} to finish connecting this channel.
                </p>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Callback URL</label>
                  <div className="flex gap-2">
                    <Input
                      type="text"
                      readOnly
                      value={webhookUrl(selectedFlow.platform)}
                      onFocus={(e) => e.target.select()}
                      className="flex-1 text-xs px-2.5 py-1.5 font-mono"
                    />
                    <button type="button" onClick={() => copyToClipboard(webhookUrl(selectedFlow.platform))} className="px-2.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-secondary">
                      <Copy size={13} />
                    </button>
                  </div>
                </div>
                {selectedFlow.platform === 'messenger' && (
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Verify Token</label>
                    <div className="flex gap-2">
                      <Input
                        type="text"
                        readOnly
                        value={selectedFlow.verifyToken || ''}
                        onFocus={(e) => e.target.select()}
                        className="flex-1 text-xs px-2.5 py-1.5 font-mono"
                      />
                      <button type="button" onClick={() => copyToClipboard(selectedFlow.verifyToken || '')} className="px-2.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-secondary">
                        <Copy size={13} />
                      </button>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">This is the token you entered when creating this flow - Meta echoes it back during the webhook handshake to prove the request is legitimate.</p>
                  </div>
                )}
              </Card>
            )}

            <Card className="space-y-3">
              <h3 className="font-semibold text-foreground text-sm flex items-center gap-2"><Shield size={16} className="text-purple-500" /> Engagement Policy</h3>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Mode</label>
                <Select
                  value={selectedFlow.supportPolicy?.mode || 'draft'}
                  onChange={(e) => handleUpdatePolicy(selectedFlow._id, { ...selectedFlow.supportPolicy, mode: e.target.value })}
                  className="text-xs px-2.5 py-1.5"
                >
                  <option value="draft">Draft (shadow mode - human approves every reply)</option>
                  <option value="auto">Auto (agent replies directly)</option>
                  <option value="human_only">Human only (agent never replies)</option>
                </Select>
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Max messages/day per customer (blank = unlimited)</label>
                <Input
                  type="number"
                  defaultValue={selectedFlow.supportPolicy?.maxMessagesPerDayPerCustomer ?? ''}
                  onBlur={(e) => handleUpdatePolicy(selectedFlow._id, { ...selectedFlow.supportPolicy, maxMessagesPerDayPerCustomer: e.target.value ? parseInt(e.target.value, 10) : null })}
                  className="text-xs px-2.5 py-1.5"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Spam keywords (comma-separated)</label>
                <Input
                  type="text"
                  defaultValue={(selectedFlow.supportPolicy?.spamKeywords || []).join(', ')}
                  onBlur={(e) => handleUpdatePolicy(selectedFlow._id, { ...selectedFlow.supportPolicy, spamKeywords: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                  className="text-xs px-2.5 py-1.5"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Opt-out phrases (comma-separated)</label>
                <Input
                  type="text"
                  defaultValue={(selectedFlow.supportPolicy?.optOutPhrases || []).join(', ')}
                  onBlur={(e) => handleUpdatePolicy(selectedFlow._id, { ...selectedFlow.supportPolicy, optOutPhrases: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                  className="text-xs px-2.5 py-1.5"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">VIP tags exempt from daily cap (comma-separated)</label>
                <Input
                  type="text"
                  defaultValue={(selectedFlow.supportPolicy?.vipTags || []).join(', ')}
                  onBlur={(e) => handleUpdatePolicy(selectedFlow._id, { ...selectedFlow.supportPolicy, vipTags: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                  className="text-xs px-2.5 py-1.5"
                />
              </div>
            </Card>

            <Card className="space-y-3">
              <h3 className="font-semibold text-foreground text-sm flex items-center gap-2"><Milestone size={16} className="text-purple-500" /> Conversation Flow</h3>
              <p className="text-xs text-muted-foreground">
                Customizable funnel this flow's conversations move through (e.g. greeting → qualification → close). Leave empty for a flow that just responds without stage tracking.
              </p>

              {(stagesDraft || []).length === 0 ? (
                <p className="text-xs text-muted-foreground py-2">No stages defined - this flow responds without funnel tracking.</p>
              ) : (
                <div className="space-y-3">
                  {(stagesDraft || []).map((stage, idx) => (
                    <div key={stage.key} className="border border-border rounded-lg p-3 space-y-2 bg-secondary/50">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Stage {idx + 1}</span>
                        <div className="flex items-center gap-1">
                          <button type="button" onClick={() => moveStage(idx, -1)} disabled={idx === 0} className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"><ChevronUp size={13} /></button>
                          <button type="button" onClick={() => moveStage(idx, 1)} disabled={idx === (stagesDraft?.length || 0) - 1} className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"><ChevronDown size={13} /></button>
                          <button type="button" onClick={() => removeStage(idx)} className="p-1 text-red-500 hover:text-red-400"><Trash2 size={13} /></button>
                        </div>
                      </div>
                      <Input
                        type="text"
                        value={stage.name}
                        onChange={(e) => updateStageField(idx, 'name', e.target.value)}
                        placeholder="Stage name (e.g. Qualification)"
                        className="text-xs px-2.5 py-1.5"
                      />
                      <Textarea
                        value={stage.goal}
                        onChange={(e) => updateStageField(idx, 'goal', e.target.value)}
                        placeholder="Goal - what should the agent accomplish in this stage?"
                        rows={2}
                        className="text-xs px-2.5 py-1.5 resize-none"
                      />
                      <Textarea
                        value={stage.exitCriteria}
                        onChange={(e) => updateStageField(idx, 'exitCriteria', e.target.value)}
                        placeholder="Exit criteria - what must be true to move to the next stage?"
                        rows={2}
                        className="text-xs px-2.5 py-1.5 resize-none"
                      />
                      <div className="flex items-center gap-4">
                        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <input type="checkbox" checked={stage.escalateToHuman} onChange={(e) => updateStageField(idx, 'escalateToHuman', e.target.checked)} />
                          Escalate to human on completion
                        </label>
                        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          Max turns
                          <Input
                            type="number"
                            value={stage.maxTurns ?? ''}
                            onChange={(e) => updateStageField(idx, 'maxTurns', e.target.value ? parseInt(e.target.value, 10) : null)}
                            className="w-16 text-xs px-2 py-1"
                          />
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex justify-between items-center pt-2 border-t border-border">
                <button type="button" onClick={addStage} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
                  <Plus size={13} /> Add Stage
                </button>
                <Button
                  type="button"
                  onClick={() => handleSaveStages(selectedFlow._id)}
                  disabled={savingStages}
                  size="sm"
                >
                  {savingStages ? <Loader2 size={13} className="animate-spin" /> : null} Save Funnel
                </Button>
              </div>
            </Card>

            <Card className="space-y-3">
              <h3 className="font-semibold text-foreground text-sm flex items-center gap-2"><Users size={16} className="text-purple-500" /> Assigned Agent</h3>
              <p className="text-xs text-muted-foreground">Which agent currently operates this flow. Reassigning takes effect immediately for all its conversations.</p>
              <Select
                value={selectedFlow.assignedInstanceId || ''}
                onChange={(e) => handleReassign(selectedFlow._id, e.target.value)}
                className="text-xs px-2.5 py-1.5"
              >
                <option value="" disabled>Select agent...</option>
                {instances.map((i: any) => (
                  <option key={i.id} value={i.id}>{i.role} ({i.title})</option>
                ))}
              </Select>
            </Card>

            <Card className="space-y-3">
              <h3 className="font-semibold text-foreground text-sm">Access</h3>
              <p className="text-xs text-muted-foreground">Agents granted permission to view/edit this flow beyond whoever created it.</p>
              {(selectedFlow.access || []).length === 0 ? (
                <p className="text-xs text-muted-foreground">No additional grants.</p>
              ) : (
                <div className="space-y-2">
                  {selectedFlow.access.map(grant => (
                    <div key={grant.instanceId} className="flex items-center justify-between text-xs border border-border rounded-lg px-2.5 py-1.5">
                      <span>{instanceLabel(grant.instanceId)} <span className="text-muted-foreground">({grant.role})</span></span>
                      <button onClick={() => handleRevokeAccess(selectedFlow._id, grant.instanceId)} className="text-red-500 hover:text-red-400">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-2 pt-2 border-t border-border">
                <Select id="grant-instance-select" className="flex-1 text-xs px-2 py-1.5">
                  <option value="">Select agent...</option>
                  {instances.map((i: any) => (
                    <option key={i.id} value={i.id}>{i.role} ({i.title})</option>
                  ))}
                </Select>
                <Select id="grant-role-select" className="w-auto text-xs px-2 py-1.5">
                  <option value="viewer">viewer</option>
                  <option value="editor">editor</option>
                  <option value="owner">owner</option>
                </Select>
                <Button
                  onClick={() => {
                    const instSel = document.getElementById('grant-instance-select') as HTMLSelectElement;
                    const roleSel = document.getElementById('grant-role-select') as HTMLSelectElement;
                    handleGrantAccess(selectedFlow._id, instSel.value, roleSel.value);
                  }}
                  size="sm"
                >
                  Grant
                </Button>
              </div>
            </Card>
          </div>

          {/* Conversations column */}
          <div className="col-span-1 h-full overflow-y-auto pr-2">
            <Card noPadding className="p-4">
              <h3 className="font-semibold text-foreground text-sm mb-3 flex items-center gap-2"><MessagesSquare size={16} className="text-purple-500" /> Conversations</h3>
              {conversations.length === 0 ? (
                <p className="text-xs text-muted-foreground p-4 text-center">No conversations yet.</p>
              ) : (
                <div className="space-y-2">
                  {conversations.map(c => (
                    <button
                      key={c._id}
                      onClick={() => openConversation(c._id)}
                      className={cn(
                        'w-full text-left border rounded-lg px-3 py-2 text-xs transition-colors',
                        selectedConversation?.conversation?._id === c._id ? 'border-purple-500/40 bg-purple-500/5' : 'border-border hover:border-ring/40'
                      )}
                    >
                      <div className="flex justify-between">
                        <span className="font-mono">{c.externalThreadId}</span>
                        <span className="text-muted-foreground">{c.status}</span>
                      </div>
                      <div className="flex justify-between items-center mt-1">
                        <span className="text-muted-foreground">{new Date(c.lastMessageAt).toLocaleString()}</span>
                        <span className="text-purple-500/80">{stageName(c.currentStageKey)}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </Card>
          </div>

          {/* Conversation detail column */}
          <div className="col-span-1 h-full overflow-y-auto pr-2">
            <Card noPadding className="p-4 h-full">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-foreground text-sm">Message History</h3>
                {selectedConversation?.conversation && (
                  <span className="text-xs font-semibold uppercase tracking-wider text-purple-500/80">{stageName(selectedConversation.conversation.currentStageKey)}</span>
                )}
              </div>
              {!selectedConversation ? (
                <p className="text-xs text-muted-foreground p-4 text-center">Select a conversation to view its history.</p>
              ) : (
                <div className="space-y-2">
                  {(selectedConversation.messages || []).map((m: any) => (
                    <div key={m._id} className={cn('text-xs rounded-lg px-3 py-2', m.direction === 'inbound' ? 'bg-secondary' : 'bg-purple-500/10')}>
                      <div className="text-muted-foreground mb-1">{m.direction === 'inbound' ? 'Customer' : 'Agent'} &middot; {m.status}</div>
                      <div className="whitespace-pre-wrap">{m.content}</div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 h-full flex flex-col text-left overflow-hidden">
      <div className="mb-6 border-b border-border pb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <MessageCircle className="text-purple-500" size={24} /> {language === 'vi' ? 'Chăm sóc Khách hàng' : 'Customer Support'}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {language === 'vi' ? 'Kết nối Messenger/Zalo và cấu hình đại lý AI trả lời khách hàng.' : 'Connect Messenger/Zalo channels and configure agents to handle customer conversations.'}
          </p>
        </div>
        {!isCreating && (
          <Button onClick={() => setIsCreating(true)}>
            <Plus size={16} /> New Flow
          </Button>
        )}
      </div>

      {isCreating && !selectedCardType && (
        <Card className="mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-foreground text-sm">Choose a channel type</h3>
            <button type="button" onClick={resetCreateForm} className="text-xs text-muted-foreground hover:text-foreground">Cancel</button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {CARD_DEFS.map(card => (
              <button
                key={card.type}
                type="button"
                onClick={() => selectCard(card.type)}
                className="text-left border border-border rounded-xl p-4 hover:border-ring/40 hover:bg-secondary transition-colors"
              >
                <div className="flex items-start gap-3 mb-2">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center p-2 shrink-0 ${card.platform === 'messenger' ? 'bg-white' : 'bg-[#0068FF]/10'}`}>
                    {card.platform === 'messenger' ? (
                      <FacebookIcon className={`w-full h-full ${card.risky ? 'opacity-50' : ''}`} />
                    ) : (
                      <MessageSquare className={card.risky ? 'text-[#0068FF]/50' : 'text-[#0068FF]'} size={20} />
                    )}
                  </div>
                  <div>
                    <h4 className="font-semibold text-sm text-foreground">{card.title}</h4>
                    <span className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-semibold mt-1 px-1.5 py-0.5 rounded ${card.badgeTone === 'emerald' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'}`}>
                      {card.badgeTone === 'emerald' ? <Zap size={10} /> : <AlertTriangle size={10} />}
                      {card.badge}
                    </span>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">{card.description}</p>
              </button>
            ))}
          </div>
        </Card>
      )}

      {isCreating && selectedCardType && (
        <form onSubmit={handleCreateFlow} className="rounded-2xl border border-border bg-card p-5 space-y-4 mb-6">
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => setSelectedCardType(null)} className="text-muted-foreground hover:text-foreground">
              <ChevronLeft size={18} />
            </button>
            <h3 className="font-semibold text-foreground text-sm">{CARD_DEFS.find(c => c.type === selectedCardType)!.title}</h3>
          </div>

          {selectedCardType === 'messenger_page' && (
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Name</label>
                <Input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Support Page Inbox" className="text-xs px-2.5 py-1.5" required />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Page ID</label>
                <Input type="text" value={newPageOrOaId} onChange={(e) => setNewPageOrOaId(e.target.value)} className="text-xs px-2.5 py-1.5 font-mono" required />
                <p className="text-xs text-muted-foreground mt-1">Found in Meta Business Suite &gt; Page Settings &gt; About.</p>
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Webhook Verify Token</label>
                <Input type="text" value={newVerifyToken} onChange={(e) => setNewVerifyToken(e.target.value)} className="text-xs px-2.5 py-1.5 font-mono" required />
                <p className="text-xs text-muted-foreground mt-1">Any string you choose - Meta echoes it back during the webhook handshake.</p>
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Credential (Facebook Page access token)</label>
                <Select value={newCredentialId} onChange={(e) => setNewCredentialId(e.target.value)} className="text-xs px-2.5 py-1.5" required>
                  <option value="" disabled>Select credential...</option>
                  {credentials.filter((c: any) => c.type === 'social_facebook').map((c: any) => (
                    <option key={c._id} value={c._id}>{c.name}</option>
                  ))}
                </Select>
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Assigned Agent (optional - reply generation doesn't need a VM for this tier, only persona attribution)</label>
                <Select value={newAssignedInstanceId} onChange={(e) => setNewAssignedInstanceId(e.target.value)} className="text-xs px-2.5 py-1.5">
                  <option value="">Unassigned (assign later)</option>
                  {instances.map((i: any) => (
                    <option key={i.id} value={i.id}>{i.role} ({i.title})</option>
                  ))}
                </Select>
              </div>
            </div>
          )}

          {selectedCardType === 'zalo_oa' && (
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Name</label>
                <Input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Zalo OA Support" className="text-xs px-2.5 py-1.5" required />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">OA ID</label>
                <Input type="text" value={newPageOrOaId} onChange={(e) => setNewPageOrOaId(e.target.value)} className="text-xs px-2.5 py-1.5 font-mono" required />
                <p className="text-xs text-muted-foreground mt-1">Found in the Zalo OA Manager dashboard.</p>
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Credential (Zalo OA access token)</label>
                <Select value={newCredentialId} onChange={(e) => setNewCredentialId(e.target.value)} className="text-xs px-2.5 py-1.5" required>
                  <option value="" disabled>Select credential...</option>
                  {credentials.filter((c: any) => c.type === 'social_zalo').map((c: any) => (
                    <option key={c._id} value={c._id}>{c.name}</option>
                  ))}
                </Select>
                {credentials.filter((c: any) => c.type === 'social_zalo').length === 0 && (
                  <p className="text-[10px] text-amber-500 dark:text-amber-400 mt-1">No Zalo OA credentials yet - add one from the Vault tab first.</p>
                )}
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Assigned Agent (optional - reply generation doesn't need a VM for this tier, only persona attribution)</label>
                <Select value={newAssignedInstanceId} onChange={(e) => setNewAssignedInstanceId(e.target.value)} className="text-xs px-2.5 py-1.5">
                  <option value="">Unassigned (assign later)</option>
                  {instances.map((i: any) => (
                    <option key={i.id} value={i.id}>{i.role} ({i.title})</option>
                  ))}
                </Select>
              </div>
            </div>
          )}

          {(selectedCardType === 'messenger_personal' || selectedCardType === 'zalo_personal') && (
            <div className="space-y-4">
              <div className="flex items-start gap-2 border border-amber-500/20 bg-amber-500/5 rounded-lg p-3">
                <AlertTriangle size={14} className="text-amber-500 dark:text-amber-400 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-700 dark:text-amber-200/90">
                  Automating a personal account this way is against {selectedCardType === 'messenger_personal' ? "Meta's" : "Zalo's"} Terms of Service and risks the account being flagged or banned.
                  It also requires the account to already be logged into the assigned agent's VM via VNC - this endpoint does not handle login or 2FA.
                  Conversations on this channel default to draft-only regardless of the flow's mode.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Name</label>
                  <Input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Personal Support Account" className="text-xs px-2.5 py-1.5" required />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Label</label>
                  <Input type="text" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Which personal account is this?" className="text-xs px-2.5 py-1.5" />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Assigned Agent (required - installs channel_sync.py on this agent's VM)</label>
                  <Select value={newAssignedInstanceId} onChange={(e) => setNewAssignedInstanceId(e.target.value)} className="text-xs px-2.5 py-1.5" required>
                    <option value="">Select agent...</option>
                    {instances.map((i: any) => (
                      <option key={i.id} value={i.id}>{i.role} ({i.title})</option>
                    ))}
                  </Select>
                </div>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <Button type="button" variant="ghost" onClick={resetCreateForm} size="sm">Cancel</Button>
            <Button type="submit" disabled={creating} size="sm">
              {creating ? <Loader2 size={14} className="animate-spin" /> : null} Create Flow
            </Button>
          </div>
        </form>
      )}

      <div className="flex-1 overflow-y-auto">
        {isLoadingFlows ? (
          <div className="text-center p-12 text-muted-foreground text-sm">Loading flows...</div>
        ) : flows.length === 0 ? (
          <div className="text-center p-12 border border-dashed border-border rounded-xl text-muted-foreground">
            No customer-support flows yet. Create one to connect a Messenger or Zalo inbox.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {flows.map(flow => (
              <Card key={flow._id} className="hover:border-ring/40 transition-colors">
                <div className="flex items-start justify-between mb-2">
                  <h3 className="font-semibold text-foreground">{flow.name}</h3>
                  <button onClick={() => handleDeleteFlow(flow._id)} className="text-red-500 hover:text-red-400">
                    <Trash2 size={14} />
                  </button>
                </div>
                <p className="text-xs text-muted-foreground mb-3">{CHANNEL_TYPE_LABEL[flow.channelType] || flow.channelType}</p>
                <div className="flex items-center gap-2 text-xs text-muted-foreground mb-4">
                  <Badge variant={flow.status === 'active' ? 'success' : 'neutral'} className="uppercase">{flow.status}</Badge>
                  <span>&middot;</span>
                  <span>{flow.supportPolicy?.mode || 'draft'}</span>
                </div>
                <div className="text-xs text-muted-foreground mb-4">Agent: {instanceLabel(flow.assignedInstanceId)}</div>
                <Button
                  onClick={() => setSelectedFlowId(flow._id)}
                  variant="outline"
                  size="sm"
                  className="w-full"
                >
                  Manage
                </Button>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default FleetSupport;
