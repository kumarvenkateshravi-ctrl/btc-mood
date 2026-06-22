'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { COMPARE_SYMBOLS } from '@/lib/compare';

interface SymbolSearchProps {
  open: boolean;
  current: string;
  onClose: () => void;
  onSelect: (symbol: string) => void;
}

/**
 * Symbol quick-search command palette. Opens on `/`, fuzzy-filters the tradable
 * symbols, arrow keys + Enter to pick. Sets the pattern for a larger universe.
 */
export default function SymbolSearch({ open, current, onClose, onSelect }: SymbolSearchProps) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      // Focus after paint.
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [open]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return COMPARE_SYMBOLS;
    return COMPARE_SYMBOLS.filter(
      (s) => s.symbol.toLowerCase().includes(q) || s.label.toLowerCase().includes(q),
    );
  }, [query]);

  useEffect(() => {
    if (active >= results.length) setActive(0);
  }, [results, active]);

  if (!open) return null;

  const choose = (symbol: string) => {
    onSelect(symbol);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/50 pt-[18vh] backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-[min(440px,92vw)] overflow-hidden rounded-xl border border-line bg-surface-1 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
          <Search className="h-4 w-4 text-ink-faint" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(results.length - 1, a + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                if (results[active]) choose(results[active].symbol);
              } else if (e.key === 'Escape') {
                onClose();
              }
            }}
            placeholder="Search symbol…"
            className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
          />
          <kbd className="rounded border border-line bg-base px-1.5 py-0.5 font-mono text-[10px] text-ink-faint">
            esc
          </kbd>
        </div>

        <ul className="max-h-[44vh] overflow-auto py-1">
          {results.length === 0 ? (
            <li className="px-3 py-4 text-center text-xs text-ink-faint">No matches.</li>
          ) : (
            results.map((s, i) => (
              <li key={s.symbol}>
                <button
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(s.symbol)}
                  className={[
                    'flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors',
                    i === active ? 'bg-accent/15 text-ink' : 'text-ink-muted hover:bg-surface-2',
                  ].join(' ')}
                >
                  <span className="font-medium">{s.label}</span>
                  <span className="font-mono text-[11px] text-ink-faint">
                    {s.symbol}
                    {s.symbol === current ? ' · current' : ''}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
