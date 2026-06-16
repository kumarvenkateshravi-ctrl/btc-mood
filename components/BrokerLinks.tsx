import { Bitcoin } from 'lucide-react';
import { getBrokers, type BrokerConfig } from '@/lib/brokers';

export default function BrokerLinks() {
  const brokers = getBrokers();

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      {brokers.map((b) => (
        <BrokerCard key={b.id} broker={b} />
      ))}
    </div>
  );
}

function BrokerCard({ broker }: { broker: BrokerConfig }) {
  const hasUrl = Boolean(broker.url);
  const inner = (
    <>
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#0a0e16] ring-1 ring-[#1d2940]">
          <Bitcoin className="h-5 w-5 text-amber-400" />
        </div>
        <div>
          <h3 className="text-base font-semibold text-[#eaf1f9]">
            {broker.name}
          </h3>
          <p className="text-xs text-slate-400">{broker.pitch}</p>
        </div>
      </div>
      <div
        className={[
          'mt-4 inline-flex items-center text-sm font-medium',
          hasUrl
            ? 'text-emerald-300 group-hover:text-emerald-200'
            : 'text-slate-500',
        ].join(' ')}
      >
        {hasUrl ? 'Open account →' : 'Link coming soon'}
      </div>
    </>
  );

  if (!hasUrl) {
    return (
      <div
        aria-disabled="true"
        className="cursor-not-allowed rounded-xl border border-[#1d2940] bg-[#0d1422] p-5 opacity-60"
      >
        {inner}
      </div>
    );
  }

  return (
    <a
      href={broker.url ?? '#'}
      rel="noopener nofollow sponsored"
      target="_blank"
      className="group rounded-xl border border-[#1d2940] bg-[#111927] p-5 transition hover:border-emerald-500/40 hover:bg-[#0f1626]"
    >
      {inner}
    </a>
  );
}
