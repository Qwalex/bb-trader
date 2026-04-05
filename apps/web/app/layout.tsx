import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { ApiAuthBridge } from './components/ApiAuthBridge';
import { AppNavigation } from './components/AppNavigation';
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
          {session ? <AppNavigation /> : null}
        </header>
        <main className="main">{children}</main>
      </body>
    </html>
  );
}
