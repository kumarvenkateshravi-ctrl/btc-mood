'use client';

import { useState } from 'react';
import { Download, Link2, Check } from 'lucide-react';
import { candlesToCsv, copyText, downloadCsv } from '@/lib/csv';
import type { Candle, Timeframe } from '@/lib/types';

interface ExportBarProps {
  tf: Timeframe;
  symbol: string;
  candles: Candle[];
}

export default function ExportBar({ tf, symbol, candles }: ExportBarProps) {
  const [copied, setCopied] = useState(false);

  function onCsv() {
    if (candles.length === 0) return;
    const csv = candlesToCsv(candles);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    downloadCsv(`${symbol.toLowerCase()}_${tf}_${stamp}.csv`, csv);
  }

  async function onCopyLink() {
    const ok = await copyText(window.location.href);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={onCsv}
        disabled={candles.length === 0}
        className="inline-flex items-center gap-1.5 rounded-md border border-[#1d2940] bg-[#111927] px-2.5 py-1.5 text-xs font-medium text-[#eaf1f9] hover:border-slate-500/50 disabled:opacity-50"
      >
        <Download className="h-3.5 w-3.5" />
        CSV
      </button>
      <button
        onClick={onCopyLink}
        className="inline-flex items-center gap-1.5 rounded-md border border-[#1d2940] bg-[#111927] px-2.5 py-1.5 text-xs font-medium text-[#eaf1f9] hover:border-slate-500/50"
      >
        {copied ? (
          <>
            <Check className="h-3.5 w-3.5 text-emerald-300" />
            Copied
          </>
        ) : (
          <>
            <Link2 className="h-3.5 w-3.5" />
            Share
          </>
        )}
      </button>
    </div>
  );
}
