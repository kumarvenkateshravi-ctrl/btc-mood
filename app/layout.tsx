import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { Providers } from './providers';
import './globals.css';

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
});

const jetbrains = JetBrains_Mono({
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
      className={`${inter.variable} ${jetbrains.variable} h-full antialiased`}
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
