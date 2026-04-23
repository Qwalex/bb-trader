import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import localFont from 'next/font/local';
import { NAV_MENU_HIDDEN_SETTING_KEY, NAV_MENU_ITEMS } from '@repo/shared';

import { PwaRegister } from './components/PwaRegister';
import { TopNav } from './components/TopNav';

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

function getApiBaseForServer(): string {
  return (
    process.env.API_INTERNAL_URL?.replace(/\/$/, '') ??
    process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '') ??
    'http://api:3001'
  );
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
  const cookieStore = await cookies();
  const cabinetId = cookieStore.get('cabinet_id')?.value?.trim() ?? '';
  const authToken = cookieStore.get('sb_auth')?.value?.trim() ?? '';
  let isAdmin = false;
  let hiddenMenuIds: string[] = NAV_MENU_ITEMS.filter((i) => i.defaultHidden).map((i) => i.id);
  if (authToken) {
    try {
      const res = await fetch(`${getApiBaseForServer()}/auth/me`, {
        cache: 'no-store',
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });
      if (res.ok) {
        const me = (await res.json()) as { role?: string };
        isAdmin = String(me.role ?? '').trim().toLowerCase() === 'admin';
      }
      const settingsRes = await fetch(`${getApiBaseForServer()}/settings/raw`, {
        cache: 'no-store',
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });
      if (settingsRes.ok) {
        const settingsJson = (await settingsRes.json()) as {
          settings?: Array<{ key: string; value: string }>;
        };
        const raw = settingsJson.settings?.find(
          (s) => s.key === NAV_MENU_HIDDEN_SETTING_KEY,
        )?.value;
        if (raw) {
          try {
            const parsed = JSON.parse(raw) as unknown;
            if (Array.isArray(parsed)) {
              hiddenMenuIds = parsed
                .map((v) => String(v).trim())
                .filter((v) => v.length > 0);
            }
          } catch {
            // keep defaults
          }
        }
      }
    } catch {
      isAdmin = false;
    }
  }
  return (
    <html lang="ru">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        <PwaRegister />
        <TopNav isAdmin={isAdmin} cabinetId={cabinetId} hiddenMenuIds={hiddenMenuIds} />
        <main className="main">{children}</main>
      </body>
    </html>
  );
}
