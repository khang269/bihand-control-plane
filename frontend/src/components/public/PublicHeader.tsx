import React from 'react';
import { Network, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { LanguageToggle } from './LanguageToggle';
import { ThemeToggle } from '../ui/ThemeToggle';
import { Button } from '../ui/Button';

export interface PublicHeaderProps {
  /** 'auth' (default): Sign in / Go to Dashboard. 'back': a Back-to-home button. 'none': chrome only. */
  cta?: 'auth' | 'back' | 'none';
}

/** Sticky pill-shaped nav shared by Landing, Login, Terms and Privacy — evose.ai-style. */
export const PublicHeader: React.FC<PublicHeaderProps> = ({ cta = 'auth' }) => {
  const navigate = useNavigate();
  const { token } = useAuth();
  const { language, t } = useLanguage();

  return (
    <header className="sticky top-0 z-40 px-4 pt-4">
      <div className="max-w-6xl mx-auto flex items-center justify-between rounded-full border border-border bg-card/90 backdrop-blur-md shadow-sm px-4 py-2.5">
        <div className="flex items-center gap-2 cursor-pointer" onClick={() => navigate('/')}>
          <div className="h-7 w-7 rounded-lg bg-primary text-primary-foreground flex items-center justify-center shrink-0">
            <Network size={16} />
          </div>
          <span className="text-base font-bold tracking-tight">Bihand</span>
        </div>

        <div className="flex items-center gap-2">
          <LanguageToggle />
          <ThemeToggle />

          {cta === 'auth' && (
            token ? (
              <Button size="sm" shape="pill" onClick={() => navigate('/dashboard')}>
                {t('landing.go_to_dashboard')}
              </Button>
            ) : (
              <>
                <button
                  onClick={() => navigate('/login')}
                  className="hidden sm:inline text-sm text-muted-foreground hover:text-foreground px-3 py-1.5 transition-colors"
                >
                  {t('landing.sign_in')}
                </button>
                <Button size="sm" shape="pill" onClick={() => navigate('/login')}>
                  {language === 'vi' ? 'Đăng ký' : 'Sign up'}
                </Button>
              </>
            )
          )}

          {cta === 'back' && (
            <Button size="sm" shape="pill" variant="outline" onClick={() => navigate('/')}>
              <ArrowLeft size={14} /> {language === 'en' ? 'Back' : 'Quay Lại'}
            </Button>
          )}
        </div>
      </div>
    </header>
  );
};

export default PublicHeader;
