/** Не копируются: уникальны между кабинетами или задаются заново при клоне. */
export const CABINET_CLONE_SKIP_SETTING_KEYS = new Set([
  'STATS_RESET_AT',
]);

export const CABINET_CLONE_UNIQUE_SETTING_KEYS = new Set([
  'BYBIT_API_KEY_MAINNET',
  'BYBIT_API_KEY_TESTNET',
  'TELEGRAM_BOT_TOKEN',
]);

const COPY_SUFFIX_RE = /\s+copy\s+\(\d+\)$/i;

export function stripCloneSuffix(name: string): string {
  return String(name ?? '')
    .trim()
    .replace(COPY_SUFFIX_RE, '')
    .trim();
}

/** «Имя copy (1)», «Имя copy (2)», … без коллизий с existingNames. */
export function buildCloneCabinetName(sourceName: string, existingNames: readonly string[]): string {
  const base = stripCloneSuffix(sourceName) || String(sourceName ?? '').trim() || 'Cabinet';
  const taken = new Set(existingNames.map((n) => n.trim()));
  let n = 1;
  for (;;) {
    const candidate = `${base} copy (${n})`;
    if (!taken.has(candidate)) {
      return candidate;
    }
    n += 1;
    if (n > 10_000) {
      throw new Error('Unable to generate unique clone cabinet name');
    }
  }
}
