import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, LayoutDashboard, Server, AlertTriangle, FlaskConical, Shield, FileText, Settings, ArrowRight } from 'lucide-react';

const ROUTES = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard, shortcut: 'G D', section: 'Navigate' },
  { path: '/services', label: 'Services', icon: Server, shortcut: 'G S', section: 'Navigate' },
  { path: '/evaluations', label: 'Evaluations', icon: FlaskConical, shortcut: 'G E', section: 'Navigate' },
  { path: '/incidents', label: 'Incidents', icon: AlertTriangle, shortcut: 'G I', section: 'Navigate' },
  { path: '/governance', label: 'Governance', icon: Shield, section: 'Navigate' },
  { path: '/data-policy', label: 'Data Policy', icon: FileText, section: 'Navigate' },
  { path: '/settings', label: 'API & Settings', icon: Settings, section: 'Navigate' },
];

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef(null);
  const navigate = useNavigate();

  const filtered = query
    ? ROUTES.filter(r => r.label.toLowerCase().includes(query.toLowerCase()))
    : ROUTES;

  const go = useCallback((path) => {
    setOpen(false);
    setQuery('');
    setSelected(0);
    navigate(path);
  }, [navigate]);

  // Global keyboard listener
  useEffect(() => {
    let gPressed = false;
    let gTimeout;

    const handler = (e) => {
      // ⌘K or Ctrl+K to open
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(prev => !prev);
        return;
      }

      // ? to show shortcuts (when not in input)
      if (e.key === '?' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) {
        e.preventDefault();
        setOpen(true);
        return;
      }

      // Escape to close
      if (e.key === 'Escape' && open) {
        setOpen(false);
        setQuery('');
        return;
      }

      // G + key shortcuts (when not in input)
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;

      if (e.key === 'g' || e.key === 'G') {
        if (!gPressed) {
          gPressed = true;
          gTimeout = setTimeout(() => { gPressed = false; }, 500);
          return;
        }
      }

      if (gPressed) {
        gPressed = false;
        clearTimeout(gTimeout);
        const map = { d: '/', s: '/services', i: '/incidents', e: '/evaluations' };
        const path = map[e.key.toLowerCase()];
        if (path) {
          e.preventDefault();
          go(path);
        }
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, go]);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setSelected(0);
    }
  }, [open]);

  // Arrow key navigation inside palette
  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected(prev => Math.min(prev + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' && filtered[selected]) {
      go(filtered[selected].path);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[18vh] bg-[color-mix(in_oklab,black_40%,transparent)] backdrop-blur-sm"
      onClick={() => { setOpen(false); setQuery(''); }}
      role="presentation"
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-hairline bg-[var(--material-thick)] backdrop-blur-material backdrop-saturate-material shadow-lg overflow-hidden"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-hairline">
          <Search size={16} strokeWidth={1.5} className="text-text-subtle shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => { setQuery(e.target.value); setSelected(0); }}
            onKeyDown={handleKeyDown}
            placeholder="Type a command or search..."
            className="flex-1 text-[15px] bg-transparent text-text placeholder-text-subtle outline-none"
            aria-label="Search commands"
          />
          <kbd className="text-[10px] font-mono text-text-subtle bg-surface-elevated px-1.5 py-0.5 rounded-xs">
            esc
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-72 overflow-y-auto p-1.5" role="listbox">
          {filtered.length === 0 ? (
            <p className="px-4 py-6 text-sm text-text-subtle text-center">No results</p>
          ) : (
            filtered.map((item, i) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.path}
                  role="option"
                  aria-selected={i === selected}
                  onClick={() => go(item.path)}
                  onMouseEnter={() => setSelected(i)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-left transition-standard ${
                    i === selected ? 'bg-accent-weak shadow-xs' : ''
                  }`}
                >
                  <Icon size={15} strokeWidth={1.5} className={i === selected ? 'text-accent' : 'text-text-subtle'} />
                  <span className={`flex-1 text-sm ${i === selected ? 'text-text font-medium' : 'text-text-muted'}`}>
                    {item.label}
                  </span>
                  {item.shortcut && (
                    <kbd className="text-[10px] font-mono text-text-subtle bg-surface-elevated px-1.5 py-0.5 rounded-xs">
                      {item.shortcut}
                    </kbd>
                  )}
                  {i === selected && <ArrowRight size={12} strokeWidth={1.5} className="text-accent" />}
                </button>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 border-t border-hairline flex items-center gap-4 text-[10px] text-text-subtle">
          <span><kbd className="font-mono bg-surface-elevated px-1 py-0.5 rounded-xs">↑↓</kbd> navigate</span>
          <span><kbd className="font-mono bg-surface-elevated px-1 py-0.5 rounded-xs">↵</kbd> open</span>
          <span><kbd className="font-mono bg-surface-elevated px-1 py-0.5 rounded-xs">esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
