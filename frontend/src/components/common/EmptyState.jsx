export default function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="bg-surface rounded-lg border border-border p-10 text-center">
      {Icon && (
        <div className="mx-auto w-10 h-10 rounded-lg bg-surface-elevated flex items-center justify-center mb-3">
          <Icon size={20} strokeWidth={1.5} className="text-text-subtle" />
        </div>
      )}
      <h3 className="text-sm font-medium text-text">{title}</h3>
      {description && <p className="text-xs text-text-muted mt-1">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
