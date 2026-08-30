import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../../context/LanguageContext';
import { cn } from '../../lib/cn';

interface FleetNavDrawerProps {
  fleetId: string;
  activeTab: string;
  onClose: () => void;
}

export const FleetNavDrawer: React.FC<FleetNavDrawerProps> = ({ fleetId, activeTab, onClose }) => {
  const navigate = useNavigate();
  const { language } = useLanguage();

  const navItems = useMemo(() => [
    { id: 'org', label: language === 'vi' ? '🧬 Cơ cấu & Nhân sự' : '🧬 Org & Roster', path: '/org' },
    { id: 'issues', label: language === 'vi' ? '📋 Bảng Sự cố' : '📋 Ops Board', path: '/issues' },
    { id: 'inbox', label: language === 'vi' ? '📥 Quản trị' : '📥 Governance', path: '/inbox' },
    { id: 'routines', label: language === 'vi' ? '🔄 Tự động hóa' : '🔄 Automations', path: '/routines' },
    { id: 'support', label: language === 'vi' ? '💬 Chăm sóc KH' : '💬 Customer Support', path: '/support' },
    { id: 'goals', label: language === 'vi' ? '🎯 Lộ trình' : '🎯 Roadmap', path: '/goals' },
    { id: 'activity', label: language === 'vi' ? '📈 Live Feed' : '📈 Live Feed', path: '/activity' },
    { id: 'costs', label: language === 'vi' ? '💸 Sổ Chi phí' : '💸 Ledger', path: '/costs' },
    { id: 'credentials', label: language === 'vi' ? '🔒 Kho khóa' : '🔒 Vault', path: '/credentials' },
  ], [language]);

  return (
    <div className="p-2">
      {navItems.map((item) => {
        const isActive = activeTab === item.id;
        return (
          <button
            key={item.id}
            onClick={() => {
              navigate(`/fleet/${fleetId}${item.path}`);
              onClose();
            }}
            className={cn(
              'w-full text-left px-3.5 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200 mb-1',
              isActive
                ? 'bg-purple-500/10 text-purple-400'
                : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
};

export default FleetNavDrawer;
