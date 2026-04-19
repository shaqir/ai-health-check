import { useId, useRef } from 'react';
import { Calendar, X, ChevronDown } from 'lucide-react';

/**
 * Styled datetime picker. Visually consistent with the app's other
 * form fields; under the hood still a native <input type="datetime-local">
 * so keyboard + mobile behaviour stays platform-correct. The native
 * widget is layered transparently on top of the styled face — clicking
 * anywhere on the field opens the OS picker.
 *
 * Preset chips give one-tap shortcuts for the most common values when
 * logging an incident or scheduling maintenance.
 */

// datetime-local expects `YYYY-MM-DDTHH:mm` in local time (no timezone
// component). Date#toISOString returns UTC, so we pre-shift by the local
// offset before slicing.
function toLocalInputValue(date) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function formatFriendly(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(d);
}

const PRESETS = {
  now: { label: 'Now', compute: () => new Date() },
  plus1h: {
    label: '+1 hour',
    compute: () => { const d = new Date(); d.setHours(d.getHours() + 1); return d; },
  },
  tomorrow9am: {
    label: 'Tomorrow 9 AM',
    compute: () => {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      d.setHours(9, 0, 0, 0);
      return d;
    },
  },
  nextWeek: {
    label: 'Next week',
    compute: () => { const d = new Date(); d.setDate(d.getDate() + 7); return d; },
  },
};

export default function DateTimeField({
  label,
  value,
  onChange,
  required = false,
  placeholder = 'Select a date and time',
  presets = ['now', 'plus1h', 'tomorrow9am'],
  name,
  id,
}) {
  const inputRef = useRef(null);
  const auto = useId();
  const fieldId = id || `dt-${auto}`;
  const hasValue = !!value;

  const applyPreset = (key) => {
    const preset = PRESETS[key];
    if (!preset) return;
    onChange(toLocalInputValue(preset.compute()));
  };

  // Prefer the browser's native showPicker() API for a consistent modal
  // experience. It's the only reliable cross-browser way to programmatically
  // open a date input's OS picker. Falls back to .focus() on older Safari.
  const openPicker = () => {
    const el = inputRef.current;
    if (!el) return;
    try {
      if (typeof el.showPicker === 'function') {
        el.showPicker();
        return;
      }
    } catch {
      // Some browsers throw SecurityError if called outside a user gesture;
      // fall through to focus as a safe default.
    }
    el.focus();
    el.click();
  };

  return (
    <div>
      {label && (
        <label
          htmlFor={fieldId}
          className="block text-[11px] font-medium text-text-muted tracking-tight mb-1.5"
        >
          {label}
        </label>
      )}

      <div className="relative group">
        {/* Styled trigger button — clicking anywhere opens the native picker
            via showPicker(). Falls back to .focus() on browsers that don't
            support it. The native input is kept in the tree (visually hidden
            but accessible) so keyboard users and mobile OS pickers work. */}
        <button
          type="button"
          onClick={openPicker}
          className={`w-full flex items-center gap-2 px-3.5 py-2 text-sm bg-[var(--material-thick)] border border-hairline rounded-md transition-standard cursor-pointer hover:border-hairline-strong hover:bg-surface group-focus-within:border-accent ${
            hasValue ? 'text-text' : 'text-text-subtle'
          }`}
          aria-label={label ? `${label} — click to open date picker` : 'Open date picker'}
        >
          <Calendar size={14} strokeWidth={1.75} className="shrink-0 text-accent" />
          <span className="flex-1 text-left truncate font-mono tabular-nums text-[13px]">
            {hasValue ? formatFriendly(value) : placeholder}
          </span>
          {!hasValue && (
            <ChevronDown size={12} strokeWidth={1.75} className="shrink-0 text-text-subtle group-hover:text-text transition-standard" />
          )}
        </button>

        {/* Native input — visually hidden but focusable, so keyboard users
            get the OS calendar via Tab + Enter, and onChange still fires for
            typed values. */}
        <input
          ref={inputRef}
          id={fieldId}
          name={name}
          type="datetime-local"
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          required={required}
          className="sr-only"
          aria-hidden="true"
          tabIndex={-1}
        />

        {/* Clear button — only visible when a value is set */}
        {hasValue && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onChange('');
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-text-subtle hover:text-text bg-surface-elevated rounded-pill transition-standard"
            aria-label="Clear date"
            title="Clear"
          >
            <X size={12} strokeWidth={1.75} />
          </button>
        )}
      </div>

      {/* Preset chips — quick shortcuts for the most common values */}
      {presets.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {presets.map((key) => {
            const preset = PRESETS[key];
            if (!preset) return null;
            return (
              <button
                key={key}
                type="button"
                onClick={() => applyPreset(key)}
                className="px-2.5 py-0.5 text-[11px] font-medium text-text-muted bg-surface-elevated border border-hairline rounded-pill hover:text-text hover:border-hairline-strong transition-standard"
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
