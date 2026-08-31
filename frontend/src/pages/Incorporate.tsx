import React, { useEffect, useState, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Building,
  Briefcase,
  ArrowRight,
  Rocket,
  Loader2,
  PlusCircle,
  Trash2,
  Network,
  CreditCard,
  Globe,
  Upload
} from 'lucide-react';
import api from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import OrgChartFlow from '../components/OrgChartFlow';
import AgentSetupWizard from '../components/AgentSetupWizard';

const Incorporate: React.FC = () => {
  const navigate = useNavigate();
  const { token, user } = useAuth();
  const { t, language } = useLanguage();
  const onBehalfOf = useMemo(() => new URLSearchParams(window.location.search).get('email'), []);
  const [activeStep, setActiveStep] = useState(1);
  const [avatarLibrary, setAvatarLibrary] = useState<any[]>([]);

  useEffect(() => {
    api.get('/avatar/library')
      .then(res => {
        if (res.data && res.data.library) {
          setAvatarLibrary(res.data.library);
        }
      })
      .catch(err => console.error('Failed to load avatar library:', err));
  }, []);
  
  // Fleet configuration
  const [fleetName, setFleetName] = useState('');
  const fleetPlan: string = 'custom';
  const [fleetMission, setFleetMission] = useState('Execute general business tasks autonomously.');
  const [password, setPassword] = useState('');
  
  // Initial task
  const [initialTaskTitle, setInitialTaskTitle] = useState('Review fleet mission and set up initial strategy');
  const [initialTaskDesc, setInitialTaskDesc] = useState('Please review our fleet mission statement, analyze our current resources, and formulate a step-by-step strategy. Report your findings and any blockers in this thread.');

  // Agent roster - starts empty. The fleet can be created with zero agents; agents are added
  // one at a time via AgentSetupWizard (the same modal/flow as the fleet dashboard's "Hire
  // Agent" button) and staged here as drafts until the fleet is actually submitted.
  const [agents, setAgents] = useState<any[]>([]);
  const [isAddAgentWizardOpen, setIsAddAgentWizardOpen] = useState(false);
  const [editingAgentIndex, setEditingAgentIndex] = useState<number | null>(null);

  // Modal and helper for Credential creation in the fleet deployment wizard
  const [isAddingCredential, setIsAddingCredential] = useState(false);
  const [newCredName, setNewCredName] = useState('');
  const [newCredType, setNewCredType] = useState('llm_api_key');
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

  const [existingCredentials, setExistingCredentials] = useState<any[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [draftCredentials, setDraftCredentials] = useState<any[]>([]);
  const [addingCredForAgentId, setAddingCredForAgentId] = useState<string | null>(null);

  // Roster CSV/XLSX Import State
  const [isParsingRoster, setIsParsingRoster] = useState(false);
  const rosterFileInputRef = useRef<HTMLInputElement>(null);

  const handleRosterFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const file = files[0];
    
    if (file.name.endsWith('.json')) {
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const rawData = JSON.parse(event.target?.result as string);
          const rawAgents = Array.isArray(rawData) ? rawData : (rawData.agents || []);
          
          const roleToId: Record<string, string> = {};
          const normalized = rawAgents.map((ag: any, idx: number) => {
            const role = ag.role || ag.roleKey || `Employee ${idx + 1}`;
            const id = `agent_${role.toLowerCase().replace(/ /g, '_')}_${Math.random().toString(36).substring(2, 6)}`;
            roleToId[role.toUpperCase()] = id;
            let prov = (ag.provider || 'anthropic').toLowerCase().trim();
            if (prov === 'google') prov = 'gemini';
            return {
              id,
              role,
              title: ag.title || `${role} Staff`,
              agentType: ag.agentType || ag.iteration || 'opencode',
              provider: prov,
              apiKey: ag.apiKey || '',
              model: ag.model || 'claude-sonnet-4-6',
              machineType: ag.machineType || 'e2-small',
              reportsTo: ag.reportsTo || null,
              enabledSkills: ag.enabledSkills || ['bihand'],
              avatarHash: ag.avatarHash || null,
              skillsFiles: ag.skillsFiles || ag.customSkills || [],
              customAgentMd: ag.customAgentMd || ag.agentMd || ''
            };
          });

          // Resolve reportsTo manager linkages
          normalized.forEach((ag: any) => {
            if (ag.reportsTo) {
              ag.reportsTo = roleToId[ag.reportsTo.toUpperCase()] || null;
            }
          });

          setAgents(normalized);
          alert(language === 'vi'
            ? `Đã nhập và thiết lập thành công ${normalized.length} nhân sự từ cấu hình JSON!` 
            : `Successfully imported and linked ${normalized.length} agents from JSON config!`
          );
        } catch (err: any) {
          alert("Failed to parse JSON file: " + err.message);
        }
      };
      reader.readAsText(file);
      if (rosterFileInputRef.current) {
        rosterFileInputRef.current.value = '';
      }
      return;
    }

    const formData = new FormData();
    formData.append('file', file);
    
    setIsParsingRoster(true);
    try {
      const res = await api.post('/fleets/parse-roster', formData);
      if (res.data && res.data.success && res.data.agents) {
        setAgents(res.data.agents);
        alert(language === 'vi'
          ? `Đã nhập và thiết lập thành công ${res.data.agents.length} nhân sự từ tệp ${file.name}!` 
          : `Successfully imported and linked ${res.data.agents.length} agents from ${file.name}!`
        );
      }
    } catch (err: any) {
      console.error(err);
      alert(err.response?.data?.detail || "Failed to parse imported roster file. Please ensure columns match standard headers.");
    } finally {
      setIsParsingRoster(false);
      if (rosterFileInputRef.current) {
        rosterFileInputRef.current.value = '';
      }
    }
  };

  const combinedCredentials = useMemo(() => {
    return [...draftCredentials, ...existingCredentials];
  }, [draftCredentials, existingCredentials]);

  useEffect(() => {
    if (token) {
      const url = onBehalfOf ? `/admin/users/${onBehalfOf}/credentials` : '/credentials';
      api.get(url)
        .then(res => setExistingCredentials(res.data.credentials || []))
        .catch(console.error);
    }
  }, [token, isAddingCredential, onBehalfOf]);

  useEffect(() => {
    if (token && draftCredentials.length > 0) {
      const uploadDrafts = async () => {
        const idMap: Record<string, string> = {};
        for (const draft of draftCredentials) {
          try {
            const res = await api.post('/credentials', {
              name: draft.name.replace(' (Draft)', ''),
              type: draft.type,
              data: draft.data
            });
            const realId = res.data._id || res.data.id;
            idMap[draft._id] = realId;
          } catch (err) {
            console.error("Failed to upload draft credential", draft.name, err);
          }
        }

        // Update agents apiKey with the real database credentials
        setAgents(prevAgents => prevAgents.map(ag => {
          if (ag.apiKey && idMap[ag.apiKey]) {
            return { ...ag, apiKey: idMap[ag.apiKey] };
          }
          return ag;
        }));

        setDraftCredentials([]);

        try {
          const res = await api.get('/credentials');
          setExistingCredentials(res.data.credentials || []);
        } catch (e) {
          console.error(e);
        }
      };

      uploadDrafts();
    }
  }, [token, draftCredentials]);

  const removeAgentProfile = (idx: number) => {
    const newAgents = [...agents];
    newAgents.splice(idx, 1);
    setAgents(newAgents);
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
      let createdId = '';
      if (token) {
        const url = onBehalfOf ? `/admin/users/${encodeURIComponent(onBehalfOf)}/credentials` : '/credentials';
        const res = await api.post(url, { name: newCredName, type: newCredType, data: finalData });
        createdId = res.data.credential?._id || res.data._id || res.data.id;
      } else {
        const newDraft = {
          _id: `draft_${Date.now()}`,
          name: `${newCredName} (Draft)`,
          type: newCredType,
          data: finalData
        };
        setDraftCredentials(prev => [...prev, newDraft]);
        createdId = newDraft._id;
      }
      setIsAddingCredential(false);
      
      // Auto-assign to the agent that was being edited when "+ New secret" was clicked, if any
      if ((newCredType === 'llm_api_key' || newCredType === 'generic_token') && addingCredForAgentId) {
        setAgents(prev => prev.map(ag => ag.id === addingCredForAgentId ? { ...ag, apiKey: createdId } : ag));
        setAddingCredForAgentId(null);
      }
      
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
    } catch (err) {
      alert("Failed to add credential");
    } finally {
      setCredIsLoading(false);
    }
  };

  // Convert current agents to ReactFlow mock fleet details
  const mockFleetDetails = useMemo(() => {
    return {
      instances: agents.map(ag => ({
        id: ag.id,
        role: ag.role,
        agentType: ag.agentType,
        status: 'provisioned',
        reportsTo: ag.reportsTo,
        avatarHash: ag.avatarHash
      }))
    };
  }, [agents]);

  // Pricing calculations based on machineType and custom selected duration in days (Now daily deduction cost)
  const totalCost = useMemo(() => {
    let cost = 0;
    const pricingMapPerDay: Record<string, number> = {
      'e2-micro': 50,
      'e2-small': 100,
      'e2-medium': 200,
      'e2-standard-2': 400,
    };
    agents.forEach(ag => {
      const perDayCost = pricingMapPerDay[ag.machineType] || 100;
      cost += perDayCost;
    });
    return cost;
  }, [agents]);

  const handleSubmit = async () => {
    if (!fleetName || !password) {
      alert("Please fill in fleet name and runtime master password.");
      return;
    }

    // Validate that all agents have api keys (unless using bihand provider or subscription auth)
    for (const ag of agents) {
      const usesSubscriptionAuth = (ag.agentType === 'claudecode' || ag.agentType === 'codex') && !!ag.oauthToken;
      if (!usesSubscriptionAuth && ag.provider !== 'bihand' && !ag.apiKey) {
        alert(`Please configure or link an API Key credential for ${ag.role}`);
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const payload = {
        name: fleetName,
        plan: fleetPlan,
        password: password,
        mission: fleetMission,
        agents: agents.map(ag => ({
          id: ag.id,
          role: ag.role,
          title: ag.title,
          agentType: ag.agentType,
          provider: ag.provider,
          apiKey: ag.apiKey || '', // linked credential ID
          oauthToken: ag.oauthToken || null,
          customBaseUrl: ag.customBaseUrl || null,
          model: ag.model,
          machineType: ag.machineType,
          durationDays: ag.durationDays || 30, // Include the selected duration
          reportsTo: ag.reportsTo,
          enabledSkills: ag.enabledSkills || [],
          avatarHash: ag.avatarHash,
          skillsFiles: ag.skillsFiles || [],
          customAgentMd: ag.customAgentMd || ''
        })),
        initialTask: initialTaskTitle.trim() && initialTaskDesc.trim() ? {
          title: initialTaskTitle,
          description: initialTaskDesc,
        } : null
      };

      const endpoint = onBehalfOf ? `/admin/users/${onBehalfOf}/fleets` : '/fleets';
      const res = await api.post(endpoint, payload);
      if (onBehalfOf) {
        alert(language === 'vi'
          ? `Đã triển khai thành công hạm đội AI trên danh nghĩa của ${onBehalfOf}!`
          : `Successfully provisioned fleet on behalf of ${onBehalfOf}!`
        );
        navigate('/admin');
      } else {
        navigate(`/fleet/${res.data.fleetId}/dashboard`);
      }
    } catch (e: any) {
      console.error(e);
      alert(e.response?.data?.detail || "Failed to provision fleet.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto pb-24">
      {onBehalfOf && (
        <div className="mb-6 p-4 bg-purple-950/20 border border-purple-500/20 rounded-2xl flex items-center justify-between text-left text-xs text-purple-300">
          <div>
            <span className="font-extrabold uppercase font-mono block text-purple-400">👑 Admin Backdoor Provisioning Mode</span>
            You are configuring and launching this entire fleet on behalf of the user <strong className="text-white">{onBehalfOf}</strong>. The system will use this user's preconfigured, encrypted credentials.
          </div>
          <button onClick={() => navigate('/admin')} className="px-3 py-1.5 bg-[#27272a]/60 hover:bg-[#27272a] text-white font-bold rounded-lg border border-[#27272a] hover:border-[#3f3f46]">
            Return to Admin Panel
          </button>
        </div>
      )}
      {/* Deployment Steps Header */}
      <div className="mb-10 text-center">
        <h1 className="text-3xl font-semibold tracking-tight text-[#fafafa] mb-1.5 font-mono">{t('wizard.title')}</h1>
        <p className="text-[#a1a1aa] text-sm max-w-lg mx-auto">{t('wizard.subtitle')}</p>
        
        <div className="flex items-center justify-center gap-6 mt-8">
          <button onClick={() => setActiveStep(1)} className="flex items-center gap-2">
            <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold ${activeStep >= 1 ? 'bg-[#fafafa] text-[#18181b]' : 'bg-[#27272a] text-[#a1a1aa]'}`}>1</span>
            <span className={`text-sm font-medium ${activeStep === 1 ? 'text-[#fafafa]' : 'text-[#71717a]'}`}>{t('wizard.step_1')}</span>
          </button>
          <div className="w-10 h-[1px] bg-[#27272a]"></div>
          <button onClick={() => { if (fleetName) setActiveStep(2); }} className="flex items-center gap-2">
            <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold ${activeStep >= 2 ? 'bg-[#fafafa] text-[#18181b]' : 'bg-[#27272a] text-[#a1a1aa]'}`}>2</span>
            <span className={`text-sm font-medium ${activeStep === 2 ? 'text-[#fafafa]' : 'text-[#71717a]'}`}>{t('wizard.step_2')}</span>
          </button>
          <div className="w-10 h-[1px] bg-[#27272a]"></div>
          <button onClick={() => { if (fleetName) setActiveStep(3); }} className="flex items-center gap-2">
            <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold ${activeStep >= 3 ? 'bg-[#fafafa] text-[#18181b]' : 'bg-[#27272a] text-[#a1a1aa]'}`}>3</span>
            <span className={`text-sm font-medium ${activeStep === 3 ? 'text-[#fafafa]' : 'text-[#71717a]'}`}>{t('wizard.step_3')}</span>
          </button>
          <div className="w-10 h-[1px] bg-[#27272a]"></div>
          <button onClick={() => { if (fleetName) setActiveStep(4); }} className="flex items-center gap-2">
            <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold ${activeStep >= 4 ? 'bg-[#fafafa] text-[#18181b]' : 'bg-[#27272a] text-[#a1a1aa]'}`}>4</span>
            <span className={`text-sm font-medium ${activeStep === 4 ? 'text-[#fafafa]' : 'text-[#71717a]'}`}>{t('wizard.step_4')}</span>
          </button>
        </div>
      </div>

      {/* Step 1: Fleet Identity & Mission */}
      {activeStep === 1 && (
        <div className="max-w-3xl mx-auto border border-[#27272a] rounded-xl bg-[#09090b] p-6 space-y-6 shadow-xl text-left">
          <div className="flex items-center gap-3 border-b border-[#27272a] pb-4 mb-2">
            <Building className="text-pink-500" size={20} />
            <h2 className="font-semibold text-lg text-[#fafafa]">{t('wizard.step_1')}</h2>
          </div>

          <div className="space-y-6">
            <div>
              <label className="block text-xs font-medium text-[#a1a1aa] mb-1.5">{t('wizard.company_name')}</label>
              <input 
                type="text" 
                placeholder="e.g. Acme GenAI Solutions"
                value={fleetName}
                onChange={e => setFleetName(e.target.value)}
                className="w-full bg-[#18181b] border border-[#27272a] rounded-md px-3 py-2 text-sm text-[#fafafa] focus:border-[#a1a1aa] outline-none transition-colors"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#a1a1aa] mb-1.5">{t('wizard.mission_statement')}</label>
              <textarea 
                rows={4}
                placeholder={t('wizard.mission_placeholder')}
                value={fleetMission}
                onChange={e => setFleetMission(e.target.value)}
                className="w-full bg-[#18181b] border border-[#27272a] rounded-md px-3 py-2 text-sm text-[#fafafa] focus:border-[#a1a1aa] outline-none transition-colors resize-none font-mono"
              />
            </div>
          </div>

          <div className="flex justify-end pt-4 border-t border-[#27272a]">
            <button 
              onClick={() => setActiveStep(2)}
              disabled={!fleetName}
              className="bg-[#fafafa] text-[#18181b] px-5 py-2 rounded-md font-medium text-sm hover:opacity-90 flex items-center gap-1.5 disabled:opacity-50"
            >
              {t('wizard.next')}: {t('wizard.step_2')} <ArrowRight size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Fleet Configuration */}
      {activeStep === 2 && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)] gap-6 items-start">
            {/* Roster panel */}
            <div className="border border-[#27272a] rounded-xl bg-[#09090b] p-4 shadow-xl space-y-4 h-[550px] flex flex-col">
              <h3 className="text-[10px] font-semibold text-[#a1a1aa] uppercase tracking-wider font-mono">
                {language === 'vi' ? 'Đội hình' : 'Roster'} ({agents.length})
              </h3>
              <div className="flex-1 overflow-y-auto space-y-1.5">
                {agents.length === 0 ? (
                  <div className="text-[11px] text-[#71717a] italic text-center py-10 px-2 leading-relaxed">
                    {language === 'vi'
                      ? 'Chưa có tác nhân nào. Nhấn "Thêm Tác nhân" để tuyển nhân viên đầu tiên - hạm đội cũng có thể khởi chạy trống và bạn thêm tác nhân sau.'
                      : 'No agents yet. Click "Add Agent" below to hire your first employee - the fleet can also launch empty and you can add agents later.'}
                  </div>
                ) : (
                  agents.map((ag, i) => (
                    <div
                      key={ag.id}
                      className="w-full text-left px-3 py-2 rounded-lg border border-[#27272a] bg-[#111113] hover:border-[#3f3f46] transition-colors group flex items-center justify-between gap-2"
                    >
                      <button type="button" onClick={() => setEditingAgentIndex(i)} className="min-w-0 flex-1 text-left">
                        <div className="text-xs font-semibold text-white truncate">{ag.role}</div>
                        <div className="text-[10px] text-[#71717a] truncate uppercase font-mono">
                          {ag.agentType}{ag.title ? ` · ${ag.title}` : ''}
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => removeAgentProfile(i)}
                        className="text-[#71717a] hover:text-red-500 p-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))
                )}
              </div>

              <div className="flex flex-col gap-1.5 pt-2 border-t border-[#27272a]">
                <button
                  onClick={() => setIsAddAgentWizardOpen(true)}
                  type="button"
                  className="w-full flex items-center justify-center gap-1.5 bg-[#70a4af] hover:bg-[#5b8c95] text-white py-2 rounded-lg text-xs font-semibold transition-colors"
                >
                  <PlusCircle size={14} /> {language === 'vi' ? 'Thêm Tác nhân' : 'Add Agent'}
                </button>
                <input
                  type="file"
                  ref={rosterFileInputRef}
                  onChange={handleRosterFileUpload}
                  accept=".csv,.xlsx,.json"
                  className="hidden"
                />
                <button
                  onClick={() => rosterFileInputRef.current?.click()}
                  disabled={isParsingRoster}
                  type="button"
                  className="w-full flex items-center justify-center gap-1 bg-[#18181b] border border-[#27272a] text-[#a1a1aa] hover:text-[#fafafa] py-1.5 rounded-lg text-[9px] transition-colors font-semibold uppercase font-mono disabled:opacity-50"
                >
                  {isParsingRoster ? <Loader2 size={10} className="animate-spin" /> : <Upload size={10} />} Import CSV/XLSX/JSON
                </button>
                <button
                  type="button"
                  onClick={() => { setIsAddingCredential(true); setNewCredType('llm_api_key'); setAddingCredForAgentId(null); }}
                  className="w-full flex items-center justify-center gap-1 bg-transparent border border-[#27272a] text-[#71717a] hover:text-[#fafafa] py-1.5 rounded-lg text-[9px] transition-colors font-semibold uppercase font-mono"
                >
                  + {language === 'vi' ? 'Thêm Thông tin xác thực' : 'Add Credential'}
                </button>
              </div>
            </div>

            {/* Tree flow */}
            <div className="border border-[#27272a] rounded-xl bg-[#09090b] p-4 shadow-xl space-y-3 h-[550px] flex flex-col">
              <div className="flex items-center justify-between border-b border-[#27272a] pb-2">
                <h3 className="font-semibold text-[#fafafa] flex items-center gap-2 text-xs uppercase tracking-wider font-mono">
                  <Network size={16} className="text-pink-500" /> Tree Hierarchy Flow
                </h3>
                <span className="text-[10px] text-[#a1a1aa]">Dotted node paths beautify automatically on adjustments</span>
              </div>
              <div className="flex-1 min-h-0">
                <OrgChartFlow fleetDetails={mockFleetDetails} ownerName={user?.name || 'Human Manager'} />
              </div>
            </div>
          </div>

          {/* Navigation */}
          <div className="max-w-3xl mx-auto flex justify-between pt-8 mt-8 border-t border-[#27272a]">
            <button type="button" onClick={() => setActiveStep(1)} className="text-sm font-medium text-[#a1a1aa] hover:text-[#fafafa]">Back</button>
            <button
              onClick={() => setActiveStep(3)}
              className="bg-[#fafafa] text-[#18181b] px-5 py-2 rounded-md font-medium text-sm hover:opacity-90 flex items-center gap-1.5"
            >
              Next Step: First Task <ArrowRight size={14} />
            </button>
          </div>
        </div>
      )}

      {(isAddAgentWizardOpen || editingAgentIndex !== null) && (
        <AgentSetupWizard
          reportsToOptions={agents
            .map((ag) => ({ id: ag.id, role: ag.role, title: ag.title }))
            .filter((_, i) => editingAgentIndex === null || i !== editingAgentIndex)}
          credentialsOverride={combinedCredentials}
          avatarLibraryOverride={avatarLibrary}
          initialAgent={editingAgentIndex !== null ? agents[editingAgentIndex] : null}
          submitLabel={editingAgentIndex !== null ? { en: 'Save Changes', vi: 'Lưu thay đổi' } : { en: 'Add to Roster', vi: 'Thêm vào Đội hình' }}
          isSubmitting={false}
          onClose={() => { setIsAddAgentWizardOpen(false); setEditingAgentIndex(null); }}
          onSubmit={(agentPayload) => {
            if (editingAgentIndex !== null) {
              const updated = [...agents];
              updated[editingAgentIndex] = { ...agents[editingAgentIndex], ...agentPayload, id: agents[editingAgentIndex].id };
              setAgents(updated);
              setEditingAgentIndex(null);
            } else {
              const newId = `agent_${Date.now()}`;
              setAgents([...agents, { ...agentPayload, id: newId }]);
              setIsAddAgentWizardOpen(false);
            }
          }}
        />
      )}

      {/* Step 3: First Task (Optional) */}
      {activeStep === 3 && (
        <div className="max-w-3xl mx-auto border border-[#27272a] rounded-xl bg-[#09090b] p-6 space-y-6 shadow-xl text-left">
          <div className="flex items-center gap-3 border-b border-[#27272a] pb-4 mb-2">
            <Briefcase className="text-pink-500" size={20} />
            <h2 className="font-semibold text-lg text-[#fafafa]">First Task & Bootstrap Goal (Optional)</h2>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-[#a1a1aa] mb-1.5">First Task Title</label>
              <input 
                type="text" 
                placeholder="e.g. Workspace evaluation"
                value={initialTaskTitle}
                onChange={e => setInitialTaskTitle(e.target.value)}
                className="w-full bg-[#18181b] border border-[#27272a] rounded-md px-3 py-2 text-sm text-[#fafafa] focus:border-[#a1a1aa] outline-none transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#a1a1aa] mb-1.5">Task Instructions (Assigned directly to CEO on launch)</label>
              <textarea 
                rows={5}
                value={initialTaskDesc}
                onChange={e => setInitialTaskDesc(e.target.value)}
                className="w-full bg-[#18181b] border border-[#27272a] rounded-md px-3 py-2 text-sm text-[#fafafa] focus:border-[#a1a1aa] outline-none transition-colors resize-none font-mono"
              />
            </div>
          </div>

          <div className="flex justify-between pt-4 border-t border-[#27272a] items-center">
            <button type="button" onClick={() => setActiveStep(2)} className="text-sm font-medium text-[#a1a1aa] hover:text-[#fafafa]">
              {language === 'vi' ? 'Quay lại' : 'Back'}
            </button>
            <div className="flex items-center gap-3">
              <button 
                type="button"
                onClick={() => {
                  setInitialTaskTitle('');
                  setInitialTaskDesc('');
                  setActiveStep(4);
                }}
                className="text-sm font-medium text-[#a1a1aa] hover:text-[#fafafa] border border-[#27272a] px-4 py-2 rounded-md hover:bg-[#18181b]"
              >
                {language === 'vi' ? 'Bỏ qua Bước này' : 'Skip Step'}
              </button>
              <button 
                onClick={() => setActiveStep(4)}
                className="bg-[#fafafa] text-[#18181b] px-5 py-2 rounded-md font-medium text-sm hover:opacity-90 flex items-center gap-1.5"
              >
                {language === 'vi' ? 'Tiếp theo: Xem lại & Mật khẩu' : 'Next Step: Review & Password'} <ArrowRight size={14} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step 4: Review and Password */}
      {activeStep === 4 && (
        <div className="max-w-3xl mx-auto border border-[#27272a] rounded-xl bg-[#09090b] p-6 space-y-6 shadow-xl text-left">
          <div className="flex items-center gap-3 border-b border-[#27272a] pb-4 mb-2">
            <CreditCard className="text-pink-500" size={20} />
            <h2 className="font-semibold text-lg text-[#fafafa]">
              {language === 'vi' ? 'Xem lại & Xác nhận Kích hoạt' : 'Review & Confirm Launch'}
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div className="border border-[#27272a] rounded-xl p-4 bg-[#111113] space-y-3">
                <div className="flex justify-between text-xs">
                  <span className="text-[#a1a1aa]">{language === 'vi' ? 'Tên Hạm đội' : 'Fleet Name'}</span>
                  <span className="font-medium text-[#fafafa]">{fleetName}</span>
                </div>
                <div className="flex justify-between text-xs border-t border-[#27272a] pt-3">
                  <span className="text-[#a1a1aa]">{language === 'vi' ? 'Tổng số Tác nhân' : 'Roster Size'}</span>
                  <span className="font-medium text-[#fafafa]">{agents.length} {language === 'vi' ? 'Máy ảo Tác nhân' : 'Agent VM(s)'}</span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#a1a1aa] mb-1.5">
                  {language === 'vi' ? 'Mật khẩu chủ của Trang điều khiển' : 'Master Dashboard Password'}
                </label>
                <input 
                  type="password" 
                  placeholder={language === 'vi' ? 'Mật khẩu truy cập VNC/Môi trường' : 'Master password for VNC/Runtimes'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="w-full bg-[#18181b] border border-[#27272a] rounded-md px-3 py-2 text-sm text-[#fafafa] focus:border-[#a1a1aa] outline-none transition-colors"
                />
                <p className="text-[10px] text-[#71717a] mt-1.5">
                  {language === 'vi' ? 'Bắt buộc để đăng nhập vào luồng VNC của máy ảo tác nhân AI.' : 'Required to log into agent unblocked VM VNC streams.'}
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-[#fafafa] uppercase tracking-wider">
                  {language === 'vi' ? 'Tóm tắt Đội ngũ Nhân sự' : 'Employee Lineup Summary'}
                </h3>
                <div className="border border-[#27272a] rounded-xl divide-y divide-[#27272a] bg-[#111113] max-h-48 overflow-y-auto">
                  {agents.map((ag) => (
                    <div key={ag.id} className="p-3 flex items-center justify-between text-xs">
                      <div>
                        <div className="font-medium text-[#fafafa]">{ag.role} ({ag.title})</div>
                        <div className="text-[10px] text-[#a1a1aa] uppercase mt-0.5">{ag.agentType} &middot; {ag.machineType}</div>
                      </div>
                      <div className="text-[10px] text-[#a1a1aa] text-right font-mono">
                        {ag.provider.toUpperCase()}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="border-t border-[#27272a] pt-4">
                <span className="text-xs text-[#a1a1aa]">{language === 'vi' ? 'Ước tính chi phí GCP:' : 'Estimated GCP cost:'}</span>
                <div className="text-xl font-semibold text-[#fafafa] mt-1">
                  ~{totalCost} {language === 'vi' ? '(đơn vị máy) / Ngày' : 'compute-units / day'}
                </div>
                <p className="text-[10px] text-[#a1a1aa] mt-1">
                  {language === 'vi'
                    ? 'Không có hệ thống thanh toán trong bản mã nguồn mở này — bạn dùng khóa GCP và API key của riêng mình, và trả trực tiếp cho GCP/nhà cung cấp LLM.'
                    : "No billing in this open-source build — you use your own GCP account and LLM API key, and pay GCP/your LLM provider directly."}
                </p>
              </div>
            </div>
          </div>

          <div className="border-t border-[#27272a] pt-6 mt-6">
            {!token ? (
              <div className="bg-[#111113] border border-[#27272a] rounded-xl p-6 text-center space-y-4 max-w-md mx-auto">
                <h3 className="text-sm font-semibold text-[#fafafa] uppercase tracking-wider">Sign in to launch your fleet</h3>
                <p className="text-xs text-[#a1a1aa] leading-relaxed">
                  You're in guest mode. Log in (email + password — no Google account needed) to save your credentials and launch this fleet.
                </p>
                <button
                  type="button"
                  onClick={() => navigate('/login')}
                  className="mt-2 bg-[#fafafa] text-[#18181b] px-6 py-2.5 rounded-lg font-medium hover:opacity-90 text-sm"
                >
                  Go to login
                </button>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="flex justify-between items-center pt-4 border-t border-[#27272a]">
                  <button type="button" onClick={() => setActiveStep(3)} className="text-sm font-medium text-[#a1a1aa] hover:text-[#fafafa]">Back</button>
                  <button
                    className="bg-[#fafafa] text-[#18181b] px-6 py-2.5 rounded-lg font-medium hover:opacity-90 disabled:opacity-50 flex items-center gap-2 text-sm"
                    onClick={handleSubmit}
                    disabled={isSubmitting || !password}
                  >
                    {isSubmitting ? <Loader2 className="animate-spin" size={18} /> : <Rocket size={16} />}
                    Provision & Launch
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Add Credential Modal */}
      {isAddingCredential && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <form onSubmit={handleAddCredential} className="bg-[#09090b] border border-[#27272a] rounded-xl w-full max-w-lg p-6 space-y-4 shadow-xl text-left text-sm">
            <h3 className="text-lg font-semibold text-[#fafafa] mb-4">Add Secret Credential</h3>
            
            <div>
              <label className="block text-xs font-medium text-[#a1a1aa] mb-1.5">Credential Name</label>
              <input 
                type="text" 
                required
                placeholder="e.g. My Token Account"
                value={newCredName}
                onChange={e => setNewCredName(e.target.value)}
                className="w-full bg-[#18181b] border border-[#27272a] rounded-md px-3 py-2 text-sm text-[#fafafa] focus:border-[#a1a1aa] outline-none transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#a1a1aa] mb-1.5">Credential Type</label>
              <select 
                value={newCredType}
                onChange={e => setNewCredType(e.target.value)}
                className="w-full bg-[#18181b] border border-[#27272a] rounded-md px-3 py-2 text-sm text-[#fafafa] focus:border-[#a1a1aa] outline-none transition-colors"
              >
                <option value="llm_api_key">LLM API Key (OpenAI, Anthropic, Gemini)</option>
                <option value="generic_token">Generic Auth Token</option>
                <option value="google_workspace">Google Workspace (OAuth)</option>
                <option value="social_facebook">Facebook Page (for Meta MCP)</option>
                <option value="social_instagram">Instagram Business Integration</option>
                <option value="social_x">X (Twitter) Developer API</option>
                <option value="social_reddit">Reddit API Integration</option>
              </select>
            </div>

            {/* Custom Inputs for Facebook */}
            {newCredType === 'social_facebook' && (
              <div className="grid grid-cols-2 gap-4 border-t border-[#27272a] pt-4">
                <div className="col-span-2">
                  <h4 className="text-xs font-semibold text-[#fafafa] uppercase tracking-wider mb-2">Facebook Settings</h4>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#a1a1aa] mb-1.5">Page ID</label>
                  <input 
                    type="text" 
                    required 
                    placeholder="e.g. 109283748293749"
                    value={fbPageId}
                    onChange={e => setFbPageId(e.target.value)}
                    className="w-full bg-[#18181b] border border-[#27272a] rounded-md px-3 py-2 text-sm text-[#fafafa] focus:border-[#a1a1aa] outline-none transition-colors font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#a1a1aa] mb-1.5">Page Access Token</label>
                  <input 
                    type="password" 
                    required 
                    placeholder="EAAG..."
                    value={fbAccessToken}
                    onChange={e => setFbAccessToken(e.target.value)}
                    className="w-full bg-[#18181b] border border-[#27272a] rounded-md px-3 py-2 text-sm text-[#fafafa] focus:border-[#a1a1aa] outline-none transition-colors font-mono"
                  />
                </div>
              </div>
            )}

            {/* Custom Inputs for Instagram */}
            {newCredType === 'social_instagram' && (
              <div className="grid grid-cols-2 gap-4 border-t border-[#27272a] pt-4">
                <div className="col-span-2">
                  <h4 className="text-xs font-semibold text-[#fafafa] uppercase tracking-wider mb-2">Instagram Business Settings</h4>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#a1a1aa] mb-1.5">Instagram Business ID</label>
                  <input 
                    type="text" 
                    required 
                    placeholder="e.g. 17841400000000000"
                    value={igBusinessId}
                    onChange={e => setIgBusinessId(e.target.value)}
                    className="w-full bg-[#18181b] border border-[#27272a] rounded-md px-3 py-2 text-sm text-[#fafafa] focus:border-[#a1a1aa] outline-none transition-colors font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#a1a1aa] mb-1.5">Facebook Page Access Token (linked to IG)</label>
                  <input 
                    type="password" 
                    required 
                    placeholder="EAAG..."
                    value={igAccessToken}
                    onChange={e => setIgAccessToken(e.target.value)}
                    className="w-full bg-[#18181b] border border-[#27272a] rounded-md px-3 py-2 text-sm text-[#fafafa] focus:border-[#a1a1aa] outline-none transition-colors font-mono"
                  />
                </div>
              </div>
            )}

            {/* Custom Inputs for X (Twitter) */}
            {newCredType === 'social_x' && (
              <div className="grid grid-cols-2 gap-4 border-t border-[#27272a] pt-4">
                <div className="col-span-2">
                  <h4 className="text-xs font-semibold text-[#fafafa] uppercase tracking-wider mb-2">X / Twitter API Keys (OAuth 1.0a)</h4>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#a1a1aa] mb-1.5">Consumer Key (API Key)</label>
                  <input 
                    type="text" 
                    required 
                    placeholder="e.g. xYz..."
                    value={xConsumerKey}
                    onChange={e => setXConsumerKey(e.target.value)}
                    className="w-full bg-[#18181b] border border-[#27272a] rounded-md px-3 py-2 text-sm text-[#fafafa] focus:border-[#a1a1aa] outline-none transition-colors font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#a1a1aa] mb-1.5">Consumer Secret (API Secret)</label>
                  <input 
                    type="password" 
                    required 
                    placeholder="e.g. sEcReT..."
                    value={xConsumerSecret}
                    onChange={e => setXConsumerSecret(e.target.value)}
                    className="w-full bg-[#18181b] border border-[#27272a] rounded-md px-3 py-2 text-sm text-[#fafafa] focus:border-[#a1a1aa] outline-none transition-colors font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#a1a1aa] mb-1.5">Access Token</label>
                  <input 
                    type="text" 
                    required 
                    placeholder="e.g. 12345-abc..."
                    value={xAccessToken}
                    onChange={e => setXAccessToken(e.target.value)}
                    className="w-full bg-[#18181b] border border-[#27272a] rounded-md px-3 py-2 text-sm text-[#fafafa] focus:border-[#a1a1aa] outline-none transition-colors font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#a1a1aa] mb-1.5">Access Token Secret</label>
                  <input 
                    type="password" 
                    required 
                    placeholder="e.g. sEcReT..."
                    value={xAccessTokenSecret}
                    onChange={e => setXAccessTokenSecret(e.target.value)}
                    className="w-full bg-[#18181b] border border-[#27272a] rounded-md px-3 py-2 text-sm text-[#fafafa] focus:border-[#a1a1aa] outline-none transition-colors font-mono"
                  />
                </div>
              </div>
            )}

            {/* Custom Inputs for Reddit */}
            {newCredType === 'social_reddit' && (
              <div className="grid grid-cols-2 gap-4 border-t border-[#27272a] pt-4">
                <div className="col-span-2">
                  <h4 className="text-xs font-semibold text-[#fafafa] uppercase tracking-wider mb-2">Reddit API Settings</h4>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#a1a1aa] mb-1.5">Client ID</label>
                  <input 
                    type="text" 
                    required 
                    placeholder="e.g. abcde12345"
                    value={redditClientId}
                    onChange={e => setRedditClientId(e.target.value)}
                    className="w-full bg-[#18181b] border border-[#27272a] rounded-md px-3 py-2 text-sm text-[#fafafa] focus:border-[#a1a1aa] outline-none transition-colors font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#a1a1aa] mb-1.5">Client Secret</label>
                  <input 
                    type="password" 
                    required 
                    placeholder="e.g. sEcReT..."
                    value={redditClientSecret}
                    onChange={e => setRedditClientSecret(e.target.value)}
                    className="w-full bg-[#18181b] border border-[#27272a] rounded-md px-3 py-2 text-sm text-[#fafafa] focus:border-[#a1a1aa] outline-none transition-colors font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#a1a1aa] mb-1.5">Username</label>
                  <input 
                    type="text" 
                    required 
                    placeholder="e.g. MyBotUser"
                    value={redditUsername}
                    onChange={e => setRedditUsername(e.target.value)}
                    className="w-full bg-[#18181b] border border-[#27272a] rounded-md px-3 py-2 text-sm text-[#fafafa] focus:border-[#a1a1aa] outline-none transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#a1a1aa] mb-1.5">Password</label>
                  <input 
                    type="password" 
                    required 
                    placeholder="********"
                    value={redditPassword}
                    onChange={e => setRedditPassword(e.target.value)}
                    className="w-full bg-[#18181b] border border-[#27272a] rounded-md px-3 py-2 text-sm text-[#fafafa] focus:border-[#a1a1aa] outline-none transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#a1a1aa] mb-1.5">User Agent (Optional)</label>
                  <input 
                    type="text" 
                    placeholder="BihandAgent/1.0 by /u/MyBotUser"
                    value={redditUserAgent}
                    onChange={e => setRedditUserAgent(e.target.value)}
                    className="w-full bg-[#18181b] border border-[#27272a] rounded-md px-3 py-2 text-sm text-[#fafafa] focus:border-[#a1a1aa] outline-none transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#a1a1aa] mb-1.5">Target Subreddit (Optional)</label>
                  <input 
                    type="text" 
                    placeholder="e.g. test"
                    value={redditSubreddit}
                    onChange={e => setRedditSubreddit(e.target.value)}
                    className="w-full bg-[#18181b] border border-[#27272a] rounded-md px-3 py-2 text-sm text-[#fafafa] focus:border-[#a1a1aa] outline-none transition-colors"
                  />
                </div>
              </div>
            )}

            {newCredType !== 'google_workspace' && !newCredType.startsWith('social_') && (
              <div>
                <label className="block text-xs font-medium text-[#a1a1aa] mb-1.5">Secret Data</label>
                <textarea 
                  required
                  placeholder="sk-proj-..."
                  value={newCredData}
                  onChange={e => setNewCredData(e.target.value)}
                  className="w-full h-24 bg-[#18181b] border border-[#27272a] rounded-md px-3 py-2 text-sm text-[#fafafa] focus:border-[#a1a1aa] outline-none transition-colors resize-none font-mono"
                />
              </div>
            )}
            
            <div className="flex justify-end gap-3 pt-4 border-t border-[#27272a] mt-6">
              <button type="button" onClick={() => setIsAddingCredential(false)} className="px-4 py-2 rounded-md text-sm font-medium text-[#a1a1aa] hover:text-[#fafafa]">Cancel</button>
              {newCredType === 'google_workspace' ? (
                token ? (
                  <button type="button" onClick={async () => {
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
                  }} className="bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700 flex items-center gap-2">
                    <Globe size={16} /> Authorize with Google
                  </button>
                ) : (
                  <button type="button" disabled className="bg-blue-600/50 text-white/50 px-4 py-2 rounded-md text-sm font-medium flex items-center gap-2 cursor-not-allowed">
                    <Globe size={16} /> Google OAuth (Log In First)
                  </button>
                )
              ) : (
                <button type="submit" disabled={credIsLoading} className="bg-[#fafafa] text-[#18181b] px-4 py-2 rounded-md text-sm font-medium hover:opacity-90 disabled:opacity-50 flex items-center gap-2">
                  {credIsLoading ? <Loader2 size={16} className="animate-spin" /> : null}
                  Save Secret
                </button>
              )}
            </div>
          </form>
        </div>
      )}

    </div>
  );
};

export default Incorporate;
