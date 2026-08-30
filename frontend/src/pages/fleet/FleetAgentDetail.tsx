import React, { useEffect, useMemo, useState, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Activity,
  Link as LinkIcon,
  Loader2,
  MonitorPlay,
  Save,
  Unplug,
  Share2,
  TerminalSquare, ExternalLink, Play, Square, Globe, RotateCcw,
  Plus, Pencil, Trash2,
} from 'lucide-react';
import api from '../../lib/api';
import { useLanguage } from '../../context/LanguageContext';
import { AGENT_TEMPLATES, SKILL_TEMPLATES } from '../../lib/templates';
import AgentLogsModal from '../../components/AgentLogsModal';
import TerminalPanel from '../../components/TerminalPanel';
import { useAvatar } from '../../lib/avatarCache';
import { AvatarImage } from '../../components/AvatarImage';
import { cn } from '../../lib/cn';
import { Button, Card, Input, Textarea, Select, Modal } from '../../components/ui';

  type TabType = 'dashboard' | 'instructions' | 'skills' | 'configuration' | 'integrations' | 'runs' | 'terminal';

const SYSTEM_SKILLS = [
  'bihand',
  'bihand-agent',
  'bihand-browser-use',
  'bihand-dev',
  'bihand-create-agent',
  'bihand-google-workspace',
  'meta-mcp',
  'social-instagram',
  'social-x',
  'social-reddit'
];

const isSystemSkill = (name: string) => SYSTEM_SKILLS.includes(name);

// Systematically-injected MCP servers (chrome-devtools at provision time, meta via the
// dedicated Meta MCP integration card) - never editable/deletable from this tab. The backend
// enforces this too; this is just the matching UI-side badge/disable treatment.
const PROTECTED_MCP_SERVERS = ['chrome-devtools', 'meta'];
const isProtectedMcpServer = (name: string) => PROTECTED_MCP_SERVERS.includes(name);

type McpServerEntry = {
  name: string;
  command?: string | null;
  args?: string[];
  env?: Record<string, string>;
  url?: string | null;
  headers?: Record<string, string>;
  protected: boolean;
};

type ToolConnection = {
  status?: string;
  connectedAt?: string | null;
  email?: string | null;
  scopes?: string[];
  lastError?: string | null;
  name?: string | null;
  credentialId?: string | null;
};

type AdapterCapabilities = {
  supportsInstructionsBundle: boolean;
  supportsSkills: boolean;
  supportsLocalAgentJwt: boolean;
  requiresMaterializedRuntimeSkills: boolean;
  supportsModelProfiles: boolean;
};

interface InstructionFile {
  name: string;
  content: string;
}

const ModelViewerContainer: React.FC<{ avatarHash: string }> = ({ avatarHash }) => {
  const { glbSrc } = useAvatar(avatarHash);
  if (!glbSrc) {
    return <div className="w-full h-full bg-secondary animate-pulse flex items-center justify-center text-xs text-muted-foreground">Loading 3D asset into memory...</div>;
  }
  return React.createElement('model-viewer', {
    src: glbSrc,
    'camera-controls': 'true',
    'auto-rotate': 'true',
    style: { width: '100%', height: '100%', background: 'transparent', display: 'block' },
    alt: "3D Humanoid Agent Avatar",
    'shadow-intensity': "1",
    'interaction-prompt': "auto",
    'auto-rotate-delay': "1000"
  } as any);
};

