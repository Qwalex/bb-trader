import { Markup } from 'telegraf';

export function confirmKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('✅ Подтвердить', 'sig_confirm'),
      Markup.button.callback('❌ Отмена', 'sig_cancel'),
    ],
  ]);
}

export function cancelOnlyKeyboard() {
  return Markup.inlineKeyboard([[Markup.button.callback('❌ Отмена', 'sig_cancel')]]);
}

/** `requestId` — полный ключ `cabinetId|ingestId`, как в callback userbot. */
export function externalConfirmKeyboard(requestId: string) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('✅ Подтвердить', `ub_confirm:${requestId}`),
      Markup.button.callback('❌ Отклонить', `ub_reject:${requestId}`),
    ],
  ]);
}

export function spotBuyPromptKeyboard(requestId: string) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('✅ Купить на спот', `spot_buy_yes:${requestId}`),
      Markup.button.callback('❌ Нет', `spot_buy_no:${requestId}`),
    ],
  ]);
}

export function spotSellPromptKeyboard(signalId: string, kind: string, levelIndex: number) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('✅ Продать', `spot_sell_yes:${signalId}:${kind}:${levelIndex}`),
      Markup.button.callback('❌ Нет', `spot_sell_no:${signalId}:${kind}:${levelIndex}`),
    ],
  ]);
}

/** Кнопка отмены ордеров по сделке из уведомления «result без входа». */
export function staleResultCancelKeyboard(signalId: string) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('Отменить', `ub_stale_cancel:${signalId}`)],
  ]);
}

export function sourceSelectionKeyboard(sources: string[]) {
  const rows = sources.map((s, i) => [Markup.button.callback(s, `src_pick:${i}`)]);
  rows.push([Markup.button.callback('➡️ Без источника', 'src_none')]);
  rows.push([Markup.button.callback('❌ Отмена', 'sig_cancel')]);
  return Markup.inlineKeyboard(rows);
}

export function mainMenuKeyboard() {
  return Markup.keyboard([
    ['Сводка', 'Рейтинги', 'Сделки'],
    ['Диагностика', 'Логи'],
  ])
    .resize()
    .persistent();
}

export function buildTradesNumberKeyboard(items: Array<{ id: string }>) {
  const buttons = items.map((s, i) =>
    Markup.button.callback(String(i + 1), `td:${s.id}`),
  );
  const grid: (typeof buttons)[] = [];
  for (let i = 0; i < buttons.length; i += 5) {
    grid.push(buttons.slice(i, i + 5));
  }
  return Markup.inlineKeyboard(grid);
}
