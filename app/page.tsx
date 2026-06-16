import Link from 'next/link';
import Header from '@/components/Header';
import BrokerLinks from '@/components/BrokerLinks';
import { getBrokersEnabled } from '@/lib/brokers';
import { Activity, Layers, ShieldCheck, Sparkles } from 'lucide-react';

export default function Home() {
  const brokersEnabled = getBrokersEnabled();

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      {/* Hero */}
      <section className="mx-auto w-full max-w-6xl px-4 pt-16 pb-12 sm:pt-24 sm:pb-20">
        <div className="flex flex-col items-center text-center gap-6">
          <span className="inline-flex items-center gap-2 rounded-full border border-[#1d2940] bg-[#111927] px-3 py-1 text-xs text-slate-300">
            <Sparkles className="h-3.5 w-3.5 text-emerald-300" />
            v1 — multi-timeframe, real-time
          </span>
          <h1 className="max-w-3xl text-4xl sm:text-6xl font-semibold tracking-tight text-[#eaf1f9]">
            Read the <span className="text-emerald-300">mood</span> of Bitcoin
            across every timeframe.
          </h1>
          <p className="max-w-2xl text-base sm:text-lg text-slate-400">
            BTC Market Mood is a fast, opinionated dashboard for BTC/USDT. Six
            timeframes. Candlestick or Heikin Ashi. Clean signals at a glance —
            built for traders who care about what the market is doing, not
            chasing indicators.
          </p>
          <div className="mt-2 flex flex-col sm:flex-row gap-3">
            <Link
              href="/app"
              className="inline-flex items-center justify-center rounded-lg bg-emerald-500 px-6 py-3 text-sm font-semibold text-[#0a0e16] hover:bg-emerald-400 transition"
            >
              Open the dashboard →
            </Link>
            {brokersEnabled && (
              <a
                href="#brokers"
                className="inline-flex items-center justify-center rounded-lg border border-[#1d2940] bg-[#111927] px-6 py-3 text-sm font-semibold text-[#eaf1f9] hover:border-slate-500/50 transition"
              >
                Open a trading account
              </a>
            )}
          </div>
        </div>
      </section>

      {/* What it does */}
      <section className="mx-auto w-full max-w-6xl px-4 pb-16">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Feature
            icon={<Layers className="h-5 w-5 text-emerald-300" />}
            title="Six timeframes"
            body="1m, 5m, 15m, 1h, 4h, 1d — switch with a single click. The strip stays in sync with the main chart."
          />
          <Feature
            icon={<Activity className="h-5 w-5 text-emerald-300" />}
            title="Heikin Ashi on demand"
            body="Toggle Heikin Ashi to smooth the noise and see the underlying trend without losing candle precision."
          />
          <Feature
            icon={<ShieldCheck className="h-5 w-5 text-emerald-300" />}
            title="No geo-blocks"
            body="We proxy Binance from the server, so the dashboard works even where api.binance.com is blocked."
          />
        </div>
      </section>

      {/* Brokers — only when the feature flag is on. */}
      {brokersEnabled && (
        <section id="brokers" className="mx-auto w-full max-w-6xl px-4 pb-20">
          <div className="mb-6">
            <h2 className="text-2xl sm:text-3xl font-semibold text-[#eaf1f9]">
              Open a trading account
            </h2>
            <p className="mt-2 text-sm text-slate-400">
              We may earn a commission if you sign up through these links.
            </p>
          </div>
          <BrokerLinks />
        </section>
      )}

      <footer className="mt-auto border-t border-[#1d2940] bg-[#0a0e16]">
        <div className="mx-auto max-w-6xl px-4 py-6 text-xs text-slate-500">
          © {new Date().getFullYear()} BTC Market Mood. Educational use only —
          not financial advice. Crypto trading carries risk; never trade with
          money you can&apos;t afford to lose.
        </div>
      </footer>
    </div>
  );
}

function Feature({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-xl border border-[#1d2940] bg-[#111927] p-5">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#0a0e16] ring-1 ring-[#1d2940]">
        {icon}
      </div>
      <h3 className="mt-3 text-base font-semibold text-[#eaf1f9]">{title}</h3>
      <p className="mt-1 text-sm text-slate-400">{body}</p>
    </div>
  );
}
