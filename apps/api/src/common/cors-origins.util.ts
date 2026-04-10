/** Совпадает с логикой enableCors в main.ts */
export function parseCorsOrigins(raw: string | undefined): string[] {
  return String(raw ?? '')
    .split(',')
    .map((value) => value.trim().replace(/\/+$/, ''))
    .filter((value) => value.length > 0);
}
