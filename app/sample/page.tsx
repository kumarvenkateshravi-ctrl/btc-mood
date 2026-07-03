'use client';

// EXPERIMENTAL standalone page, recreated from a Figma Make export
// ("Build responsive crypto dashboard.make"). Deliberately self-contained: it
// does NOT use the MDS design system, so the MDS numeral rule is exempted here.
/* eslint-disable no-restricted-properties, @next/next/no-page-custom-font */

import { useState, type ReactNode } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  LayoutGrid,
  BarChart2,
  Wallet,
  WalletMinimal,
  Newspaper,
  Mail,
  Settings,
  LogOut,
  Search,
  Bell,
  ChevronDown,
  TrendingUp,
  TrendingDown,
  MoreVertical,
  CandlestickChart,
  DollarSign,
} from "lucide-react";

// ─── Color palette ────────────────────────────────────────────────────────────
const C = {
  sidebar: "#1b2028",
  card: "#1b2028",
  surface: "#31353f",
  iconBg: "#31353f",
  blue: "#3a6ff8",
  green: "#1ecb4f",
  orange: "#f46d22",
  btcYellow: "#ffc01e",
  ltcCyan: "#64cff9",
  mutedText: "#9e9e9e",
  dimText: "#e4e4e4",
  border: "#31353f",
};

// ─── Chart data generators ────────────────────────────────────────────────────
function genData(points: number, base: number, amp: number) {
  // Deterministic seed so server-render and client-hydration produce identical data.
  let seed = base;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  let v = base;
  return Array.from({ length: points }, (_, i) => {
    v += (rnd() - 0.48) * amp;
    v = Math.max(base * 0.85, Math.min(base * 1.15, v));
    return { t: i, price: Math.round(v) };
  });
}

const chartDataMap: Record<string, { t: number; price: number }[]> = {
  "1h": genData(30, 35000, 400),
  "3h": genData(30, 34500, 700),
  "1d": genData(30, 33000, 1200),
  "1w": genData(30, 30000, 2500),
  "1m": genData(30, 28000, 4000),
};

const timeLabels: Record<string, string[]> = {
  "1h": ["19:00", "19:10", "19:20", "19:30", "19:40", "19:50"],
  "3h": ["17:00", "17:30", "18:00", "18:30", "19:00", "19:30"],
  "1d": ["08:00", "10:00", "12:00", "14:00", "16:00", "18:00"],
  "1w": ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  "1m": ["Wk1", "Wk2", "Wk3", "Wk4", "Wk5", "Wk6"],
};

// ─── Coin sparkline data ──────────────────────────────────────────────────────
const btcSpark = genData(12, 52000, 800);
const ethSpark = genData(12, 28000, 600);
const ltcSpark = genData(12, 8200, 300);
const solSpark = genData(12, 14300, 400);

// ─── Sidebar ─────────────────────────────────────────────────────────────────
type NavItem = { icon: ReactNode; label: string; active?: boolean };

function SidebarNav() {
  const [active, setActive] = useState("Overview");

  const topItems: NavItem[] = [
    { icon: <LayoutGrid size={20} />, label: "Overview" },
    { icon: <BarChart2 size={20} />, label: "Chart" },
    { icon: <Wallet size={20} />, label: "Transactions" },
    { icon: <WalletMinimal size={20} />, label: "Wallet" },
    { icon: <Newspaper size={20} />, label: "News" },
    { icon: <Mail size={20} />, label: "Mail Box" },
  ];

  const bottomItems: NavItem[] = [
    { icon: <Settings size={20} />, label: "Setting" },
    { icon: <LogOut size={20} />, label: "Logout" },
  ];

  const NavRow = ({ item }: { item: NavItem }) => {
    const isActive = active === item.label;
    return (
      <button
        onClick={() => setActive(item.label)}
        className="flex items-center gap-5 w-full px-3 py-2.5 rounded-[10px] transition-all duration-200 group"
        style={{
          background: isActive ? C.blue : "transparent",
          boxShadow: isActive ? "4px 4px 32px 0px rgba(103,90,255,0.07)" : "none",
        }}
      >
        <span
          className="transition-colors duration-200"
          style={{ color: isActive ? "white" : C.mutedText }}
        >
          {item.icon}
        </span>
        <span
          className="text-sm transition-colors duration-200"
          style={{
            color: isActive ? "white" : C.mutedText,
            fontFamily: "Poppins, sans-serif",
            fontWeight: isActive ? 600 : 400,
          }}
        >
          {item.label}
        </span>
      </button>
    );
  };

  return (
    <aside
      className="flex flex-col justify-between py-8 px-5 h-full flex-shrink-0"
      style={{ width: 256, background: C.sidebar }}
    >
      {/* Logo */}
      <div>
        <div className="flex items-center gap-2 px-3 mb-10">
          <svg width="36" height="20" viewBox="0 0 36 20" fill="none">
            <path d="M0 10C0 4.477 4.477 0 10 0h16c5.523 0 10 4.477 10 10s-4.477 10-10 10H10C4.477 20 0 15.523 0 10z" fill={C.blue} />
            <circle cx="10" cy="10" r="4" fill="white" />
          </svg>
          <span
            className="text-white text-xl"
            style={{ fontFamily: "Inter, sans-serif", fontWeight: 700 }}
          >
            Logoipsm
          </span>
        </div>

        <nav className="flex flex-col gap-1">
          {topItems.map((item) => (
            <NavRow key={item.label} item={item} />
          ))}
        </nav>
      </div>

      <nav className="flex flex-col gap-1">
        {bottomItems.map((item) => (
          <NavRow key={item.label} item={item} />
        ))}
      </nav>
    </aside>
  );
}

