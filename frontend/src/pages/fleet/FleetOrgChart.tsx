import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Network, Trash2, Tv2, TerminalSquare, Plus, Play, Square, Loader2 } from 'lucide-react';
import OrgChartFlow from '../../components/OrgChartFlow';
import AgentLogsModal from '../../components/AgentLogsModal';
import { useAuth } from '../../context/AuthContext';
import api from '../../lib/api';
import { AvatarImage } from '../../components/AvatarImage';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { Input, Select } from '../../components/ui/Input';
import { cn } from '../../lib/cn';

const FleetOrgChart: React.FC = () => {
  const { fleetId } = useParams<{ fleetId?: string }>();
  const { user } = useAuth();
  const [fleetDetails, setFleetDetails] = useState<any>(null);

  const [viewingLogsAgent, setViewingLogsAgent] = useState<any>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  // States for adding a new agent
  const [newAgentRole, setNewAgentRole] = useState('Engineer');
  const [newAgentTitle, setNewAgentTitle] = useState('Software Developer');
  const [newAgentType, setNewAgentType] = useState('opencode');
  const [newAgentProvider, setNewAgentTypeProvider] = useState('anthropic');
  const [newAgentApiKey, setNewAgentApiKey] = useState('');
  const [newAgentUseSubscription, setNewAgentUseSubscription] = useState(false);
  const [newAgentOauthToken, setNewAgentOauthToken] = useState('');
  const [newAgentModel, setNewAgentModel] = useState('claude-sonnet-4-6');
  const [newAgentReportsTo, setNewAgentReportsTo] = useState('');
  const [newAgentDurationDays, setNewAgentDurationDays] = useState(30); // Default to 30 days
  const [newAgentMachineType, setNewAgentMachineType] = useState('e2-small'); // Default to e2-small
  const [isAddingAgent, setIsAddingAgent] = useState(false);
  const [existingCredentials, setExistingCredentials] = useState<any[]>([]);
  const [newAgentAvatarHash, setNewAgentAvatarHash] = useState('99d68008c17ea62c9c497582b58dc8b3'); // default to robot
  const [avatarLibrary, setAvatarLibrary] = useState<any[]>([]);
  const [isAvatarModalOpen, setIsAvatarModalOpen] = useState(false);
  const [avatarModalSearch, setAvatarModalSearch] = useState('');

  useEffect(() => {
    if (isAddModalOpen) {
      api.get('/credentials')
        .then(res => setExistingCredentials(res.data.credentials || []))
        .catch(console.error);

      api.get('/avatar/library')
        .then(res => setAvatarLibrary(res.data.library || []))
        .catch(console.error);
    }
  }, [isAddModalOpen]);

  const modelOptionsByProvider: Record<string, string[]> = {
    gemini: [
      'gemini-2.5-flash',
      'gemini-2.5-pro',
      'gemini-2.5-flash-lite',
      'gemini-3.5-flash',
      'gemini-3.1-pro-preview',
      'gemini-3.1-flash-lite',
      'gemini-3-flash-preview'
    ],
    openai: [
      'gpt-5.5',
      'gpt-5.4',
      'gpt-5.4-mini',
      'gpt-5.4-nano',
      'gpt-4o-mini'
    ],
    anthropic: [
      'claude-opus-4-8',
      'claude-opus-4-7',
      'claude-sonnet-4-6',
      'claude-haiku-4-5'
    ],
    deepseek: [
      'deepseek-chat',
      'deepseek-coder'
    ]
  };

  const defaultModels: Record<string, string> = {
    anthropic: 'claude-sonnet-4-6',
    openai: 'gpt-5.5',
    gemini: 'gemini-2.5-flash',
    deepseek: 'deepseek-chat',
  };

  const handleProviderChange = (prov: string) => {
    setNewAgentTypeProvider(prov);
    setNewAgentModel(defaultModels[prov] || '');
  };

  const fetchFleetDetails = async () => {
    try {
      const res = await api.get(`/fleets/${fleetId}`);
      setFleetDetails(res.data);
    } catch (e) {
      console.error(e);
    }
  };

  const handleAddAgentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const usesClaudeSubscription = newAgentType === 'claudecode' && newAgentUseSubscription;
    if (!newAgentRole) return;
    if (usesClaudeSubscription ? !newAgentOauthToken.trim() : !newAgentApiKey) return;
    setIsAddingAgent(true);

    // Convert durationDays to durationMonths (Backend expects durationMonths or we use durationDays on add endpoint)
    // To ensure exact day accuracy, we can pass durationDays on backend as well. Let's see what endpoint accepts
    const calculatedMonths = Math.max(1, Math.round(newAgentDurationDays / 30));
    try {
      await api.post(`/fleets/${fleetId}/instances`, {
        agent: {
          role: newAgentRole,
          title: newAgentTitle || newAgentRole,
          reportsTo: newAgentReportsTo || null,
          agentType: newAgentType,
          provider: newAgentProvider,
          apiKey: usesClaudeSubscription ? '' : newAgentApiKey,
          oauthToken: usesClaudeSubscription ? newAgentOauthToken : null,
          model: newAgentModel || null,
          durationMonths: calculatedMonths, // Fallback compatibility
          durationDays: newAgentDurationDays, // Explicit days
          machineType: newAgentMachineType,
          agentMd: "",
          soulMd: "",
          toolsMd: "",
          mcpConfig: "",
          enabledSkills: [],
          avatarHash: newAgentAvatarHash || null
        }
      });
      setIsAddModalOpen(false);
      setNewAgentRole('');
      setNewAgentTitle('');
      setNewAgentApiKey('');
      setNewAgentUseSubscription(false);
      setNewAgentOauthToken('');
      setNewAgentModel('');
      setNewAgentReportsTo('');
      setNewAgentDurationDays(30);
      setNewAgentMachineType('e2-small');
      setNewAgentAvatarHash('99d68008c17ea62c9c497582b58dc8b3');
      fetchFleetDetails();
    } catch (err: any) {
      alert(err.response?.data?.detail || "Failed to add agent to fleet.");
    } finally {
      setIsAddingAgent(false);
    }
  };

  useEffect(() => {
    if (fleetId) fetchFleetDetails();
  }, [fleetId]);

  const handleDeleteAgent = async (instanceId: string, role: string) => {
    if (!window.confirm(`Are you sure you want to permanently destroy the ${role} agent?`)) return;
    try {
      await api.delete(`/fleets/${fleetId}/instances/${instanceId}`);
      fetchFleetDetails();
    } catch (e: any) {
      alert(e.response?.data?.detail || "Failed to destroy agent");
    }
  };

  const handleStartAgent = async (instanceId: string) => {
    try {
      await api.post(`/fleets/${fleetId}/instances/${instanceId}/start`);
      fetchFleetDetails();
    } catch (e: any) {
      alert(e.response?.data?.detail || "Failed to start agent");
    }
  };

  const handleStopAgent = async (instanceId: string) => {
    try {
      await api.post(`/fleets/${fleetId}/instances/${instanceId}/stop`);
      fetchFleetDetails();
    } catch (e: any) {
      alert(e.response?.data?.detail || "Failed to stop agent");
    }
  };

  if (!fleetDetails) return <div className="p-8 text-muted-foreground">Loading org chart...</div>;

  return (
    <div className="p-8 h-full flex flex-col overflow-y-auto">
      <div className="flex items-center justify-between mb-6 border-b border-border pb-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Network className="text-pink-500" size={24} /> Organization Chart
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Manage your autonomous employees and their physical runtimes.</p>
        </div>
        <div>
          <Button onClick={() => setIsAddModalOpen(true)}>
            <Plus size={16} /> Hire New Agent
          </Button>
        </div>
      </div>

      <div className="mb-8 h-[500px]">
        <OrgChartFlow fleetDetails={fleetDetails} ownerName={user?.name || 'Human Manager'} />
      </div>

      <div className="space-y-4">
        <h3 className="font-semibold text-lg border-b border-border pb-2 mb-4">Employee Directory</h3>
        {fleetDetails.instances?.map((inst: any) => {
          const isTransitional = ["provisioning_queued", "provisioning", "installing", "starting_queued", "stopping_queued", "restarting_queued", "deleting_queued", "deleting"].includes(inst.status);
          const statusVariant = inst.status === 'running' || inst.status === 'provisioned' ? 'success' : (inst.status === 'error' ? 'error' : 'warning');
          return (
            <Card key={inst.id} className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <AvatarImage
                  hash={inst.avatarHash}
                  className="w-12 h-12 rounded-full overflow-hidden bg-secondary flex items-center justify-center text-muted-foreground border border-border"
                  fallbackSize={24}
                />
                <div>
                  <h3 className="font-semibold text-lg flex items-center gap-2">
                    {inst.role}
                  </h3>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-sm text-muted-foreground uppercase">{inst.agentType}</span>
                    <Badge variant={statusVariant}>{inst.status.replace('_', ' ')}</Badge>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {inst.status === 'stopped' ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleStartAgent(inst.id)}
                    disabled={isTransitional}
                    className="text-emerald-500 hover:border-emerald-500/30 hover:bg-emerald-500/10"
                  >
                    <Play size={14} /> Start
                  </Button>
                ) : (inst.status === 'running' || inst.status === 'provisioned') ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleStopAgent(inst.id)}
                    disabled={isTransitional}
                    className="text-amber-500 hover:border-amber-500/30 hover:bg-amber-500/10"
                  >
                    <Square size={14} /> Stop
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" disabled>
                    Changing...
                  </Button>
                )}

                {inst.ip && !isTransitional && (
                  <a
                    href={inst.agentType === 'openclaw' ? `http://${inst.ip}/screen/vnc.html?chat=session&session=main${inst.token ? `&token=${inst.token}` : ''}` : `http://${inst.ip}/screen/vnc.html?path=screen/websockify${inst.token ? `&token=${inst.token}` : ''}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 border border-border px-3 py-1.5 rounded-lg text-xs hover:bg-secondary transition-colors text-blue-500"
                  >
                    <Tv2 size={14} /> Live Screen
                  </a>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setViewingLogsAgent(inst)}
                  className="text-emerald-500"
                >
                  <TerminalSquare size={14} /> Logs
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDeleteAgent(inst.id, inst.role)}
                  disabled={isTransitional}
                  className="text-muted-foreground hover:text-red-500 hover:bg-red-500/10"
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            </Card>
          );
        })}
      </div>

      {viewingLogsAgent && (
        <AgentLogsModal
          fleetId={fleetId!}
          instance={viewingLogsAgent}
          onClose={() => setViewingLogsAgent(null)}
        />
      )}

      <Modal
        open={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        title="Hire New Employee Agent"
        widthClassName="max-w-lg"
      >
        <form onSubmit={handleAddAgentSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold uppercase text-muted-foreground mb-1.5">Role / Identifier</label>
              <Input
                type="text"
                required
                placeholder="e.g. Designer, Analyst"
                value={newAgentRole}
                onChange={e => setNewAgentRole(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase text-muted-foreground mb-1.5">Job Title</label>
              <Input
                type="text"
                placeholder="e.g. Lead UI/UX Designer"
                value={newAgentTitle}
                onChange={e => setNewAgentTitle(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold uppercase text-muted-foreground mb-1.5">Agent Runtime</label>
              <Select
                value={newAgentType}
                onChange={e => setNewAgentType(e.target.value)}
              >
                <option value="openclaw">OpenClaw (Autonomous GUI browser agent)</option>
                <option value="opencode">OpenCode VM (High-speed software developer runtime)</option>
                <option value="claudecode">ClaudeCode CLI strategy</option>
              </Select>
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase text-muted-foreground mb-1.5">Reports To Manager</label>
              <Select
                value={newAgentReportsTo}
                onChange={e => setNewAgentReportsTo(e.target.value)}
              >
                <option value="">No Manager (Top level / CEO reports to Board)</option>
                {fleetDetails?.instances?.map((i: any) => (
                  <option key={i.id} value={i.id}>{i.role} ({i.alias})</option>
                ))}
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4">
            <div>
              <label className="block text-xs font-semibold uppercase text-muted-foreground mb-1.5">Machine Size</label>
              <Select
                value={newAgentMachineType}
                onChange={e => setNewAgentMachineType(e.target.value)}
              >
                <option value="e2-small">Small (2 vCPU, 2GB RAM, 64GB Disk) - 100 Credits/day</option>
                <option value="e2-medium">Medium (2 vCPU, 4GB RAM, 128GB Disk) - 200 Credits/day</option>
                <option value="e2-standard-2">Large (2 vCPU, 8GB RAM, 256GB Disk) - 400 Credits/day</option>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold uppercase text-muted-foreground mb-1.5">LLM Provider</label>
              <Select
                value={newAgentProvider}
                onChange={e => handleProviderChange(e.target.value)}
              >
                <option value="anthropic">Anthropic (Claude)</option>
                <option value="openai">OpenAI (GPT)</option>
                <option value="gemini">Google (Gemini)</option>
                <option value="deepseek">DeepSeek</option>
              </Select>
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase text-muted-foreground mb-1.5">Model</label>
              <Select
                value={modelOptionsByProvider[newAgentProvider]?.includes(newAgentModel) ? newAgentModel : (newAgentModel ? 'custom' : '')}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === 'custom') {
                    setNewAgentModel('');
                  } else {
                    setNewAgentModel(val);
                  }
                }}
                className="mb-2"
              >
                <option value="">Select a model...</option>
                {modelOptionsByProvider[newAgentProvider]?.map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
                <option value="custom">Custom Model...</option>
              </Select>
              {(!modelOptionsByProvider[newAgentProvider]?.includes(newAgentModel) || newAgentModel === '') && (
                <Input
                  type="text"
                  placeholder="Type custom model name..."
                  value={newAgentModel}
                  onChange={e => setNewAgentModel(e.target.value)}
                />
              )}
            </div>
          </div>

          {newAgentType === 'claudecode' && (
            <div className="border border-border rounded-lg p-3 bg-secondary/30 space-y-2">
              <label className="flex items-center gap-2 text-xs text-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={newAgentUseSubscription}
                  onChange={e => setNewAgentUseSubscription(e.target.checked)}
                  className="accent-blue-500"
                />
                Use my Claude subscription instead of API key billing
              </label>
              {newAgentUseSubscription && (
                <div className="space-y-1.5 pl-6">
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    Run <code className="text-foreground">claude setup-token</code> on a machine with a browser
                    (Pro/Max/Team/Enterprise plan required), then paste the printed token below.
                  </p>
                  <Input
                    type="password"
                    value={newAgentOauthToken}
                    onChange={e => setNewAgentOauthToken(e.target.value)}
                    className="text-xs font-mono"
                    placeholder="Paste the token from `claude setup-token`..."
                  />
                </div>
              )}
            </div>
          )}

          {!(newAgentType === 'claudecode' && newAgentUseSubscription) && (
            <div>
              <label className="block text-xs font-semibold uppercase text-muted-foreground mb-1.5">API Key Credential</label>
              <Select
                value={newAgentApiKey}
                onChange={e => setNewAgentApiKey(e.target.value)}
                required
              >
                <option value="" disabled>Select Encrypted Credential...</option>
                {existingCredentials.filter(c => c.type === 'llm_api_key' || c.type === 'generic_token').map(c => (
                  <option key={c._id} value={c._id}>{c.name}</option>
                ))}
              </Select>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold uppercase text-muted-foreground mb-1.5">3D Avatar Representation</label>
            <button
              type="button"
              onClick={() => setIsAvatarModalOpen(true)}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-left text-foreground hover:border-ring transition-colors flex items-center justify-between"
            >
              <span className="truncate">
                {avatarLibrary.find(a => a.hash === newAgentAvatarHash)?.title || "Select 3D Avatar Model..."}
              </span>
              <span className="text-xs text-blue-500 font-semibold uppercase font-mono">Choose Avatar ➔</span>
            </button>
            {newAgentAvatarHash && (
              <div className="mt-2 flex items-center gap-3 bg-secondary/30 p-2.5 rounded-lg border border-border">
                <AvatarImage
                  hash={newAgentAvatarHash}
                  className="w-12 h-12 rounded bg-background object-cover border border-border shrink-0"
                />
                <div className="text-[10px] text-muted-foreground leading-snug text-left">
                  <span className="font-semibold text-foreground block text-sm">
                    {avatarLibrary.find(a => a.hash === newAgentAvatarHash)?.title || 'Selected Avatar'}
                  </span>
                  {avatarLibrary.find(a => a.hash === newAgentAvatarHash)?.description}
                </div>
              </div>
            )}
          </div>

          <div className="pt-4 flex items-center justify-end gap-3 border-t border-border">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setIsAddModalOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isAddingAgent}
            >
              {isAddingAgent && <Loader2 size={14} className="animate-spin" />}
              Deploy Employee
            </Button>
          </div>
        </form>
      </Modal>

      {/* 3D Avatar Selection Modal Overlay */}
      <Modal
        open={isAvatarModalOpen}
        onClose={() => {
          setIsAvatarModalOpen(false);
          setAvatarModalSearch('');
        }}
        widthClassName="max-w-4xl"
      >
        <div className="pr-8 mb-4">
          <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
            ✨ Select 3D Humanoid Avatar Representation
          </h3>
          <p className="text-xs text-muted-foreground mt-1">Select a high-quality 3D avatar character to link as the workspace avatar for your new agent.</p>
        </div>

        <div className="mb-4">
          <Input
            type="text"
            placeholder="Search avatars by name or description..."
            value={avatarModalSearch}
            onChange={e => setAvatarModalSearch(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          <button
            type="button"
            onClick={() => {
              setNewAgentAvatarHash('');
              setIsAvatarModalOpen(false);
              setAvatarModalSearch('');
            }}
            className={cn(
              'p-3 rounded-xl border text-left flex flex-col justify-between items-start transition-all hover:bg-secondary',
              newAgentAvatarHash === ''
                ? 'border-pink-500 bg-pink-500/5'
                : 'border-border bg-secondary/30'
            )}
          >
            <div className="flex items-center gap-3">
              <div className="w-16 h-16 rounded-lg bg-secondary flex items-center justify-center border border-border">
                <span className="text-2xl">👤</span>
              </div>
              <div>
                <h4 className="font-semibold text-sm text-foreground">Default Initial Avatar</h4>
                <p className="text-[10px] text-muted-foreground mt-1 leading-snug">Uses the default generic employee avatar icon across the org chart and boards.</p>
              </div>
            </div>
            <div className="mt-4 text-[10px] text-pink-500 font-bold uppercase tracking-wider">Active Choice</div>
          </button>

          {avatarLibrary
            .filter(av =>
              av.title.toLowerCase().includes(avatarModalSearch.toLowerCase()) ||
              av.description.toLowerCase().includes(avatarModalSearch.toLowerCase())
            )
            .map(av => {
              const isSelected = newAgentAvatarHash === av.hash;
              return (
                <button
                  key={av.hash}
                  type="button"
                  onClick={() => {
                    setNewAgentAvatarHash(av.hash);
                    setIsAvatarModalOpen(false);
                    setAvatarModalSearch('');
                  }}
                  className={cn(
                    'p-3 rounded-xl border text-left flex flex-col justify-between items-start transition-all hover:bg-secondary',
                    isSelected
                      ? 'border-pink-500 bg-pink-500/5'
                      : 'border-border bg-secondary/30'
                  )}
                >
                  <div className="flex gap-3">
                    <AvatarImage
                      hash={av.hash}
                      alt={av.title}
                      className="w-16 h-16 rounded-lg bg-background object-cover border border-border shrink-0"
                    />
                    <div>
                      <h4 className="font-semibold text-sm text-foreground">{av.title}</h4>
                      <p className="text-[10px] text-muted-foreground mt-1 leading-snug line-clamp-3">{av.description}</p>
                    </div>
                  </div>
                  <div className="mt-4 w-full flex items-center justify-between text-[10px] uppercase font-mono tracking-wider">
                    <span className="text-muted-foreground">Hash: {av.hash.slice(0, 8)}...</span>
                    <span className={isSelected ? 'text-pink-500 font-bold' : 'text-blue-500'}>
                      {isSelected ? 'Selected' : 'Select Avatar'}
                    </span>
                  </div>
                </button>
              );
            })}
        </div>

        <div className="border-t border-border pt-4 mt-4 flex justify-end">
          <Button
            type="button"
            onClick={() => {
              setIsAvatarModalOpen(false);
              setAvatarModalSearch('');
            }}
          >
            Close Window
          </Button>
        </div>
      </Modal>

    </div>
  );
};

export default FleetOrgChart;
