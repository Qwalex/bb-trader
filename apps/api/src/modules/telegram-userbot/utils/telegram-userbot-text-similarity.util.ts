export function isNumberClose(a: number, b: number): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return false;
  }
  const diff = Math.abs(a - b);
  const base = Math.max(Math.abs(b), 1);
  return diff / base <= 0.0005;
}

export function arePriceArraysClose(a: number[], b: number[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    const av = a[i];
    const bv = b[i];
    if (av == null || bv == null || !isNumberClose(av, bv)) {
      return false;
    }
  }
  return true;
}

export function tokenizeForSimilarity(text: string): Set<string> {
  const normalized = text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  if (!normalized) {
    return new Set();
  }
  return new Set(
    normalized
      .split(/\s+/)
      .map((x) => x.trim())
      .filter((x) => x.length >= 3)
      .slice(0, 256),
  );
}

export function computeTextSimilarity(a: string, b: string): number {
  const aTokens = tokenizeForSimilarity(a);
  const bTokens = tokenizeForSimilarity(b);
  if (aTokens.size === 0 || bTokens.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const tok of aTokens) {
    if (bTokens.has(tok)) {
      intersection += 1;
    }
  }
  const union = aTokens.size + bTokens.size - intersection;
  if (union <= 0) {
    return 0;
  }
  return intersection / union;
}
