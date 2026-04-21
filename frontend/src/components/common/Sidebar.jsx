import { NavLink as RouterNavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from './ThemeProvider';
import {
  LayoutDashboard, Server, AlertTriangle, FlaskConical,
  Shield, FileText, Settings, LogOut, Sun, Moon, Search
} from 'lucide-react';
import NotificationsBell from './NotificationsBell';

function NavLink({ to, icon: Icon, label, exact = false }) {
  const location = useLocation();
  const active = exact
    ? location.pathname === to
    : (location.pathname.startsWith(to) && to !== '/') || (to === '/' && location.pathname === '/');

  return (
    <RouterNavLink
      to={to}
      aria-current={active ? 'page' : undefined}
      className={`relative flex items-center gap-3 pl-[10px] pr-3 py-2 rounded-md text-sm transition-standard ${
        active
          ? 'bg-accent-weak text-text font-medium'
          : 'text-text-muted hover:bg-surface-elevated hover:text-text'
      }`}
    >
      {active && (
        <span
          aria-hidden="true"
          className="absolute left-0 top-2 bottom-2 w-[2px] rounded-pill bg-accent"
        />
      )}
      <Icon size={16} strokeWidth={1.5} className={active ? 'text-accent' : 'text-text-subtle'} />
      <span className="flex-1">{label}</span>
    </RouterNavLink>
  );
}

export default function Sidebar() {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();

  return (
    <aside
      className="w-60 bg-[var(--material-thin)] backdrop-blur-material backdrop-saturate-material text-text-muted flex flex-col h-full border-r border-hairline"
      role="navigation"
      aria-label="Main navigation"
    >
      <div className="p-4 flex items-center gap-2.5">
        <div className="w-6 h-6 rounded-lg bg-accent flex items-center justify-center">
          <Server size={12} strokeWidth={2} className="text-white" />
        </div>
        <h1 className="text-[13px] font-semibold text-text tracking-tight">AI Health Check</h1>
      </div>

      {/* Cmd+K trigger */}
      <div className="px-3 pb-2">
        <button
          onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text-subtle bg-[var(--material-thick)] rounded-pill shadow-xs hover:text-text transition-standard"
          aria-label="Open command palette"
        >
          <Search size={12} strokeWidth={1.5} />
          <span className="flex-1 text-left">Search...</span>
          <kbd className="text-[10px] font-mono bg-surface px-1 py-0.5 rounded-xs">⌘K</kbd>
        </button>
      </div>

      <nav className="flex-1 px-3 py-2 space-y-0.5 overflow-y-auto">
        <div className="mb-3">
          <p className="px-3 text-[11px] font-medium text-text-subtle tracking-tight mb-1.5">Platform</p>
          <NavLink to="/" icon={LayoutDashboard} label="Dashboard" exact />
          <NavLink to="/services" icon={Server} label="Services" />
          <NavLink to="/evaluations" icon={FlaskConical} label="Evaluations" />
          <NavLink to="/incidents" icon={AlertTriangle} label="Incidents" />
        </div>

        <div>
          <p className="px-3 text-[11px] font-medium text-text-subtle tracking-tight mb-1.5">Administration</p>
          <NavLink to="/governance" icon={Shield} label="Governance" />
          <NavLink to="/data-policy" icon={FileText} label="Data Policy" />
          <NavLink to="/settings" icon={Settings} label="API & Settings" />
        </div>
      </nav>

      <div className="p-3 border-t border-hairline space-y-1">
        <NotificationsBell />

        <button
          onClick={toggle}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text-muted hover:text-text hover:bg-surface-elevated rounded-pill transition-standard"
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
        >
          {theme === 'dark' ? <Sun size={14} strokeWidth={1.5} /> : <Moon size={14} strokeWidth={1.5} />}
          {theme === 'dark' ? 'Light mode' : 'Dark mode'}
        </button>

        <div className="flex items-center gap-2.5 px-3 py-2">
          <div className="w-7 h-7 rounded-full bg-accent-weak flex items-center justify-center text-xs font-medium text-accent">
            {user?.username?.[0]?.toUpperCase() || 'U'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-text truncate">{user?.username}</p>
            <p className="text-[10px] text-text-subtle truncate capitalize">{user?.role}</p>
          </div>
          <button
            onClick={logout}
            className="p-1 text-text-subtle hover:text-status-failing rounded-xs transition-standard"
            aria-label="Sign out"
          >
            <LogOut size={14} strokeWidth={1.5} />
          </button>
        </div>
      </div>
    </aside>
  );
}
