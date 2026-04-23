import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import localFont from 'next/font/local';
import Link from 'next/link';

import { CabinetSwitcher } from './components/CabinetSwitcher';
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
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
      'max-image-preview': 'none',
      'max-snippet': -1,
      'max-video-preview': -1,
    },
  },
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

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cabinetId = (await cookies()).get('cabinet_id')?.value?.trim() ?? '';
  const withCabinet = (path: string): string => {
    if (!cabinetId) return path;
    const hasQuery = path.includes('?');
    return `${path}${hasQuery ? '&' : '?'}cabinetId=${encodeURIComponent(cabinetId)}`;
  };
  return (
    <html lang="ru">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        <PwaRegister />
        <header className="nav">
          <strong className="brand">SignalsBot</strong>
          <CabinetSwitcher />
          <nav className="navLinks">
            <Link href={withCabinet('/')}>Дашборд</Link>
            <Link href={withCabinet('/trades')}>Сделки</Link>
            <Link href={withCabinet('/logs')}>Логи</Link>
            <Link href={withCabinet('/ai')}>AI</Link>
            <Link href={withCabinet('/diagnostics')}>Диагностика</Link>
            <Link href={withCabinet('/telegram-userbot')}>Userbot</Link>
            <Link href={withCabinet('/openrouter-spend')}>Расходы OpenRouter</Link>
            <Link href={withCabinet('/my-group')}>Моя группа</Link>
            <Link href={withCabinet('/filters')}>Фильтры</Link>
            <Link href={withCabinet('/settings')}>Настройки</Link>
          </nav>
        </header>
        <main className="main">{children}</main>
      </body>
    </html>
  );
}
