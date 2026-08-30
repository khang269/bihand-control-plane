import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { jwtDecode } from 'jwt-decode';
import api from '../lib/api';

interface User {
  email: string;
  role: string;
  name?: string;
  avatar?: string;
  credits?: number;
}

interface AuthContextType {
  token: string | null;
  user: User | null;
  login: (credential: string) => Promise<void>;
  logout: () => void;
  isLoading: boolean;
  refreshToken: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [token, setToken] = useState<string | null>(localStorage.getItem('mc_token'));
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const parseToken = (t: string) => {
    try {
      const payload = jwtDecode<any>(t);
      setUser({
        email: payload.email,
        role: payload.role || 'user',
        name: payload.name || payload.email.split('@')[0],
        avatar: payload.avatar || `https://ui-avatars.com/api/?name=${payload.name || payload.email}&background=0D8ABC&color=fff`,
      });
    } catch (e) {
      console.error('Failed to parse token', e);
      logout();
    }
  };

  useEffect(() => {
    if (token) {
      parseToken(token);
      refreshToken();

      // Perform daily JWT refresh check
      const todayStr = new Date().toISOString().split('T')[0];
      const lastRefresh = localStorage.getItem('mc_last_refresh_date');
      if (lastRefresh !== todayStr) {
        api.get('/auth/refresh-token')
          .then(res => {
            const freshToken = res.data.access_token;
            if (freshToken) {
              setToken(freshToken);
              localStorage.setItem('mc_token', freshToken);
              localStorage.setItem('mc_last_refresh_date', todayStr);
              parseToken(freshToken);
            }
          })
          .catch(err => {
            console.error('Failed to perform daily token refresh:', err);
          });
      }
    }
    setIsLoading(false);
  }, []);

  const login = async (credential: string) => {
    try {
      const res = await api.post('/auth/token', { google_token: credential });
      const newToken = res.data.access_token;
      setToken(newToken);
      localStorage.setItem('mc_token', newToken);
      const todayStr = new Date().toISOString().split('T')[0];
      localStorage.setItem('mc_last_refresh_date', todayStr);
      parseToken(newToken);
      refreshToken();
    } catch (error) {
      console.error('Login failed', error);
      throw error;
    }
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    localStorage.removeItem('mc_token');
  };

  const refreshToken = async () => {
    try {
      const res = await api.get('/auth/me');
      setUser(prev => prev ? { 
        ...prev, 
        credits: res.data.user?.credits,
        role: res.data.user?.role || prev.role || 'user'
      } : prev);
    } catch (e) {
      console.error('Failed to refresh token data', e);
    }
  };

  return (
    <AuthContext.Provider value={{ token, user, login, logout, isLoading, refreshToken }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
