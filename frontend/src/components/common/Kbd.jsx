export default function Kbd({ children }) {
  return (
    <kbd className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-mono font-medium text-text-subtle bg-surface-elevated rounded-xs">
      {children}
    </kbd>
  );
}
