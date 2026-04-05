import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import Link from 'next/link';

import { ApiAuthBridge } from './components/ApiAuthBridge';
import { WorkspaceSwitcher } from './components/WorkspaceSwitcher';
import { PwaRegister } from './components/PwaRegister';
import { readDashboardSession } from '../lib/server-auth';
import { withBasePath } from '../lib/auth';
import { getSupabaseAnonKey, getSupabaseUrl } from '../lib/supabase';

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
  const session = await readDashboardSession();
  const supabaseUrl = getSupabaseUrl();
  const supabaseAnonKey = getSupabaseAnonKey();
  return (
    <html lang="ru">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        <ApiAuthBridge
          supabaseUrl={supabaseUrl}
          supabaseAnonKey={supabaseAnonKey}
        />
        <PwaRegister />
        <header className="nav">
          <strong className="brand">SignalsBot</strong>
          {session ? (
            <nav className="navLinks">
              <WorkspaceSwitcher />
              <Link href="/">Дашборд</Link>
              <Link href="/trades">Сделки</Link>
              <Link href="/logs">Логи</Link>
              <Link href="/ai">AI</Link>
              <Link href="/diagnostics">Диагностика</Link>
              <Link href="/telegram-userbot">Userbot</Link>
              <Link href="/my-group">Моя группа</Link>
              <Link href="/filters">Фильтры</Link>
              <Link href="/settings">Настройки</Link>
              <form action={withBasePath('/auth/logout')} method="post">
                <button
                  type="submit"
                  style={{
                    background: 'transparent',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    color: 'var(--foreground)',
                    cursor: 'pointer',
                    padding: '0.3rem 0.65rem',
                  }}
                >
                  Выйти
                </button>
              </form>
            </nav>
          ) : null}
        </header>
        <main className="main">{children}</main>
      </body>
    </html>
  );
}
