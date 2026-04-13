import { NavLink as RouterNavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from './ThemeProvider';
import {
  LayoutDashboard, Server, AlertTriangle, FlaskConical,
  Shield, FileText, Settings, LogOut, Sun, Moon, Search
} from 'lucide-react';

function NavLink({ to, icon: Icon, label, exact = false, shortcut }) {
  const location = useLocation();
  const active = exact
    ? location.pathname === to
    : (location.pathname.startsWith(to) && to !== '/') || (to === '/' && location.pathname === '/');

  return (
    <RouterNavLink
      to={to}
      aria-current={active ? 'page' : undefined}
      className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors duration-150 ${
        active
          ? 'bg-accent-muted text-text font-medium'
          : 'text-text-muted hover:bg-surface-elevated hover:text-text'
      }`}
    >
      <Icon size={16} strokeWidth={1.5} className={active ? 'text-accent' : 'text-text-subtle'} />
      <span className="flex-1">{label}</span>
      {shortcut && (
        <kbd className="hidden lg:inline text-[10px] font-mono text-text-subtle bg-surface-elevated px-1.5 py-0.5 rounded-sm border border-border">
          {shortcut}
        </kbd>
      )}
    </RouterNavLink>
  );
}

export default function Sidebar() {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();

  return (
    <aside className="w-60 bg-surface text-text-muted flex flex-col h-full border-r border-border" role="navigation" aria-label="Main navigation">
      <div className="p-4 flex items-center gap-3 border-b border-border">
        <div className="w-7 h-7 rounded-md bg-accent flex items-center justify-center">
          <Server size={14} strokeWidth={1.5} className="text-white" />
        </div>
        <div>
          <h1 className="text-sm font-semibold text-text tracking-tight">AIHealthCheck</h1>
          <p className="text-[10px] uppercase tracking-wider text-text-subtle font-medium">Control Room</p>
        </div>
      </div>

      {/* Cmd+K trigger */}
      <div className="px-3 pt-3 pb-1">
        <button
          onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text-subtle bg-surface-elevated border border-border rounded-md hover:text-text hover:border-border-strong transition-colors"
          aria-label="Open command palette"
        >
          <Search size={12} strokeWidth={1.5} />
          <span className="flex-1 text-left">Search...</span>
          <kbd className="text-[10px] font-mono bg-surface px-1 py-0.5 rounded-sm border border-border">⌘K</kbd>
        </button>
      </div>

      <nav className="flex-1 px-3 py-2 space-y-0.5 overflow-y-auto">
        <div className="mb-3">
          <p className="px-3 text-[10px] font-semibold text-text-subtle uppercase tracking-wider mb-1.5">Platform</p>
          <NavLink to="/" icon={LayoutDashboard} label="Dashboard" exact shortcut="G D" />
          <NavLink to="/services" icon={Server} label="Services" shortcut="G S" />
          <NavLink to="/evaluations" icon={FlaskConical} label="Evaluations" shortcut="G E" />
          <NavLink to="/incidents" icon={AlertTriangle} label="Incidents" shortcut="G I" />
        </div>

        <div>
          <p className="px-3 text-[10px] font-semibold text-text-subtle uppercase tracking-wider mb-1.5">Administration</p>
          <NavLink to="/governance" icon={Shield} label="Governance" />
          <NavLink to="/data-policy" icon={FileText} label="Data Policy" />
          <NavLink to="/settings" icon={Settings} label="API & Settings" />
        </div>
      </nav>

      <div className="p-3 border-t border-border space-y-2">
        <button
          onClick={toggle}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text-muted hover:text-text hover:bg-surface-elevated rounded-md transition-colors"
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
        >
          {theme === 'dark' ? <Sun size={14} strokeWidth={1.5} /> : <Moon size={14} strokeWidth={1.5} />}
          {theme === 'dark' ? 'Light mode' : 'Dark mode'}
        </button>

        <div className="flex items-center gap-2.5 px-3 py-2 bg-surface-elevated rounded-md border border-border">
          <div className="w-7 h-7 rounded-md bg-accent/20 flex items-center justify-center text-xs font-medium text-accent">
            {user?.username?.[0]?.toUpperCase() || 'U'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-text truncate">{user?.username}</p>
            <p className="text-[10px] text-text-subtle truncate capitalize">{user?.role}</p>
          </div>
          <button
            onClick={logout}
            className="p-1 text-text-subtle hover:text-status-failing rounded-sm transition-colors"
            aria-label="Sign out"
          >
            <LogOut size={14} strokeWidth={1.5} />
          </button>
        </div>
      </div>
    </aside>
  );
}
