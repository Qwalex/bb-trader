export type TranslationParams = Record<string, string | number | null | undefined>;

export function translate(
  messages: Record<string, unknown>,
  key: string,
  params?: TranslationParams,
): string {
  const parts = key.split('.');
  let cur: unknown = messages;
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object') {
      return key;
    }
    cur = (cur as Record<string, unknown>)[part];
  }
  if (typeof cur !== 'string') {
    return key;
  }
  if (!params) {
    return cur;
  }
  return cur.replace(/\{(\w+)\}/g, (_, token: string) => {
    const value = params[token];
    return value == null ? `{${token}}` : String(value);
  });
}

export type Translator = (key: string, params?: TranslationParams) => string;

export function createTranslator(messages: Record<string, unknown>): Translator {
  return (key, params) => translate(messages, key, params);
}
