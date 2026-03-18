import { Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import ServicesPage from './pages/ServicesPage';
import IncidentsPage from './pages/IncidentsPage';
import GovernancePage from './pages/GovernancePage';
import DataPolicyPage from './pages/DataPolicyPage';
import {
  LayoutDashboard, Server, AlertTriangle, Shield, FileText, LogOut,
} from 'lucide-react';

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="p-8 text-center">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function NavLink({ to, icon: Icon, label }) {
  const location = useLocation();
  const active = location.pathname === to;
  return (
    <Link
      to={to}
      className={`flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm transition-colors ${
        active
          ? 'bg-blue-50 text-blue-700 font-medium'
          : 'text-gray-600 hover:bg-gray-100'
      }`}
    >
      <Icon size={18} />
      {label}
    </Link>
  );
}

function AppLayout({ children }) {
  const { user, logout, isAdmin } = useAuth();

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-gray-200 flex flex-col">
        <div className="p-6 border-b border-gray-100">
          <h1 className="text-lg font-semibold text-gray-900">AIHealthCheck</h1>
          <p className="text-xs text-gray-500 mt-1">Health checks for your AI fleet</p>
        </div>

        <nav className="flex-1 p-4 space-y-1">
          <NavLink to="/" icon={LayoutDashboard} label="Dashboard" />
          <NavLink to="/services" icon={Server} label="Services" />
          <NavLink to="/incidents" icon={AlertTriangle} label="Incidents" />
          <NavLink to="/governance" icon={Shield} label="Governance" />
          <NavLink to="/data-policy" icon={FileText} label="Privacy & Data Policy" />
        </nav>

        <div className="p-4 border-t border-gray-100">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-900">{user?.username}</p>
              <p className="text-xs text-gray-500 capitalize">{user?.role}</p>
            </div>
            <button
              onClick={logout}
              className="p-2 text-gray-400 hover:text-red-500 transition-colors"
              title="Logout"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto p-8">{children}</main>
    </div>
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
                <Route path="/governance" element={<GovernancePage />} />
                <Route path="/data-policy" element={<DataPolicyPage />} />
              </Routes>
            </AppLayout>
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}