const FleetAgentDetail: React.FC = () => {
  const { fleetId, instanceId } = useParams<{ fleetId: string; instanceId: string }>();
  const navigate = useNavigate();
  const { language } = useLanguage();

  const currentInstanceIdRef = useRef(instanceId);
  useEffect(() => {
    currentInstanceIdRef.current = instanceId;
  }, [instanceId]);

  const [activeTab, setActiveTab] = useState<TabType>('dashboard');
  const [instance, setInstance] = useState<any>(null);
  const [agentTasks, setAgentTasks] = useState<any[]>([]);

  const [viewingLogs, setViewingLogs] = useState(false);

  const [powerLoading, setPowerLoading] = useState(false);

  const [reconfigLoading, setReconfigLoading] = useState(false);
  const [targetMachineType, setTargetMachineType] = useState('');
  const [targetIteration, setTargetIteration] = useState('');
  const [targetProvider, setTargetProvider] = useState('');
  const [targetModel, setTargetModel] = useState('');
  const [targetApiKey, setTargetApiKey] = useState('');
  const [useClaudeSubscription, setUseClaudeSubscription] = useState(false);
  const [targetOauthToken, setTargetOauthToken] = useState('');

  const handleStartAgent = async () => {
    setPowerLoading(true);
    try {
      await api.post(`/fleets/${fleetId}/instances/${instanceId}/start`);
      await fetchDetails();
    } catch (e: any) {
      alert(e.response?.data?.detail || "Failed to start agent");
    } finally {
      setPowerLoading(false);
    }
  };

  const handleRestartAgent = async () => {
    setPowerLoading(true);
    try {
      await api.post(`/fleets/${fleetId}/instances/${instanceId}/restart`);
      await fetchDetails();
    } catch (e: any) {
      alert(e.response?.data?.detail || "Failed to restart agent");
    } finally {
      setPowerLoading(false);
    }
  };

  const handleStopAgent = async () => {
    setPowerLoading(true);
    try {
      await api.post(`/fleets/${fleetId}/instances/${instanceId}/stop`);
      await fetchDetails();
    } catch (e: any) {
      alert(e.response?.data?.detail || "Failed to stop agent");
    } finally {
      setPowerLoading(false);
    }
  };

  const [agentMd, setAgentMd] = useState('');
  const [soulMd, setSoulMd] = useState('');
  const [toolsMd, setToolsMd] = useState('');
  const [mcpConfig, setMcpConfig] = useState('');
  const [toolConnections, setToolConnections] = useState<Record<string, ToolConnection>>({});
  const [credentials, setCredentials] = useState<any[]>([]);
  const [selectedGoogleCred, setSelectedGoogleCred] = useState('');
  const [selectedMetaMcpCred, setSelectedMetaMcpCred] = useState('');
  const [isConnectingMetaMcp, setIsConnectingMetaMcp] = useState(false);
  const [isDisconnectingMetaMcp, setIsDisconnectingMetaMcp] = useState(false);
  const [selectedMetaDevtoolsCred, setSelectedMetaDevtoolsCred] = useState('');
  const [isConnectingMetaDevtools, setIsConnectingMetaDevtools] = useState(false);
  const [isDisconnectingMetaDevtools, setIsDisconnectingMetaDevtools] = useState(false);

  // Dedicated per-agent MCP server management (custom servers only - protected ones are read-only here)
  const [mcpServerList, setMcpServerList] = useState<McpServerEntry[]>([]);
  const [isLoadingMcpServers, setIsLoadingMcpServers] = useState(false);
  const [mcpFormMode, setMcpFormMode] = useState<'add' | string | null>(null);
  const [mcpFormName, setMcpFormName] = useState('');
  const [mcpFormType, setMcpFormType] = useState<'local' | 'remote'>('local');
  const [mcpFormCommand, setMcpFormCommand] = useState('');
  const [mcpFormArgs, setMcpFormArgs] = useState('');
  const [mcpFormEnv, setMcpFormEnv] = useState('');
  const [mcpFormUrl, setMcpFormUrl] = useState('');
  const [mcpFormHeaders, setMcpFormHeaders] = useState('');
  const [mcpSaving, setMcpSaving] = useState(false);
  const [mcpDeletingName, setMcpDeletingName] = useState<string | null>(null);

  // Platform specific selection states
  const [selectedIgCred, setSelectedIgCred] = useState('');
  const [selectedXCred, setSelectedXCred] = useState('');
  const [selectedRedditCred, setSelectedRedditCred] = useState('');

  const [connectingPlatform, setConnectingPlatform] = useState<string | null>(null);
  const [disconnectingPlatform, setDisconnectingPlatform] = useState<string | null>(null);

  const [isAddingCredential, setIsAddingCredential] = useState(false);
  const [newCredName, setNewCredName] = useState('');
  const [newCredType, setNewCredType] = useState('google_workspace');
  const [newCredData, setNewCredData] = useState('');
  const [credIsLoading, setCredIsLoading] = useState(false);

  // Form states for Facebook
  const [fbPageId, setFbPageId] = useState('');
  const [fbAccessToken, setFbAccessToken] = useState('');

  // Form states for Instagram
  const [igBusinessId, setIgBusinessId] = useState('');
  const [igAccessToken, setIgAccessToken] = useState('');

  // Form states for X (Twitter)
  const [xConsumerKey, setXConsumerKey] = useState('');
  const [xConsumerSecret, setXConsumerSecret] = useState('');
  const [xAccessToken, setXAccessToken] = useState('');
  const [xAccessTokenSecret, setXAccessTokenSecret] = useState('');

  // Form states for Reddit
  const [redditClientId, setRedditClientId] = useState('');
  const [redditClientSecret, setRedditClientSecret] = useState('');
  const [redditUsername, setRedditUsername] = useState('');
  const [redditPassword, setRedditPassword] = useState('');
  const [redditUserAgent, setRedditUserAgent] = useState('');
  const [redditSubreddit, setRedditSubreddit] = useState('');

  const [fleetOwnerEmail, setFleetOwnerEmail] = useState<string | null>(null);

  useEffect(() => {
    if (activeTab === 'integrations') {
      const getUrl = fleetOwnerEmail ? `/admin/users/${encodeURIComponent(fleetOwnerEmail)}/credentials` : '/credentials';
      api.get(getUrl).then(res => setCredentials(res.data.credentials || [])).catch(console.error);
    }
  }, [activeTab, fleetOwnerEmail]);

  const fetchMcpServers = async () => {
    setIsLoadingMcpServers(true);
    try {
      const res = await api.get(`/fleets/${fleetId}/instances/${instanceId}/mcp-servers`);
      setMcpServerList(res.data.servers || []);
    } catch (error) {
      console.error(error);
    } finally {
      setIsLoadingMcpServers(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'configuration') {
      fetchMcpServers();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, instanceId]);

  const resetMcpForm = () => {
    setMcpFormMode(null);
    setMcpFormName('');
    setMcpFormType('local');
    setMcpFormCommand('');
    setMcpFormArgs('');
    setMcpFormEnv('');
    setMcpFormUrl('');
    setMcpFormHeaders('');
  };

  const openAddMcpForm = () => {
    resetMcpForm();
    setMcpFormMode('add');
  };

  const openEditMcpForm = (server: McpServerEntry) => {
    setMcpFormMode(server.name);
    setMcpFormName(server.name);
    setMcpFormType(server.url ? 'remote' : 'local');
    setMcpFormCommand(server.command || '');
    setMcpFormArgs((server.args || []).join('\n'));
    setMcpFormEnv(Object.entries(server.env || {}).map(([k, v]) => `${k}=${v}`).join('\n'));
    setMcpFormUrl(server.url || '');
    setMcpFormHeaders(Object.entries(server.headers || {}).map(([k, v]) => `${k}=${v}`).join('\n'));
  };

  const parseLines = (text: string): Record<string, string> => {
    const result: Record<string, string> = {};
    text.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (!trimmed) return;
      const idx = trimmed.indexOf('=');
      if (idx === -1) return;
      result[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
    });
    return result;
  };

  const handleMcpServerSave = async () => {
    const name = mcpFormName.trim();
    if (!name) {
      alert('MCP server name is required.');
      return;
    }
    if (mcpFormType === 'remote' && !mcpFormUrl.trim()) {
      alert('URL is required for a remote MCP server.');
      return;
    }
    if (mcpFormType === 'local' && !mcpFormCommand.trim()) {
      alert('Command is required for a local MCP server.');
      return;
    }

    const payload = mcpFormType === 'remote'
      ? { name, url: mcpFormUrl.trim(), headers: parseLines(mcpFormHeaders) }
      : {
          name,
          command: mcpFormCommand.trim(),
          args: mcpFormArgs.split('\n').map(a => a.trim()).filter(Boolean),
          env: parseLines(mcpFormEnv),
        };

    setMcpSaving(true);
    try {
      if (mcpFormMode === 'add') {
        await api.post(`/fleets/${fleetId}/instances/${instanceId}/mcp-servers`, payload);
      } else {
        await api.put(`/fleets/${fleetId}/instances/${instanceId}/mcp-servers/${encodeURIComponent(mcpFormMode || '')}`, payload);
      }
      resetMcpForm();
      await fetchMcpServers();
    } catch (error: any) {
      console.error(error);
      alert(error.response?.data?.detail || 'Failed to save MCP server.');
    } finally {
      setMcpSaving(false);
    }
  };

  const handleMcpServerDelete = async (name: string) => {
    if (!window.confirm(`Remove MCP server "${name}"?`)) return;
    setMcpDeletingName(name);
    try {
      await api.delete(`/fleets/${fleetId}/instances/${instanceId}/mcp-servers/${encodeURIComponent(name)}`);
      await fetchMcpServers();
    } catch (error: any) {
      console.error(error);
      alert(error.response?.data?.detail || 'Failed to remove MCP server.');
    } finally {
      setMcpDeletingName(null);
    }
  };

  const handleAddCredential = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCredName) return;

    let finalData = '';
    
    if (newCredType === 'social_facebook') {
      if (!fbPageId || !fbAccessToken) return;
      finalData = JSON.stringify({ page_id: fbPageId, access_token: fbAccessToken });
    } else if (newCredType === 'social_instagram') {
      if (!igBusinessId || !igAccessToken) return;
      finalData = JSON.stringify({ instagram_business_id: igBusinessId, access_token: igAccessToken });
    } else if (newCredType === 'social_x') {
      if (!xConsumerKey || !xConsumerSecret || !xAccessToken || !xAccessTokenSecret) return;
      finalData = JSON.stringify({
        consumer_key: xConsumerKey,
        consumer_secret: xConsumerSecret,
        access_token: xAccessToken,
        access_token_secret: xAccessTokenSecret
      });
    } else if (newCredType === 'social_reddit') {
      if (!redditClientId || !redditClientSecret || !redditUsername || !redditPassword) return;
      finalData = JSON.stringify({
        client_id: redditClientId,
        client_secret: redditClientSecret,
        username: redditUsername,
        password: redditPassword,
        user_agent: redditUserAgent,
        subreddit: redditSubreddit
      });
    } else {
      if (!newCredData) return;
      finalData = newCredData;
    }

    setCredIsLoading(true);
    try {
      await api.post('/credentials', { name: newCredName, type: newCredType, data: finalData });
      setIsAddingCredential(false);
      setNewCredName('');
      setNewCredData('');
      setFbPageId('');
      setFbAccessToken('');
      setIgBusinessId('');
      setIgAccessToken('');
      setXConsumerKey('');
      setXConsumerSecret('');
      setXAccessToken('');
      setXAccessTokenSecret('');
      setRedditClientId('');
      setRedditClientSecret('');
      setRedditUsername('');
      setRedditPassword('');
      setRedditUserAgent('');
      setRedditSubreddit('');
      const getUrl = fleetOwnerEmail ? `/admin/users/${encodeURIComponent(fleetOwnerEmail)}/credentials` : '/credentials';
      const res = await api.get(getUrl);
      setCredentials(res.data.credentials || []);
    } catch (err) {
      alert("Failed to add credential");
    } finally {
      setCredIsLoading(false);
    }
  };
  const [adapterCapabilities, setAdapterCapabilities] = useState<AdapterCapabilities | null>(null);

  const [isLoadingConfig, setIsLoadingConfig] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const [isConnectingGoogle, setIsConnectingGoogle] = useState(false);
  const [isDisconnectingGoogle, setIsDisconnectingGoogle] = useState(false);

  const [instructionFiles, setInstructionFiles] = useState<InstructionFile[]>([]);
  const [selectedInstructionFile, setSelectedInstructionFile] = useState('AGENTS.md');
  const [instructionDraft, setInstructionDraft] = useState<string | null>(null);
  const [isLoadingInstructionFile, setIsLoadingInstructionFile] = useState(false);
  const [isSavingInstructions, setIsSavingInstructions] = useState(false);

  const [skillsFiles, setSkillsFiles] = useState<InstructionFile[]>([]);
  const [originalSkillsFiles, setOriginalSkillsFiles] = useState<InstructionFile[]>([]);
  const [isSavingSkill, setIsSavingSkill] = useState(false);
  const [selectedSkillFile, setSelectedSkillFile] = useState<string | null>(null);
  const [skillDraftContent, setSkillDraftContent] = useState<string | null>(null);
  const [isSkillSnapshotLoading, setIsSkillSnapshotLoading] = useState(false);
  const [skillsError, setSkillsError] = useState<string | null>(null);

  const googleConnection = toolConnections.googleWorkspace || {};
  const metaMcpConnection = toolConnections.meta_mcp || {};
  const metaDevtoolsConnection = toolConnections.meta_devtools || {};

  const fetchDetails = async () => {
    const response = await api.get(`/fleets/${fleetId}`);
    if (currentInstanceIdRef.current !== instanceId) return;
    setFleetOwnerEmail(response.data.userId || null);
    const inst = response.data.instances.find((item: any) => item.id === instanceId);
    if (!inst) {
      navigate(`/fleet/${fleetId}/dashboard`);
      return;
    }
    setInstance(inst);
    if (inst.toolConnections) {
      setToolConnections(inst.toolConnections);
    }
    if (inst.adapterCapabilities) {
      setAdapterCapabilities(inst.adapterCapabilities);
    }

    try {
      const taskRes = await api.get(`/fleets/${fleetId}/tasks`);
      if (currentInstanceIdRef.current !== instanceId) return;
      const allTasks = taskRes.data.tasks || [];
      const assigned = allTasks.filter((t: any) => t.assigneeId === instanceId);
      setAgentTasks(assigned);
    } catch (e) {
      console.error("Failed to fetch tasks for agent", e);
    }
  };

  const fetchLiveConfig = async () => {
    setIsLoadingConfig(true);
    try {
      const response = await api.get(`/fleets/${fleetId}/instances/${instanceId}/config`);
      if (currentInstanceIdRef.current !== instanceId) return;
      setAgentMd(response.data.agentMd || AGENT_TEMPLATES['Default (Blank)'].md);
      setSoulMd(response.data.soulMd || 'Execute tasks diligently.');
      setToolsMd(response.data.toolsMd || 'No custom tools configured.');
      setMcpConfig(response.data.mcpConfig || AGENT_TEMPLATES['Default (Blank)'].mcp);
      setToolConnections(response.data.toolConnections || {});
      setAdapterCapabilities(response.data.adapterCapabilities || null);
    } catch {
      if (currentInstanceIdRef.current !== instanceId) return;
      // Set defaults for capabilities to prevent tabs disappearing on config fetch failures
      setAdapterCapabilities({
        supportsSkills: true,
        supportsInstructionsBundle: true,
        supportsLocalAgentJwt: false,
        requiresMaterializedRuntimeSkills: false,
        supportsModelProfiles: false
      });
      if (!instance) return;
      setAgentMd(instance.agentMd || AGENT_TEMPLATES['Default (Blank)'].md);
      setSoulMd(instance.soulMd || 'Execute tasks diligently.');
      setToolsMd(instance.toolsMd || 'No custom tools configured.');
      setMcpConfig(instance.mcpConfig || AGENT_TEMPLATES['Default (Blank)'].mcp);
      setToolConnections(instance.toolConnections || {});
    } finally {
      if (currentInstanceIdRef.current === instanceId) {
        setIsLoadingConfig(false);
      }
    }
  };

  const fetchInstructionsBundle = async () => {
    if (!fleetId || !instanceId) return;
    setIsLoadingInstructionFile(true);
    try {
      const response = await api.get(`/fleets/${fleetId}/instances/${instanceId}/instructions`);
      if (currentInstanceIdRef.current !== instanceId) return;
      const files = response.data.files as InstructionFile[];
      setInstructionFiles(files);
      setSelectedInstructionFile(files.length > 0 ? files[0].name : 'AGENTS.md');
      setInstructionDraft(null);
    } finally {
      if (currentInstanceIdRef.current === instanceId) {
        setIsLoadingInstructionFile(false);
      }
    }
  };

  useEffect(() => {
    if (!fleetId || !instanceId) return;
    setInstance(null);
    setFleetOwnerEmail(null);
    setAdapterCapabilities(null);
    setIsLoadingConfig(true);
    // Instantly wipe caches of previous agents when navigating
    setInstructionFiles([]);
    setSkillsFiles([]);
    setOriginalSkillsFiles([]);
    setSelectedInstructionFile('AGENTS.md');
    setSelectedSkillFile(null);
    setInstructionDraft(null);
    setSkillDraftContent(null);
    fetchDetails().catch(console.error);

    // Periodically poll agent details (such as status) when active in workspace details view
    const interval = setInterval(() => {
      if (document.hasFocus()) {
        api.get(`/fleets/${fleetId}`).then(res => {
          if (currentInstanceIdRef.current !== instanceId) return;
          const inst = res.data.instances?.find((item: any) => item.id === instanceId);
          if (inst) {
            setInstance((prev: any) => {
              // Keep status live and trigger state changes on status changes
              if (!prev) return inst;
              if (prev.status !== inst.status) {
                return { ...prev, status: inst.status, ip: inst.ip };
              }
              return prev;
            });
          }
        }).catch(console.error);
      }
    }, 4000);

    return () => clearInterval(interval);
  }, [fleetId, instanceId]);

  useEffect(() => {
    if (!instance) return;
    fetchLiveConfig().catch(console.error);
    // Explicitly re-query when agent changes and a sub-tab is active, but NEVER overwrite active draft edits
    if (activeTab === 'instructions' && instructionDraft === null) {
      fetchInstructionsBundle().catch(console.error);
    } else if (activeTab === 'skills' && skillDraftContent === null) {
      fetchSkillsSnapshot().catch(console.error);
    }
  }, [instance]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get('tab');
    if (tab === 'dashboard' || tab === 'instructions' || tab === 'skills' || tab === 'configuration' || tab === 'integrations' || tab === 'runs' || tab === 'terminal') {
      setActiveTab(tab as TabType);
    }
  }, [location.search]);

  useEffect(() => {
    if (activeTab === 'instructions') {
      fetchInstructionsBundle().catch(console.error);
    } else if (activeTab === 'skills') {
      fetchSkillsSnapshot().catch(console.error);
    }
  }, [activeTab, fleetId, instanceId]);

  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab);
    navigate(`?tab=${tab}`, { replace: true });
  };

  const fetchSkillsSnapshot = async (retryAttempt: number = 0) => {
    if (!fleetId || !instanceId) return;
    setIsSkillSnapshotLoading(true);
    setSkillsError(null);
    try {
      const response = await api.get(`/fleets/${fleetId}/instances/${instanceId}/skills`);
      if (currentInstanceIdRef.current !== instanceId) return;
      const files = response.data.files as InstructionFile[];
      setSkillsFiles(files);
      setOriginalSkillsFiles(files);
      setSelectedSkillFile(files.length > 0 ? files[0].name : null);
      setSkillDraftContent(null);
    } catch (err: any) {
      if (currentInstanceIdRef.current !== instanceId) return;
      console.error(err);
      const msg = err.response?.data?.detail || "SSH connection lag or directory unavailable on VM.";
      
      if (retryAttempt < 3) {
        setSkillsError(`Failed to sync live skills (${msg}). Retrying in 3s (Attempt ${retryAttempt + 1}/3)...`);
        setTimeout(() => {
          fetchSkillsSnapshot(retryAttempt + 1);
        }, 3000);
      } else {
        setSkillsError(`Failed to load live skills from VM: ${msg}. Showing last saved database copy.`);
      }
    } finally {
      if (currentInstanceIdRef.current === instanceId) {
        setIsSkillSnapshotLoading(false);
      }
    }
  };

  const handleAddSkill = () => {
    let candidate = 'new-skill-1';
    let counter = 1;
    while (skillsFiles.some(f => f.name === candidate) || SYSTEM_SKILLS.includes(candidate)) {
      candidate = `new-skill-${counter}`;
      counter++;
    }
    setSkillsFiles([...skillsFiles, { name: candidate, content: '' }]);
    setSelectedSkillFile(candidate);
    setSkillDraftContent(null);
  };

  const handleDeleteSkill = () => {
    if (selectedSkillFile === null) return;
    if (selectedSkillFile && isSystemSkill(selectedSkillFile)) {
      alert(`Forbidden: System-managed skill '${selectedSkillFile}' cannot be deleted.`);
      return;
    }
    const skillToDelete = selectedSkillFile || '';
    if (!window.confirm(`Delete ${skillToDelete || 'selected skill'}?`)) return;
    const newFiles = skillsFiles.filter((f) => f.name !== skillToDelete);
    setSkillsFiles(newFiles);
    setSelectedSkillFile(newFiles.length > 0 ? newFiles[0].name : null);
    setSkillDraftContent(null);
  };

  const updateSelectedSkillName = (newName: string) => {
    if (selectedSkillFile === null) return;
    if (selectedSkillFile && isSystemSkill(selectedSkillFile)) {
      alert(`Forbidden: System-managed skill '${selectedSkillFile}' cannot be renamed.`);
      return;
    }
    // Remove space, uppercase, and invalid special characters from folder name dynamically
    const sanitizedName = newName.replace(/[^a-zA-Z0-9_\-]/g, '').trim().toLowerCase();
    if (isSystemSkill(sanitizedName)) {
      alert(`Forbidden: Cannot use '${sanitizedName}' because it is reserved for system-managed skills.`);
      return;
    }
    setSkillsFiles(skillsFiles.map(f => f.name === selectedSkillFile ? { ...f, name: sanitizedName } : f));
    setSelectedSkillFile(sanitizedName);
  };

  const handleGoogleConnect = async () => {
    if (!selectedGoogleCred) {
      alert("Please select a credential first.");
      return;
    }
    setIsConnectingGoogle(true);
    try {
      await api.post(`/fleets/${fleetId}/instances/${instanceId}/tools/google-workspace/connect`, {
        credentialId: selectedGoogleCred
      });
      await fetchLiveConfig();
    } catch (error) {
      console.error(error);
      alert('Failed to connect Google Workspace.');
    } finally {
      setIsConnectingGoogle(false);
    }
  };

  const handleGoogleDisconnect = async () => {
    setIsDisconnectingGoogle(true);
    try {
      await api.post(`/fleets/${fleetId}/instances/${instanceId}/tools/google-workspace/disconnect`);
      await fetchLiveConfig();
    } catch (error) {
      console.error(error);
      alert('Failed to disconnect Google Workspace.');
    } finally {
      setIsDisconnectingGoogle(false);
    }
  };

  const handleMetaMcpConnect = async () => {
    if (!selectedMetaMcpCred) {
      alert("Please select a credential first.");
      return;
    }
    setIsConnectingMetaMcp(true);
    try {
      await api.post(`/fleets/${fleetId}/instances/${instanceId}/tools/meta-mcp/connect`, {
        credentialId: selectedMetaMcpCred
      });
      await fetchLiveConfig();
    } catch (error) {
      console.error(error);
      alert('Failed to connect Meta MCP.');
    } finally {
      setIsConnectingMetaMcp(false);
    }
  };

  const handleMetaMcpDisconnect = async () => {
    setIsDisconnectingMetaMcp(true);
    try {
      await api.post(`/fleets/${fleetId}/instances/${instanceId}/tools/meta-mcp/disconnect`);
      await fetchLiveConfig();
    } catch (error) {
      console.error(error);
      alert('Failed to disconnect Meta MCP.');
    } finally {
      setIsDisconnectingMetaMcp(false);
    }
  };

  const handleMetaDevtoolsConnect = async () => {
    if (!selectedMetaDevtoolsCred) {
      alert("Please select a credential first.");
      return;
    }
    setIsConnectingMetaDevtools(true);
    try {
      await api.post(`/fleets/${fleetId}/instances/${instanceId}/tools/meta-devtools/connect`, {
        credentialId: selectedMetaDevtoolsCred
      });
      await fetchLiveConfig();
    } catch (error) {
      console.error(error);
      alert('Failed to connect Meta Developer Tools MCP.');
    } finally {
      setIsConnectingMetaDevtools(false);
    }
  };

  const handleMetaDevtoolsDisconnect = async () => {
    setIsDisconnectingMetaDevtools(true);
    try {
      await api.post(`/fleets/${fleetId}/instances/${instanceId}/tools/meta-devtools/disconnect`);
      await fetchLiveConfig();
    } catch (error) {
      console.error(error);
      alert('Failed to disconnect Meta Developer Tools MCP.');
    } finally {
      setIsDisconnectingMetaDevtools(false);
    }
  };

  const handlePlatformConnect = async (platform: string, credentialId: string) => {
    if (!credentialId) {
      alert("Please select a credential first.");
      return;
    }
    setConnectingPlatform(platform);
    try {
      await api.post(`/fleets/${fleetId}/instances/${instanceId}/tools/social-media/connect`, {
        platform,
        credentialId
      });
      await fetchLiveConfig();
    } catch (error) {
      console.error(error);
      alert(`Failed to connect ${platform.toUpperCase()}.`);
    } finally {
      setConnectingPlatform(null);
    }
  };

  const handlePlatformDisconnect = async (platform: string) => {
    setDisconnectingPlatform(platform);
    try {
      await api.post(`/fleets/${fleetId}/instances/${instanceId}/tools/social-media/disconnect`, {
        platform,
        credentialId: '' // connect payload re-used for platform key lookup
      });
      await fetchLiveConfig();
    } catch (error) {
      console.error(error);
      alert(`Failed to disconnect ${platform.toUpperCase()}.`);
    } finally {
      setDisconnectingPlatform(null);
    }
  };

  const supportsInstructions = adapterCapabilities ? adapterCapabilities.supportsInstructionsBundle : true;

  /*
  const handleApplyTemplate = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const template = AGENT_TEMPLATES[event.target.value];
    if (!template) return;
    setAgentMd(template.md);
    setMcpConfig(template.mcp);
  };
*/

  const handleApplySkillTemplate = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const templateKey = event.target.value;
    const templateContent = SKILL_TEMPLATES[templateKey];
    if (!templateContent) return;
    
    setSkillDraftContent(templateContent);
    setSkillsFiles(skillsFiles.map(f => f.name === selectedSkillFile ? { ...f, content: templateContent } : f));
  };

  const selectedInstructionContent = useMemo(() => {
    if (instructionDraft !== null) return instructionDraft;
    const found = instructionFiles.find((f) => f.name === selectedInstructionFile);
    return found ? found.content : '';
  }, [instructionFiles, selectedInstructionFile, instructionDraft]);

  const instructionDirty = instructionDraft !== null;

  const skillsDirty = useMemo(() => {
    return skillDraftContent !== null || JSON.stringify(skillsFiles) !== JSON.stringify(originalSkillsFiles);
  }, [skillsFiles, originalSkillsFiles, skillDraftContent]);

  const handleSaveInstructions = async () => {
    if (!instructionDirty) return;
    setIsSavingInstructions(true);
    // Optimistically update status to show transition screen
    setInstance((prev: any) => prev ? { ...prev, status: 'updating' } : prev);
    try {
      const nextFiles = instructionFiles.map((file) => {
        if (file.name === selectedInstructionFile) {
          return { name: file.name, content: selectedInstructionContent };
        }
        return file;
      });
      await api.put(`/fleets/${fleetId}/instances/${instanceId}/instructions`, { files: nextFiles });
      setInstructionFiles(nextFiles);
      setInstructionDraft(null);
    } catch (e) {
      console.error(e);
      alert('Failed to save instructions to VM.');
      // Restore details on error
      await fetchDetails();
    } finally {
      setIsSavingInstructions(false);
    }
  };

  const handleSaveSkill = async () => {
    if (selectedSkillFile === null) return;
    if (!selectedSkillFile.trim()) {
      alert("Skill name cannot be empty.");
      return;
    }
    setIsSavingSkill(true);
    // Optimistically update status to show transition screen
    setInstance((prev: any) => prev ? { ...prev, status: 'updating' } : prev);
    try {
      const nextContent = skillDraftContent ?? skillsFiles.find(f => f.name === selectedSkillFile)?.content ?? '';
      const nextFiles = skillsFiles.map((file) => {
        if (file.name === selectedSkillFile) {
          return { name: file.name, content: nextContent };
        }
        return file;
      });
      const res = await api.put(`/fleets/${fleetId}/instances/${instanceId}/skills`, { files: nextFiles });
      if (res.data.files) {
        setSkillsFiles(res.data.files);
        setOriginalSkillsFiles(res.data.files);
      } else {
        setSkillsFiles(nextFiles);
        setOriginalSkillsFiles(nextFiles);
      }
      setSkillDraftContent(null);
    } catch (e) {
      console.error(e);
      alert('Failed to save skill to VM.');
      await fetchDetails();
    } finally {
      setIsSavingSkill(false);
    }
  };

  const handleSaveConfig = async () => {
    setIsSaving(true);
    // Optimistically update status to show transition screen
    setInstance((prev: any) => prev ? { ...prev, status: 'updating' } : prev);
    try {
      await api.put(`/fleets/${fleetId}/instances/${instanceId}/config`, {
        agentMd,
        soulMd,
        toolsMd,
        mcpConfig,
        enabledSkills: instance.enabledSkills || [],
      });
      await fetchLiveConfig();
    } catch {
      alert('Failed to update agent config.');
      await fetchDetails();
    } finally {
      setIsSaving(false);
    }
  };

  const handlePrimarySave = async () => {
    if (activeTab === 'instructions') {
      await handleSaveInstructions();
    } else if (activeTab === 'skills') {
      await handleSaveSkill();
    } else {
      await handleSaveConfig();
    }
  };

  if (!instance) {
    return (
      <div className="p-8 flex flex-col items-center justify-center h-full min-h-[400px] text-muted-foreground space-y-4">
        <Loader2 className="animate-spin text-foreground" size={32} />
        <span className="text-sm font-medium">Loading agent details...</span>
      </div>
    );
  }

  const statusTone = instance.status === 'running'
    ? 'text-emerald-500 font-medium'
    : instance.status === 'provisioning' || instance.status === 'installing' || instance.status === 'updating' || instance.status.endsWith('_queued')
      ? 'text-blue-400 animate-pulse'
      : 'text-muted-foreground';

  const renderDashboard = () => (
    <div className="space-y-6">
      {(instance.status === 'error' || instance.status === 'stopped') && (
        <div className={cn(
          'border rounded-xl p-5 text-left flex flex-col md:flex-row md:items-center justify-between gap-4',
          instance.status === 'error' ? 'border-red-500/20 bg-red-500/5' : 'border-border bg-secondary/40'
        )}>
          <div className="space-y-1">
            <h4 className={cn('text-sm font-bold flex items-center gap-1.5', instance.status === 'error' ? 'text-red-400' : 'text-foreground')}>
              {instance.status === 'error'
                ? (<>⚠️ {language === 'vi' ? 'Nhân sự gặp sự cố kết nối' : 'Agent Connection Error'}</>)
                : (<>⏸ {language === 'vi' ? 'Nhân sự đang dừng' : 'Agent Stopped'}</>)}
            </h4>
            <p className="text-xs text-muted-foreground leading-relaxed max-w-2xl">
              {instance.status === 'error'
                ? (language === 'vi'
                    ? 'Máy ảo nhân sự gặp sự cố hoặc mất kết nối SSH. Bạn có thể chỉnh sửa Custom Instructions, Skills hoặc Configuration, sau đó nhấn "Restart & Heal" hoặc "Reconfigure" để khởi tạo lại (re-provision) mà không làm mất dữ liệu.'
                    : 'The agent VM is unreachable or has failed to initialize. You can modify its Custom Instructions, Skills, or Hardware Configuration, and then trigger "Restart & Heal" or "Reconfigure" to re-provision it with your new settings.')
                : (language === 'vi'
                    ? 'Máy ảo nhân sự hiện đang dừng. Bạn có thể chỉnh sửa Custom Instructions, Skills hoặc Configuration ngay cả khi dừng, rồi nhấn "Start Agent" để khởi động lại.'
                    : 'The agent VM is currently stopped. You can still edit its Custom Instructions, Skills, or Hardware Configuration while stopped, then hit "Start Agent" to bring it back up.')}
            </p>
          </div>
          <div className="flex items-center gap-2.5 shrink-0 self-end md:self-auto">
            <Button
              type="button"
              onClick={handleStartAgent}
              disabled={powerLoading}
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-500 text-white hover:opacity-100"
            >
              {powerLoading ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
              {language === 'vi' ? 'Khởi động máy ảo' : 'Start Agent'}
            </Button>
            {instance.status === 'error' && (
              <Button
                type="button"
                onClick={handleRestartAgent}
                disabled={powerLoading}
                size="sm"
                className="border border-blue-500/30 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400"
              >
                {powerLoading ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                {language === 'vi' ? 'Khởi động lại & Khôi phục' : 'Restart & Heal'}
              </Button>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {instance?.avatarHash && (
          <Card className="flex flex-col h-[320px] lg:col-span-2">
            <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground mb-2 font-mono">3D Humanoid Agent Avatar</div>
            <div className="flex-1 min-h-0 relative rounded-lg bg-black/40 overflow-hidden border border-border">
              <ModelViewerContainer avatarHash={instance.avatarHash} />
            </div>
          </Card>
        )}

        <Card>
          <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground mb-2">Latest Run</div>
          <div className="text-lg font-semibold text-foreground">{instance.status.replace('_', ' ')}</div>
          <div className="text-sm text-muted-foreground mt-1">Runtime: {instance.agentType.toUpperCase()}</div>
        </Card>
        {Object.entries(toolConnections).map(([toolKey, conn]) => (
          <Card key={toolKey}>
            <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground mb-2">
              {toolKey === 'googleWorkspace' ? 'Google Workspace' : toolKey.replace('social_', 'Social ').toUpperCase()}
            </div>
            <div className="text-lg font-semibold text-foreground">{conn.status === 'connected' ? 'Connected' : 'Not connected'}</div>
            <div className="text-sm text-muted-foreground mt-1">{conn.name || 'No account linked'}</div>
          </Card>
        ))}
        <Card>
          <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground mb-2">Billing Model</div>
          <div className="text-lg font-semibold text-foreground">
            {instance.machineType === 'e2-small' ? '100' : instance.machineType === 'e2-medium' ? '200' : '400'} CR/day
          </div>
          <div className="text-sm text-muted-foreground mt-1">Utility-based daily credit deduction ({instance.machineType})</div>
        </Card>
      </div>

      <Card>
        <h3 className="text-xs uppercase tracking-[0.18em] text-muted-foreground mb-4">Assigned Issues</h3>
        <div className="space-y-2">
          {agentTasks.length === 0 ? (
            <div className="text-muted-foreground text-sm py-2">No issues currently assigned to this agent.</div>
          ) : (
            agentTasks.map((t: any) => (
              <div
                key={t._id}
                onClick={() => navigate(`/fleet/${fleetId}/issues/${t._id}`)}
                className="flex items-center justify-between p-3 bg-secondary hover:bg-secondary/70 rounded-lg transition-colors border border-border cursor-pointer group"
              >
                <div className="flex items-center gap-3">
                  <span className="text-xs font-mono text-muted-foreground group-hover:text-foreground transition-colors">{t.identifier}</span>
                  <span className="text-sm font-medium text-foreground">{t.title}</span>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded border border-border text-muted-foreground">
                    {t.status.replace('_', ' ')}
                  </span>
                  {t.priority !== 'none' && (
                    <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded border ${t.priority === 'critical' ? 'text-red-500 border-red-500/20 bg-red-500/10' : t.priority === 'high' ? 'text-orange-500 border-orange-500/20 bg-orange-500/10' : t.priority === 'medium' ? 'text-yellow-500 border-yellow-500/20 bg-yellow-500/10' : 'text-blue-500 border-blue-500/20 bg-blue-500/10'}`}>
                      {t.priority}
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );

  const renderInstructions = () => {
    if (isLoadingInstructionFile) {
      return (
        <Card className="p-8 h-[520px] flex flex-col items-center justify-center text-muted-foreground">
          <Loader2 className="animate-spin mb-3 text-blue-500" size={32} />
          <span className="text-sm font-medium">Loading instructions and file contents from VM...</span>
        </Card>
      );
    }

    return (
      <div className="grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)] gap-4">
        <Card noPadding className="p-3 space-y-3">
          <div className="pt-1">
            <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground mb-2">Files</div>
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {instructionFiles.map((file) => (
                <button
                  key={file.name}
                  type="button"
                  onClick={() => { setSelectedInstructionFile(file.name); setInstructionDraft(null); }}
                  className={cn(
                    'w-full text-left px-2 py-1.5 rounded-md text-xs transition-colors',
                    selectedInstructionFile === file.name ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary/60'
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate">{file.name}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </Card>

        <Card className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground mb-1">Selected File</div>
              <div className="font-mono text-sm text-foreground truncate">{selectedInstructionFile || 'None'}</div>
            </div>
          </div>

          <textarea
            value={selectedInstructionContent}
            onChange={(event) => setInstructionDraft(event.target.value)}
            className="w-full h-[460px] bg-zinc-950 border border-border rounded-md p-3 text-sm font-mono text-zinc-100 resize-none focus:outline-none focus:border-ring"
          />
        </Card>
      </div>
    );
  };

  const renderSkills = () => (
    <div className="grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)] gap-4">
      <Card noPadding className="p-3 space-y-3">
        <div className="pt-1">
          <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground mb-2">Skill Files</div>
          {skillsError && (
            <div className="mb-2 p-2 rounded bg-amber-500/10 border border-amber-500/20 text-[10px] text-amber-200">
              {skillsError}
            </div>
          )}
          {isSkillSnapshotLoading || isSavingSkill ? (
            <div className="py-8 flex flex-col items-center justify-center text-muted-foreground">
              <Loader2 className="animate-spin mb-2" size={18} />
              <span className="text-xs">{isSavingSkill ? 'Saving skills...' : 'Loading skills...'}</span>
            </div>
          ) : (
            <>
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {skillsFiles.map((file, idx) => (
                  <button
                    key={`${file.name}-${idx}`}
                    type="button"
                    onClick={() => { setSelectedSkillFile(file.name); setSkillDraftContent(null); }}
                    className={cn(
                      'w-full text-left px-2 py-1.5 rounded-md text-xs transition-colors',
                      selectedSkillFile === file.name ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary/60'
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate">{file.name || '(empty name)'}</span>
                    </div>
                  </button>
                ))}
                {skillsFiles.length === 0 && (
                  <div className="text-xs text-muted-foreground italic px-2 py-1">No skills added.</div>
                )}
              </div>
              <div className="mt-4 flex gap-2">
                <Button
                  type="button"
                  onClick={handleAddSkill}
                  variant="outline"
                  size="sm"
                  className="w-full"
                >
                  Add Skill
                </Button>
              </div>
            </>
          )}
        </div>
      </Card>

      <Card className="space-y-3">
        {isSkillSnapshotLoading || isSavingSkill ? (
          <div className="h-[460px] flex items-center justify-center text-muted-foreground">
            <Loader2 className="animate-spin mr-2" size={18} /> {isSavingSkill ? 'Saving skills...' : 'Loading skills...'}
          </div>
        ) : selectedSkillFile !== null ? (
          <>
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3 border-b border-border pb-3">
                <div className="flex-1">
                  <label className="block text-xs uppercase tracking-[0.16em] text-muted-foreground mb-1">Skill Folder Name</label>
                  <Input
                    value={selectedSkillFile || ''}
                    onChange={(e) => updateSelectedSkillName(e.target.value)}
                    disabled={selectedSkillFile === 'bihand' || selectedSkillFile === 'bihand-agent' || (selectedSkillFile || '').startsWith('bihand-') || (selectedSkillFile || '').startsWith('social-')}
                    className="font-mono disabled:cursor-not-allowed"
                    placeholder="my-skill-name"
                  />
                </div>
                {!isSystemSkill(selectedSkillFile || '') && (
                  <Button
                    type="button"
                    onClick={handleDeleteSkill}
                    variant="destructive"
                    size="sm"
                    className="self-end bg-red-500/10 text-red-300 hover:bg-red-500/20 border border-red-500/30"
                  >
                    Delete
                  </Button>
                )}
              </div>

              {!isSystemSkill(selectedSkillFile || '') && (
                <div className="flex items-center gap-2 bg-secondary/60 p-2.5 rounded-lg border border-border/60">
                  <span className="text-xs font-semibold text-muted-foreground">Preset Templates:</span>
                  <Select
                    className="text-xs py-1.5 flex-1"
                    onChange={handleApplySkillTemplate}
                    value="custom"
                  >
                    <option value="custom" disabled>Select preset...</option>
                    {Object.keys(SKILL_TEMPLATES).map((key) => (
                      <option key={key} value={key}>{key}</option>
                    ))}
                  </Select>
                </div>
              )}
            </div>

              <div>
                <label className="block text-xs uppercase tracking-[0.16em] text-muted-foreground mb-1 mt-2">
                  SKILL.md Content {isSystemSkill(selectedSkillFile || '') && <span className="text-blue-400 font-semibold lowercase">(System-managed)</span>}
                </label>
                <textarea
                  value={(skillDraftContent ?? skillsFiles.find(f => f.name === selectedSkillFile)?.content ?? '')}
                  onChange={(event) => setSkillDraftContent(event.target.value)}
                  disabled={isSystemSkill(selectedSkillFile || '')}
                  className="w-full h-[400px] bg-zinc-950 border border-border rounded-md p-3 text-sm font-mono text-zinc-100 resize-none focus:outline-none focus:border-ring disabled:opacity-80"
                  placeholder="Skill MD content..."
                />
              </div>
          </>
        ) : (
          <div className="h-[460px] flex items-center justify-center text-sm text-muted-foreground">
            Select or add a skill to edit.
          </div>
        )}
      </Card>
    </div>
  );

  const handleReconfigure = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetMachineType || !targetIteration || !targetProvider || !targetModel) return;
    setReconfigLoading(true);
    try {
      const response = await api.post(`/fleets/${fleetId}/instances/${instanceId}/reconfigure`, {
        machineType: targetMachineType,
        iteration: targetIteration,
        provider: targetProvider,
        model: targetModel,
        apiKeyCredentialId: targetApiKey,
        oauthToken: (targetIteration === 'claudecode' && useClaudeSubscription && targetOauthToken.trim())
          ? targetOauthToken.trim()
          : null,
      });
      alert(response.data.message || "Agent reconfiguration initiated!");
      await fetchDetails();
    } catch (e: any) {
      alert(e.response?.data?.detail || "Failed to reconfigure agent");
    } finally {
      setReconfigLoading(false);
    }
  };

  const modelOptionsByProvider: Record<string, string[]> = {
    bihand: ['gemini-3.5-flash'],
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
    bihand: 'gemini-3.5-flash',
  };

  const renderConfiguration = () => {
    // Sync default values on load
    if (instance && !targetMachineType) {
      setTargetMachineType(instance.machineType || 'e2-small');
      setTargetIteration(instance.agentType || 'openclaw');
      setTargetProvider(instance.provider || 'openai');
      setTargetModel(instance.model || 'default');
    }

    const providerOptions = [
      { value: 'bihand', label: 'Bihand (Zero-Configuration Google Gemini 3.5 Flash)' },
      { value: 'anthropic', label: 'Anthropic (Claude)' },
      { value: 'openai', label: 'OpenAI (GPT)' },
      { value: 'gemini', label: 'Google Gemini' },
      { value: 'deepseek', label: 'DeepSeek' },
    ];

    const machineOptions = [
      { value: 'e2-small', label: 'Small (2 vCPU, 2GB RAM, 64GB Disk) - 100 CR/day' },
      { value: 'e2-medium', label: 'Medium (2 vCPU, 4GB RAM, 128GB Disk) - 200 CR/day' },
      { value: 'e2-standard-2', label: 'Large (2 vCPU, 8GB RAM, 256GB Disk) - 400 CR/day' },
    ];

    const strategyOptions = [
      { value: 'openclaw', label: 'OpenClaw (Autonomous GUI browser agent)' },
      { value: 'opencode', label: 'OpenCode VM (High-speed software developer runtime)' },
      { value: 'claudecode', label: 'ClaudeCode CLI strategy' },
      { value: 'codex', label: 'OpenAI Codex Strategy' },
    ];

    const activeModelOptions = modelOptionsByProvider[targetProvider] || [];
    const isPredefined = activeModelOptions.includes(targetModel);
    const selectValue = isPredefined ? targetModel : (targetModel ? 'custom' : '');

    return (
      <form onSubmit={handleReconfigure} className="space-y-6 text-left">
        <Card>
          <h3 className="text-lg font-semibold text-foreground mb-4 font-mono uppercase tracking-wider text-xs text-purple-400">Identity</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1 font-semibold">Name / Role</label>
              <Input className="opacity-80" value={instance?.role || ''} readOnly />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1 font-semibold">Title</label>
              <Input className="opacity-80" value={instance?.alias || 'Employee'} readOnly />
            </div>
          </div>
        </Card>

        <Card className="space-y-4 shadow-xl">
          <div className="border-b border-border pb-3">
            <h3 className="font-semibold text-xs text-foreground uppercase tracking-wider font-mono">Reconfigure & Resize Worker</h3>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Modify this agent's hardware performance configuration, runtime worker strategies, and active model providers on the fly.
            All currently active task backlogs, conversations, and subtask trees will be securely retained.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-border/60">
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1 font-semibold">Runtime Strategy</label>
              <Select
                value={targetIteration}
                onChange={(e) => {
                  const newType = e.target.value;
                  setTargetIteration(newType);
                  if (newType === 'claudecode') {
                    setTargetProvider('anthropic');
                    setTargetModel('claude-sonnet-4-6');
                  }
                }}
                className="text-xs py-1.5"
              >
                {strategyOptions.map(s => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </Select>
            </div>

            <div>
              <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1 font-semibold">Machine size</label>
              <Select
                value={targetMachineType}
                onChange={(e) => setTargetMachineType(e.target.value)}
                className="text-xs py-1.5"
              >
                {machineOptions.map(m => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </Select>
            </div>

            <div className={targetProvider === 'bihand' ? 'col-span-2' : ''}>
              <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1 font-semibold">LLM Provider</label>
              <Select
                value={targetProvider}
                disabled={targetIteration === 'claudecode'}
                onChange={(e) => {
                  const prov = e.target.value;
                  setTargetProvider(prov);
                  setTargetModel(defaultModels[prov] || '');
                }}
                className="text-xs py-1.5"
              >
                {providerOptions.map(p => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </Select>
            </div>

            {targetProvider !== 'bihand' && (
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1 font-semibold">Model Target</label>
                <div className="space-y-1.5 text-left">
                  <Select
                    value={selectValue}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === 'custom') {
                        setTargetModel('');
                      } else {
                        setTargetModel(val);
                      }
                    }}
                    className="text-xs py-1.5"
                  >
                    <option value="" disabled>Select target model...</option>
                    {activeModelOptions.map(opt => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                    <option value="custom">Custom model string...</option>
                  </Select>
                  {selectValue === 'custom' && (
                    <Input
                      type="text"
                      value={targetModel}
                      onChange={(e) => setTargetModel(e.target.value)}
                      className="text-xs py-1.5 font-mono"
                      placeholder="e.g. gpt-4o, claude-3-5-sonnet"
                    />
                  )}
                </div>
              </div>
            )}

            {targetProvider !== 'bihand' && (
              <div className="col-span-2">
                <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1 font-semibold flex justify-between">
                  <span>API Key Credential</span>
                  <button type="button" onClick={() => { setIsAddingCredential(true); setNewCredType('llm_api_key'); }} className="text-[10px] text-blue-400 hover:underline">+ New secret</button>
                </label>
                <Select
                  value={targetApiKey}
                  onChange={e => {
                    if (e.target.value === 'create_new') {
                      setIsAddingCredential(true);
                      setNewCredType('llm_api_key');
                    } else {
                      setTargetApiKey(e.target.value);
                    }
                  }}
                  className="text-xs py-1.5"
                >
                  <option value="">Select Encrypted Credential (or leave blank to re-use active credential)...</option>
                  <option value="create_new">+ Create new credential...</option>
                  {credentials.filter(c => c.type === 'llm_api_key' || c.type === 'generic_token').map(c => (
                    <option key={c._id} value={c._id}>{c.name}</option>
                  ))}
                </Select>
              </div>
            )}

            {targetIteration === 'claudecode' && (
              <div className="col-span-2 border border-border rounded-lg p-3 bg-secondary/60 space-y-2">
                <label className="flex items-center gap-2 text-xs text-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useClaudeSubscription}
                    onChange={(e) => setUseClaudeSubscription(e.target.checked)}
                    className="accent-blue-500"
                  />
                  Use my Claude subscription (Pro/Max/Team) instead of API key billing
                </label>
                {useClaudeSubscription && (
                  <div className="space-y-1.5 pl-6">
                    <p className="text-[10px] text-muted-foreground leading-relaxed">
                      Run <code className="text-muted-foreground">claude setup-token</code> on a machine with a browser
                      (requires a Claude Pro, Max, Team, or Enterprise plan), then paste the printed token below.
                      It's a one-year token — inference runs against your subscription, not this agent's API key.
                    </p>
                    <Input
                      type="password"
                      value={targetOauthToken}
                      onChange={(e) => setTargetOauthToken(e.target.value)}
                      className="text-xs py-1.5 font-mono"
                      placeholder="Paste the token from `claude setup-token`..."
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex justify-end pt-4 border-t border-border/60">
            <Button
              type="submit"
              disabled={reconfigLoading || !instance}
              size="sm"
              className="min-w-[120px] h-9"
            >
              {reconfigLoading ? (
                <>
                  <Loader2 size={14} className="animate-spin" /> Reconfiguring...
                </>
              ) : (
                <>Reconfigure Agent</>
              )}
            </Button>
          </div>
        </Card>

        {renderMcpServers()}
      </form>
    );
  };

  const renderSocialIntegrationRow = (platform: string, label: string, credType: string, selectedVal: string, setSelectedVal: React.Dispatch<React.SetStateAction<string>>) => {
    const connKey = `social_${platform}`;
    const conn = toolConnections[connKey] || {};
    
    return (
      <div key={platform} className="flex items-center justify-between border-b border-border py-4 last:border-none last:pb-0">
        <div>
          <h4 className="text-md font-semibold text-foreground">{label}</h4>
          <p className="text-xs text-muted-foreground mt-0.5">Post and upload auto-updates to your linked {label} account.</p>
          <div className="mt-2 text-xs text-muted-foreground">
            Status: <span className="text-foreground font-medium">{conn.status || 'not_connected'}</span>
            {conn.name ? ` (${conn.name})` : ''}
            {conn.lastError && <span className="text-red-400 block mt-1">Error: {conn.lastError}</span>}
          </div>
        </div>
        <div className="flex flex-col gap-2 w-72">
          {conn.status === 'connected' ? (
            <Button
              type="button"
              onClick={() => handlePlatformDisconnect(platform)}
              disabled={disconnectingPlatform === platform}
              size="sm"
              className="w-full border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 text-red-300"
            >
              {disconnectingPlatform === platform ? <Loader2 size={14} className="animate-spin" /> : <Unplug size={14} />}
              Disconnect {label}
            </Button>
          ) : (
            <>
              <Select
                className="text-xs"
                value={selectedVal}
                onChange={(e) => {
                  if (e.target.value === 'ADD_NEW') {
                    setIsAddingCredential(true);
                    setNewCredType(credType);
                  } else {
                    setSelectedVal(e.target.value);
                  }
                }}
              >
                <option value="" disabled>Select {label} Credential...</option>
                {credentials.filter(c => c.type === credType).map(c => (
                  <option key={c._id} value={c._id}>{c.name}</option>
                ))}
                <option value="ADD_NEW">+ Create New {label} Credential...</option>
              </Select>
              <Button
                type="button"
                onClick={() => handlePlatformConnect(platform, selectedVal)}
                disabled={connectingPlatform === platform || !selectedVal}
                size="sm"
                className="w-full border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300"
              >
                {connectingPlatform === platform ? <Loader2 size={14} className="animate-spin" /> : <LinkIcon size={14} />}
                Connect {label}
              </Button>
            </>
          )}
        </div>
      </div>
    );
  };

  const renderIntegrations = () => (
    <div className="space-y-6">
      {/* Google Workspace */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-white rounded-lg flex items-center justify-center p-2">
              <svg viewBox="0 0 24 24" className="w-full h-full"><path fill="#4285F4" d="M23.745 12.27c0-.825-.075-1.62-.21-2.385H12.24v4.53h6.465a5.49 5.49 0 0 1-2.385 3.585v2.97h3.855c2.265-2.07 3.57-5.115 3.57-8.7z"/><path fill="#34A853" d="M12.24 24c3.24 0 5.955-1.08 7.935-2.91l-3.855-2.97c-1.08.72-2.46 1.155-4.08 1.155-3.135 0-5.79-2.115-6.735-4.965H1.47v3.075A11.996 11.996 0 0 0 12.24 24z"/><path fill="#FBBC05" d="M5.505 14.31A7.162 7.162 0 0 1 5.13 12a7.162 7.162 0 0 1 .375-2.31V6.615H1.47A11.97 11.97 0 0 0 0 12c0 1.935.465 3.765 1.275 5.385l4.23-3.075z"/><path fill="#EA4335" d="M12.24 4.725c1.77 0 3.36.6 4.605 1.785l3.45-3.45C18.195 1.14 15.48 0 12.24 0 7.545 0 3.345 2.7 1.47 6.615l4.035 3.075c.945-2.85 3.6-4.965 6.735-4.965z"/></svg>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-foreground">Google Workspace</h3>
              <p className="text-sm text-muted-foreground">Access Gmail, Calendar, Drive, Docs, and Sheets.</p>
            </div>
          </div>
          <div className="flex flex-col gap-2 w-72">
            {googleConnection.status === 'connected' ? (
              <Button
                type="button"
                onClick={handleGoogleDisconnect}
                disabled={isDisconnectingGoogle}
                className="w-full border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 text-red-300"
              >
                {isDisconnectingGoogle ? <Loader2 size={16} className="animate-spin" /> : <Unplug size={16} />}
                Disconnect
              </Button>
            ) : (
              <>
                <Select
                  value={selectedGoogleCred}
                  onChange={(e) => {
                    if (e.target.value === 'ADD_NEW') {
                      setIsAddingCredential(true);
                      setNewCredType('google_workspace');
                    } else {
                      setSelectedGoogleCred(e.target.value);
                    }
                  }}
                >
                  <option value="" disabled>Select Credential...</option>
                  {credentials.filter(c => c.type === 'google_workspace').map(c => (
                    <option key={c._id} value={c._id}>{c.name}</option>
                  ))}
                  <option value="ADD_NEW">+ Add New Credential...</option>
                </Select>
                <Button
                  type="button"
                  onClick={handleGoogleConnect}
                  disabled={isConnectingGoogle || !selectedGoogleCred}
                  className="w-full border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300"
                >
                  {isConnectingGoogle ? <Loader2 size={16} className="animate-spin" /> : <LinkIcon size={16} />}
                  Connect
                </Button>
              </>
            )}
          </div>
        </div>
        <div className="mt-4 pt-4 border-t border-border text-sm text-muted-foreground">
          Status: <span className="text-foreground font-medium">{googleConnection.status || 'not_connected'}</span>
          {googleConnection.email ? ` (${googleConnection.email})` : ''}
          {googleConnection.lastError && (
            <div className="mt-2 text-sm text-red-400">Last error: {googleConnection.lastError}</div>
          )}
        </div>
      </Card>

      {/* Meta MCP - Facebook/Instagram/Threads/Ads agent tools */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-white rounded-lg flex items-center justify-center p-2">
              <svg viewBox="0 0 24 24" className="w-full h-full"><path fill="#1877F2" d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-foreground">Meta MCP</h3>
              <p className="text-sm text-muted-foreground">Gives this agent native MCP tools for Facebook Pages, Instagram, Threads, and Ads Manager (if the token has ads scopes). Handled entirely behind the scenes - no manual setup.</p>
            </div>
          </div>
          <div className="flex flex-col gap-2 w-72">
            {metaMcpConnection.status === 'connected' ? (
              <Button
                type="button"
                onClick={handleMetaMcpDisconnect}
                disabled={isDisconnectingMetaMcp}
                className="w-full border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 text-red-300"
              >
                {isDisconnectingMetaMcp ? <Loader2 size={16} className="animate-spin" /> : <Unplug size={16} />}
                Disconnect
              </Button>
            ) : (
              <>
                <Select
                  value={selectedMetaMcpCred}
                  onChange={(e) => {
                    if (e.target.value === 'ADD_NEW') {
                      setIsAddingCredential(true);
                      setNewCredType('social_facebook');
                    } else {
                      setSelectedMetaMcpCred(e.target.value);
                    }
                  }}
                >
                  <option value="" disabled>Select Facebook Page Credential...</option>
                  {credentials.filter(c => c.type === 'social_facebook').map(c => (
                    <option key={c._id} value={c._id}>{c.name}</option>
                  ))}
                  <option value="ADD_NEW">+ Create New Facebook Page Credential...</option>
                </Select>
                <Button
                  type="button"
                  onClick={handleMetaMcpConnect}
                  disabled={isConnectingMetaMcp || !selectedMetaMcpCred}
                  className="w-full border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300"
                >
                  {isConnectingMetaMcp ? <Loader2 size={16} className="animate-spin" /> : <LinkIcon size={16} />}
                  Connect
                </Button>
              </>
            )}
          </div>
        </div>
        <div className="mt-4 pt-4 border-t border-border text-sm text-muted-foreground">
          Status: <span className="text-foreground font-medium">{metaMcpConnection.status || 'not_connected'}</span>
          {metaMcpConnection.name ? ` (${metaMcpConnection.name})` : ''}
          {metaMcpConnection.lastError && (
            <div className="mt-2 text-sm text-red-400">Last error: {metaMcpConnection.lastError}</div>
          )}
        </div>
      </Card>

      {/* Meta Developer Tools MCP - remote MCP for inspecting/debugging Meta's own dev-console app config */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-white rounded-lg flex items-center justify-center p-2">
              <svg viewBox="0 0 24 24" className="w-full h-full"><path fill="#1877F2" d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-foreground">Meta Developer Tools MCP</h3>
              <p className="text-sm text-muted-foreground">Gives this agent Meta's dev-console tools: search Meta's docs, inspect app settings/security config, check App Review and compliance status, monitor API usage and rate limits, and manage webhook subscriptions.</p>
            </div>
          </div>
          <div className="flex flex-col gap-2 w-72">
            {metaDevtoolsConnection.status === 'connected' ? (
              <Button
                type="button"
                onClick={handleMetaDevtoolsDisconnect}
                disabled={isDisconnectingMetaDevtools}
                className="w-full border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 text-red-300"
              >
                {isDisconnectingMetaDevtools ? <Loader2 size={16} className="animate-spin" /> : <Unplug size={16} />}
                Disconnect
              </Button>
            ) : (
              <>
                <Select
                  value={selectedMetaDevtoolsCred}
                  onChange={(e) => {
                    if (e.target.value === 'ADD_NEW') {
                      setIsAddingCredential(true);
                      setNewCredType('meta_devtools');
                    } else {
                      setSelectedMetaDevtoolsCred(e.target.value);
                    }
                  }}
                >
                  <option value="" disabled>Select Meta Developer Tools Credential...</option>
                  {credentials.filter(c => c.type === 'meta_devtools').map(c => (
                    <option key={c._id} value={c._id}>{c.name}</option>
                  ))}
                  <option value="ADD_NEW">+ Authorize with Meta...</option>
                </Select>
                <Button
                  type="button"
                  onClick={handleMetaDevtoolsConnect}
                  disabled={isConnectingMetaDevtools || !selectedMetaDevtoolsCred}
                  className="w-full border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300"
                >
                  {isConnectingMetaDevtools ? <Loader2 size={16} className="animate-spin" /> : <LinkIcon size={16} />}
                  Connect
                </Button>
              </>
            )}
          </div>
        </div>
        <div className="mt-4 pt-4 border-t border-border text-sm text-muted-foreground">
          Status: <span className="text-foreground font-medium">{metaDevtoolsConnection.status || 'not_connected'}</span>
          {metaDevtoolsConnection.name ? ` (${metaDevtoolsConnection.name})` : ''}
          {metaDevtoolsConnection.lastError && (
            <div className="mt-2 text-sm text-red-400">Last error: {metaDevtoolsConnection.lastError}</div>
          )}
        </div>
      </Card>

      {/* Social Media - Granular Platform Credentials */}
      <Card className="p-6 space-y-4">
        <div className="flex items-center gap-4 mb-4 pb-4 border-b border-border">
          <div className="w-12 h-12 bg-white rounded-lg flex items-center justify-center p-2 text-zinc-900">
            <Share2 size={28} />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-foreground">Social Media Integrations</h3>
            <p className="text-sm text-muted-foreground">Bind specific secure accounts directly to your agent.</p>
          </div>
        </div>

        {renderSocialIntegrationRow("instagram", "Instagram Business", "social_instagram", selectedIgCred, setSelectedIgCred)}
        {renderSocialIntegrationRow("x", "X (Twitter)", "social_x", selectedXCred, setSelectedXCred)}
        {renderSocialIntegrationRow("reddit", "Reddit API", "social_reddit", selectedRedditCred, setSelectedRedditCred)}
      </Card>
    </div>
  );

  const renderMcpServers = () => {
    const canModify = instance?.status === 'running';

    const renderMcpForm = () => (
      <Card className="bg-secondary/40 space-y-4 mb-4">
        <h4 className="text-sm font-semibold text-foreground">{mcpFormMode === 'add' ? 'Add MCP Server' : `Edit "${mcpFormMode}"`}</h4>
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1 font-semibold">Name</label>
          <Input
            type="text"
            value={mcpFormName}
            onChange={(e) => setMcpFormName(e.target.value)}
            disabled={mcpFormMode !== 'add'}
            className="text-xs py-1.5 font-mono disabled:cursor-not-allowed"
            placeholder="e.g. my-custom-tool"
          />
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setMcpFormType('local')}
            className={cn(
              'px-3 py-1.5 rounded-md text-xs font-medium border',
              mcpFormType === 'local' ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground'
            )}
          >
            Local (command)
          </button>
          <button
            type="button"
            onClick={() => setMcpFormType('remote')}
            className={cn(
              'px-3 py-1.5 rounded-md text-xs font-medium border',
              mcpFormType === 'remote' ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground'
            )}
          >
            Remote (URL)
          </button>
        </div>
        {mcpFormType === 'local' ? (
          <>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1 font-semibold">Command</label>
              <Input
                type="text"
                value={mcpFormCommand}
                onChange={(e) => setMcpFormCommand(e.target.value)}
                className="text-xs py-1.5 font-mono"
                placeholder="npx"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1 font-semibold">Arguments (one per line)</label>
              <Textarea
                value={mcpFormArgs}
                onChange={(e) => setMcpFormArgs(e.target.value)}
                rows={3}
                className="text-xs py-1.5 font-mono"
                placeholder={"-y\n@some/mcp-package"}
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1 font-semibold">Environment Variables (KEY=VALUE, one per line)</label>
              <Textarea
                value={mcpFormEnv}
                onChange={(e) => setMcpFormEnv(e.target.value)}
                rows={3}
                className="text-xs py-1.5 font-mono"
                placeholder={"API_KEY=your-key-here"}
              />
            </div>
          </>
        ) : (
          <>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1 font-semibold">URL</label>
              <Input
                type="text"
                value={mcpFormUrl}
                onChange={(e) => setMcpFormUrl(e.target.value)}
                className="text-xs py-1.5 font-mono"
                placeholder="https://example.com/mcp"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1 font-semibold">Headers (KEY=VALUE, one per line)</label>
              <Textarea
                value={mcpFormHeaders}
                onChange={(e) => setMcpFormHeaders(e.target.value)}
                rows={3}
                className="text-xs py-1.5 font-mono"
                placeholder={"Authorization=Bearer ..."}
              />
            </div>
          </>
        )}
        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <Button
            type="button"
            onClick={resetMcpForm}
            disabled={mcpSaving}
            variant="ghost"
            size="sm"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleMcpServerSave}
            disabled={mcpSaving}
            size="sm"
          >
            {mcpSaving ? <Loader2 size={14} className="animate-spin" /> : null}
            {mcpFormMode === 'add' ? 'Add Server' : 'Save Changes'}
          </Button>
        </div>
      </Card>
    );

    return (
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-foreground">MCP Servers</h3>
            <p className="text-sm text-muted-foreground mt-0.5">Custom MCP tools available to this agent. System-managed servers are read-only here.</p>
          </div>
          {!mcpFormMode && (
            <Button
              type="button"
              onClick={openAddMcpForm}
              disabled={!canModify}
              title={!canModify ? 'Agent must be running to modify MCP servers' : undefined}
              size="sm"
              className="border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300"
            >
              <Plus size={14} /> Add MCP Server
            </Button>
          )}
        </div>

        {!canModify && (
          <div className="mb-4 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-md px-3 py-2">
            Agent must be in "running" status to add, edit, or remove MCP servers.
          </div>
        )}

        {mcpFormMode && renderMcpForm()}

        {isLoadingMcpServers ? (
          <div className="text-xs text-muted-foreground flex items-center gap-2 py-4"><Loader2 size={14} className="animate-spin" /> Loading MCP servers...</div>
        ) : mcpServerList.length === 0 ? (
          <div className="text-xs text-muted-foreground py-4">No MCP servers configured yet.</div>
        ) : (
          <div className="space-y-2">
            {mcpServerList.map(server => (
              <div key={server.name} className="flex items-center justify-between border border-border rounded-md px-3 py-2.5 bg-secondary/40">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-foreground">{server.name}</span>
                    {(server.protected || isProtectedMcpServer(server.name)) && (
                      <span className="text-[10px] text-blue-400 font-semibold uppercase">(System-managed)</span>
                    )}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
                    {server.url ? server.url : `${server.command || ''} ${(server.args || []).join(' ')}`.trim()}
                  </div>
                </div>
                {!(server.protected || isProtectedMcpServer(server.name)) && (
                  <div className="flex items-center gap-1 shrink-0 ml-3">
                    <button
                      type="button"
                      onClick={() => openEditMcpForm(server)}
                      disabled={!canModify}
                      className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary disabled:opacity-40"
                      title="Edit"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMcpServerDelete(server.name)}
                      disabled={!canModify || mcpDeletingName === server.name}
                      className="p-1.5 rounded-md text-red-400 hover:bg-red-500/10 disabled:opacity-40"
                      title="Delete"
                    >
                      {mcpDeletingName === server.name ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    );
  };

  const renderRuns = () => (
    <Card className="p-6">
      <div className="text-foreground text-lg font-semibold mb-2">Run History</div>
      <div className="text-muted-foreground text-sm mb-4">Per-agent run timeline will appear here. Current execution events are available in Fleet Activity and issue threads.</div>
      <Button
        type="button"
        onClick={() => navigate(`/fleet/${fleetId}/activity`)}
        variant="outline"
        size="sm"
      >
        <Activity size={15} /> Open Fleet Activity
      </Button>
    </Card>
  );



  const saveButtonDisabled =
    isSaving
    || isLoadingConfig
    || !['running', 'stopped', 'error'].includes(instance.status)
    || (activeTab === 'instructions' && !instructionDirty)
    || (activeTab === 'skills' && !skillsDirty);

  const saveButtonLabel = activeTab === 'instructions'
    ? (isSavingInstructions ? 'Saving...' : 'Save Instructions')
    : activeTab === 'skills'
    ? (isSavingSkill ? 'Saving...' : 'Save Skills')
    : (isSaving ? 'Saving...' : 'Save');

  const tabDefs: { id: TabType; label: string }[] = [
    { id: 'dashboard', label: 'Dashboard' },
    ...(supportsInstructions ? [{ id: 'instructions' as TabType, label: 'Instructions' }] : []),
    ...(adapterCapabilities?.supportsSkills ? [{ id: 'skills' as TabType, label: 'Skills' }] : []),
    { id: 'configuration', label: 'Configuration' },
    { id: 'integrations', label: 'Integrations' },
    { id: 'runs', label: 'Runs' },
    ...(instance.status === 'running' ? [{ id: 'terminal' as TabType, label: 'Terminal' }] : []),
  ];

  return (
    <div className="p-8 h-full flex flex-col overflow-hidden">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <AvatarImage
              hash={instance?.avatarHash}
              className="w-12 h-12 rounded-lg overflow-hidden bg-secondary flex items-center justify-center text-foreground border border-border"
              fallbackSize={28}
            />
            <div>
              <h1 className="text-3xl font-bold tracking-tight">{instance.role}</h1>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span className="uppercase">{instance.agentType}</span>
                <span>&middot;</span>
                <span className={statusTone}>{instance.status.replace('_', ' ')}</span>
              </div>
            </div>
          </div>
          <div className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{instance.title || 'Agent'}</span>
            <span className="mx-2">&middot;</span>
            Model: {instance.model || 'default'}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {instance.status === 'stopped' ? (
            <Button
              onClick={handleStartAgent}
              disabled={powerLoading || ["provisioning_queued", "provisioning", "installing", "starting_queued", "stopping_queued", "restarting_queued", "deleting_queued", "deleting", "updating"].includes(instance.status)}
              size="sm"
              className="border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400"
            >
              {powerLoading ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
              Start Agent
            </Button>
          ) : (instance.status === 'running' || instance.status === 'provisioned') ? (
            <Button
              onClick={handleStopAgent}
              disabled={powerLoading || ["provisioning_queued", "provisioning", "installing", "starting_queued", "stopping_queued", "restarting_queued", "deleting_queued", "deleting", "updating"].includes(instance.status)}
              size="sm"
              className="border border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400"
            >
              {powerLoading ? <Loader2 size={16} className="animate-spin" /> : <Square size={16} />}
              Stop Agent
            </Button>
          ) : instance.status === 'error' ? (
            <div className="flex items-center gap-2">
              <Button
                onClick={handleStartAgent}
                disabled={powerLoading}
                size="sm"
                className="border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400"
              >
                {powerLoading ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
                Start Agent
              </Button>
              <Button
                onClick={handleRestartAgent}
                disabled={powerLoading}
                size="sm"
                className="border border-blue-500/30 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400"
              >
                {powerLoading ? <Loader2 size={16} className="animate-spin" /> : <RotateCcw size={16} />}
                Restart & Heal
              </Button>
            </div>
          ) : (
            <Button
              disabled
              variant="outline"
              size="sm"
            >
              Changing...
            </Button>
          )}

          <Button
            onClick={handlePrimarySave}
            disabled={saveButtonDisabled}
            size="sm"
          >
            {(isSaving || isSavingInstructions || isSavingSkill) ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            {saveButtonLabel}
          </Button>

          {instance.ip && instance.status === 'running' && (
            <a
              href={instance.agentType === 'openclaw' ? `http://${instance.ip}/screen/vnc.html?chat=session&session=main${instance.token ? `&token=${instance.token}` : ''}` : `http://${instance.ip}/screen/vnc.html?path=screen/websockify${instance.token ? `&token=${instance.token}` : ''}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 border border-blue-500/30 bg-blue-500/10 px-3 py-1.5 rounded-md text-sm hover:bg-blue-500/20 transition-colors text-blue-400 font-medium"
            >
              <MonitorPlay size={16} /> Live Screen
            </a>
          )}

          {instance.ip && instance.status === 'running' && instance.agentType === 'openclaw' && (
            <a
              href={`http://${instance.ip}/${instance.token ? `?token=${instance.token}` : ''}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 border border-purple-500/30 bg-purple-500/10 px-3 py-1.5 rounded-md text-sm hover:bg-purple-500/20 transition-colors text-purple-400 font-medium"
            >
              <ExternalLink size={16} /> OpenClaw Dashboard
            </a>
          )}

          {instance.status !== 'deleted' && (
            <Button
              onClick={() => setViewingLogs(true)}
              size="sm"
              className="border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400"
            >
              <TerminalSquare size={16} /> Logs
            </Button>
          )}
        </div>
      </div>

      {['running', 'stopped', 'error'].includes(instance.status) ? (
        <>
          <div className="flex border-b border-border mb-6 overflow-x-auto">
            {tabDefs.map(({ id, label }) => (
              <button
                key={id}
                onClick={() => handleTabChange(id)}
                className={cn(
                  'px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
                  activeTab === id ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto pr-1">
            {activeTab === 'dashboard' && renderDashboard()}
            {activeTab === 'instructions' && renderInstructions()}
            {activeTab === 'skills' && renderSkills()}
            {activeTab === 'configuration' && renderConfiguration()}
            {activeTab === 'integrations' && renderIntegrations()}
            {activeTab === 'runs' && renderRuns()}
            {activeTab === 'terminal' && instance.status === 'running' && (
              <div className="h-[70vh]">
                <TerminalPanel instanceId={instanceId!} fleetId={fleetId!} />
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center min-h-[400px] text-muted-foreground space-y-4">
          <Loader2 className="animate-spin text-foreground" size={32} />
          <span className="text-lg font-medium text-foreground">Agent is currently {instance.status.replace('_', ' ')}.</span>
          <span className="text-sm">Please wait until the agent is available.</span>
        </div>
      )}

      <Modal open={isAddingCredential} onClose={() => setIsAddingCredential(false)} title="Add Secret Credential" widthClassName="max-w-lg">
        <form onSubmit={handleAddCredential} className="space-y-4 text-left">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">Credential Name</label>
            <Input
              type="text"
              required
              placeholder="e.g. Acme Account"
              value={newCredName}
              onChange={e => setNewCredName(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">Credential Type</label>
            <Select
              value={newCredType}
              onChange={e => setNewCredType(e.target.value)}
            >
              <option value="google_workspace">Google Workspace (OAuth)</option>
              <option value="meta_devtools">Meta Developer Tools (OAuth)</option>
              <option value="social_facebook">Facebook Page (for Meta MCP)</option>
              <option value="social_instagram">Instagram Business Integration</option>
              <option value="social_x">X (Twitter) Developer API</option>
              <option value="social_reddit">Reddit API Integration</option>
            </Select>
          </div>

          {/* Custom Inputs for Facebook */}
          {newCredType === 'social_facebook' && (
            <div className="grid grid-cols-2 gap-4 border-t border-border pt-4">
              <div className="col-span-2">
                <h4 className="text-xs font-semibold text-foreground uppercase tracking-wider mb-2">Facebook Settings</h4>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">Page ID</label>
                <Input
                  type="text"
                  required
                  placeholder="e.g. 109283748293749"
                  value={fbPageId}
                  onChange={e => setFbPageId(e.target.value)}
                  className="font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">Page Access Token</label>
                <Input
                  type="password"
                  required
                  placeholder="EAAG..."
                  value={fbAccessToken}
                  onChange={e => setFbAccessToken(e.target.value)}
                  className="font-mono"
                />
              </div>
            </div>
          )}

          {/* Custom Inputs for Instagram */}
          {newCredType === 'social_instagram' && (
            <div className="grid grid-cols-2 gap-4 border-t border-border pt-4">
              <div className="col-span-2">
                <h4 className="text-xs font-semibold text-foreground uppercase tracking-wider mb-2">Instagram Business Settings</h4>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">Instagram Business ID</label>
                <Input
                  type="text"
                  required
                  placeholder="e.g. 17841400000000000"
                  value={igBusinessId}
                  onChange={e => setIgBusinessId(e.target.value)}
                  className="font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">Facebook Page Access Token (linked to IG)</label>
                <Input
                  type="password"
                  required
                  placeholder="EAAG..."
                  value={igAccessToken}
                  onChange={e => setIgAccessToken(e.target.value)}
                  className="font-mono"
                />
              </div>
            </div>
          )}

          {/* Custom Inputs for X (Twitter) */}
          {newCredType === 'social_x' && (
            <div className="grid grid-cols-2 gap-4 border-t border-border pt-4">
              <div className="col-span-2">
                <h4 className="text-xs font-semibold text-foreground uppercase tracking-wider mb-2">X / Twitter API Keys (OAuth 1.0a)</h4>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">Consumer Key (API Key)</label>
                <Input
                  type="text"
                  required
                  placeholder="e.g. xYz..."
                  value={xConsumerKey}
                  onChange={e => setXConsumerKey(e.target.value)}
                  className="font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">Consumer Secret (API Secret)</label>
                <Input
                  type="password"
                  required
                  placeholder="e.g. sEcReT..."
                  value={xConsumerSecret}
                  onChange={e => setXConsumerSecret(e.target.value)}
                  className="font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">Access Token</label>
                <Input
                  type="text"
                  required
                  placeholder="e.g. 12345-abc..."
                  value={xAccessToken}
                  onChange={e => setXAccessToken(e.target.value)}
                  className="font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">Access Token Secret</label>
                <Input
                  type="password"
                  required
                  placeholder="e.g. sEcReT..."
                  value={xAccessTokenSecret}
                  onChange={e => setXAccessTokenSecret(e.target.value)}
                  className="font-mono"
                />
              </div>
            </div>
          )}

          {/* Custom Inputs for Reddit */}
          {newCredType === 'social_reddit' && (
            <div className="grid grid-cols-2 gap-4 border-t border-border pt-4">
              <div className="col-span-2">
                <h4 className="text-xs font-semibold text-foreground uppercase tracking-wider mb-2">Reddit API Settings</h4>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">Client ID</label>
                <Input
                  type="text"
                  required
                  placeholder="e.g. abcde12345"
                  value={redditClientId}
                  onChange={e => setRedditClientId(e.target.value)}
                  className="font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">Client Secret</label>
                <Input
                  type="password"
                  required
                  placeholder="e.g. sEcReT..."
                  value={redditClientSecret}
                  onChange={e => setRedditClientSecret(e.target.value)}
                  className="font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">Username</label>
                <Input
                  type="text"
                  required
                  placeholder="e.g. MyBotUser"
                  value={redditUsername}
                  onChange={e => setRedditUsername(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">Password</label>
                <Input
                  type="password"
                  required
                  placeholder="********"
                  value={redditPassword}
                  onChange={e => setRedditPassword(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">User Agent (Optional)</label>
                <Input
                  type="text"
                  placeholder="BihandAgent/1.0 by /u/MyBotUser"
                  value={redditUserAgent}
                  onChange={e => setRedditUserAgent(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">Target Subreddit (Optional)</label>
                <Input
                  type="text"
                  placeholder="e.g. test"
                  value={redditSubreddit}
                  onChange={e => setRedditSubreddit(e.target.value)}
                />
              </div>
            </div>
          )}

          {newCredType !== 'google_workspace' && newCredType !== 'meta_devtools' && !newCredType.startsWith('social_') && (
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">Secret Data</label>
              <Textarea
                required
                placeholder="sk-proj-..."
                value={newCredData}
                onChange={e => setNewCredData(e.target.value)}
                className="h-24 resize-none font-mono"
              />
            </div>
          )}

          <div className="flex justify-end gap-3 pt-4 border-t border-border mt-6">
            <Button type="button" onClick={() => setIsAddingCredential(false)} variant="ghost" size="sm">Cancel</Button>
            {newCredType === 'google_workspace' ? (
              <Button type="button" onClick={async () => {
                  if (!newCredName) {
                    alert("Please provide a name for the Google Workspace credential.");
                    return;
                  }
                  try {
                    const res = await api.post('/credentials/oauth/google/start', { name: newCredName });
                    window.location.href = res.data.authUrl;
                  } catch (e) {
                    alert("Failed to start Google OAuth flow.");
                  }
              }} size="sm" className="bg-blue-600 text-white hover:bg-blue-700 hover:opacity-100">
                <Globe size={16} /> Authorize with Google
              </Button>
            ) : newCredType === 'meta_devtools' ? (
              <Button type="button" onClick={async () => {
                  if (!newCredName) {
                    alert("Please provide a name for the Meta Developer Tools credential.");
                    return;
                  }
                  try {
                    const res = await api.post('/credentials/oauth/meta/start', { name: newCredName });
                    window.location.href = res.data.authUrl;
                  } catch {
                    alert("Failed to start Meta OAuth flow.");
                  }
              }} size="sm" className="bg-blue-600 text-white hover:bg-blue-700 hover:opacity-100">
                <Globe size={16} /> Authorize with Meta
              </Button>
            ) : (
              <Button type="submit" disabled={credIsLoading} size="sm">
                {credIsLoading ? <Loader2 size={16} className="animate-spin" /> : null}
                Save Secret
              </Button>
            )}
          </div>
        </form>
      </Modal>
      {viewingLogs && (
        <AgentLogsModal fleetId={fleetId!} instance={instance} onClose={() => setViewingLogs(false)} />
      )}
    </div>
  );
};

export default FleetAgentDetail;
