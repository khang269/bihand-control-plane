import React, { useEffect, useState } from 'react';
import { X, Loader2, ChevronLeft, ChevronRight, Check, Bot, Terminal, Code2, Globe2 } from 'lucide-react';
import api from '../lib/api';
import { useLanguage } from '../context/LanguageContext';
import { AGENT_TEMPLATES, SKILL_TEMPLATES } from '../lib/templates';

const SKILL_TEMPLATE_INFOS = [
  {
    slug: 'web-audit',
    name: 'Web Quality & Performance Auditor',
    description: 'Scan active endpoints and report latency metrics',
  },
  {
    slug: 'security-guard',
    name: 'Security & Dependency Guard',
    description: 'Perform package audits and check for vulnerabilities',
  },
  {
    slug: 'seo-optimizer',
    name: 'SEO & Meta Optimizer',
    description: 'Audit visual tags, page descriptions, and rankings',
  },
  {
    slug: 'copywriter',
    name: 'Copywriting & Content Specialist',
    description: 'Draft landing pages, announcements, and summaries',
  }
];

// Generic-role instruction starters surfaced in Step 3. Deliberately a different, smaller set
// than the full AGENT_TEMPLATES dict (which also holds the CEO/CTO/PM org-chart flavored
// templates used elsewhere) - these are the ones that make sense as a starting point for an
// arbitrary single agent being hired into an existing fleet.
const INSTRUCTION_TEMPLATE_KEYS = [
  'Marketing Specialist',
  'Customer Support Agent',
  'Software Engineer',
  'Trader',
  'Sales / BDR',
  'Data Analyst',
  'Content Writer',
];

const AGENT_TYPE_INFOS: { id: string; name: string; recommended?: boolean; icon: React.ReactNode; description: { en: string; vi: string } }[] = [
  {
    id: 'claudecode',
    name: 'Claude Code',
    recommended: true,
    icon: <Terminal size={20} />,
    description: {
      en: 'General-purpose coding & reasoning agent. Best all-around default for engineering, research, and ops work.',
      vi: 'Tác nhân lập trình & suy luận đa năng. Lựa chọn mặc định tốt nhất cho kỹ thuật, nghiên cứu và vận hành.',
    },
  },
  {
    id: 'codex',
    name: 'Codex',
    icon: <Code2 size={20} />,
    description: {
      en: "OpenAI's autonomous coding agent CLI, tuned for software engineering tasks.",
      vi: 'CLI tác nhân lập trình tự động của OpenAI, tối ưu cho các tác vụ kỹ thuật phần mềm.',
    },
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    icon: <Bot size={20} />,
    description: {
      en: 'High-speed, multi-provider developer runtime for fast iteration.',
      vi: 'Runtime lập trình đa nhà cung cấp, tốc độ cao cho việc lặp lại nhanh.',
    },
  },
  {
    id: 'openclaw',
    name: 'OpenClaw',
    icon: <Globe2 size={20} />,
    description: {
      en: 'Autonomous GUI browser agent - drives a real browser for web-based tasks.',
      vi: 'Tác nhân trình duyệt GUI tự động - điều khiển trình duyệt thật cho các tác vụ trên web.',
    },
  },
];

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

type ProviderChoice = 'subscription' | 'apikey' | 'bihand' | 'custom';

interface AgentSetupWizardProps {
  // Options for the "Reports To Manager" dropdown - real fleet instances (Hire Agent) or
  // in-progress draft agents (fleet-creation wizard's roster).
  reportsToOptions?: { id: string; role: string; title?: string }[];
  // Hire Agent: fetch credentials for this specific user (admin-on-behalf-of flow).
  credentialsUserId?: string;
  // Fleet-creation wizard: pass the already-loaded (and possibly draft/pre-login) credential
  // list directly instead of having this component fetch its own.
  credentialsOverride?: any[];
  // When set, the wizard opens pre-filled for editing this agent instead of creating a new one.
  initialAgent?: Record<string, any> | null;
  submitLabel?: { en: string; vi: string };
  onClose: () => void;
  onSubmit: (agent: Record<string, any>) => Promise<void> | void;
  isSubmitting: boolean;
}

