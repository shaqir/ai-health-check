import { useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Info } from 'lucide-react';

/**
 * Tooltip — wraps any child and shows a floating bubble on hover/focus.
 * Uses React Portal so it renders above cards with overflow-hidden.
 */
export function Tooltip({ content, children, className = '' }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, below: false });
  const triggerRef = useRef(null);

  const show = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const below = rect.top < 60;
    setPos({
      top: below ? rect.bottom + 8 : rect.top - 8,
      left: rect.left + rect.width / 2,
      below,
    });
    setOpen(true);
  }, []);

  const hide = useCallback(() => setOpen(false), []);

  return (
    <>
      <span
        ref={triggerRef}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        className={`inline-flex items-center ${className}`}
      >
        {children}
      </span>
      {open && createPortal(
        <div
          role="tooltip"
          style={{
            top: pos.top,
            left: pos.left,
            transform: `translate(-50%, ${pos.below ? '0' : '-100%'})`,
          }}
          className="fixed z-[200] px-3 py-2 text-[11px] leading-snug text-text max-w-[320px] w-max bg-[var(--material-thick)] backdrop-blur-material backdrop-saturate-material rounded-md border border-hairline shadow-md pointer-events-none"
        >
          {content}
        </div>,
        document.body,
      )}
    </>
  );
}

/**
 * InfoTip — a small (i) icon with built-in Tooltip.
 * Use inline next to labels when the explanation shouldn't dominate the UI.
 */
export function InfoTip({ content, size = 12, className = '' }) {
  return (
    <Tooltip content={content} className={className}>
      <Info
        size={size}
        strokeWidth={1.75}
        className="text-text-subtle hover:text-text-muted transition-standard cursor-help outline-none"
        tabIndex={0}
        aria-label="More info"
      />
    </Tooltip>
  );
}

export default Tooltip;
