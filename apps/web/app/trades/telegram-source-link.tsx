'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { getApiBase } from '../../lib/api';

type Props = {
  signalId: string;
  status: string;
  deletedAt?: string | null;
  sourceChatId: string | null;
  sourceMessageId: string | null;
};

type ChatRow = { chatId: string; title: string; enabled: boolean };

type Candidate = {
  ingestId: string;
  chatId: string;
  messageId: string;
  chatTitle: string;
  textPreview: string;
  classification: string;
  status: string;
  createdAt: string;
};

export function TelegramSourceLink({
  signalId,
  status,
  deletedAt,
  sourceChatId,
  sourceMessageId,
}: Props) {
  const router = useRouter();
  const [chat, setChat] = useState(sourceChatId ?? '');
  const [msg, setMsg] = useState(sourceMessageId ?? '');
  const [saving, setSaving] = useState(false);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [chats, setChats] = useState<ChatRow[]>([]);
  const [filterChatId, setFilterChatId] = useState('');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loadingPick, setLoadingPick] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);

  useEffect(() => {
    setChat(sourceChatId ?? '');
    setMsg(sourceMessageId ?? '');
  }, [sourceChatId, sourceMessageId]);

  const isDisabled = Boolean(deletedAt) || saving || status === 'FAILED';

  const loadPickerData = useCallback(async () => {
    setLoadingPick(true);
    setPickError(null);
    try {
      const base = getApiBase();
      const q = new URLSearchParams();
      q.set('limit', '400');
      if (filterChatId.trim()) q.set('chatId', filterChatId.trim());

      const [chRes, candRes] = await Promise.all([
        fetch(`${base}/telegram-userbot/chats`),
        fetch(`${base}/telegram-userbot/ingest-link-candidates?${q.toString()}`),
      ]);
      if (!chRes.ok) {
        const t = await chRes.text().catch(() => '');
        throw new Error(t || `chats ${chRes.status}`);
      }
      if (!candRes.ok) {
        const t = await candRes.text().catch(() => '');
        throw new Error(t || `candidates ${candRes.status}`);
      }
      const chJson = (await chRes.json()) as ChatRow[];
      const candJson = (await candRes.json()) as { items?: Candidate[] };
      setChats(Array.isArray(chJson) ? chJson : []);
      setCandidates(Array.isArray(candJson.items) ? candJson.items : []);
    } catch (e) {
      setPickError(e instanceof Error ? e.message : 'Ошибка загрузки');
      setCandidates([]);
    } finally {
      setLoadingPick(false);
    }
  }, [filterChatId]);

  useEffect(() => {
    if (!pickerOpen) return;
    void loadPickerData();
  }, [pickerOpen, loadPickerData]);

  async function onSave() {
    if (isDisabled) return;
    const c = chat.trim();
    const m = msg.trim();
    if ((c.length > 0) !== (m.length > 0)) {
      window.alert('Заполните оба поля (chat id и message id) или очистите оба для сброса.');
      return;
    }
    const payload = {
      sourceChatId: c.length > 0 ? c : null,
      sourceMessageId: m.length > 0 ? m : null,
    };
    const ok = window.confirm(
      payload.sourceChatId
        ? `Привязать сделку к Telegram?\n\nchat: ${payload.sourceChatId}\nmessage: ${payload.sourceMessageId}`
        : 'Сбросить привязку к сообщению Telegram?',
    );
    if (!ok) return;

    setSaving(true);
    try {
      const res = await fetch(`${getApiBase()}/orders/trades/${signalId}/telegram-source`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || `${res.status} ${res.statusText}`);
      }
      router.refresh();
    } catch (e) {
      const err = e instanceof Error ? e.message : 'Ошибка сохранения';
      window.alert(err);
    } finally {
      setSaving(false);
    }
  }

  function applyCandidate(row: Candidate) {
    setChat(row.chatId);
    setMsg(row.messageId);
    setPickerOpen(false);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', alignItems: 'center' }}>
        <input
          type="text"
          placeholder="chat id"
          value={chat}
          onChange={(e) => setChat(e.target.value)}
          disabled={isDisabled}
          title="ID чата Telegram (как в userbot), например -100…"
          style={{
            flex: '1 1 120px',
            minWidth: 0,
            padding: '0.3rem 0.45rem',
            borderRadius: 6,
            border: '1px solid var(--border)',
            background: 'var(--card)',
            color: 'var(--foreground)',
          }}
        />
        <input
          type="text"
          placeholder="message id"
          value={msg}
          onChange={(e) => setMsg(e.target.value)}
          disabled={isDisabled}
          title="ID сообщения с сигналом (root), на которое отвечают closed/reentry"
          style={{
            flex: '1 1 100px',
            minWidth: 0,
            padding: '0.3rem 0.45rem',
            borderRadius: 6,
            border: '1px solid var(--border)',
            background: 'var(--card)',
            color: 'var(--foreground)',
          }}
        />
        <button
          type="button"
          onClick={() => void onSave()}
          disabled={isDisabled}
          style={{
            padding: '0.3rem 0.55rem',
            borderRadius: 6,
            border: '1px solid var(--border)',
            background: isDisabled ? 'var(--muted)' : 'var(--accent)',
            color: 'var(--accent-foreground, #fff)',
            cursor: isDisabled ? 'not-allowed' : 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          {saving ? '…' : 'Сохранить'}
        </button>
        <button
          type="button"
          disabled={isDisabled}
          onClick={() => setPickerOpen((v) => !v)}
          style={{
            padding: '0.3rem 0.55rem',
            borderRadius: 6,
            border: '1px solid var(--border)',
            background: isDisabled ? 'var(--muted)' : 'var(--card)',
            color: 'var(--foreground)',
            cursor: isDisabled ? 'not-allowed' : 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          {pickerOpen ? 'Скрыть подбор' : 'Подобрать из БД'}
        </button>
      </div>

      {pickerOpen && !isDisabled && (
        <div
          style={{
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: '0.5rem',
            background: 'var(--card)',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '0.5rem',
              alignItems: 'center',
              marginBottom: '0.45rem',
            }}
          >
            <label style={{ fontSize: '0.82rem', opacity: 0.9 }}>
              Чат:
              <select
                value={filterChatId}
                onChange={(e) => setFilterChatId(e.target.value)}
                style={{
                  marginLeft: '0.35rem',
                  padding: '0.25rem 0.4rem',
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  background: 'var(--background)',
                  color: 'var(--foreground)',
                  maxWidth: 220,
                }}
              >
                <option value="">Все</option>
                {chats.map((c) => (
                  <option key={c.chatId} value={c.chatId}>
                    {c.enabled ? '' : '○ '}
                    {c.title || c.chatId}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => void loadPickerData()}
              disabled={loadingPick}
              style={{
                padding: '0.2rem 0.45rem',
                fontSize: '0.82rem',
                borderRadius: 6,
                border: '1px solid var(--border)',
                cursor: loadingPick ? 'wait' : 'pointer',
              }}
            >
              Обновить
            </button>
            <span className="tradeCardMuted" style={{ fontSize: '0.78rem' }}>
              Список по всем парам; при необходимости выберите чат выше.
            </span>
          </div>
          {loadingPick && <div className="tradeCardMuted">Загрузка…</div>}
          {pickError && (
            <div style={{ color: 'var(--destructive, #c44)', fontSize: '0.85rem' }}>{pickError}</div>
          )}
          {!loadingPick && !pickError && candidates.length === 0 && (
            <div className="tradeCardMuted" style={{ fontSize: '0.85rem' }}>
              В TgUserbotIngest пока нет записей (сообщения должны попадать в ingest через userbot).
            </div>
          )}
          <div
            style={{
              maxHeight: 220,
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.35rem',
            }}
          >
            {candidates.map((row) => (
              <button
                key={row.ingestId}
                type="button"
                onClick={() => applyCandidate(row)}
                style={{
                  textAlign: 'left',
                  padding: '0.4rem 0.45rem',
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  background: 'var(--background)',
                  color: 'var(--foreground)',
                  cursor: 'pointer',
                }}
              >
                <div style={{ fontSize: '0.78rem', opacity: 0.85 }}>
                  {row.chatTitle} · msg {row.messageId} · {row.classification}/{row.status}
                </div>
                <div style={{ fontSize: '0.82rem', marginTop: '0.15rem' }}>
                  {row.textPreview || '(без текста)'}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      <span className="tradeCardMuted" style={{ fontSize: '0.78rem', lineHeight: 1.35 }}>
        Для userbot: closed/reentry с цитатой ищут активную сделку по паре chat id + message id
        корневого поста. «Подобрать из БД» — последние сообщения из ingest (по желанию сузьте чатом).
      </span>
    </div>
  );
}
