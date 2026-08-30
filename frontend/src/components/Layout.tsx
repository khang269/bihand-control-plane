import React, { useState, useEffect } from 'react';
import { Outlet, useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { Building2, PlusCircle, CreditCard, LayoutDashboard, LogOut, ChevronDown, ChevronRight, Inbox, CircleDot, Repeat, Target, Bot, Network, DollarSign, Lock, Activity, Settings as SettingsIcon, Video } from 'lucide-react';
import api from '../lib/api';
import { useAvatar } from '../lib/avatarCache';
import { cn } from '../lib/cn';
import { IconBadge } from './ui/IconBadge';
import { ThemeToggle } from './ui/ThemeToggle';
import { LanguageToggle } from './public/LanguageToggle';

const navLinkClass = (active: boolean) =>
  cn(
    'flex items-center gap-3 px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
    active ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
  );

const AgentSidebarLink: React.FC<{ agent: any; activeFleetId: string; locationPath: string }> = ({ agent, activeFleetId, locationPath }) => {
  const { thumbnailSrc } = useAvatar(agent.avatarHash);
  return (
    <Link to={`/fleet/${activeFleetId}/agents/${agent.id}`} className={navLinkClass(locationPath.includes(agent.id))}>
      {agent.avatarHash ? (
        thumbnailSrc ? (
          <img src={thumbnailSrc} alt="Avatar" className="w-4 h-4 rounded-full object-cover border border-border" />
        ) : (
          <div className="w-4 h-4 rounded-full bg-secondary border border-border" />
        )
      ) : (
        <Bot size={16} />
      )}
      {agent.role}
    </Link>
  );
};

const Layout: React.FC = () => {
  const { user, logout } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const [fleets, setFleets] = useState<any[]>([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [dropdownLoading, setDropdownLoading] = useState(false);
  const [fleetDetails, setFleetDetails] = useState<any>(null);

  // Extract fleetId from URL to determine context
  const pathParts = location.pathname.split('/');
  const isFleetContext = pathParts[1] === 'fleet' && pathParts.length >= 3;
  // Pages that manage their own chrome and need the full content area (no padding/max-width).
  const isFullBleed = false;
  const activeFleetId = isFleetContext ? pathParts[2] : null;

  useEffect(() => {
    loadFleets();
  }, []);

  useEffect(() => {
    if (activeFleetId) {
      // Poll details during provisioning/installation or transient statuses to auto-refresh sidebar agents list
      const fetchDetails = () => {
        api.get(`/fleets/${activeFleetId}`).then(res => {
          setFleetDetails(res.data);
        }).catch(err => {
          console.error(err);
        });
      };

      fetchDetails();
      const interval = setInterval(() => {
        // Only trigger poll if document is focused to prevent browser tab throttling/slowness
        if (document.hasFocus()) {
          fetchDetails();
        }
      }, 5000); // Poll every 5s for smooth UI updates during setup
      return () => clearInterval(interval);
    } else {
      setFleetDetails(null);
    }
  }, [activeFleetId]);

  const loadFleets = async () => {
    setDropdownLoading(true);
    try {
      const res = await api.get('/fleets');
      setFleets(res.data);
    } catch (e) {
      console.error('Failed to load fleets', e);
    } finally {
      setDropdownLoading(false);
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  const activeFleet = fleets.find(f => f.id === activeFleetId);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      {/* Sidebar */}
      {!isFleetContext && (
        <aside className="w-64 border-r border-border bg-background flex flex-col h-full flex-shrink-0">

        {/* Fleet Switcher */}
        <div className="p-4 border-b border-border relative">
          <div
            className="flex items-center gap-2 px-2 py-1.5 hover:bg-secondary rounded-md cursor-pointer transition-colors"
            onClick={() => {
              if (!dropdownOpen) {
                setDropdownOpen(true);
                loadFleets(); // Load asynchronously while keeping dropdown responsive
              } else {
                setDropdownOpen(false);
              }
            }}
          >
            <IconBadge size="sm">
              <Building2 size={14} />
            </IconBadge>
            <div className="flex-1 overflow-hidden">
              <div className="text-sm font-semibold truncate">
                {activeFleet ? activeFleet.name : t('nav.select_company')}
              </div>
            </div>
            <ChevronDown size={14} className="text-muted-foreground" />
          </div>

          {/* Dropdown */}
          {dropdownOpen && (
            <div className="absolute top-14 left-4 w-56 bg-card border border-border rounded-lg shadow-xl z-50 py-1">
              <div className="px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t('nav.your_companies')}</div>
              {dropdownLoading ? (
                <div className="px-4 py-6 flex items-center justify-center text-xs text-muted-foreground gap-2">
                  <span className="animate-spin border-2 border-t-transparent border-muted-foreground rounded-full w-3.5 h-3.5" />
                  {t('nav.loading')}
                </div>
              ) : (
                <div className="max-h-60 overflow-y-auto">
                  {fleets.map(f => (
                    <button
                      key={f.id}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-secondary flex items-center justify-between transition-colors"
                      onClick={() => { setDropdownOpen(false); navigate(`/fleet/${f.id}/dashboard`); }}
                    >
                      <span className="truncate">{f.name}</span>
                      {(f.status === 'running' || f.status === 'provisioned') && (
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      )}
                    </button>
                  ))}
                  {fleets.length === 0 && (
                    <div className="px-3 py-2 text-xs text-muted-foreground italic">{t('nav.no_fleets_found')}</div>
                  )}
                </div>
              )}
              <div className="border-t border-border mt-1 pt-1">
                <button
                  className="w-full text-left px-3 py-2 text-sm hover:bg-secondary flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => { navigate('/wizard'); setDropdownOpen(false); }}
                >
                  <PlusCircle size={14} /> {t('nav.incorporate_new')}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Navigation */}
        <div className="flex-1 overflow-y-auto p-3 space-y-6">

          {activeFleetId ? (
            <>
              {/* Bihand-style Workspace Sidebar */}
              <nav className="space-y-1">
                <Link to={`/fleet/${activeFleetId}/dashboard`} className={navLinkClass(location.pathname.endsWith('/dashboard'))}>
                  <LayoutDashboard size={16} /> {t('nav.dashboard')}
                </Link>
              </nav>

              <div>
                <div className="px-3 mb-2 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Work</div>
                <nav className="space-y-1">
                  <Link to={`/fleet/${activeFleetId}/inbox`} className={navLinkClass(location.pathname.includes('/inbox'))}>
                    <Inbox size={16} /> {t('nav.inbox')}
                  </Link>
                  <Link to={`/fleet/${activeFleetId}/issues`} className={navLinkClass(location.pathname.includes('/issues'))}>
                    <CircleDot size={16} /> {t('nav.incidents')}
                  </Link>
                  <Link to={`/fleet/${activeFleetId}/routines`} className={navLinkClass(location.pathname.includes('/routines'))}>
                    <Repeat size={16} /> {t('nav.scheduled_routines')}
                  </Link>
                  <Link to={`/fleet/${activeFleetId}/goals`} className={navLinkClass(location.pathname.includes('/goals'))}>
                    <Target size={16} /> {t('nav.goals_roadmap')}
                  </Link>
                </nav>
              </div>

              <div>
                <div className="px-3 mb-2 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Agents</div>
                <nav className="space-y-1">
                  {fleetDetails?.instances?.map((agent: any) => (
                    <AgentSidebarLink key={agent.id} agent={agent} activeFleetId={activeFleetId!} locationPath={location.pathname} />
                  ))}
                </nav>
              </div>

              <div>
                <div className="px-3 mb-2 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Fleet</div>
                <nav className="space-y-1">
                  <Link to={`/fleet/${activeFleetId}/org`} className={navLinkClass(location.pathname.includes('/org'))}>
                    <Network size={16} /> {t('fleet.org_chart.title')}
                  </Link>
                  <Link to={`/fleet/${activeFleetId}/credentials`} className={navLinkClass(location.pathname.includes('/credentials'))}>
                    <Lock size={16} /> {t('nav.credentials')}
                  </Link>
                  <Link to={`/fleet/${activeFleetId}/costs`} className={navLinkClass(location.pathname.includes('/costs'))}>
                    <DollarSign size={16} /> {t('fleet.costs.title')}
                  </Link>
                  <Link to={`/fleet/${activeFleetId}/activity`} className={navLinkClass(location.pathname.includes('/activity'))}>
                    <Activity size={16} /> {t('fleet.activity.title')}
                  </Link>
                </nav>
              </div>
            </>
          ) : (
            <div>
              <div className="px-3 mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t('nav.workspace')}</div>
              <nav className="space-y-1">
                <Link to="/dashboard" className={navLinkClass(location.pathname === '/dashboard')}>
                  <LayoutDashboard size={16} /> {t('nav.dashboard')}
                </Link>
                <Link to="/architecture-studio" className={navLinkClass(location.pathname === '/architecture-studio')}>
                  <Building2 size={16} /> {t('nav.architecture_studio')}
                </Link>
                <Link to="/film-studio" className={navLinkClass(location.pathname === '/film-studio')}>
                  <Video size={16} /> {t('nav.film_studio')}
                </Link>
                <Link to="/wizard" className={navLinkClass(location.pathname === '/wizard')}>
                  <PlusCircle size={16} /> {t('nav.incorporate_new')}
                </Link>
                <Link to="/credentials" className={navLinkClass(location.pathname === '/credentials')}>
                  <Lock size={16} /> {t('nav.credentials')}
                </Link>
                <Link to="/billing" className={navLinkClass(location.pathname === '/billing')}>
                  <CreditCard size={16} /> {t('nav.billing_packages')}
                </Link>
                {user?.role === 'admin' && (
                  <Link to="/admin" className="flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium text-muted-foreground hover:bg-secondary hover:text-emerald-500 transition-colors mt-4 border-t border-border pt-4">
                    <SettingsIcon size={18} /> {t('nav.admin_panel')}
                  </Link>
                )}
              </nav>
            </div>
          )}

        </div>

        {/* User Profile */}
        <div className="p-4 border-t border-border">
          <div className="flex items-center gap-3">
            <img src={user?.avatar} alt="Avatar" className="w-8 h-8 rounded-full bg-secondary" />
            <div className="flex-1 overflow-hidden">
              <div className="text-sm font-medium truncate">{user?.name}</div>
              <div className="text-xs text-muted-foreground truncate">{user?.email}</div>
            </div>

            <button onClick={handleLogout} className="text-muted-foreground hover:text-foreground p-1 rounded-md hover:bg-secondary transition-colors" title={t('nav.sign_out')}>
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
      )}

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col h-full overflow-hidden">

        {/* Topbar */}
        <header className="h-14 border-b border-border flex items-center justify-between px-6 flex-shrink-0 bg-background">
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            {isFleetContext ? (
              <>
                <Link to="/dashboard" className="flex items-center gap-1.5 px-3 py-1.5 bg-secondary border border-border hover:border-muted-foreground/40 hover:text-foreground rounded-lg text-xs font-semibold uppercase tracking-wider text-muted-foreground transition-colors" title={t('nav.exit_to_portal')}>
                  <Building2 size={12} /> {t('nav.exit_to_portal')}
                </Link>
                <span className="text-border">|</span>
                <span className="text-foreground font-extrabold tracking-tight uppercase flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-purple-500 shadow-[0_0_10px_rgba(168,85,247,0.5)] animate-pulse"></span>
                  {activeFleet ? activeFleet.name : t('nav.select_company')}
                </span>
              </>
            ) : (
              <span>Bihand</span>
            )}
            <ChevronRight size={14} className="text-border" />
            <span className="text-foreground font-medium">
              {location.pathname.includes('/dashboard') ? t('nav.dashboard') :
               location.pathname.includes('/inbox') ? t('nav.inbox') :
               location.pathname.includes('/issues') ? t('nav.incidents') :
               location.pathname.includes('/routines') ? t('nav.scheduled_routines') :
               location.pathname.includes('/goals') ? t('nav.goals_roadmap') :
               location.pathname.includes('/org') ? t('fleet.org_chart.title') :
               location.pathname.includes('/costs') ? t('fleet.costs.title') :
               location.pathname.includes('/activity') ? t('fleet.activity.title') :
               location.pathname === '/wizard' ? t('nav.incorporate_new') :
               location.pathname === '/credentials' ? t('nav.credentials') :
               location.pathname === '/billing' ? t('nav.billing_packages') : ''}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <LanguageToggle />
            <ThemeToggle />

            {isFleetContext && (
              <>
                <span className="text-border">|</span>
                {/* User Profile */}
                <div className="flex items-center gap-3 flex-shrink-0">
                  <img src={user?.avatar} alt="Avatar" className="w-7 h-7 rounded-full bg-secondary border border-border" />
                  <div className="hidden sm:block text-left">
                    <div className="text-xs font-bold text-foreground max-w-[120px] truncate">{user?.name}</div>
                    <div className="text-[10px] text-muted-foreground max-w-[120px] truncate">{user?.email}</div>
                  </div>

                  <button onClick={handleLogout} className="text-muted-foreground hover:text-foreground p-1.5 rounded-md hover:bg-secondary transition-colors" title={t('nav.sign_out')}>
                    <LogOut size={14} />
                  </button>
                </div>
              </>
            )}
          </div>
        </header>

        {/* Page Content */}
        <div className={`flex-1 ${isFleetContext || isFullBleed ? 'overflow-hidden h-full w-full' : 'overflow-y-auto p-8'}`}>
          <div className={isFleetContext || isFullBleed ? 'h-full w-full' : 'max-w-5xl mx-auto w-full'}>
            <Outlet context={{ activeFleetId, fleets, loadFleets }} />
          </div>
        </div>
      </main>
    </div>
  );
};

export default Layout;
