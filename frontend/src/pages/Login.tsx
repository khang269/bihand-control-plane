import React, { useEffect, useState } from 'react';
import { GoogleOAuthProvider, GoogleLogin } from '@react-oauth/google';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { useTheme } from '../context/ThemeContext';
import { useNavigate, Navigate } from 'react-router-dom';
import { PublicHeader } from '../components/public/PublicHeader';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import api from '../lib/api';

const Login: React.FC = () => {
  const { login, loginWithToken, token } = useAuth();
  const { t } = useLanguage();
  const { theme } = useTheme();
  const navigate = useNavigate();

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [googleEnabled, setGoogleEnabled] = useState(false);

  useEffect(() => {
    api.get('/auth/config')
      .then(res => setGoogleEnabled(!!res.data?.google))
      .catch(() => setGoogleEnabled(false));
  }, []);

  if (token) {
    return <Navigate to="/dashboard" replace />;
  }

  const onGoogleSuccess = async (credentialResponse: { credential?: string }) => {
    if (credentialResponse.credential) {
      try {
        await login(credentialResponse.credential);
        navigate('/dashboard');
      } catch (err) {
        console.error('Login failed', err);
        setError('Google sign-in failed. Ensure the backend is running.');
      }
    }
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const path = mode === 'register' ? '/auth/register' : '/auth/login';
      const body = mode === 'register' ? { email, password, name: name || undefined } : { email, password };
      const res = await api.post(path, body);
      loginWithToken(res.data.access_token);
      navigate('/dashboard');
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground bg-dot-grid">
      <PublicHeader cta="back" />

      <div className="flex-1 flex items-center justify-center px-6 py-16">
        <div className="flex flex-col items-center max-w-md w-full">
          <Card className="w-full shadow-2xl">
            <div className="text-center mb-6">
              <h2 className="text-xl font-semibold mb-2">
                {mode === 'login' ? t('login.title') : 'Create your account'}
              </h2>
              <p className="text-muted-foreground text-sm">
                {mode === 'login'
                  ? 'No Google account needed — sign in with email and password.'
                  : 'Takes 10 seconds. No Google account, no credit card.'}
              </p>
            </div>

            <form onSubmit={onSubmit} className="flex flex-col gap-3">
              {mode === 'register' && (
                <Input
                  type="text"
                  placeholder="Name (optional)"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                />
              )}
              <Input
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
              <Input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                minLength={mode === 'register' ? 8 : undefined}
                required
              />
              {error && <p className="text-sm text-destructive text-left">{error}</p>}
              <Button type="submit" size="lg" disabled={submitting} className="w-full mt-1">
                {submitting ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Create account'}
              </Button>
            </form>

            <p className="text-sm text-muted-foreground text-center mt-4">
              {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
              <button
                type="button"
                className="text-foreground font-medium underline underline-offset-2"
                onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(null); }}
              >
                {mode === 'login' ? 'Sign up' : 'Log in'}
              </button>
            </p>

            {googleEnabled && (
              <>
                <div className="flex items-center gap-3 my-5">
                  <div className="h-px flex-1 bg-border" />
                  <span className="text-xs text-muted-foreground">or</span>
                  <div className="h-px flex-1 bg-border" />
                </div>
                <div className="flex justify-center w-full">
                  <GoogleOAuthProvider clientId={import.meta.env.VITE_GOOGLE_CLIENT_ID || ""}>
                    <GoogleLogin
                      onSuccess={onGoogleSuccess}
                      onError={() => setError('Google sign-in failed.')}
                      theme={theme === 'dark' ? 'filled_black' : 'outline'}
                      size="large"
                      text="signin_with"
                      shape="rectangular"
                    />
                  </GoogleOAuthProvider>
                </div>
              </>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
};

export default Login;
