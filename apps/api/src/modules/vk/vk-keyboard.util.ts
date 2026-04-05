/**
 * Клавиатуры VK (inline callback). Синхронизировать вручную с telegram.service (Markup).
 */

export type VkButtonRow = Array<{
  action: {
    type: 'callback';
    label: string;
    payload: string;
  };
  color?: 'primary' | 'secondary' | 'negative' | 'positive';
}>;

export function vkInlineKeyboard(buttons: VkButtonRow[]): string {
  return JSON.stringify({
    inline: true,
    buttons: buttons.map((row) =>
      row.map((b) => ({
        action: {
          type: 'callback',
          label: b.action.label,
          payload: b.action.payload,
        },
        color: b.color ?? 'secondary',
      })),
    ),
  });
}

export function vkPayload(obj: Record<string, string>): string {
  return JSON.stringify(obj);
}
