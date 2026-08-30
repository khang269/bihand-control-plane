import React from 'react';
import { Globe, Shield, Zap, TerminalSquare, Network, Tv2, Sparkles, Crown, ClipboardList, Code2, Megaphone, Check, Loader2, FileText } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext';
import Incorporate from './Incorporate';
import { PublicHeader } from '../components/public/PublicHeader';
import { PublicFooter } from '../components/public/PublicFooter';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Pill } from '../components/ui/Pill';
import { IconBadge } from '../components/ui/IconBadge';
import { StatRow } from '../components/ui/StatRow';
import { WindowFrame } from '../components/ui/WindowFrame';
import { FeatureSection } from '../components/landing/FeatureSection';
import {
  DelegationMockup, IntegrationsMockup, LiveScreenMockup, SandboxMockup, TerminalMockup, ModelPickerMockup,
} from '../components/landing/CapabilityMockups';
import { cn } from '../lib/cn';

const ChatShowcase: React.FC<{ className?: string }> = ({ className }) => {
  const { t } = useLanguage();
  return (
    <WindowFrame url="app.bihand.io/fleet/growth-team" className={className}>
      <div className="p-5 space-y-4">
        <div className="flex justify-end">
          <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-zinc-100 text-zinc-900 text-sm px-4 py-2.5">
            {t('landing.showcase.chat.user')}
          </div>
        </div>
        <div className="flex items-start gap-2.5">
          <div className="h-7 w-7 rounded-full bg-purple-500/20 text-purple-300 flex items-center justify-center text-xs font-bold shrink-0">S</div>
          <div className="max-w-[88%] space-y-2">
            <div className="rounded-2xl rounded-tl-sm bg-zinc-800 text-zinc-100 text-sm px-4 py-2.5">
              {t('landing.showcase.chat.agent_1')}
            </div>
            <div className="rounded-2xl rounded-tl-sm bg-zinc-800 text-zinc-100 text-sm px-4 py-2.5 space-y-1.5">
              <div className="flex items-center gap-2 text-emerald-400 text-xs">
                <Check size={13} /> {t('landing.showcase.chat.step_1')}
              </div>
              <div className="flex items-center gap-2 text-emerald-400 text-xs">
                <Check size={13} /> {t('landing.showcase.chat.step_2')}
              </div>
              <div className="flex items-center gap-2 text-zinc-400 text-xs">
                <Loader2 size={13} className="animate-spin" /> {t('landing.showcase.chat.step_3')}
              </div>
            </div>
            <div className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-300">
              <FileText size={14} className="text-zinc-400" /> {t('landing.showcase.chat.artifact')}
            </div>
          </div>
        </div>
      </div>
    </WindowFrame>
  );
};

const OrgNode: React.FC<{ icon: React.ElementType; role: string; status: string }> = ({ icon: Icon, role, status }) => (
  <div className="flex flex-col items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2.5 shadow-sm w-full">
    <IconBadge size="sm">
      <Icon size={14} />
    </IconBadge>
    <div className="text-xs font-semibold text-center leading-tight">{role}</div>
    <span className="flex items-center gap-1 text-[10px] text-emerald-500">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
      {status}
    </span>
  </div>
);

const OrgChartShowcase: React.FC<{ className?: string }> = ({ className }) => {
  const { t } = useLanguage();
  const status = t('landing.showcase.org.status');
  const reports = [
    { icon: ClipboardList, role: t('landing.showcase.org.pm') },
    { icon: Code2, role: t('landing.showcase.org.dev') },
    { icon: Megaphone, role: t('landing.showcase.org.marketing') },
  ];
  return (
    <Card className={cn('flex flex-col items-center justify-center py-8 px-6 bg-dot-grid', className)}>
      <div className="w-36">
        <OrgNode icon={Crown} role={t('landing.showcase.org.ceo')} status={status} />
      </div>
      <div className="h-6 w-px bg-border" />
      <div className="w-[85%] h-px bg-border" />
      <div className="flex justify-between gap-3 w-[85%]">
        {reports.map(({ icon, role }) => (
          <div key={role} className="flex flex-col items-center flex-1">
            <div className="h-6 w-px bg-border" />
            <OrgNode icon={icon} role={role} status={status} />
          </div>
        ))}
      </div>
    </Card>
  );
};

const capabilities = [
  {
    icon: Network,
    titleKey: 'landing.features.multi_agent.title',
    descKey: 'landing.features.multi_agent.desc',
    exampleKey: 'landing.features.multi_agent.example',
    visual: <DelegationMockup />,
  },
  {
    icon: Globe,
    titleKey: 'landing.features.native_app.title',
    descKey: 'landing.features.native_app.desc',
    exampleKey: 'landing.features.native_app.example',
    visual: <IntegrationsMockup />,
  },
  {
    icon: Tv2,
    titleKey: 'landing.features.live_screens.title',
    descKey: 'landing.features.live_screens.desc',
    exampleKey: 'landing.features.live_screens.example',
    visual: <LiveScreenMockup />,
  },
  {
    icon: Shield,
    titleKey: 'landing.features.secure_sandboxing.title',
    descKey: 'landing.features.secure_sandboxing.desc',
    exampleKey: 'landing.features.secure_sandboxing.example',
    visual: <SandboxMockup />,
  },
  {
    icon: TerminalSquare,
    titleKey: 'landing.features.cli_first.title',
    descKey: 'landing.features.cli_first.desc',
    exampleKey: 'landing.features.cli_first.example',
    visual: <TerminalMockup />,
  },
  {
    icon: Zap,
    titleKey: 'landing.features.model_agnostic.title',
    descKey: 'landing.features.model_agnostic.desc',
    exampleKey: 'landing.features.model_agnostic.example',
    visual: <ModelPickerMockup />,
  },
];

