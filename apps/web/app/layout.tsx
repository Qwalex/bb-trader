import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import Link from 'next/link';

import { PwaRegister } from './components/PwaRegister';

import './globals.css';

function normalizeBasePath(raw: string | undefined): string {
  const t = (raw ?? '').trim();
  if (!t || t === '/') return '';
  return (t.startsWith('/') ? t : `/${t}`).replace(/\/+$/, '');
}

const basePath = normalizeBasePath(process.env.NEXT_PUBLIC_BASE_PATH);
function withBasePath(url: string): string {
  if (!url.startsWith('/')) return url;
  return `${basePath}${url}`;
}

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
  manifest: withBasePath('/manifest.webmanifest'),
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'SignalsBot',
  },
  icons: {
    icon: [
      {
        url: withBasePath('/icons/icons/icon-192x192.png'),
        type: 'image/png',
        sizes: '192x192',
      },
      {
        url: withBasePath('/icons/icons/icon-512x512.png'),
        type: 'image/png',
        sizes: '512x512',
      },
    ],
    apple: [
      {
        url: withBasePath('/icons/icons/icon-152x152.png'),
        type: 'image/png',
        sizes: '152x152',
      },
      {
        url: withBasePath('/icons/icons/icon-192x192.png'),
        type: 'image/png',
        sizes: '192x192',
      },
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
          <strong className="brand">SignalsBot Dev</strong>
          <nav className="navLinks">
            <Link href="/">Дашборд</Link>
            <Link href="/trades">Сделки</Link>
            <Link href="/logs">Логи</Link>
            <Link href="/ai">AI</Link>
            <Link href="/diagnostics">Диагностика</Link>
            <Link href="/telegram-userbot">Userbot</Link>
            <Link href="/my-group">Моя группа</Link>
            <Link href="/filters">Фильтры</Link>
            <Link href="/settings">Настройки</Link>
          </nav>
        </header>
        <main className="main">{children}</main>
      </body>
    </html>
  );
}
