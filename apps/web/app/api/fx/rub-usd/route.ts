import { NextResponse } from 'next/server';

/** Публичный JSON (зеркало структуры daily_json.js). На части хостингов недоступен из-за сети/DNS. */
const CBR_DAILY_JSON = 'https://www.cbr-xml-daily.ru/daily_json.js';
/** Официальная выгрузка ЦБ РФ — чаще открывается с Railway и других облаков. */
const CBR_XML_DAILY = 'https://www.cbr.ru/scripts/XML_daily.asp';
/**
 * Международный fallback: курс RUB за 1 USD (агрегат, не официальный курс ЦБ).
 * Бесплатный tier без ключа; условия: https://www.exchangerate-api.com/terms
 */
const EXCHANGE_RATE_API_USD = 'https://api.exchangerate-api.com/v4/latest/USD';

const FETCH_TIMEOUT_MS = 12_000;

function parseCbrNumber(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') return Number(raw.replace(',', '.').replace(/\s/g, ''));
  return Number.NaN;
}

function parseUsdFromCbrXml(xml: string): { rubPerUsd: number; date: string } | null {
  const dm = xml.match(/<ValCurs[^>]*\bDate="([^"]+)"/);
  const date = dm?.[1]?.trim() ?? '';
  const usdAt = xml.indexOf('<CharCode>USD</CharCode>');
  if (usdAt < 0) return null;
  const slice = xml.slice(usdAt, usdAt + 1200);
  const nomM = slice.match(/<Nominal>\s*(\d+)\s*<\/Nominal>/);
  const valM = slice.match(/<Value>\s*([^<]+?)\s*<\/Value>/);
  if (!valM) return null;
  const value = parseCbrNumber(valM[1]);
  const nominal = nomM ? parseCbrNumber(nomM[1]) : 1;
  const nom = Number.isFinite(nominal) && nominal > 0 ? nominal : 1;
  if (!Number.isFinite(value) || value <= 0) return null;
  return { rubPerUsd: value / nom, date };
}

async function fetchRubFromJson(): Promise<{ rubPerUsd: number; date: string } | null> {
  const res = await fetch(CBR_DAILY_JSON, {
    next: { revalidate: 3600 },
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    Date?: string;
    Valute?: { USD?: { Value?: unknown; Nominal?: unknown } };
  };
  const usd = data?.Valute?.USD;
  const value = parseCbrNumber(usd?.Value);
  const nominal = parseCbrNumber(usd?.Nominal);
  const nom = Number.isFinite(nominal) && nominal > 0 ? nominal : 1;
  if (!Number.isFinite(value) || value <= 0) return null;
  return { rubPerUsd: value / nom, date: String(data?.Date ?? '') };
}

async function fetchRubFromXml(): Promise<{ rubPerUsd: number; date: string } | null> {
  const res = await fetch(CBR_XML_DAILY, {
    next: { revalidate: 3600 },
    headers: { Accept: 'application/xml,text/xml;q=0.9,*/*;q=0.8' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) return null;
  const text = await res.text();
  return parseUsdFromCbrXml(text);
}

async function fetchRubFromExchangeRateApi(): Promise<{ rubPerUsd: number; date: string } | null> {
  const res = await fetch(EXCHANGE_RATE_API_USD, {
    next: { revalidate: 3600 },
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { date?: string; rates?: { RUB?: unknown } };
  const rub = parseCbrNumber(data?.rates?.RUB);
  if (!Number.isFinite(rub) || rub <= 0) return null;
  return { rubPerUsd: rub, date: String(data?.date ?? '') };
}

export async function GET() {
  try {
    const fromJson = await fetchRubFromJson();
    if (fromJson) {
      return NextResponse.json({
        ok: true as const,
        rubPerUsd: fromJson.rubPerUsd,
        date: fromJson.date,
        source: 'cbr-xml-daily',
      });
    }
  } catch {
    /* пробуем официальный XML */
  }

  try {
    const fromXml = await fetchRubFromXml();
    if (fromXml) {
      return NextResponse.json({
        ok: true as const,
        rubPerUsd: fromXml.rubPerUsd,
        date: fromXml.date,
        source: 'cbr-ru-xml',
      });
    }
  } catch {
    /* пробуем международный агрегатор */
  }

  try {
    const fromIntl = await fetchRubFromExchangeRateApi();
    if (fromIntl) {
      return NextResponse.json({
        ok: true as const,
        rubPerUsd: fromIntl.rubPerUsd,
        date: fromIntl.date,
        source: 'exchangerate-api',
      });
    }
  } catch {
    /* ниже общая ошибка */
  }

  return NextResponse.json({ ok: false as const, error: 'CBR_FETCH' }, { status: 502 });
}
