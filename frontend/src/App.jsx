import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import ServicesPage from './pages/ServicesPage';
import IncidentsPage from './pages/IncidentsPage';
import IncidentDetailPage from './pages/IncidentDetailPage';
import EvaluationsPage from './pages/EvaluationsPage';
import GovernancePage from './pages/GovernancePage';
import DataPolicyPage from './pages/DataPolicyPage';
import SettingsPage from './pages/SettingsPage';
import Sidebar from './components/common/Sidebar';
import CommandPalette from './components/common/CommandPalette';
import { HeaderSlotProvider, useHeaderSlot } from './components/common/HeaderSlotContext';

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-accent"></div>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function AppHeaderBar() {
  const { setNode } = useHeaderSlot();
  return (
    <header className="sticky top-0 z-30 h-16 border-b border-hairline bg-[var(--material-opaque)] backdrop-blur-material backdrop-saturate-material">
      <div className="h-full px-8 max-w-[1240px] mx-auto flex items-center">
        <div ref={setNode} className="w-full" />
      </div>
    </header>
  );
}

function AppLayout({ children }) {
  return (
    <HeaderSlotProvider>
      <div className="flex h-screen bg-bg overflow-hidden">
        <Sidebar />
        <main id="main-content" className="flex-1 overflow-y-auto" role="main">
          <AppHeaderBar />
          <div className="px-8 py-8 max-w-[1240px] mx-auto space-y-8">
            {children}
          </div>
        </main>
        <CommandPalette />
      </div>
    </HeaderSlotProvider>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/*"
        element={
          <ProtectedRoute>
            <AppLayout>
              <Routes>
                <Route path="/" element={<DashboardPage />} />
                <Route path="/services" element={<ServicesPage />} />
                <Route path="/incidents" element={<IncidentsPage />} />
                <Route path="/incidents/:id" element={<IncidentDetailPage />} />
                <Route path="/evaluations" element={<EvaluationsPage />} />
                <Route path="/governance" element={<GovernancePage />} />
                <Route path="/data-policy" element={<DataPolicyPage />} />
                <Route path="/settings" element={<SettingsPage />} />
              </Routes>
            </AppLayout>
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}