const StepDot: React.FC<{ active: boolean; done: boolean; label: string }> = ({ active, done, label }) => (
  <div className="flex-1 flex flex-col items-center gap-1.5">
    <div className={`w-full h-1.5 rounded-full transition-colors ${active || done ? 'bg-[#70a4af]' : 'bg-[#27272a]'}`} />
    <span className={`text-[10px] font-semibold uppercase tracking-wide ${active ? 'text-white' : 'text-[#71717a]'}`}>{label}</span>
  </div>
);

const resolveInitialProviderChoice = (initialAgent?: Record<string, any> | null): ProviderChoice => {
  if (!initialAgent) return 'subscription';
  if (initialAgent.oauthToken) return 'subscription';
  if (initialAgent.provider === 'custom') return 'custom';
  if (initialAgent.provider === 'bihand') return 'bihand';
  return 'apikey';
};

const AgentSetupWizard: React.FC<AgentSetupWizardProps> = ({
  reportsToOptions,
  credentialsUserId,
  credentialsOverride,
  initialAgent,
  submitLabel,
  onClose,
  onSubmit,
  isSubmitting,
}) => {
  const { language } = useLanguage();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  // Step 1: Agent Type + identity/sizing
  const [agentType, setAgentType] = useState(() => initialAgent?.agentType || 'claudecode');
  const [role, setRole] = useState(() => initialAgent?.role || 'Engineer');
  const [title, setTitle] = useState(() => initialAgent?.title || 'Software Developer');
  const [reportsTo, setReportsTo] = useState(() => initialAgent?.reportsTo || '');
  const [machineType, setMachineType] = useState(() => initialAgent?.machineType || 'e2-small');
  const durationDays = 30;

  // Step 2: Provider
  const [providerChoice, setProviderChoice] = useState<ProviderChoice>(() => resolveInitialProviderChoice(initialAgent));
  const [apiKeyCredentialId, setApiKeyCredentialId] = useState(() => initialAgent?.apiKey || '');
  const [model, setModel] = useState(() => initialAgent?.model || 'claude-sonnet-4-6');
  const [oauthToken, setOauthToken] = useState(() => initialAgent?.oauthToken || '');
  const [customBaseUrl, setCustomBaseUrl] = useState(() => initialAgent?.customBaseUrl || '');
  const [customModel, setCustomModel] = useState(() => (initialAgent?.provider === 'custom' ? initialAgent?.model || '' : ''));
  const [existingCredentials, setExistingCredentials] = useState<any[]>(credentialsOverride || []);

  // Step 3: Instructions
  const [customInstructions, setCustomInstructions] = useState(() => initialAgent?.customAgentMd || '');

  // Step 4: Skills
  const [skillsFiles, setSkillsFiles] = useState<{ name: string; content: string }[]>(() => initialAgent?.skillsFiles || []);
  const [isSkillEditorOpen, setIsSkillEditorOpen] = useState(false);
  const [selectedSkillToEdit, setSelectedSkillToEdit] = useState('');
  const [originalSkillToEditName, setOriginalSkillToEditName] = useState('');
  const [skillEditorContent, setSkillEditorContent] = useState('');

  // credentialsOverride is consumed once via the lazy useState initializer above - this
  // effect only covers the "fetch it ourselves" (Hire Agent) path, so it never needs to
  // setState synchronously in the effect body.
  useEffect(() => {
    if (!credentialsOverride) {
      const url = credentialsUserId ? `/admin/users/${encodeURIComponent(credentialsUserId)}/credentials` : '/credentials';
      api.get(url).then(res => setExistingCredentials(res.data.credentials || [])).catch(console.error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [credentialsUserId]);

  // Reset the provider step whenever the agent type changes, since the available provider
  // choices (and which are valid) differ per runtime. Done as a direct state update from the
  // type-card click handler (selectAgentType, below) rather than a useEffect keyed on
  // agentType, to avoid the extra cascading render a setState-in-effect would cause.
  const selectAgentType = (id: string) => {
    setAgentType(id);
    setApiKeyCredentialId('');
    setOauthToken('');
    setCustomBaseUrl('');
    setCustomModel('');
    if (id === 'claudecode') {
      setProviderChoice('subscription');
      setModel('claude-sonnet-4-6');
    } else if (id === 'codex') {
      setProviderChoice('subscription');
    } else {
      setProviderChoice('bihand');
    }
  };

  const providerCards: { id: ProviderChoice; label: { en: string; vi: string }; recommended?: boolean }[] = agentType === 'claudecode'
    ? [
        { id: 'subscription', label: { en: 'Claude Subscription', vi: 'Gói thuê bao Claude' }, recommended: true },
        { id: 'apikey', label: { en: 'Anthropic API Key', vi: 'Khóa API Anthropic' } },
      ]
    : agentType === 'codex'
    ? [
        { id: 'subscription', label: { en: 'OpenAI Subscription', vi: 'Gói thuê bao OpenAI' }, recommended: true },
        { id: 'bihand', label: { en: 'Bihand Provider', vi: 'Nhà cung cấp Bihand' } },
        { id: 'custom', label: { en: 'Custom Provider', vi: 'Nhà cung cấp Tùy chỉnh' } },
      ]
    : [
        { id: 'bihand', label: { en: 'Bihand Provider', vi: 'Nhà cung cấp Bihand' }, recommended: true },
        { id: 'custom', label: { en: 'Custom Provider', vi: 'Nhà cung cấp Tùy chỉnh' } },
      ];

  const step1Valid = role.trim().length > 0;
  const step2Valid = (() => {
    if (providerChoice === 'subscription') return oauthToken.trim().length > 0;
    if (providerChoice === 'apikey') return apiKeyCredentialId.trim().length > 0;
    if (providerChoice === 'bihand') return true;
    if (providerChoice === 'custom') return customBaseUrl.trim().length > 0 && customModel.trim().length > 0 && apiKeyCredentialId.trim().length > 0;
    return false;
  })();

  const stepValid = step === 1 ? step1Valid : step === 2 ? step2Valid : true;

  const goNext = () => setStep(s => (s < 4 ? ((s + 1) as 1 | 2 | 3 | 4) : s));
  const goBack = () => setStep(s => (s > 1 ? ((s - 1) as 1 | 2 | 3 | 4) : s));

  const applyInstructionTemplate = (key: string) => {
    const tpl = AGENT_TEMPLATES[key];
    if (tpl) setCustomInstructions(tpl.md);
  };

  const addSkillFromTemplate = (slug: string) => {
    const info = SKILL_TEMPLATE_INFOS.find(i => i.slug === slug);
    const content = SKILL_TEMPLATES[slug];
    if (!info || !content) return;
    let candidate = slug;
    let counter = 1;
    while (skillsFiles.some(f => f.name === candidate)) {
      candidate = `${slug}-${counter}`;
      counter++;
    }
    setSkillsFiles([...skillsFiles, { name: candidate, content }]);
  };

  const addBlankSkill = () => {
    let candidate = 'custom-skill-1';
    let counter = 1;
    while (skillsFiles.some(f => f.name === candidate)) {
      candidate = `custom-skill-${counter}`;
      counter++;
    }
    const blankContent = `---\nname: ${candidate}\ndescription: Custom skill.\n---\n\n# ${candidate}\n\n- Step 1: Perform action`;
    setSkillsFiles([...skillsFiles, { name: candidate, content: blankContent }]);
    setSelectedSkillToEdit(candidate);
    setOriginalSkillToEditName(candidate);
    setSkillEditorContent(blankContent);
    setIsSkillEditorOpen(true);
  };

  const handleSubmit = () => {
    if (!stepValid) return;
    const usesSubscription = providerChoice === 'subscription';
    const usesCustom = providerChoice === 'custom';
    const usesBihand = providerChoice === 'bihand';

    let provider = 'anthropic';
    if (agentType === 'claudecode') {
      provider = 'anthropic';
    } else if (usesSubscription) {
      provider = 'openai';
    } else if (usesBihand) {
      provider = 'bihand';
    } else if (usesCustom) {
      provider = 'custom';
    }

    const resolvedModel = usesCustom ? customModel : usesBihand ? 'gemini-3.5-flash' : model;

    const agentPayload = {
      role,
      title: title || role,
      reportsTo: reportsTo || null,
      agentType,
      provider,
      apiKey: usesSubscription ? '' : usesBihand ? 'bihand-system-placeholder' : apiKeyCredentialId,
      model: resolvedModel,
      durationMonths: Math.max(1, Math.round(durationDays / 30)),
      durationDays,
      machineType,
      agentMd: '',
      soulMd: '',
      toolsMd: '',
      mcpConfig: '',
      enabledSkills: [],
      customAgentMd: customInstructions || '',
      skillsFiles,
      oauthToken: usesSubscription ? oauthToken : null,
      customBaseUrl: usesCustom ? customBaseUrl : null,
    };

    onSubmit(agentPayload);
  };

  const t = (en: string, vi: string) => (language === 'vi' ? vi : en);

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="bg-[#09090b] border border-[#27272a] rounded-xl w-full max-w-2xl max-h-[92vh] shadow-2xl flex flex-col text-left">
        <div className="flex items-center justify-between p-5 border-b border-[#27272a]">
          <div>
            <h3 className="text-lg font-semibold text-white">{initialAgent ? t('Edit Agent', 'Sửa Tác nhân') : t('Deploy a New Agent', 'Triển khai Tác nhân Mới')}</h3>
            <p className="text-xs text-[#a1a1aa] mt-1">
              {t('Step', 'Bước')} {step} / 4
            </p>
          </div>
          <button onClick={onClose} className="text-[#a1a1aa] hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="flex gap-2 px-5 pt-4">
          <StepDot active={step === 1} done={step > 1} label={t('Type', 'Loại')} />
          <StepDot active={step === 2} done={step > 2} label={t('Provider', 'Nhà C.cấp')} />
          <StepDot active={step === 3} done={step > 3} label={t('Instructions', 'Chỉ dẫn')} />
          <StepDot active={step === 4} done={false} label={t('Skills', 'Kỹ năng')} />
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {step === 1 && (
            <div className="space-y-5">
              <div>
                <label className="block text-xs font-semibold uppercase text-[#71717a] mb-2">
                  {t('Agent Runtime', 'Hệ Chạy Tác nhân')}
                </label>
                <div className="grid grid-cols-2 gap-3">
                  {AGENT_TYPE_INFOS.map(info => (
                    <button
                      key={info.id}
                      type="button"
                      onClick={() => selectAgentType(info.id)}
                      className={`text-left p-3.5 rounded-xl border transition-all flex flex-col gap-2 ${
                        agentType === info.id ? 'border-[#70a4af] bg-[#70a4af]/10' : 'border-[#27272a] bg-black/20 hover:border-[#3f3f46]'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className={`flex items-center gap-2 ${agentType === info.id ? 'text-[#70a4af]' : 'text-[#a1a1aa]'}`}>
                          {info.icon}
                          <span className="font-semibold text-sm text-white">{info.name}</span>
                        </div>
                        {info.recommended && (
                          <span className="text-[9px] font-bold uppercase text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">
                            {t('Recommended', 'Đề xuất')}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-[#a1a1aa] leading-snug">{info.description[language === 'vi' ? 'vi' : 'en']}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold uppercase text-[#71717a] mb-1.5">{t('Role / Identifier', 'Vai trò / Định danh')}</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Designer, Analyst"
                    value={role}
                    onChange={e => setRole(e.target.value)}
                    className="w-full bg-[#18181b] border border-[#27272a] rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-[#a1a1aa]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase text-[#71717a] mb-1.5">{t('Job Title', 'Chức danh công việc')}</label>
                  <input
                    type="text"
                    placeholder="e.g. Lead UI/UX Designer"
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                    className="w-full bg-[#18181b] border border-[#27272a] rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-[#a1a1aa]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold uppercase text-[#71717a] mb-1.5">{t('Reports To Manager', 'Quản lý báo cáo')}</label>
                  <select
                    value={reportsTo}
                    onChange={e => setReportsTo(e.target.value)}
                    className="w-full bg-[#18181b] border border-[#27272a] rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-[#a1a1aa]"
                  >
                    <option value="">{t('No Manager (Top level)', 'Không có quản lý (Cấp cao nhất)')}</option>
                    {reportsToOptions?.map((i) => (
                      <option key={i.id} value={i.id}>{i.role}{i.title ? ` (${i.title})` : ''}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase text-[#71717a] mb-1.5">{t('Machine Size', 'Cấu hình Máy ảo')}</label>
                  <select
                    value={machineType}
                    onChange={e => setMachineType(e.target.value)}
                    className="w-full bg-[#18181b] border border-[#27272a] rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-[#a1a1aa]"
                  >
                    <option value="e2-small">Small (2 vCPU, 2GB) - 100 {t('Credits/day', 'Tín dụng/ngày')}</option>
                    <option value="e2-medium">Medium (2 vCPU, 4GB) - 200 {t('Credits/day', 'Tín dụng/ngày')}</option>
                    <option value="e2-standard-2">Large (2 vCPU, 8GB) - 400 {t('Credits/day', 'Tín dụng/ngày')}</option>
                  </select>
                </div>
              </div>

            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <div>
                <label className="block text-xs font-semibold uppercase text-[#71717a] mb-2">{t('Provider', 'Nhà cung cấp')}</label>
                <div className={`grid gap-3 ${providerCards.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
                  {providerCards.map(card => (
                    <button
                      key={card.id}
                      type="button"
                      onClick={() => setProviderChoice(card.id)}
                      className={`text-left p-3 rounded-xl border transition-all ${
                        providerChoice === card.id ? 'border-[#70a4af] bg-[#70a4af]/10' : 'border-[#27272a] bg-black/20 hover:border-[#3f3f46]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-semibold text-xs text-white">{card.label[language === 'vi' ? 'vi' : 'en']}</span>
                        {card.recommended && <Check size={12} className="text-emerald-400 shrink-0" />}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {providerChoice === 'subscription' && agentType === 'claudecode' && (
                <div className="border border-[#27272a] rounded-lg p-3.5 bg-[#111113] space-y-2">
                  <p className="text-[11px] text-[#a1a1aa] leading-relaxed">
                    {t(
                      'Run `claude setup-token` on a machine with a browser (Pro/Max/Team/Enterprise plan required), then paste the printed token below.',
                      'Chạy `claude setup-token` trên máy có trình duyệt (yêu cầu gói Pro/Max/Team/Enterprise), sau đó dán token in ra bên dưới.'
                    )}
                  </p>
                  <input
                    type="password"
                    value={oauthToken}
                    onChange={e => setOauthToken(e.target.value)}
                    className="w-full bg-[#18181b] border border-[#27272a] rounded-md px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-[#a1a1aa]"
                    placeholder={t('Paste the token from `claude setup-token`...', 'Dán token từ `claude setup-token`...')}
                  />
                </div>
              )}

              {providerChoice === 'subscription' && agentType === 'codex' && (
                <div className="border border-[#27272a] rounded-lg p-3.5 bg-[#111113] space-y-2">
                  <p className="text-[11px] text-[#a1a1aa] leading-relaxed">
                    {t(
                      'Run `codex login` on a machine with a browser - or `codex login --device-auth` if this is a remote/headless machine - then paste the full contents of the generated `~/.codex/auth.json` file below. It contains your ChatGPT access token: treat it like a password.',
                      'Chạy `codex login` trên máy có trình duyệt - hoặc `codex login --device-auth` nếu đây là máy từ xa/không màn hình - sau đó dán toàn bộ nội dung tệp `~/.codex/auth.json` được tạo ra bên dưới. Tệp này chứa token truy cập ChatGPT của bạn: hãy bảo mật như mật khẩu.'
                    )}
                  </p>
                  <textarea
                    rows={6}
                    value={oauthToken}
                    onChange={e => setOauthToken(e.target.value)}
                    className="w-full bg-[#18181b] border border-[#27272a] rounded-md px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-[#a1a1aa] resize-none"
                    placeholder='{"tokens": {"access_token": "..."}, ...}'
                  />
                </div>
              )}

              {agentType === 'claudecode' && providerChoice === 'apikey' && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold uppercase text-[#71717a] mb-1.5">{t('Model', 'Mô hình')}</label>
                    <select
                      value={model}
                      onChange={e => setModel(e.target.value)}
                      className="w-full bg-[#18181b] border border-[#27272a] rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-[#a1a1aa]"
                    >
                      {modelOptionsByProvider.anthropic.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold uppercase text-[#71717a] mb-1.5">{t('API Key Credential', 'Thông tin API Key')}</label>
                    <select
                      value={apiKeyCredentialId}
                      onChange={e => setApiKeyCredentialId(e.target.value)}
                      className="w-full bg-[#18181b] border border-[#27272a] rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-[#a1a1aa]"
                    >
                      <option value="" disabled>{t('Select Encrypted Credential...', 'Chọn Khóa đã Mã hóa...')}</option>
                      {existingCredentials.filter(c => c.type === 'llm_api_key' || c.type === 'generic_token').map(c => (
                        <option key={c._id} value={c._id}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {agentType === 'claudecode' && providerChoice === 'apikey' && (
                <div className="text-[11px] text-[#71717a]">
                  {t('Model is billed against your saved Anthropic API key credential.', 'Mô hình được tính phí theo khóa API Anthropic đã lưu.')}
                </div>
              )}

              {providerChoice === 'bihand' && (
                <p className="text-[11px] text-[#a1a1aa]">
                  {t('No key needed - inference runs on the shared Bihand-managed model and is billed from your platform credits.', 'Không cần khóa - suy luận chạy trên mô hình do Bihand quản lý và được tính từ tín dụng nền tảng của bạn.')}
                </p>
              )}

              {providerChoice === 'custom' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold uppercase text-[#71717a] mb-1.5">{t('Base URL', 'Base URL')}</label>
                    <input
                      type="text"
                      value={customBaseUrl}
                      onChange={e => setCustomBaseUrl(e.target.value)}
                      placeholder="https://api.example.com/v1"
                      className="w-full bg-[#18181b] border border-[#27272a] rounded-md px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-[#a1a1aa]"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold uppercase text-[#71717a] mb-1.5">{t('Model Name', 'Tên Mô hình')}</label>
                      <input
                        type="text"
                        value={customModel}
                        onChange={e => setCustomModel(e.target.value)}
                        placeholder="e.g. llama-3.3-70b"
                        className="w-full bg-[#18181b] border border-[#27272a] rounded-md px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-[#a1a1aa]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold uppercase text-[#71717a] mb-1.5">{t('API Key Credential', 'Thông tin API Key')}</label>
                      <select
                        value={apiKeyCredentialId}
                        onChange={e => setApiKeyCredentialId(e.target.value)}
                        className="w-full bg-[#18181b] border border-[#27272a] rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-[#a1a1aa]"
                      >
                        <option value="" disabled>{t('Select Encrypted Credential...', 'Chọn Khóa đã Mã hóa...')}</option>
                        {existingCredentials.filter(c => c.type === 'llm_api_key' || c.type === 'generic_token').map(c => (
                          <option key={c._id} value={c._id}>{c.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <p className="text-[11px] text-[#a1a1aa] leading-relaxed">
                {t(
                  'This becomes your agent\'s persona and operating rules - it\'s prepended to every task the agent runs. Be specific about (1) role & tone, (2) how to prioritize work, (3) hard constraints it must never break, and (4) when to escalate to a human.',
                  'Đây sẽ là tính cách và quy tắc vận hành của tác nhân - được thêm vào trước mỗi tác vụ mà tác nhân thực hiện. Hãy cụ thể về (1) vai trò & giọng điệu, (2) cách ưu tiên công việc, (3) các ràng buộc không được vi phạm, và (4) khi nào cần chuyển cho con người.'
                )}
              </p>
              <div>
                <label className="block text-xs font-semibold uppercase text-[#71717a] mb-2">{t('Start from a template', 'Bắt đầu từ mẫu')}</label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {INSTRUCTION_TEMPLATE_KEYS.map(key => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => applyInstructionTemplate(key)}
                      className="text-left p-2.5 rounded-lg border border-[#27272a] bg-black/20 hover:border-[#70a4af] transition-colors"
                    >
                      <span className="text-[11px] font-semibold text-white">{key}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase text-[#71717a] mb-1.5">{t('Custom Agent Instructions', 'Chỉ dẫn tùy chỉnh')}</label>
                <textarea
                  rows={10}
                  placeholder={t(
                    'Enter custom instructions for this agent (System will prepend the foundational Bihand core contract automatically)...',
                    'Nhập hướng dẫn tùy chỉnh cho nhân sự này (Hệ thống sẽ tự động ghép thêm quy tắc Bihand core)...'
                  )}
                  value={customInstructions}
                  onChange={e => setCustomInstructions(e.target.value)}
                  className="w-full bg-[#18181b] border border-[#27272a] rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-[#a1a1aa] font-mono resize-none"
                />
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <p className="text-[11px] text-[#a1a1aa] leading-relaxed">
                {t(
                  'Skills are reusable, named playbooks the agent can invoke for specific jobs. Add one from a template or write your own.',
                  'Kỹ năng là các quy trình có tên, có thể tái sử dụng mà tác nhân có thể gọi khi cần. Thêm từ mẫu hoặc tự viết.'
                )}
              </p>
              <div>
                <label className="block text-xs font-semibold uppercase text-[#71717a] mb-2">{t('Add from template', 'Thêm từ mẫu')}</label>
                <div className="grid grid-cols-2 gap-2">
                  {SKILL_TEMPLATE_INFOS.map(info => (
                    <button
                      key={info.slug}
                      type="button"
                      onClick={() => addSkillFromTemplate(info.slug)}
                      className="text-left p-2.5 rounded-lg border border-[#27272a] bg-black/20 hover:border-[#70a4af] transition-colors"
                    >
                      <span className="text-[11px] font-semibold text-white block">{info.name}</span>
                      <span className="text-[10px] text-[#71717a]">{info.description}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-bold text-[#fafafa]">
                    {t('Skills List', 'Danh sách Kỹ năng')} ({skillsFiles.length})
                  </span>
                  <button type="button" onClick={addBlankSkill} className="text-[10px] font-bold text-blue-400 hover:underline">
                    ＋ {t('Write Custom Skill', 'Viết Kỹ năng Tùy chỉnh')}
                  </button>
                </div>
                {skillsFiles.length === 0 ? (
                  <div className="text-[10px] text-[#a1a1aa] italic py-1">
                    {t('No skills added yet.', 'Chưa thêm kỹ năng nào.')}
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {skillsFiles.map((f, index) => (
                      <div key={index} className="inline-flex items-center gap-1.5 bg-[#1e1e24] border border-[#3e3e4a] px-2 py-0.5 rounded-md text-[10px] text-white">
                        <span className="font-mono truncate max-w-[140px]" title={f.name}>{f.name}</span>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedSkillToEdit(f.name);
                            setOriginalSkillToEditName(f.name);
                            setSkillEditorContent(f.content);
                            setIsSkillEditorOpen(true);
                          }}
                          className="text-blue-400 hover:text-blue-300 font-semibold"
                        >
                          {t('Edit', 'Sửa')}
                        </button>
                        <button
                          type="button"
                          onClick={() => setSkillsFiles(skillsFiles.filter((_, i) => i !== index))}
                          className="text-red-400 hover:text-red-300 ml-0.5 font-bold"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="p-5 border-t border-[#27272a] flex justify-between items-center">
          <button
            type="button"
            onClick={step === 1 ? onClose : goBack}
            className="px-4 py-2 border border-[#27272a] text-[#a1a1aa] rounded-md text-sm font-semibold hover:bg-[#18181b] flex items-center gap-1.5"
          >
            {step > 1 && <ChevronLeft size={14} />}
            {step === 1 ? t('Cancel', 'Hủy bỏ') : t('Back', 'Quay lại')}
          </button>
          {step < 4 ? (
            <button
              type="button"
              onClick={goNext}
              disabled={!stepValid}
              className="px-4 py-2 bg-[#70a4af] text-white rounded-md text-sm font-semibold hover:bg-[#5b8c95] disabled:opacity-50 flex items-center gap-1.5"
            >
              {t('Next', 'Tiếp theo')}
              <ChevronRight size={14} />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isSubmitting}
              className="px-4 py-2 bg-[#70a4af] text-white rounded-md text-sm font-semibold hover:bg-[#5b8c95] disabled:opacity-50 flex items-center gap-2"
            >
              {isSubmitting && <Loader2 className="animate-spin" size={16} />}
              {submitLabel ? t(submitLabel.en, submitLabel.vi) : t('Deploy Agent', 'Triển khai Tác nhân')}
            </button>
          )}
        </div>
      </div>

      {isSkillEditorOpen && (
        <div className="fixed inset-0 z-[70] bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-[#09090b] border border-[#27272a] rounded-xl w-full max-w-xl p-6 space-y-4 shadow-2xl text-left">
            <div className="flex items-center justify-between pb-3 border-b border-[#27272a]">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider font-mono">{t('Edit Skill (SKILL.md)', 'Chỉnh sửa Kỹ năng (SKILL.md)')}</h3>
              <button onClick={() => setIsSkillEditorOpen(false)} className="text-[#a1a1aa] hover:text-white transition-colors" type="button">
                <X size={16} />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-[#71717a] mb-1 font-semibold">{t('Skill Folder/File Name', 'Tên thư mục kỹ năng')}</label>
                <input
                  type="text"
                  value={selectedSkillToEdit}
                  onChange={(e) => setSelectedSkillToEdit(e.target.value.replace(/[^a-zA-Z0-9_-]/g, '').trim().toLowerCase())}
                  className="w-full bg-[#18181b] border border-[#27272a] rounded-md px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-[#a1a1aa]"
                  placeholder="my-skill-name"
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-[#71717a] mb-1 font-semibold">{t('Markdown Content', 'Nội dung (Markdown)')}</label>
                <textarea
                  rows={14}
                  value={skillEditorContent}
                  onChange={(e) => setSkillEditorContent(e.target.value)}
                  className="w-full h-80 bg-[#18181b] border border-[#27272a] rounded-md p-3 text-xs font-mono text-[#d4d4d8] resize-none focus:outline-none focus:border-[#a1a1aa]"
                  placeholder="# Skill Title..."
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setIsSkillEditorOpen(false)} className="px-3 py-1.5 border border-[#27272a] text-[#a1a1aa] rounded-md text-xs font-semibold hover:bg-[#18181b]">
                {t('Cancel', 'Hủy')}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!selectedSkillToEdit) {
                    alert(t('Please enter a skill name.', 'Vui lòng nhập tên kỹ năng.'));
                    return;
                  }
                  const exists = skillsFiles.some((f) => f.name === selectedSkillToEdit && f.name !== originalSkillToEditName);
                  if (exists) {
                    alert(t('This skill name already exists.', 'Tên kỹ năng này đã tồn tại.'));
                    return;
                  }
                  const updated = [...skillsFiles];
                  const targetIdx = updated.findIndex(f => f.name === originalSkillToEditName);
                  if (targetIdx !== -1) {
                    updated[targetIdx] = { name: selectedSkillToEdit, content: skillEditorContent };
                  } else {
                    updated.push({ name: selectedSkillToEdit, content: skillEditorContent });
                  }
                  setSkillsFiles(updated);
                  setIsSkillEditorOpen(false);
                }}
                className="px-3 py-1.5 bg-[#70a4af] text-white rounded-md text-xs font-semibold hover:bg-[#5b8c95]"
              >
                {t('Save Skill', 'Lưu kỹ năng')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AgentSetupWizard;
