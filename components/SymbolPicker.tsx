'use client';

import { COMPARE_SYMBOLS, type CompareSymbol } from '@/lib/compare';

interface SymbolPickerProps {
  value: CompareSymbol;
  onChange: (s: CompareSymbol) => void;
}

export default function SymbolPicker({ value, onChange }: SymbolPickerProps) {
  return (
    <div className="inline-flex rounded-lg border border-[#1d2940] bg-[#111927] p-1">
      {COMPARE_SYMBOLS.map((c) => {
        const active = c.symbol === value;
        return (
          <button
            key={c.symbol}
            onClick={() => onChange(c.symbol)}
            className={[
              'rounded-md px-3 py-1.5 text-sm font-medium transition',
              active
                ? 'bg-[#0a0e16] text-[#eaf1f9] ring-1 ring-[#1d2940]'
                : 'text-slate-400 hover:text-[#eaf1f9]',
            ].join(' ')}
          >
            {c.label}
          </button>
        );
      })}
    </div>
  );
}
