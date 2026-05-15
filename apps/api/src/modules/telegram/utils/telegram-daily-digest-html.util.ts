import type { TelegramSourceRatingRow } from '../types/telegram.types';

import { formatRatingSection } from './telegram-dashboard-html.util';
import { escapeTelegramHtml, formatRuDate } from './telegram-html.util';
import type { OrdersDailyDigestModel } from '../../orders/orders-digest.types';

function signedFixed(n: number, digits: number): string {
  const s = n.toFixed(digits);
  if (n > 0) return `+${s}`;
  return s;
}

function statusRu(status: string): string {
  switch (status) {
    case 'CLOSED_WIN':
      return 'WIN';
    case 'CLOSED_LOSS':
      return 'LOSS';
    case 'CLOSED_MIXED':
      return 'MIX';
    default:
      return status;
  }
}

function isEmptyDailyWindow(params: {
  digest: OrdersDailyDigestModel;
  tops: { byPnl: TelegramSourceRatingRow[]; byWinrate: TelegramSourceRatingRow[] };
}): boolean {
  const { digest, tops } = params;
  const closedInWindow =
    digest.rolling24h.wins + digest.rolling24h.losses + digest.rolling24h.mixed;
  const hasTopData = tops.byPnl.length > 0 || tops.byWinrate.length > 0;
  return closedInWindow === 0 && !hasTopData;
}

export function formatTelegramDailyDigestHtml(params: {
  cabinetName: string;
  digest: OrdersDailyDigestModel;
  balanceLine: string;
  tops: {
    byPnl: TelegramSourceRatingRow[];
    byWinrate: TelegramSourceRatingRow[];
  };
}): string {
  const { cabinetName, digest, balanceLine, tops } = params;
  const { rolling24h, cumulativeBeforeWindow, overall, deltaPnlVsBefore, deltaWinratePoints } =
    digest;
  const fromStr = formatRuDate(rolling24h.from);
  const toStr = formatRuDate(rolling24h.to);
  const escapedCabinetName = escapeTelegramHtml(cabinetName);
  const escapedBalanceLine = escapeTelegramHtml(balanceLine);

  if (isEmptyDailyWindow({ digest, tops })) {
    return (
      `<b>📬 Ежедневный дайджест</b>\n` +
      `<i>${escapedCabinetName} · период: ${escapeTelegramHtml(fromStr)} — ${escapeTelegramHtml(toStr)}</i>\n\n` +
      `<b>🕐 За последние 24 ч</b>\n` +
      `<i>Новостей нет: новых закрытий сделок не было.</i>\n\n` +
      `<b>💵 Сейчас (Bybit USDT)</b>\n<code>${escapedBalanceLine}</code>`
    );
  }

  let body =
    `<b>📬 Ежедневный дайджест</b>\n` +
    `<i>${escapedCabinetName} · закрытые за 24 ч: ${escapeTelegramHtml(fromStr)} — ${escapeTelegramHtml(toStr)}</i>\n\n` +
    `<b>💵 Сейчас (Bybit USDT)</b>\n<code>${escapedBalanceLine}</code>\n\n` +
    `<b>📊 Итого по кабинету</b>\n` +
    `├ Σ PnL: <code>${overall.totalPnl.toFixed(2)}</code>\n` +
    `├ Winrate: <code>${overall.winrate.toFixed(1)}%</code> <i>(W ${overall.wins} / L ${overall.losses}, закр. ${overall.totalClosed})</i>\n` +
    `└ Открытых сигналов: <b>${overall.openSignals}</b>\n\n` +
    `<b>🕐 За прошедшие 24 ч</b>\n` +
    `├ Закрыто сделок: <b>${rolling24h.wins + rolling24h.losses + rolling24h.mixed}</b>` +
    ` <i>(W ${rolling24h.wins} / L ${rolling24h.losses}` +
    (rolling24h.mixed > 0 ? ` / MIX ${rolling24h.mixed}` : '') +
    `)</i>\n` +
    `├ Σ PnL: <code>${signedFixed(rolling24h.totalPnl, 2)}</code>\n` +
    `├ Winrate (24 ч): <code>${rolling24h.decided > 0 ? rolling24h.winrate.toFixed(1) : '—'}%</code>\n` +
    `└ <i>До окна</i>: Σ PnL <code>${cumulativeBeforeWindow.totalPnl.toFixed(2)}</code> · WR <code>${cumulativeBeforeWindow.decided > 0 ? cumulativeBeforeWindow.winrate.toFixed(1) : '—'}%</code>\n` +
    `   <i>Изменение</i>: ΔPnL <code>${signedFixed(deltaPnlVsBefore, 2)}</code> · ΔWR <code>${signedFixed(deltaWinratePoints, 2)} п.п.</code>\n`;

  if (rolling24h.trades.length > 0) {
    body += `\n<b>📋 Закрытия за 24 ч</b>\n`;
    const lines = rolling24h.trades.map((t) => {
      const pnl =
        typeof t.realizedPnl === 'number' && Number.isFinite(t.realizedPnl)
          ? signedFixed(t.realizedPnl, 2)
          : '—';
      const when =
        t.closedAt instanceof Date && !Number.isNaN(t.closedAt.getTime())
          ? formatRuDate(t.closedAt)
          : '—';
      const src = escapeTelegramHtml((t.source ?? '—').trim() || '—');
      return (
        `• <code>${escapeTelegramHtml(t.pair)}</code> ${escapeTelegramHtml((t.direction ?? '').toUpperCase())} · ` +
        `<b>${escapeTelegramHtml(statusRu(t.status))}</b> · <code>${pnl}</code>\n` +
        `  <i>${escapeTelegramHtml(when)}</i> · ${src}`
      );
    });
    body += lines.join('\n');
  } else {
    body += `\n<b>📋 Закрытия за 24 ч</b>\n<i>нет</i>`;
  }

  body += `\n\n${formatRatingSection('💰', 'Топ источников по PnL', tops.byPnl)}`;
  body += `\n\n${formatRatingSection('📈', 'Топ источников по Winrate', tops.byWinrate)}`;

  return body;
}
