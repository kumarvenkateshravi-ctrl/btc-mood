'use client';

import { useEffect } from 'react';
import { ArrowDown, ArrowUp, GripVertical } from 'lucide-react';
import { setActiveOrder } from '@/lib/paperStore';
import type { Side } from '@/lib/paper';

interface ChartContextMenuProps {
  /** Price at the click point. */
  price: number;
  /** Screen X position. */
  x: number;
  /** Screen Y position. */
  y: number;
  /** Current chart symbol. */
  symbol: string;
  /** Current mid price for SL suggestion. */
  midPrice: number;
  onClose: () => void;
}

export default function ChartContextMenu({
  price,
  x,
  y,
  symbol,
  midPrice,
  onClose,
}: ChartContextMenuProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    const onClick = () => onClose();
    // Small delay so the right-click that opened it doesn't immediately
    // close it via the same event bubbling.
    const t = setTimeout(() => window.addEventListener('click', onClick), 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener('click', onClick);
    };
  }, [onClose]);

  const stage = (side: Side, type: 'limit' | 'stop') => {
    setActiveOrder({
      id: `ctx_${crypto.randomUUID().slice(0, 12)}`,
      symbol,
      side,
      type,
      units: 0.1,
      entry: price,
      tp: null,
      sl: null,
      reduceOnly: false,
      postOnly: false,
      ocoGroup: null,
    });
    onClose();
  };

  const displayPrice = price.toFixed(1);

  // Constrain to viewport edges so the menu doesn't overflow.
  const maxRight = typeof window !== 'undefined' ? window.innerWidth - 12 : 800;
  const maxBottom = typeof window !== 'undefined' ? window.innerHeight - 12 : 600;
  const left = Math.min(x, maxRight - 180);
  const top = Math.min(y, maxBottom - 140);

  return (
    <div
      role="menu"
      className="fixed z-50 w-[180px] overflow-hidden rounded-xl border border-line bg-surface-1 shadow-2xl backdrop-blur-md"
      style={{
        left,
        top,
        animation: 'mode-fade 120ms var(--ease-quart)',
      }}
    >
      <div className="flex items-center justify-between border-b border-line bg-surface-2/40 px-2.5 py-1.5">
        <GripVertical className="h-3 w-3 text-ink-faint" aria-hidden />
        <span className="font-mono text-[10px] font-medium text-ink-muted">
          ${displayPrice}
        </span>
      </div>

      <div className="p-1">
        <MenuItem
          icon={<ArrowUp className="h-3.5 w-3.5" />}
          label="Buy limit"
          desc={`Limit buy @ ${displayPrice}`}
          onClick={() => stage('buy', 'limit')}
        />
        <MenuItem
          icon={<ArrowDown className="h-3.5 w-3.5" />}
          label="Sell limit"
          desc={`Limit sell @ ${displayPrice}`}
          onClick={() => stage('sell', 'limit')}
        />
        <div className="my-1 border-t border-line" />
        <MenuItem
          icon={<ArrowUp className="h-3.5 w-3.5" />}
          label="Buy stop"
          desc={`Stop buy @ ${displayPrice}`}
          onClick={() => stage('buy', 'stop')}
        />
        <MenuItem
          icon={<ArrowDown className="h-3.5 w-3.5" />}
          label="Sell stop"
          desc={`Stop sell @ ${displayPrice}`}
          onClick={() => stage('sell', 'stop')}
        />
      </div>
    </div>
  );
}

function MenuItem({
  icon,
  label,
  desc,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs transition hover:bg-accent/10"
    >
      <span className="shrink-0 text-ink-muted">{icon}</span>
      <div className="min-w-0">
        <div className="font-medium text-ink">{label}</div>
        <div className="mt-0.5 text-[10px] text-ink-faint">{desc}</div>
      </div>
    </button>
  );
}
