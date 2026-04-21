export default function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="bg-surface rounded-xl border border-hairline shadow-xs py-16 px-6 text-center">
      {Icon && (
        <div className="mx-auto w-12 h-12 rounded-xl bg-surface-elevated flex items-center justify-center mb-4">
          <Icon size={22} strokeWidth={1.5} className="text-text-subtle" />
        </div>
      )}
      <h3 className="text-[15px] font-semibold text-text tracking-tight">{title}</h3>
      {description && <p className="text-[13px] text-text-muted mt-1.5 max-w-md mx-auto">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