// ─── Header ───────────────────────────────────────────────────────────────────
function Header() {
  return (
    <header
      className="flex items-center justify-between px-8 py-6 flex-shrink-0"
      style={{ background: C.surface }}
    >
      <h1
        className="text-white text-3xl"
        style={{ fontFamily: "Poppins, sans-serif", fontWeight: 600 }}
      >
        Dashboard
      </h1>

      <div className="flex items-center gap-4">
        {/* Search */}
        <div
          className="flex items-center gap-3 px-4 py-2.5 rounded-lg"
          style={{ background: C.sidebar, width: 320 }}
        >
          <Search size={18} color={C.mutedText} />
          <span
            className="text-sm"
            style={{ color: C.mutedText, fontFamily: "Poppins, sans-serif" }}
          >
            Search...
          </span>
        </div>

        {/* Notification */}
        <button
          className="relative flex items-center justify-center rounded-lg transition-opacity hover:opacity-80"
          style={{ background: C.sidebar, width: 44, height: 44 }}
        >
          <Bell size={20} color={C.mutedText} />
          <span
            className="absolute top-2 right-2 w-2.5 h-2.5 rounded-full border-2 border-white"
            style={{ background: C.orange }}
          />
        </button>

        {/* User */}
        <div className="flex items-center gap-3">
          <div
            className="rounded-[10px] flex-shrink-0"
            style={{ width: 44, height: 44, background: C.mutedText }}
          />
          <span
            className="text-white text-sm"
            style={{ fontFamily: "Poppins, sans-serif", fontWeight: 500 }}
          >
            Courtney Henry
          </span>
          <ChevronDown size={18} color={C.mutedText} />
        </div>
      </div>
    </header>
  );
}

