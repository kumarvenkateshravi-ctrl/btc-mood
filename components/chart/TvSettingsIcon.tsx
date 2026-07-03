/** TradingView-style settings gear icon (lucide doesn't ship one matching TV). */
export function TvSettingsIcon({ size = 16, strokeWidth = 1.5, className = '' }: { size?: number, strokeWidth?: number, className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M7.5 3h9l4.5 9-4.5 9h-9L3 12z" />
      <circle cx="12" cy="12" r="2.5" />
    </svg>
  );
}
