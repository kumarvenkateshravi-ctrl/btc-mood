'use client';

import type { Narration } from '@/lib/narrate';
import type { Signal } from '@/lib/types';

const SIDE_LABEL: Record<Signal['side'], string> = { buy: 'BUY', sell: 'SELL', neutral: 'WAIT' };
const SIDE_GLYPH: Record<Signal['side'], string> = { buy: '▲', sell: '▼', neutral: '•' };
const SIDE_CHIP: Record<Signal['side'], string> = {
  buy: 'text-bull-bright bg-bull/12 ring-bull/30',
  sell: 'text-bear-bright bg-bear/12 ring-bear/30',
  neutral: 'text-neutral bg-neutral/10 ring-neutral/25',
};

interface MoodRationaleProps {
  narration: Narration;
}

export default function MoodRationale({ narration }: MoodRationaleProps) {
  return (
    <section className="panel rounded-2xl p-4">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.2em] text-ink-faint">
          Mood rationale
        </h2>
        <span className="text-[10px] text-ink-faint">why the verdict</span>
      </header>

      {narration.insufficient || narration.factors.length === 0 ? (
        <p className="text-xs text-ink-faint">{narration.summary}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {narration.factors.map((f) => (
            <li key={f.tf} className="flex items-start gap-2.5 py-2 first:pt-0 last:pb-0">
              <span className="mt-0.5 inline-flex items-center gap-1.5">
                <span className="w-7 shrink-0 font-mono text-xs uppercase tracking-wider text-ink-muted">
                  {f.tf}
                </span>
                <span
                  className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold ring-1 ${SIDE_CHIP[f.side]}`}
                >
                  <span aria-hidden>{SIDE_GLYPH[f.side]}</span>
                  {SIDE_LABEL[f.side]}
                </span>
              </span>
              <span className="min-w-0 flex-1 pt-0.5 font-mono text-[11px] leading-relaxed text-ink-muted">
                {f.text}
                {!f.fresh && <span className="ml-1 text-ink-faint">(stale)</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
