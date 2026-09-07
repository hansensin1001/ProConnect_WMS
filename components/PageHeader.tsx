export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between px-8 py-6 border-b border-line bg-panel">
      <div>
        <h1 className="stencil text-2xl text-ink">{title}</h1>
        {subtitle && <p className="text-sm text-graphite mt-1">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