// ─── Coin Sparkline ───────────────────────────────────────────────────────────
function Sparkline({ data, color }: { data: { t: number; price: number }[]; color: string }) {
  return (
    <ResponsiveContainer width="100%" height={46}>
      <AreaChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={`sg-${color.replace("#", "")}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={color} stopOpacity={0.2} />
            <stop offset="95%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area
          type="monotone"
          dataKey="price"
          stroke={color}
          strokeWidth={2}
          fill={`url(#sg-${color.replace("#", "")})`}
          dot={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ─── Coin Card ────────────────────────────────────────────────────────────────
interface CoinCardProps {
  name: string;
  ticker: string;
  price: string;
  change: string;
  positive: boolean;
  iconColor: string;
  iconContent: ReactNode;
  sparkData: { t: number; price: number }[];
  sparkColor: string;
}

function CoinCard({
  name, ticker, price, change, positive,
  iconColor, iconContent, sparkData, sparkColor,
}: CoinCardProps) {
  return (
    <div
      className="rounded-[15px] p-5 flex flex-col gap-3 transition-transform duration-200 hover:-translate-y-1 hover:shadow-xl cursor-pointer"
      style={{ background: C.card, boxShadow: "4px 4px 33px 0px rgba(0,0,0,0.05)" }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className="rounded-[10px] flex items-center justify-center flex-shrink-0"
            style={{ width: 44, height: 44, background: C.iconBg }}
          >
            <span style={{ color: iconColor }}>{iconContent}</span>
          </div>
          <div>
            <div
              className="text-white text-base leading-tight"
              style={{ fontFamily: "Poppins, sans-serif", fontWeight: 600 }}
            >
              {name}
            </div>
            <div
              className="text-xs opacity-60"
              style={{ color: "white", fontFamily: "Poppins, sans-serif" }}
            >
              {ticker}
            </div>
          </div>
        </div>

        <div className="w-28 flex-shrink-0">
          <Sparkline data={sparkData} color={sparkColor} />
        </div>
      </div>

      <div className="flex items-end justify-between">
        <div
          className="text-white text-xl"
          style={{ fontFamily: "Poppins, sans-serif", fontWeight: 600, letterSpacing: "0.42px" }}
        >
          {price}
        </div>
        <div
          className="flex items-center gap-1 text-sm"
          style={{
            color: positive ? C.green : C.orange,
            fontFamily: "Poppins, sans-serif",
            fontWeight: 600,
          }}
        >
          {positive ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
          {change}
        </div>
      </div>
    </div>
  );
}

// ─── Credit Card ���─────────────────────────────────────────────────────────────
function CreditCard() {
  return (
    <div
      className="rounded-[15px] p-6 flex-shrink-0 relative overflow-hidden"
      style={{
        background: C.blue,
        width: "100%",
        minHeight: 180,
      }}
    >
      {/* Decorative circle overlay */}
      <div
        className="absolute -top-8 -right-8 rounded-full opacity-10"
        style={{ width: 160, height: 160, background: "white" }}
      />
      <div
        className="absolute -bottom-12 -right-4 rounded-full opacity-10"
        style={{ width: 120, height: 120, background: "white" }}
      />

      <div className="relative z-10 flex flex-col h-full gap-4">
        <div className="flex items-start justify-between">
          <div>
            <p
              className="text-white text-xs opacity-60 tracking-wide"
              style={{ fontFamily: "Poppins, sans-serif", fontWeight: 500 }}
            >
              Credit Card
            </p>
            {/* Chip */}
            <div
              className="mt-3 rounded-md"
              style={{
                width: 37,
                height: 26,
                background: "linear-gradient(126.9deg, #daaa00 0%, #fff9cf 51%, #f0ca00 100%)",
              }}
            />
          </div>
          <p
            className="text-white text-xl italic font-bold"
            style={{ fontFamily: "Poppins, sans-serif" }}
          >
            VIZA
          </p>
        </div>

        <p
          className="text-white text-base tracking-widest"
          style={{ fontFamily: "Poppins, sans-serif", fontWeight: 600 }}
        >
          3475 7381 3759 4512
        </p>

        <div className="flex items-center justify-between mt-auto">
          <p
            className="text-white text-xs opacity-60 uppercase tracking-widest"
            style={{ fontFamily: "Poppins, sans-serif", fontWeight: 500 }}
          >
            Darrell Steward
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Chart ────────────────────────────────────────────────────────────────────
const TIME_PERIODS = ["1h", "3h", "1d", "1w", "1m"] as const;
type TimePeriod = typeof TIME_PERIODS[number];

function BTCChart() {
  const [period, setPeriod] = useState<TimePeriod>("1h");
  const data = chartDataMap[period];
  const ticks = timeLabels[period];
  const currentPrice = data[data.length - 1]?.price ?? 35352;
  const firstPrice = data[0]?.price ?? 35000;
  const priceDiff = currentPrice - firstPrice;
  const priceUp = priceDiff >= 0;

  return (
    <div
      className="rounded-[15px] p-8 flex flex-col gap-6 flex-1 min-w-0"
      style={{ background: C.card, boxShadow: "4px 4px 33px 0px rgba(0,0,0,0.05)" }}
    >
      {/* Header row */}
      <div className="flex items-start justify-between">
        <div>
          <h2
            className="text-white text-xl"
            style={{ fontFamily: "Poppins, sans-serif", fontWeight: 600 }}
          >
            Chart
          </h2>
          <div className="flex items-center gap-2 mt-1">
            <span
              className="text-sm opacity-60"
              style={{ color: C.dimText, fontFamily: "Poppins, sans-serif" }}
            >
              Bitcoin/BTC
            </span>
            <ChevronDown size={16} color="white" />
          </div>
          <div
            className="text-white text-2xl mt-2"
            style={{ fontFamily: "Poppins, sans-serif", fontWeight: 600 }}
          >
            ${currentPrice.toLocaleString()}.00
          </div>
          <div
            className="text-sm mt-0.5"
            style={{
              color: priceUp ? C.green : C.orange,
              fontFamily: "Poppins, sans-serif",
              fontWeight: 600,
            }}
          >
            {priceUp ? "+" : ""}{((priceDiff / firstPrice) * 100).toFixed(2)}%
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-3">
          {/* Candle button */}
          <button
            className="flex items-center justify-center rounded-[5px] transition-opacity hover:opacity-80"
            style={{
              border: `1px solid ${C.border}`,
              padding: 7,
              color: C.mutedText,
            }}
          >
            <CandlestickChart size={18} />
          </button>

          {/* USD button */}
          <button
            className="flex items-center gap-2 rounded-[5px] px-2 py-1 transition-opacity hover:opacity-80"
            style={{ border: `1px solid ${C.border}` }}
          >
            <DollarSign size={16} color={C.btcYellow} />
            <span
              className="text-xs opacity-60"
              style={{ color: C.dimText, fontFamily: "Poppins, sans-serif", fontWeight: 600 }}
            >
              USD
            </span>
            <ChevronDown size={16} color="white" />
          </button>

          {/* Time period tabs */}
          <div className="flex items-center gap-2">
            {TIME_PERIODS.map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className="px-3 py-0.5 rounded-[15px] text-[10px] transition-all duration-200"
                style={{
                  background: period === p ? C.blue : "transparent",
                  border: period === p ? "none" : `1px solid ${C.border}`,
                  color: period === p ? "white" : C.mutedText,
                  fontFamily: "Poppins, sans-serif",
                  fontWeight: 500,
                  lineHeight: "22px",
                }}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Chart area */}
      <div className="flex gap-4">
        {/* Y-axis labels */}
        <div
          className="flex flex-col justify-between text-xs pb-6"
          style={{ color: C.mutedText, fontFamily: "Poppins, sans-serif", minWidth: 56 }}
        >
          {["50.000", "40.000", "30.000", "20.000", "10.000"].map((v) => (
            <span key={v}>{v}</span>
          ))}
        </div>

        <div className="flex-1 min-w-0">
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="btcGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={C.blue} stopOpacity={0.15} />
                  <stop offset="95%" stopColor={C.blue} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <XAxis dataKey="t" hide />
              <YAxis hide domain={["auto", "auto"]} />
              <Tooltip
                contentStyle={{
                  background: C.sidebar,
                  border: `1px solid ${C.border}`,
                  borderRadius: 8,
                  color: "white",
                  fontSize: 12,
                  fontFamily: "Poppins, sans-serif",
                }}
                formatter={(val) => [`$${Number(val).toLocaleString()}`, "BTC"]}
                labelFormatter={() => ""}
              />
              <Area
                type="monotone"
                dataKey="price"
                stroke={C.blue}
                strokeWidth={2}
                fill="url(#btcGrad)"
                dot={false}
                activeDot={{ r: 5, fill: C.blue, stroke: "white", strokeWidth: 2 }}
              />
            </AreaChart>
          </ResponsiveContainer>

          {/* X-axis */}
          <div
            className="flex justify-between mt-2 text-xs"
            style={{ color: C.mutedText, fontFamily: "Poppins, sans-serif" }}
          >
            {ticks.map((t) => (
              <span key={t}>{t}</span>
            ))}
          </div>

          {/* Volume bars */}
          <div className="flex items-end gap-1 mt-4 opacity-10" style={{ height: 32 }}>
            {data.slice(0, 24).map((_, i) => {
              const heights = [16, 22, 32, 17, 10, 13, 24, 14, 8, 16, 22, 32];
              const h = heights[i % heights.length];
              return (
                <div
                  key={i}
                  className="flex-1 rounded-sm"
                  style={{ height: h, background: C.blue }}
                />
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── My Portfolio ───────────────────────────���─────────────────────────────────
interface PortfolioAsset {
  name: string;
  ticker: string;
  amount: string;
  value: string;
  change: string;
  positive: boolean;
  iconColor: string;
  icon: ReactNode;
}

const portfolioAssets: PortfolioAsset[] = [
  {
    name: "Ethereum", ticker: "ETH", amount: "0.12543 ETH", value: "$3,245.03",
    change: "-13.40%", positive: false, iconColor: C.blue,
    icon: <EthIcon />,
  },
  {
    name: "Bitcoin", ticker: "BTC", amount: "0.12543 BTC", value: "$3,245.03",
    change: "-6.00%", positive: false, iconColor: C.btcYellow,
    icon: <BtcIcon />,
  },
  {
    name: "Litecoin", ticker: "LTC", amount: "0.12543 ITC", value: "$3,245.03",
    change: "+14.25%", positive: true, iconColor: C.ltcCyan,
    icon: <LtcIcon />,
  },
  {
    name: "Solana", ticker: "SOL", amount: "0.12543 SOL", value: "$3,245.03",
    change: "-2.00%", positive: false, iconColor: C.green,
    icon: <SolIcon />,
  },
  {
    name: "Binance Coin", ticker: "BNB", amount: "0.12543 BNB", value: "$3,245.03",
    change: "+12.00%", positive: true, iconColor: C.btcYellow,
    icon: <BnbIcon />,
  },
];

function MyPortfolio() {
  return (
    <div
      className="rounded-[15px] p-8 flex flex-col gap-5"
      style={{
        background: C.card,
        boxShadow: "4px 4px 33px 0px rgba(0,0,0,0.05)",
        width: 360,
        flexShrink: 0,
      }}
    >
      <h2
        className="text-[#e4e4e4] text-xl tracking-wide"
        style={{ fontFamily: "Poppins, sans-serif", fontWeight: 600 }}
      >
        My Portfolio
      </h2>

      <div className="flex flex-col gap-4">
        {portfolioAssets.map((asset) => (
          <div
            key={asset.name}
            className="flex items-center justify-between px-3 py-2.5 rounded-xl transition-all duration-200 cursor-pointer hover:scale-[1.02]"
            style={{ background: "transparent" }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLDivElement).style.background = C.surface;
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLDivElement).style.background = "transparent";
            }}
          >
            <div className="flex items-center gap-3">
              <div
                className="rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ width: 44, height: 44, background: C.iconBg }}
              >
                <span style={{ color: asset.iconColor }}>{asset.icon}</span>
              </div>
              <div>
                <div
                  className="text-white text-base"
                  style={{ fontFamily: "Poppins, sans-serif", fontWeight: 500 }}
                >
                  {asset.name}
                </div>
                <div
                  className="text-sm opacity-60"
                  style={{ color: "white", fontFamily: "Poppins, sans-serif" }}
                >
                  {asset.value}
                </div>
              </div>
            </div>

            <div className="text-right">
              <div
                className="text-sm"
                style={{
                  color: asset.positive ? C.green : C.orange,
                  fontFamily: "Poppins, sans-serif",
                  fontWeight: 500,
                }}
              >
                {asset.change}
              </div>
              <div
                className="text-white text-sm"
                style={{ fontFamily: "Poppins, sans-serif", fontWeight: 600 }}
              >
                {asset.amount}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Live Market ──────────────────────────────────────────────────────────────
interface MarketRow {
  name: string;
  change: string;
  positive: boolean;
  marketCap: string;
  volume: string;
  price: string;
  iconColor: string;
  icon: ReactNode;
}

const marketRows: MarketRow[] = [
  {
    name: "Bitcoin", change: "+12.00%", positive: true,
    marketCap: "$3.560M", volume: "$65.20M", price: "$48,032.32",
    iconColor: C.btcYellow, icon: <BtcIcon size={20} />,
  },
  {
    name: "Ethereum", change: "+5.30%", positive: true,
    marketCap: "$2.100M", volume: "$41.80M", price: "$3,245.12",
    iconColor: C.blue, icon: <EthIcon size={20} />,
  },
  {
    name: "Litecoin", change: "-3.15%", positive: false,
    marketCap: "$0.820M", volume: "$9.40M", price: "$183.55",
    iconColor: C.ltcCyan, icon: <LtcIcon size={20} />,
  },
  {
    name: "Solana", change: "+8.70%", positive: true,
    marketCap: "$1.240M", volume: "$22.60M", price: "$142.80",
    iconColor: C.green, icon: <SolIcon size={20} />,
  },
  {
    name: "Binance Coin", change: "-1.90%", positive: false,
    marketCap: "$0.960M", volume: "$18.20M", price: "$320.44",
    iconColor: C.btcYellow, icon: <BnbIcon size={20} />,
  },
];

function LiveMarket() {
  return (
    <div
      className="rounded-[15px] p-8 flex flex-col gap-5"
      style={{ background: C.card, boxShadow: "4px 4px 33px 0px rgba(0,0,0,0.05)" }}
    >
      <div className="flex items-center justify-between">
        <h2
          className="text-white text-xl"
          style={{ fontFamily: "Poppins, sans-serif", fontWeight: 600 }}
        >
          Live Market
        </h2>
        <button
          className="px-3 py-1 rounded-[5px] text-xs opacity-60 transition-opacity hover:opacity-100"
          style={{
            border: `1px solid ${C.border}`,
            color: C.dimText,
            fontFamily: "Poppins, sans-serif",
            fontWeight: 600,
          }}
        >
          View More
        </button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr>
              {["Coin", "Change", "Market Cap", "24h Volume", "Price", ""].map((h) => (
                <th
                  key={h}
                  className="text-left pb-3 text-xs font-normal"
                  style={{ color: C.mutedText, fontFamily: "Poppins, sans-serif" }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {marketRows.map((row) => (
              <tr
                key={row.name}
                className="transition-colors duration-150 cursor-pointer rounded-xl"
                style={{ borderRadius: 12 }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLTableRowElement).style.background = C.surface;
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLTableRowElement).style.background = "transparent";
                }}
              >
                <td className="py-3 pr-4 rounded-l-xl">
                  <div className="flex items-center gap-3">
                    <div
                      className="rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ width: 36, height: 36, background: C.iconBg }}
                    >
                      <span style={{ color: row.iconColor }}>{row.icon}</span>
                    </div>
                    <span
                      className="text-sm opacity-80"
                      style={{ color: "white", fontFamily: "Poppins, sans-serif", fontWeight: 500 }}
                    >
                      {row.name}
                    </span>
                  </div>
                </td>
                <td className="py-3 pr-4">
                  <span
                    className="text-sm font-medium opacity-80"
                    style={{
                      color: row.positive ? C.green : C.orange,
                      fontFamily: "Poppins, sans-serif",
                    }}
                  >
                    {row.change}
                  </span>
                </td>
                <td className="py-3 pr-4">
                  <span
                    className="text-sm opacity-80"
                    style={{ color: "white", fontFamily: "Poppins, sans-serif" }}
                  >
                    {row.marketCap}
                  </span>
                </td>
                <td className="py-3 pr-4">
                  <span
                    className="text-sm opacity-80"
                    style={{ color: "white", fontFamily: "Poppins, sans-serif" }}
                  >
                    {row.volume}
                  </span>
                </td>
                <td className="py-3 pr-4">
                  <span
                    className="text-sm opacity-80"
                    style={{ color: "white", fontFamily: "Poppins, sans-serif" }}
                  >
                    {row.price}
                  </span>
                </td>
                <td className="py-3 rounded-r-xl">
                  <button className="opacity-40 hover:opacity-100 transition-opacity rotate-90">
                    <MoreVertical size={18} color="white" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Coin SVG Icons ────────────────────────���──────────────────────────────────
function BtcIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M23.638 14.904c-1.602 6.43-8.113 10.34-14.542 8.736C2.67 22.05-1.244 15.525.362 9.105 1.962 2.67 8.475-1.243 14.9.358c6.43 1.605 10.342 8.115 8.738 14.548v-.002zm-6.35-4.613c.24-1.59-.974-2.45-2.64-3.03l.54-2.153-1.315-.33-.525 2.107c-.345-.087-.705-.167-1.064-.25l.526-2.127-1.32-.33-.54 2.165c-.285-.067-.565-.132-.84-.2l-1.815-.45-.35 1.407s.975.225.955.236c.535.136.63.486.615.766l-1.477 5.92c-.075.166-.24.406-.614.314.015.02-.96-.24-.96-.24l-.66 1.51 1.71.426.93.242-.54 2.19 1.32.327.54-2.17c.36.1.705.19 1.05.273l-.51 2.154 1.32.33.545-2.19c2.24.427 3.93.257 4.64-1.774.57-1.637-.03-2.58-1.217-3.196.854-.193 1.5-.76 1.68-1.93h.01zm-3.01 4.22c-.404 1.64-3.157.75-4.05.53l.72-2.9c.896.23 3.757.67 3.33 2.37zm.41-4.24c-.37 1.49-2.662.735-3.405.55l.654-2.64c.744.18 3.137.524 2.75 2.084v.006z" />
    </svg>
  );
}

function EthIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M11.944 17.97L4.58 13.62 11.943 24l7.37-10.38-7.372 4.35h.003zM12.056 0L4.69 12.223l7.365 4.354 7.365-4.35L12.056 0z" />
    </svg>
  );
}

function LtcIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm-.73 5.5h2.46L12.56 10.7l1.44-.43-.4 1.53-1.44.43-1.34 5.27H17v2H8.5l1.8-7.1-1.44.43.4-1.53 1.44-.43L11.27 5.5z" />
    </svg>
  );
}

function SolIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M4.18 16.48a.6.6 0 01.43-.18h15.04c.27 0 .4.33.21.51l-2.98 2.97a.6.6 0 01-.43.18H1.41a.3.3 0 01-.21-.51l2.98-2.97zm0-9.96a.6.6 0 01.43-.18h15.04c.27 0 .4.33.21.51l-2.98 2.97a.6.6 0 01-.43.18H1.41a.3.3 0 01-.21-.51l2.98-2.97zm15.26 5.04a.6.6 0 00-.43-.18H4.05a.3.3 0 00-.21.51l2.98 2.97a.6.6 0 00.43.18h15.04a.3.3 0 00.21-.51l-2.98-2.97z" />
    </svg>
  );
}

function BnbIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0L8.57 3.43 12 6.86l3.43-3.43L12 0zm-5.14 5.14L3.43 8.57 6.86 12l3.43-3.43-3.43-3.43zm10.28 0l-3.43 3.43L17.14 12l3.43-3.43-3.43-3.43zM12 8.57L8.57 12 12 15.43 15.43 12 12 8.57zm-5.14 5.14L3.43 17.14 6.86 20.57l3.43-3.43-3.43-3.43zm10.28 0l-3.43 3.43 3.43 3.43 3.43-3.43-3.43-3.43zM12 17.14L8.57 20.57 12 24l3.43-3.43L12 17.14z" />
    </svg>
  );
}

// ──��� App ──────────────────────────────────────────────────────────────────────
export default function SampleDashboard() {
  return (
    <div className="flex min-h-screen" style={{ background: C.surface, fontFamily: "Poppins, sans-serif" }}>
      {/* Web fonts (the Figma export specifies Poppins + Inter) */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet" />
      {/* Sidebar */}
      <SidebarNav />

      {/* Main */}
      <div className="flex flex-col flex-1 min-w-0 overflow-auto">
        <Header />

        <main className="flex-1 p-8 flex flex-col gap-6 overflow-auto">
          {/* Row 1: Coin cards + Credit card */}
          <div className="grid gap-5" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
            <CoinCard
              name="Bitcoin" ticker="BTC" price="$52,291" change="+0.25%"
              positive iconColor={C.btcYellow} iconContent={<BtcIcon />}
              sparkData={btcSpark} sparkColor={C.btcYellow}
            />
            <CoinCard
              name="Ethereum" ticker="ETH" price="$28,291" change="+0.25%"
              positive iconColor={C.blue} iconContent={<EthIcon />}
              sparkData={ethSpark} sparkColor={C.blue}
            />
            <CoinCard
              name="Litecoin" ticker="LTC" price="$8,291" change="+0.25%"
              positive iconColor={C.ltcCyan} iconContent={<LtcIcon />}
              sparkData={ltcSpark} sparkColor={C.ltcCyan}
            />
            <CoinCard
              name="Solana" ticker="SOL" price="$14,291" change="-0.25%"
              positive={false} iconColor={C.green} iconContent={<SolIcon />}
              sparkData={solSpark} sparkColor={C.green}
            />
          </div>

          {/* Row 2: Chart + Portfolio */}
          <div className="flex gap-5 items-start">
            <BTCChart />
            <div className="flex flex-col gap-5">
              <CreditCard />
              <MyPortfolio />
            </div>
          </div>

          {/* Row 3: Live Market */}
          <LiveMarket />
        </main>
      </div>
    </div>
  );
}
