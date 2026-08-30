import React from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { cn } from '../../lib/cn';

export const LanguageToggle: React.FC<{ className?: string }> = ({ className }) => {
  const { language, setLanguage } = useLanguage();
  return (
    <div className={cn('flex gap-0.5 bg-secondary border border-border p-0.5 rounded-full text-xs font-medium', className)}>
      <button
        type="button"
        onClick={() => setLanguage('en')}
        className={cn(
          'px-2 py-1 rounded-full transition-colors',
          language === 'en' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
        )}
      >
        EN
      </button>
      <button
        type="button"
        onClick={() => setLanguage('vi')}
        className={cn(
          'px-2 py-1 rounded-full transition-colors',
          language === 'vi' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
        )}
      >
        VI
      </button>
    </div>
  );
};

export default LanguageToggle;
