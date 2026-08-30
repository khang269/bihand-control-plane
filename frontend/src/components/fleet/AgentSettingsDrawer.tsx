import React from 'react';
import Drawer from '../Drawer';
import FleetAgentDetail from '../../pages/fleet/FleetAgentDetail';
import { useLanguage } from '../../context/LanguageContext';

interface AgentSettingsDrawerProps {
  open: boolean;
  onClose: () => void;
}

export const AgentSettingsDrawer: React.FC<AgentSettingsDrawerProps> = ({ open, onClose }) => {
  const { language } = useLanguage();

  return (
    <Drawer
      open={open}
      onClose={onClose}
      side="right"
      widthClassName="w-full max-w-3xl"
      title={language === 'vi' ? 'Cài đặt Tác nhân' : 'Agent Settings'}
    >
      {open && (
        <div className="h-full flex flex-col">
          <FleetAgentDetail />
        </div>
      )}
    </Drawer>
  );
};

export default AgentSettingsDrawer;
