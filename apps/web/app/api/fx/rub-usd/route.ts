import { NextResponse } from 'next/server';

/** Публичный JSON ЦБ РФ: курс USD к рублю без API-ключа. */
const CBR_DAILY_JSON = 'https://www.cbr-xml-daily.ru/daily_json.js';

function parseCbrNumber(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') return Number(raw.replace(',', '.'));
  return Number.NaN;
}

export async function GET() {
  try {
    const res = await fetch(CBR_DAILY_JSON, {
      next: { revalidate: 3600 },
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      return NextResponse.json({ ok: false as const, error: 'CBR_HTTP' }, { status: 502 });
    }
    const data = (await res.json()) as {
      Date?: string;
      Valute?: { USD?: { Value?: unknown; Nominal?: unknown } };
    };
    const usd = data?.Valute?.USD;
    const value = parseCbrNumber(usd?.Value);
    const nominal = parseCbrNumber(usd?.Nominal);
    const nom = Number.isFinite(nominal) && nominal > 0 ? nominal : 1;
    if (!Number.isFinite(value) || value <= 0) {
      return NextResponse.json({ ok: false as const, error: 'CBR_PARSE' }, { status: 502 });
    }
    const rubPerUsd = value / nom;
    return NextResponse.json({
      ok: true as const,
      rubPerUsd,
      date: String(data?.Date ?? ''),
      source: 'cbr-xml-daily',
    });
  } catch {
    return NextResponse.json({ ok: false as const, error: 'CBR_FETCH' }, { status: 502 });
  }
}
