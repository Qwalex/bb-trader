export type CabinetPurpose = 'trading' | 'content';

export const CABINET_PURPOSE_VALUES = ['trading', 'content'] as const satisfies readonly CabinetPurpose[];

export function normalizeCabinetPurpose(raw: unknown): CabinetPurpose {
  return String(raw ?? '').trim().toLowerCase() === 'content' ? 'content' : 'trading';
}

export function isContentCabinetPurpose(purpose: unknown): boolean {
  return normalizeCabinetPurpose(purpose) === 'content';
}
