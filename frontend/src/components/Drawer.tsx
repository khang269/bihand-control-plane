import React, { useEffect } from 'react';
import { X } from 'lucide-react';

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  side: 'left' | 'right';
  widthClassName?: string;
  title?: React.ReactNode;
  children: React.ReactNode;
}

export const Drawer: React.FC<DrawerProps> = ({
  open,
  onClose,
  side,
  widthClassName = 'w-full max-w-md',
  title,
  children,
}) => {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const sideClassName = side === 'left' ? 'inset-y-0 left-0' : 'inset-y-0 right-0';
  const borderClassName = side === 'left' ? 'border-r' : 'border-l';

  return (
    <div className="fixed inset-0 z-50">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className={`absolute ${sideClassName} ${widthClassName} ${borderClassName} border-border bg-card text-card-foreground shadow-2xl flex flex-col overflow-hidden`}
        role="dialog"
        aria-modal="true"
      >
        {title !== undefined && (
          <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
            <div className="text-sm font-bold">{title}</div>
            <button
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto min-h-0">{children}</div>
      </div>
    </div>
  );
};

export default Drawer;
