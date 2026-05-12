/** App Router / RSC: одно значение query (при дублях ключа Next отдаёт `string[]`). */
export function searchParamFirst(value: string | string[] | undefined): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) {
    for (const v of value) {
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
  }
  return '';
}
