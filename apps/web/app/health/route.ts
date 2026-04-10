import { NextResponse } from 'next/server';

/** Публичный health для Railway/Docker; учитывает basePath из next.config (если задан). */
export function GET() {
  return NextResponse.json({ status: 'ok', service: 'signals-bot-web' });
}
