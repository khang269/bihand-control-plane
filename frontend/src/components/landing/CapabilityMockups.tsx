import React from 'react';
import { Mail, Calendar, FileText, HardDrive, Lock, MousePointer2, Server, ShieldCheck } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { WindowFrame } from '../ui/WindowFrame';
import { Card } from '../ui/Card';
import { IconBadge } from '../ui/IconBadge';
import { cn } from '../../lib/cn';

/**
 * Illustrative product mockups for the Landing page capability sections — not live screenshots,
 * built with the same primitives/tokens as the real app so the shapes are representative.
 * Dark WindowFrame = "product screenshot" chrome; light Card = architecture-diagram style.
 */

const Ticket: React.FC<{ title: string; tag: string; active?: boolean }> = ({ title, tag, active }) => (
  <div className={cn('rounded-lg border p-2.5 text-left', active ? 'border-zinc-600 bg-zinc-800' : 'border-zinc-800 bg-zinc-900')}>
    <div className="text-xs text-zinc-100 font-medium leading-snug mb-1.5">{title}</div>
    <div className="text-[10px] text-zinc-500">{tag}</div>
  </div>
);

export const DelegationMockup: React.FC = () => {
  const { t } = useLanguage();
  return (
    <WindowFrame url="app.bihand.io/fleet/growth-team/issues">
      <div className="p-5">
        <div className="grid grid-cols-3 gap-2.5">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500 mb-2">{t('landing.showcase.mock.backlog')}</div>
            <Ticket title={t('landing.showcase.mock.ticket')} tag={t('landing.showcase.org.ceo')} />
          </div>
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500 mb-2">{t('landing.showcase.mock.in_progress')}</div>
            <Ticket title={t('landing.showcase.mock.ticket')} tag={t('landing.showcase.org.dev')} active />
          </div>
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500 mb-2">{t('landing.showcase.mock.done')}</div>
            <Ticket title={t('landing.showcase.mock.ticket_2')} tag={t('landing.showcase.org.dev')} />
          </div>
        </div>
        <div className="mt-4 pt-3 border-t border-zinc-800 text-[11px] text-zinc-500">
          {t('landing.showcase.mock.delegation_log')}
        </div>
      </div>
    </WindowFrame>
  );
};

export const IntegrationsMockup: React.FC = () => {
  const { t } = useLanguage();
  const apps = [
    { icon: Mail, name: 'Gmail' },
    { icon: Calendar, name: 'Google Calendar' },
    { icon: FileText, name: 'Google Docs' },
    { icon: HardDrive, name: 'Google Drive' },
  ];
  return (
    <WindowFrame url="app.bihand.io/fleet/growth-team/credentials">
      <div className="p-5 space-y-2">
        {apps.map(({ icon: Icon, name }) => (
          <div key={name} className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2.5">
            <div className="flex items-center gap-2.5">
              <Icon size={15} className="text-zinc-400" />
              <span className="text-sm text-zinc-100">{name}</span>
            </div>
            <span className="text-[10px] font-medium text-emerald-400 bg-emerald-500/10 rounded-full px-2 py-0.5">
              {t('landing.showcase.mock.connected')}
            </span>
          </div>
        ))}
        <div className="pt-2 text-[11px] text-zinc-500">{t('landing.showcase.mock.integrations_log')}</div>
      </div>
    </WindowFrame>
  );
};

