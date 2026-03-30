'use client';

import { formatTimeRu } from '../../lib/datetime';

export type UserbotRecentRow = {
  id: string;
  chatId: string;
  messageId: string;
  text: string | null;
  classification: string;
  status: string;
  error: string | null;
  createdAt: string;
  isToday: boolean;
  aiRequest: string | null;
  aiResponse: string | null;
};

type Props = {
  row: UserbotRecentRow;
  /** Показать строку «группа · chat id» (плоский список без группировки) */
  showChatMeta?: boolean;
  chatTitle?: string;
  pipelineStatus: string;
  disabled: boolean;
  rereadBusy: boolean;
  onTrace: () => void;
  onReread: () => void;
};

export function UserbotMessageCard({
  row,
  showChatMeta,
  chatTitle,
  pipelineStatus,
  disabled,
  rereadBusy,
  onTrace,
  onReread,
}: Props) {
  return (
    <article className="userbotMessageCard">
      <div className="userbotMessageCardTop">
        <div className="userbotMessageCardTopMain">
          <time className="userbotMessageCardTime" dateTime={row.createdAt}>
            {formatTimeRu(row.createdAt)}
          </time>
          <span className="userbotMessageCardClass">{row.classification}</span>
        </div>
        <span className="userbotMessageCardMsgId" title="Message ID">
          #{row.messageId}
        </span>
      </div>
      {showChatMeta && (
        <div className="userbotMessageCardChatLine">
          <span className="userbotMessageCardChatTitle">{chatTitle ?? row.chatId}</span>
          <code className="userbotMessageCardChatId">{row.chatId}</code>
        </div>
      )}
      <div className="userbotMessageCardText">
        {row.text ? (
          <details className="userbotMessageCardDetails">
            <summary className="userbotMessageCardSummary" title={row.text}>
              {row.text}
            </summary>
            <div className="userbotMessageCardFullText">{row.text}</div>
          </details>
        ) : (
          <span className="userbotMessageCardNoText">—</span>
        )}
      </div>
      <div className="userbotMessageCardBottom">
        <p className="userbotMessageCardPipeline" title={row.error ?? undefined}>
          {pipelineStatus}
        </p>
        <div className="userbotMessageCardActions">
          <button
            className="btn btnSecondary btnSm"
            type="button"
            onClick={onTrace}
            disabled={disabled}
          >
            Trace
          </button>
          <button className="btn btnSm" type="button" onClick={onReread} disabled={disabled}>
            {rereadBusy ? 'Перечитывание…' : 'Перечитать'}
          </button>
        </div>
      </div>
    </article>
  );
}
