import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function normalizeBasePath(raw) {
  const t = (raw ?? '').trim();
  if (!t || t === '/') return '';
  const withLeading = t.startsWith('/') ? t : `/${t}`;
  return withLeading.replace(/\/+$/, '');
}

const basePath = normalizeBasePath(process.env.NEXT_BASE_PATH);

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {
    root: path.join(__dirname, '../..'),
  },
  allowedDevOrigins: ['http://localhost:3000'],
  basePath,
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
};

export default nextConfig;
