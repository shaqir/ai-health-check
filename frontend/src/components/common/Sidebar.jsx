import { NavLink as RouterNavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { 
  LayoutDashboard, Server, AlertTriangle, 
  Shield, FileText, LogOut 
} from 'lucide-react';

function NavLink({ to, icon: Icon, label, exact = false }) {
  const location = useLocation();
  const active = exact ? location.pathname === to : location.pathname.startsWith(to) && to !== '/' || (to === '/' && location.pathname === '/');
  
  return (
    <RouterNavLink
      to={to}
      className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-all duration-200 ${
        active
          ? 'bg-slate-800 text-white font-medium shadow-sm'
          : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
      }`}
    >
      <Icon size={18} className={active ? 'text-blue-400' : 'text-slate-500'} />
      {label}
    </RouterNavLink>
  );
}

export default function Sidebar() {
  const { user, logout } = useAuth();

  return (
    <aside className="w-64 bg-[#0B1120] text-slate-300 flex flex-col h-full border-r border-slate-800">
      <div className="p-5 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
          <Server size={18} className="text-white" />
        </div>
        <div>
          <h1 className="text-base font-semibold text-white tracking-tight">AIHealthCheck</h1>
          <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mt-0.5">Control Room</p>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        <div className="mb-4">
          <p className="px-3 text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Platform</p>
          <NavLink to="/" icon={LayoutDashboard} label="Dashboard" exact />
          <NavLink to="/services" icon={Server} label="Services Registry" />
          <NavLink to="/incidents" icon={AlertTriangle} label="Incidents" />
        </div>
        
        <div>
          <p className="px-3 text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Administration</p>
          <NavLink to="/governance" icon={Shield} label="Governance" />
          <NavLink to="/data-policy" icon={FileText} label="Data Policy" />
        </div>
      </nav>

      <div className="p-4 border-t border-slate-800/50 mt-auto">
        <div className="flex items-center gap-3 bg-slate-800/30 p-3 rounded-lg border border-slate-700/50">
          <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-sm font-medium text-white shadow-inner">
            {user?.username?.[0]?.toUpperCase() || 'U'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-slate-200 truncate">{user?.username}</p>
            <p className="text-xs text-slate-500 truncate capitalize">{user?.role}</p>
          </div>
          <button
            onClick={logout}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded-md transition-colors"
            title="Sign out"
          >
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </aside>
  );
}
