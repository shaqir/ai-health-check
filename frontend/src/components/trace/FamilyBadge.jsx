import {
  Radio, FlaskConical, Siren, BarChart3, ClipboardList, Zap, HelpCircle,
} from 'lucide-react';

// Keep this in sync with backend/app/services/call_families.py.
const FAMILY_VISUAL = {
  connection_test:   { icon: Radio,         tint: 'sky' },
  evaluation:        { icon: FlaskConical,  tint: 'violet' },
  incident_triage:   { icon: Siren,         tint: 'amber' },
  dashboard_insight: { icon: BarChart3,     tint: 'emerald' },
  compliance_report: { icon: ClipboardList, tint: 'slate' },
  other:             { icon: HelpCircle,    tint: 'slate' },
  mixed:             { icon: Zap,           tint: 'slate' },
};

// Tailwind can't construct classes at runtime, so each tint has its own
// full class list. Using the token palette (status-*) would be nicer, but
// those read as healthy/degraded/failing — semantic, not categorical. The
// trace view needs variety, not judgment.
const TINTS = {
  sky:     { bg: 'bg-sky-50 dark:bg-sky-900/30',         text: 'text-sky-700 dark:text-sky-300',         border: 'border-sky-200 dark:border-sky-800' },
  violet:  { bg: 'bg-violet-50 dark:bg-violet-900/30',   text: 'text-violet-700 dark:text-violet-300',   border: 'border-violet-200 dark:border-violet-800' },
  amber:   { bg: 'bg-amber-50 dark:bg-amber-900/30',     text: 'text-amber-700 dark:text-amber-300',     border: 'border-amber-200 dark:border-amber-800' },
  emerald: { bg: 'bg-emerald-50 dark:bg-emerald-900/30', text: 'text-emerald-700 dark:text-emerald-300', border: 'border-emerald-200 dark:border-emerald-800' },
  slate:   { bg: 'bg-slate-100 dark:bg-slate-800/60',    text: 'text-slate-700 dark:text-slate-300',     border: 'border-slate-200 dark:border-slate-700' },
};

export default function FamilyBadge({ family, label, size = 'sm' }) {
  const visual = FAMILY_VISUAL[family] || FAMILY_VISUAL.other;
  const tint = TINTS[visual.tint] || TINTS.slate;
  const Icon = visual.icon;

  const padding = size === 'lg' ? 'px-2.5 py-1' : 'px-2 py-0.5';
  const textSize = size === 'lg' ? 'text-[12px]' : 'text-[11px]';
  const iconSize = size === 'lg' ? 14 : 12;

  return (
    <span
      className={`inline-flex items-center gap-1 font-medium rounded-pill border ${padding} ${textSize} ${tint.bg} ${tint.text} ${tint.border}`}
    >
      <Icon size={iconSize} strokeWidth={1.75} />
      {label || family}
    </span>
  );
}
