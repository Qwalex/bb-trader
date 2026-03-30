'use client';

import { useEffect } from 'react';

function getBasePath(): string {
  const raw = (process.env.NEXT_PUBLIC_BASE_PATH ?? '').trim();
  if (!raw || raw === '/') return '';
  return raw.startsWith('/') ? raw.replace(/\/+$/, '') : `/${raw.replace(/\/+$/, '')}`;
}

export function PwaRegister() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;

    const basePath = getBasePath();
    const swUrl = `${basePath}/sw.js`;

    const onLoad = () => {
      void navigator.serviceWorker.register(swUrl, { scope: `${basePath}/` }).catch(() => {});
    };

    window.addEventListener('load', onLoad);
    return () => window.removeEventListener('load', onLoad);
  }, []);

  return null;
}

