import React from 'react';
import { GoogleOAuthProvider, GoogleLogin } from '@react-oauth/google';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { useTheme } from '../context/ThemeContext';
import { useNavigate, Navigate } from 'react-router-dom';
import { PublicHeader } from '../components/public/PublicHeader';
import { Card } from '../components/ui/Card';

const Login: React.FC = () => {
  const { login, token } = useAuth();
  const { t } = useLanguage();
  const { theme } = useTheme();
  const navigate = useNavigate();

  if (token) {
    return <Navigate to="/dashboard" replace />;
  }

  const onSuccess = async (credentialResponse: { credential?: string }) => {
    if (credentialResponse.credential) {
      try {
        await login(credentialResponse.credential);
        navigate('/dashboard');
      } catch (err) {
        console.error('Login failed', err);
        alert('Login failed. Ensure backend is running.');
      }
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground bg-dot-grid">
      <PublicHeader cta="back" />

      <div className="flex-1 flex items-center justify-center px-6 py-16">
        <div className="flex flex-col items-center max-w-md w-full">
          <Card className="w-full text-center shadow-2xl">
            <h2 className="text-xl font-semibold mb-2">{t('login.title')}</h2>
            <p className="text-muted-foreground text-sm mb-6">{t('login.subtitle')}</p>

            <div className="flex justify-center w-full">
              <GoogleOAuthProvider clientId={import.meta.env.VITE_GOOGLE_CLIENT_ID || ""}>
                <GoogleLogin
                  onSuccess={onSuccess}
                  onError={() => {
                    console.log('Login Failed');
                    alert('Google Login Failed');
                  }}
                  theme={theme === 'dark' ? 'filled_black' : 'outline'}
                  size="large"
                  text="signin_with"
                  shape="rectangular"
                />
              </GoogleOAuthProvider>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default Login;
