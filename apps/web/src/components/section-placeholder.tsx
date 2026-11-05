// Honest empty state for sections that are not built yet. No fake data.
export function SectionPlaceholder({ title, phase }: { title: string; phase: string }) {
  return (
    <div>
      <h1 className="text-lg font-semibold">{title}</h1>
      <div className="mt-4 rounded-lg border border-dashed border-border bg-surface p-10 text-center">
        <p className="text-sm text-muted">This section is not built yet.</p>
        <p className="mt-1 font-mono text-xs text-cyan">Planned: {phase}</p>
      </div>
    </div>
  );
}
