import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LanguageProvider } from './context/LanguageContext';
import { ThemeProvider } from './context/ThemeContext';
import Login from './pages/Login';
import Landing from './pages/Landing';
import Terms from './pages/Terms';
import Privacy from './pages/Privacy';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Incorporate from './pages/Incorporate';
import Credentials from './pages/Credentials';
import Admin from './pages/Admin';
import FleetDashboard from './pages/fleet/FleetDashboard';
import ArchitectureStudio from './pages/ArchitectureStudio';
import FilmStudio from './pages/FilmStudio';
import TradingStudio from './pages/TradingStudio';

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { token, isLoading } = useAuth();
  
  if (isLoading) return <div>Loading...</div>;
  if (!token) return <Navigate to="/" replace />;
  
  return <>{children}</>;
};

const AppRoutes = () => {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/admin" element={<Admin />} />
      <Route path="/terms" element={<Terms />} />
      <Route path="/privacy" element={<Privacy />} />
      <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/architecture-studio" element={<ArchitectureStudio />} />
        <Route path="/film-studio" element={<FilmStudio />} />
        <Route path="/trading-studio" element={<TradingStudio />} />
        <Route path="/wizard" element={<Incorporate />} />
        <Route path="/credentials" element={<Credentials />} />
        
        {/* Bihand Deep Linking (Unified Command Cockpit) */}
        <Route path="/fleet/:fleetId/dashboard" element={<FleetDashboard />} />
        <Route path="/fleet/:fleetId/org" element={<FleetDashboard />} />
        <Route path="/fleet/:fleetId/credentials" element={<FleetDashboard />} />
        <Route path="/fleet/:fleetId/goals" element={<FleetDashboard />} />
        <Route path="/fleet/:fleetId/issues" element={<FleetDashboard />} />
        <Route path="/fleet/:fleetId/issues/:issueId" element={<FleetDashboard />} />
        <Route path="/fleet/:fleetId/routines" element={<FleetDashboard />} />
        <Route path="/fleet/:fleetId/support" element={<FleetDashboard />} />
        <Route path="/fleet/:fleetId/inbox" element={<FleetDashboard />} />
        <Route path="/fleet/:fleetId/activity" element={<FleetDashboard />} />
        <Route path="/fleet/:fleetId/costs" element={<FleetDashboard />} />
        <Route path="/fleet/:fleetId/agents" element={<FleetDashboard />} />
        <Route path="/fleet/:fleetId/agents/:instanceId" element={<FleetDashboard />} />
        <Route path="/fleet/:fleetId/agents/:instanceId/settings" element={<FleetDashboard />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};

const App: React.FC = () => {
  return (
    <ThemeProvider>
      <LanguageProvider>
        <AuthProvider>
          <BrowserRouter>
            <AppRoutes />
          </BrowserRouter>
        </AuthProvider>
      </LanguageProvider>
    </ThemeProvider>
  );
};

export default App;
