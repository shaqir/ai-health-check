import { createPortal } from 'react-dom';
import { useHeaderSlot } from './HeaderSlotContext';

export default function PageHeader({ title, description, children }) {
  const { node } = useHeaderSlot();

  const content = (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 w-full">
      <div className="min-w-0">
        <h1 className="text-display-sm font-semibold text-text truncate">{title}</h1>
        {description && <p className="text-[13px] text-text-muted mt-0.5 truncate">{description}</p>}
      </div>
      {children && <div className="flex items-center gap-2 shrink-0">{children}</div>}
    </div>
  );

  if (node) return createPortal(content, node);
  return content;
}
