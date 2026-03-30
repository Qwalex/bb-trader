import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import Link from 'next/link';

import { PwaRegister } from './components/PwaRegister';

import './globals.css';

const geistSans = localFont({
  src: './fonts/GeistVF.woff',
  variable: '--font-geist-sans',
});
const geistMono = localFont({
  src: './fonts/GeistMonoVF.woff',
  variable: '--font-geist-mono',
});

export const metadata: Metadata = {
  title: 'SignalsBot',
  description: 'Полуавтоматическая торговля по сигналам',
  applicationName: 'SignalsBot',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'SignalsBot',
  },
  icons: {
    icon: [
      { url: '/icons/icons/icon-192x192.png', type: 'image/png', sizes: '192x192' },
      { url: '/icons/icons/icon-512x512.png', type: 'image/png', sizes: '512x512' },
      { url: '/pwa/icon.svg', type: 'image/svg+xml' },
    ],
    apple: [
      { url: '/icons/icons/icon-152x152.png', type: 'image/png', sizes: '152x152' },
      { url: '/icons/icons/icon-192x192.png', type: 'image/png', sizes: '192x192' },
    ],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0f1419',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        <PwaRegister />
        <header className="nav">
          <strong className="brand">SignalsBot</strong>
          <nav className="navLinks">
            <Link href="/">Дашборд</Link>
            <Link href="/trades">Сделки</Link>
            <Link href="/logs">Логи</Link>
            <Link href="/diagnostics">Диагностика</Link>
            <Link href="/telegram-userbot">Userbot</Link>
            <Link href="/filters">Фильтры</Link>
            <Link href="/settings">Настройки</Link>
          </nav>
        </header>
        <main className="main">{children}</main>
      </body>
    </html>
  );
}