const Landing: React.FC = () => {
  const { token } = useAuth();
  const navigate = useNavigate();
  const { t } = useLanguage();

  const stats = [
    { value: '2,400+', label: t('landing.stats.agents') },
    { value: '640+', label: t('landing.stats.fleets') },
    { value: '6', label: t('landing.stats.runtimes') },
    { value: '99.9%', label: t('landing.stats.uptime') },
  ];

  const exampleLabel = t('landing.showcase.example_label');

  return (
    <div className="min-h-screen bg-background text-foreground font-sans selection:bg-primary selection:text-primary-foreground">
      <PublicHeader />

      {/* Hero */}
      <header className="relative overflow-hidden bg-dot-grid">
        <div className="max-w-4xl mx-auto px-6 pt-20 pb-16 text-center">
          <Pill className="mb-6">
            <Sparkles size={13} />
            {t('landing.now_supporting')}
          </Pill>

          <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight mb-4 leading-[1.08]">
            {t('landing.title_1')}<br />
            {t('landing.title_2')}
          </h1>

          <p className="font-accent italic text-2xl md:text-3xl text-muted-foreground mb-6">
            {t('landing.tagline')}
          </p>

          <p className="text-base text-muted-foreground max-w-xl mx-auto leading-relaxed mb-8">
            {t('landing.subtitle')}
          </p>

          <Button
            shape="pill"
            size="lg"
            onClick={() => token ? navigate('/dashboard') : document.getElementById('demo')?.scrollIntoView({ behavior: 'smooth' })}
          >
            {token ? t('landing.go_to_dashboard') : t('landing.get_started')}
          </Button>
        </div>
      </header>

      {/* Stats strip */}
      <section className="max-w-5xl mx-auto px-6 pb-16">
        <StatRow stats={stats} />
      </section>

      {/* At-a-glance teaser: real chat + org-chart mockups, so visitors see the product working immediately */}
      <section className="max-w-5xl mx-auto px-6 pb-20">
        <div className="text-center mb-10">
          <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight mb-2">{t('landing.showcase.title')}</h2>
          <p className="text-muted-foreground max-w-lg mx-auto">{t('landing.showcase.subtitle')}</p>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-stretch">
          <div className="lg:col-span-3 flex flex-col gap-2">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-1">
              {t('landing.showcase.chat.label')}
            </span>
            <ChatShowcase className="flex-1" />
          </div>
          <div className="lg:col-span-2 flex flex-col gap-2">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-1">
              {t('landing.showcase.org.label')}
            </span>
            <OrgChartShowcase className="flex-1" />
          </div>
        </div>
      </section>

      {/* Capability deep-dives: each gets its own diagram/mockup + a concrete real-world example */}
      <div id="capabilities">
        <div className="max-w-6xl mx-auto px-6 pt-4 text-center">
          <h2 className="text-xl font-bold">{t('landing.features.section_title')}</h2>
        </div>
        {capabilities.map(({ icon, titleKey, descKey, exampleKey, visual }, i) => (
          <FeatureSection
            key={titleKey}
            index={i + 1}
            icon={icon}
            title={t(titleKey)}
            description={t(descKey)}
            example={t(exampleKey)}
            exampleLabel={exampleLabel}
            reverse={i % 2 === 1}
            visual={visual}
          />
        ))}
      </div>

      {/* Embedded provisioning wizard demo — kept on its own dark "app window" frame since
          Incorporate.tsx's internal styling still assumes a dark backdrop (full redesign lands
          in a later checkpoint); framing it as a live app screenshot fits the mockups above. */}
      <section className="max-w-5xl mx-auto px-6 py-16 border-t border-border" id="demo">
        <div className="text-center mb-6">
          <h2 className="text-xl font-bold">{t('landing.demo.title')}</h2>
          <p className="text-sm text-muted-foreground mt-1">{t('landing.demo.subtitle')}</p>
        </div>
        <WindowFrame url="app.bihand.io/wizard" className="shadow-xl">
          <div className="p-6 md:p-10">
            <Incorporate />
          </div>
        </WindowFrame>
      </section>

      {/* Dark CTA band */}
      <section className="bg-zinc-950 text-white py-20">
        <div className="max-w-4xl mx-auto px-6 text-center">
          <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight mb-3">{t('landing.cta_band.title')}</h2>
          <p className="text-zinc-400 mb-8 max-w-xl mx-auto">{t('landing.cta_band.subtitle')}</p>
          <Button
            shape="pill"
            size="lg"
            className="bg-white text-zinc-950 hover:opacity-90 mb-12"
            onClick={() => token ? navigate('/dashboard') : document.getElementById('demo')?.scrollIntoView({ behavior: 'smooth' })}
          >
            {t('landing.cta_band.button')}
          </Button>
          <StatRow stats={stats} inverted />
        </div>
      </section>

      <PublicFooter />
    </div>
  );
};

export default Landing;
