import type { TranscriptResult } from '@repo/shared';

export function parseNumberOrNull(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const n = Number(value.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function normalizeModelName(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function formatOpenRouterError(error: unknown): string {
  if (error == null) {
    return 'Unknown OpenRouter error';
  }
  if (error instanceof Error) {
    const body = (error as { body?: unknown }).body;
    if (typeof body === 'string' && body.trim().length > 0) {
      const trimmed = body.trim();
      return `${error.message} | body: ${trimmed.length > 1200 ? `${trimmed.slice(0, 1200)}...` : trimmed}`;
    }
    return error.message;
  }
  return String(error);
}

export function extractJson(content: string): string {
  const fence = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) {
    return fence[1].trim();
  }
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start >= 0 && end > start) {
    return content.slice(start, end + 1);
  }
  return content.trim();
}

export function tryParseModelContent(
  content: unknown,
): { ok: true; value: unknown } | { ok: false; result: TranscriptResult } {
  if (content != null && typeof content === 'object' && !Array.isArray(content)) {
    return { ok: true, value: content };
  }

  if (Array.isArray(content)) {
    const text = content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (!part || typeof part !== 'object') return '';
        const p = part as Record<string, unknown>;
        return typeof p.text === 'string' ? p.text : '';
      })
      .join('\n')
      .trim();
    if (text.length === 0) {
      return { ok: false, result: { ok: false, error: 'Model returned empty array content' } };
    }
    return tryParseModelContent(text);
  }

  if (typeof content !== 'string') {
    return {
      ok: false,
      result: {
        ok: false,
        error: 'Model returned unsupported content type',
        details: String(content),
      },
    };
  }

  const jsonStr = extractJson(content);
  try {
    const json = JSON.parse(jsonStr) as unknown;
    return { ok: true, value: json };
  } catch {
    return {
      ok: false,
      result: { ok: false, error: 'Model did not return valid JSON', details: content },
    };
  }
}
