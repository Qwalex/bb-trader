import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import localFont from 'next/font/local';

import { PwaRegister } from './components/PwaRegister';
import { TopNav } from './components/TopNav';
import {
  defaultNavHiddenMenuIds,
} from '../lib/cabinet-nav.util';
import { fetchServerApi } from '../lib/api-base.util';
import { I18nProvider } from '../lib/i18n/client';
import { getServerI18n, getServerLocale } from '../lib/i18n/server';

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

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerI18n();
  return {
    title: 'SignalsBot',
    description: t('meta.description'),
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
}

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
  const cookieStore = await cookies();
  const cabinetId = cookieStore.get('cabinet_id')?.value?.trim() ?? '';
  const authToken = cookieStore.get('sb_auth')?.value?.trim() ?? '';
  let isAdmin = false;
  let hiddenMenuIds: string[] = defaultNavHiddenMenuIds();
  if (authToken) {
    try {
      const authHeaders = {
        Authorization: `Bearer ${authToken}`,
        ...(cabinetId ? { 'x-cabinet-id': cabinetId } : {}),
      };
      const navPath = `/settings/nav-menu${cabinetId ? `?cabinetId=${encodeURIComponent(cabinetId)}` : ''}`;
      const [meRes, navRes] = await Promise.all([
        fetchServerApi('/auth/me', {
          cache: 'no-store',
          headers: authHeaders,
        }),
        fetchServerApi(navPath, {
          cache: 'no-store',
          headers: authHeaders,
        }),
      ]);
      if (meRes.ok) {
        const me = (await meRes.json()) as { role?: string };
        isAdmin = String(me.role ?? '').trim().toLowerCase() === 'admin';
      }
      if (navRes.ok) {
        const navJson = (await navRes.json()) as { hiddenMenuIds?: unknown };
        if (navJson.hiddenMenuIds === null) {
          // настройка не задана — оставляем defaultHidden
        } else if (Array.isArray(navJson.hiddenMenuIds)) {
          hiddenMenuIds = navJson.hiddenMenuIds
            .map((v) => String(v).trim())
            .filter((v) => v.length > 0);
        }
      }
    } catch {
      isAdmin = false;
      hiddenMenuIds = defaultNavHiddenMenuIds();
    }
  }
  const locale = await getServerLocale();
  return (
    <html lang={locale}>
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        <I18nProvider locale={locale}>
          <PwaRegister />
          <TopNav isAdmin={isAdmin} cabinetId={cabinetId} hiddenMenuIds={hiddenMenuIds} />
          <main className="main">{children}</main>
        </I18nProvider>
      </body>
    </html>
  );
}