export const LiveScreenMockup: React.FC = () => {
  const { t } = useLanguage();
  return (
    <WindowFrame url="app.bihand.io/fleet/growth-team/agents/chris/screen">
      <div className="p-4">
        <div className="rounded-lg border border-zinc-800 bg-white overflow-hidden relative">
          <div className="h-6 bg-zinc-100 border-b border-zinc-200 flex items-center px-2 gap-1.5">
            <div className="h-2 w-2 rounded-full bg-zinc-300" />
            <div className="h-2 w-2 rounded-full bg-zinc-300" />
            <div className="ml-1.5 flex-1 h-3 rounded bg-zinc-200 max-w-[140px]" />
          </div>
          <div className="p-4 space-y-2">
            <div className="h-3 w-2/3 rounded bg-zinc-200" />
            <div className="h-3 w-1/2 rounded bg-zinc-200" />
            <div className="h-16 rounded bg-zinc-100 border border-zinc-200 mt-3" />
          </div>
          <MousePointer2 size={16} className="absolute text-zinc-900 fill-white" style={{ top: '58%', left: '52%' }} />
        </div>
        <div className="mt-3 flex items-center gap-1.5 text-xs text-red-400">
          <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
          {t('landing.showcase.mock.live_label')}
        </div>
      </div>
    </WindowFrame>
  );
};

export const SandboxMockup: React.FC = () => {
  const { t } = useLanguage();
  return (
    <Card className="p-6 bg-dot-grid flex flex-col items-center gap-4">
      <div className="grid grid-cols-3 gap-3 w-full">
        {[1, 2, 3].map((n) => (
          <div key={n} className="rounded-xl border-2 border-dashed border-border p-3 flex flex-col items-center gap-1.5">
            <IconBadge size="sm">
              <Server size={14} />
            </IconBadge>
            <span className="text-[10px] font-mono text-muted-foreground">VM-{n}</span>
            <Lock size={10} className="text-muted-foreground" />
          </div>
        ))}
      </div>
      <div className="h-5 w-px bg-border" />
      <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 shadow-sm">
        <ShieldCheck size={16} className="text-emerald-500" />
        <span className="text-xs font-semibold">{t('landing.showcase.mock.vault')}</span>
      </div>
    </Card>
  );
};

export const TerminalMockup: React.FC = () => {
  return (
    <WindowFrame url="ssh agent-dev-01 ~/workspace">
      <div className="p-4 font-mono text-[12.5px] leading-relaxed">
        <div className="text-zinc-500">$ claude-code --resume</div>
        <div className="text-zinc-300">Loaded workspace: growth-team/dev-01</div>
        <div className="text-zinc-300">Branch: <span className="text-emerald-400">feature/fix-login-bug</span></div>
        <div className="text-zinc-500 mt-2">$ git diff --stat</div>
        <div className="text-zinc-300">auth/session.py | 14 +++++++++-----</div>
        <div className="text-zinc-300">1 file changed, 9 insertions(+), 5 deletions(-)</div>
        <div className="text-zinc-500 mt-2">$ pytest tests/auth -q</div>
        <div className="text-emerald-400">12 passed in 1.84s</div>
        <div className="text-zinc-500 mt-2 flex items-center gap-1">
          $ <span className="inline-block h-3 w-1.5 bg-zinc-400 animate-pulse" />
        </div>
      </div>
    </WindowFrame>
  );
};

export const ModelPickerMockup: React.FC = () => {
  const models = [
    { name: 'GPT-4o', use: 'Complex reasoning', selected: false },
    { name: 'Claude 3.5 Sonnet', use: 'Coding', selected: true },
    { name: 'Gemini 1.5 Pro', use: 'Long context', selected: false },
    { name: 'DeepSeek V3', use: 'Bulk tasks', selected: false },
  ];
  return (
    <Card className="p-5">
      <div className="space-y-2">
        {models.map((m) => (
          <div
            key={m.name}
            className={cn(
              'flex items-center justify-between rounded-lg border px-3 py-2.5',
              m.selected ? 'border-primary bg-secondary' : 'border-border'
            )}
          >
            <div className="flex items-center gap-2.5">
              <span
                className={cn(
                  'h-3.5 w-3.5 rounded-full border-2 flex items-center justify-center shrink-0',
                  m.selected ? 'border-primary' : 'border-border'
                )}
              >
                {m.selected && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
              </span>
              <span className="text-sm font-medium">{m.name}</span>
            </div>
            <span className="text-[11px] text-muted-foreground">{m.use}</span>
          </div>
        ))}
      </div>
    </Card>
  );
};
