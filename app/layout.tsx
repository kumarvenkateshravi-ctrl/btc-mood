import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { Providers } from './providers';
import './globals.css';

// MDS B-ii — UI sans + the numeral/mono face. Geist Mono carries every
// number in the product (see globals.css --num-font, .num, DESIGN.md §B5).
const geistSans = Geist({
  variable: '--font-inter',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'BTC Market Mood — Bitcoin Multi-Timeframe Dashboard',
  description:
    'Read the mood of Bitcoin across every timeframe. A clean, fast BTC/USDT analysis dashboard.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        {/* FOUC guard: apply the persisted MDS theme before first paint on
            EVERY route (pages without a ThemeToggle included). Mirrors
            public/mcs-theme-init.js; inlined so it can't be delayed. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('mcs:theme');if(t&&t!=='obsidian'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}",
          }}
        />
      </head>
      <body className="min-h-screen w-screen font-sans bg-base text-ink">
        {/* Skip-to-content: first focusable element. Visually hidden until
            focused via keyboard — lets AT users bypass nav on every page. */}
        <a href="#main-content" className="skip-to-content">
          Skip to main content
        </a>
        <div className="app-aurora" aria-hidden />
        <div id="main-content" className="relative z-[1] h-full w-full">
          <Providers>{children}</Providers>
        </div>
      </body>
    </html>
  );
}
