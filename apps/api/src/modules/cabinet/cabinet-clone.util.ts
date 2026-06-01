/** Не копируются: задаются заново при клоне. */
export const CABINET_CLONE_SKIP_SETTING_KEYS = new Set(['STATS_RESET_AT']);

const COPY_SUFFIX_RE = /\s+copy\s+\(\d+\)$/i;

export function stripCloneSuffix(name: string): string {
  return String(name ?? '')
    .trim()
    .replace(COPY_SUFFIX_RE, '')
    .trim();
}

export function buildCloneSettingsInsertRows(
  sourceSettings: readonly { key: string; value: string }[],
  statsResetAt: string,
): { key: string; value: string }[] {
  const rows: { key: string; value: string }[] = [];
  for (const row of sourceSettings) {
    if (CABINET_CLONE_SKIP_SETTING_KEYS.has(row.key)) {
      continue;
    }
    rows.push({ key: row.key, value: row.value });
  }
  rows.push({ key: 'STATS_RESET_AT', value: statsResetAt });
  return rows;
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
