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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-screen w-screen font-sans bg-base text-ink">
        <div className="app-aurora" aria-hidden />
        <div className="relative z-[1] h-full w-full">
          <Providers>{children}</Providers>
        </div>
      </body>
    </html>
  );
}
