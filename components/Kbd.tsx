export default function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-line bg-surface-1 px-1.5 py-0.5 font-mono text-ink-muted">
      {children}
    </kbd>
  );
}
