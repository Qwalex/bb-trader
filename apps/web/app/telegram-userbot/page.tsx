'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';

import { getApiBase } from '../../lib/api';

type BotStatus = {
  connected: boolean;
  enabled: boolean;
  useAiClassifier: boolean;
  requireConfirmation: boolean;
  pollMs?: number;
  pollingInFlight?: boolean;
  credentials: {
    apiIdConfigured: boolean;
    apiHashConfigured: boolean;
    sessionConfigured: boolean;
  };
  chatsTotal: number;
  chatsEnabled: number;
  qr: {
    phase: string;
    loginUrl?: string;
    qrDataUrl?: string;
    startedAt?: string;
    updatedAt?: string;
    error?: string;
  };
};

type UserbotChat = {
  id: string;
  chatId: string;
  title: string;
  username: string | null;
  enabled: boolean;
};

type TodayMetrics = {
  dayStart: string;
  readMessages: number;
  signalsFound: number;
  signalsPlaced: number;
  noSignals: number;
  parseIncomplete: number;
  parseError: number;
  recent: Array<{
    id: string;
    chatId: string;
    messageId: string;
    text: string | null;
    aiRequest: string | null;
    aiResponse: string | null;
    isToday: boolean;
    classification: string;
    status: string;
    error: string | null;
    createdAt: string;
  }>;
};

type TraceModalState = {
  chatId: string;
  messageId: string;
  request: string | null;
  response: string | null;
};

export default function TelegramUserbotPage() {
  const [status, setStatus] = useState<BotStatus | null>(null);
  const [chats, setChats] = useState<UserbotChat[]>([]);
  const [metrics, setMetrics] = useState<TodayMetrics | null>(null);
  const [search, setSearch] = useState('');
  const [onlySignals, setOnlySignals] = useState(true);
  const [groupByChat, setGroupByChat] = useState(true);
  const [traceModal, setTraceModal] = useState<TraceModalState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const qrVisible = useMemo(
    () => status?.qr.phase === 'waiting_scan' || status?.qr.phase === 'starting',
    [status?.qr.phase],
  );
  const normalizedSearch = search.trim().toLowerCase();
  const filteredChats = useMemo(() => {
    if (!normalizedSearch) {
      return chats;
    }
    return chats.filter((chat) => {
      const title = chat.title.toLowerCase();
      const username = (chat.username ?? '').toLowerCase();
      const chatId = chat.chatId.toLowerCase();
      return (
        title.includes(normalizedSearch) ||
        username.includes(normalizedSearch) ||
        chatId.includes(normalizedSearch)
      );
    });
  }, [chats, normalizedSearch]);
  const chatTitleById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of chats) {
      m.set(c.chatId, c.title);
    }
    return m;
  }, [chats]);
  const filteredRecent = useMemo(() => {
    const rows = metrics?.recent ?? [];
    const byType = onlySignals
      ? rows.filter((r) => r.classification === 'signal')
      : rows;
    if (!groupByChat) {
      return byType;
    }
    return [...byType].sort((a, b) => {
      const c = a.chatId.localeCompare(b.chatId);
      if (c !== 0) return c;
      return (
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    });
  }, [metrics?.recent, onlySignals, groupByChat]);

  async function loadAll() {
    const [s, c, m] = await Promise.all([
      fetch(`${getApiBase()}/telegram-userbot/status`).then((r) => r.json()),
      fetch(`${getApiBase()}/telegram-userbot/chats`).then((r) => r.json()),
      fetch(`${getApiBase()}/telegram-userbot/metrics/today`).then((r) => r.json()),
    ]);
    setStatus(s as BotStatus);
    setChats(c as UserbotChat[]);
    setMetrics(m as TodayMetrics);
  }

  useEffect(() => {
    void (async () => {
      try {
        await loadAll();
      } catch {
        setMsg({ type: 'err', text: 'Не удалось загрузить состояние userbot' });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!qrVisible && !status?.connected) {
      return;
    }
    const t = setInterval(() => {
      void (async () => {
        try {
          const [qrRes, metricsRes] = await Promise.all([
            fetch(`${getApiBase()}/telegram-userbot/qr/status`),
            fetch(`${getApiBase()}/telegram-userbot/metrics/today`),
          ]);
          const j = (await qrRes.json()) as { qr?: BotStatus['qr']; connected?: boolean };
          const m = (await metricsRes.json()) as TodayMetrics;
          setStatus((prev) =>
            prev
              ? {
                  ...prev,
                  connected: j.connected ?? prev.connected,
                  qr: j.qr ?? prev.qr,
                }
              : prev,
          );
          setMetrics(m);
        } catch {
          // ignore transient polling errors
        }
      })();
    }, 1800);
    return () => clearInterval(t);
  }, [qrVisible, status?.connected]);

  async function runAction(key: string, fn: () => Promise<void>) {
    setBusy(key);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setMsg({
        type: 'err',
        text: e instanceof Error ? e.message : 'Ошибка операции',
      });
    } finally {
      setBusy(null);
    }
  }

  function renderPipelineStatus(row: TodayMetrics['recent'][number]): string {
    if (row.classification === 'result') {
      return 'Результат по сигналу';
    }
    if (row.classification !== 'signal') {
      return 'Не сигнал';
    }
    switch (row.status) {
      case 'placed':
        return 'Прочитано -> распознано -> установлен сигнал';
      case 'blocked_by_setting':
        return 'Прочитано -> распознано -> ожидает подтверждение в боте';
      case 'cancelled_by_confirmation':
        return 'Прочитано -> распознано -> отменен пользователем';
      case 'duplicate_signal':
        return 'Прочитано -> распознано -> отменен (дубликат)';
      case 'place_error':
        return 'Прочитано -> распознано -> ошибка установки';
      case 'parse_incomplete':
        return 'Прочитано -> частично распознано';
      case 'parse_error':
        return 'Прочитано -> ошибка распознавания';
      default:
        return 'Прочитано';
    }
  }

  if (loading) {
    return <p style={{ color: 'var(--muted)' }}>Загрузка…</p>;
  }

  return (
    <>
      <h1 className="pageTitle">Telegram Userbot</h1>
      <p style={{ color: 'var(--muted)', marginBottom: '1rem' }}>
        Userbot читает сообщения в выбранных группах, отделяет сигналы от результатов и
        отправляет сигналы в существующий pipeline (OpenRouter -&gt; Bybit).
      </p>
      {msg && (
        <p className={`msg ${msg.type === 'ok' ? 'ok' : 'err'}`} style={{ marginBottom: '1rem' }}>
          {msg.text}
        </p>
      )}
      <div className="card" style={{ marginBottom: '1rem' }}>
        <h3 style={{ marginBottom: '0.5rem' }}>Статус</h3>
        <p>
          Подключен: <strong>{status?.connected ? 'Да' : 'Нет'}</strong>
        </p>
        <p>
          API ID/API HASH: <strong>{status?.credentials.apiIdConfigured && status?.credentials.apiHashConfigured ? 'заданы' : 'не заданы'}</strong>
        </p>
        <p>
          Сессия: <strong>{status?.credentials.sessionConfigured ? 'есть' : 'нет'}</strong>
        </p>
        <p>
          Выбрано групп: <strong>{status?.chatsEnabled ?? 0}</strong> из {status?.chatsTotal ?? 0}
        </p>
        <p>
          Фоновое чтение: каждые{' '}
          <strong>{Math.max(1, Math.round((status?.pollMs ?? 2000) / 1000))}с</strong>{' '}
          {status?.pollingInFlight ? '(идёт цикл чтения...)' : ''}
        </p>
        <p style={{ color: 'var(--muted)', marginTop: '0.35rem' }}>
          Обработка сообщений: только за текущий день.
        </p>
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <button
          className="btn"
          type="button"
          onClick={() =>
            void runAction('connect', async () => {
              const res = await fetch(`${getApiBase()}/telegram-userbot/connect`, {
                method: 'POST',
              });
              const j = (await res.json()) as { ok?: boolean; error?: string };
              if (!j.ok) {
                throw new Error(j.error ?? 'Не удалось подключиться');
              }
              await loadAll();
              setMsg({ type: 'ok', text: 'Userbot подключен через сохраненную сессию' });
            })
          }
          disabled={busy !== null}
        >
          {busy === 'connect' ? 'Подключение…' : 'Подключить по сохраненной сессии'}
        </button>
        <button
          className="btn"
          type="button"
          onClick={() =>
            void runAction('qr', async () => {
              await fetch(`${getApiBase()}/telegram-userbot/qr/start`, { method: 'POST' });
              const res = await fetch(`${getApiBase()}/telegram-userbot/qr/status`);
              const j = (await res.json()) as { qr?: BotStatus['qr']; connected?: boolean };
              setStatus((prev) =>
                prev
                  ? { ...prev, connected: j.connected ?? prev.connected, qr: j.qr ?? prev.qr }
                  : prev,
              );
              setMsg({ type: 'ok', text: 'QR-вход запущен. Отсканируйте код в Telegram.' });
            })
          }
          disabled={busy !== null}
        >
          {busy === 'qr' ? 'Запуск…' : 'Войти по QR'}
        </button>
        <button
          className="btn btnSecondary"
          type="button"
          onClick={() =>
            void runAction('disconnect', async () => {
              await fetch(`${getApiBase()}/telegram-userbot/disconnect`, { method: 'POST' });
              await loadAll();
              setMsg({ type: 'ok', text: 'Userbot отключен' });
            })
          }
          disabled={busy !== null}
        >
          Отключить
        </button>
        <button
          className="btn btnSecondary"
          type="button"
          onClick={() =>
            void runAction('scan', async () => {
              const res = await fetch(`${getApiBase()}/telegram-userbot/scan-today`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ limitPerChat: 200 }),
              });
              const j = (await res.json()) as {
                ok?: boolean;
                error?: string;
                readMessages?: number;
                readTextMessages?: number;
              };
              if (!j.ok) {
                throw new Error(j.error ?? 'Не удалось выполнить сканирование');
              }
              await loadAll();
              setMsg({
                type: 'ok',
                text: `Сканирование завершено: прочитано ${j.readMessages ?? 0}, текстовых ${j.readTextMessages ?? 0}`,
              });
            })
          }
          disabled={busy !== null}
        >
          {busy === 'scan' ? 'Сканирование…' : 'Сканировать сообщения за сегодня'}
        </button>
        <button
          className="btn btnSecondary"
          type="button"
          onClick={() =>
            void runAction('reread-all', async () => {
              const res = await fetch(`${getApiBase()}/telegram-userbot/reread-all`, {
                method: 'POST',
              });
              const j = (await res.json()) as {
                ok?: boolean;
                error?: string;
                total?: number;
                limit?: number;
                processed?: number;
                skippedWithoutText?: number;
                failed?: number;
                hasMore?: boolean;
              };
              if (!j.ok) {
                throw new Error(j.error ?? 'Не удалось перечитать все сообщения');
              }
              await loadAll();
              setMsg({
                type: 'ok',
                text:
                  `Перечитано: ${j.processed ?? 0} из ${j.total ?? 0}` +
                  `, пропущено без текста: ${j.skippedWithoutText ?? 0}` +
                  `, ошибок: ${j.failed ?? 0}` +
                  (j.hasMore
                    ? ` (есть ещё сообщения, запустите снова; текущий лимит: ${j.limit ?? 'n/a'})`
                    : ''),
              });
            })
          }
          disabled={busy !== null}
        >
          {busy === 'reread-all' ? 'Перечитывание…' : 'Перечитать все сообщения'}
        </button>
        <button
          className="btn btnSecondary"
          type="button"
          onClick={() =>
            void runAction('sync', async () => {
              const res = await fetch(`${getApiBase()}/telegram-userbot/chats/sync`, {
                method: 'POST',
              });
              const j = (await res.json()) as { ok?: boolean; error?: string; upserted?: number };
              if (!j.ok) throw new Error(j.error ?? 'Не удалось синхронизировать группы');
              await loadAll();
              setMsg({
                type: 'ok',
                text: `Синхронизация завершена: найдено/обновлено ${j.upserted ?? 0} чатов`,
              });
            })
          }
          disabled={busy !== null}
        >
          {busy === 'sync' ? 'Синхронизация…' : 'Синхронизировать группы'}
        </button>
      </div>

      <div className="grid" style={{ marginBottom: '1rem' }}>
        <div className="card">
          <h3>Прочитано сегодня</h3>
          <div className="value">{metrics?.readMessages ?? 0}</div>
        </div>
        <div className="card">
          <h3>Найдено сигналов</h3>
          <div className="value">{metrics?.signalsFound ?? 0}</div>
        </div>
        <div className="card">
          <h3>Установлено сигналов</h3>
          <div className="value">{metrics?.signalsPlaced ?? 0}</div>
        </div>
        <div className="card">
          <h3>Сигналов не найдено</h3>
          <div className="value">{metrics?.noSignals ?? 0}</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <h3 style={{ marginBottom: '0.5rem' }}>Последние сообщения</h3>
        <div className="filters" style={{ marginBottom: '0.75rem' }}>
          <label style={{ flexDirection: 'row', alignItems: 'center', gap: '0.45rem' }}>
            <input
              type="checkbox"
              checked={onlySignals}
              onChange={(e) => setOnlySignals(e.target.checked)}
            />
            Показывать только сигналы
          </label>
          <label style={{ flexDirection: 'row', alignItems: 'center', gap: '0.45rem' }}>
            <input
              type="checkbox"
              checked={groupByChat}
              onChange={(e) => setGroupByChat(e.target.checked)}
            />
            Разбивать по группам
          </label>
        </div>
        <div className="tableWrap" style={{ maxHeight: 500, overflowY: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Время</th>
                <th>Chat ID</th>
                <th>Message ID</th>
                <th>Сообщение</th>
                <th>Класс</th>
                <th>Статус обработки</th>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              {filteredRecent.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ color: 'var(--muted)' }}>
                    Сообщения по текущему фильтру не найдены.
                  </td>
                </tr>
              )}
              {filteredRecent.map((row, idx, arr) => {
                const prev = idx > 0 ? arr[idx - 1] : null;
                const showChatDivider =
                  groupByChat && (!prev || prev.chatId !== row.chatId);
                const showTodayDivider = (!prev || showChatDivider) && row.isToday;
                const showOldDivider =
                  !showChatDivider &&
                  (prev?.isToday ?? false) &&
                  row.isToday === false;

                return (
                  <Fragment key={row.id}>
                    {showChatDivider && (
                      <tr>
                        <td colSpan={7} className="chatDividerCell">
                          <span className="chatDividerTitle">
                            {chatTitleById.get(row.chatId) ?? row.chatId}
                          </span>
                          <span className="chatDividerMeta">{row.chatId}</span>
                        </td>
                      </tr>
                    )}
                    {(showTodayDivider || showOldDivider) && (
                      <tr>
                        <td colSpan={7} style={{ background: 'var(--card)' }}>
                          <strong>
                            {showTodayDivider ? 'Сегодня' : 'Старые сообщения'}
                          </strong>
                        </td>
                      </tr>
                    )}
                    <tr>
                      <td>{new Date(row.createdAt).toLocaleTimeString('ru-RU')}</td>
                      <td>{row.chatId}</td>
                      <td>{row.messageId}</td>
                      <td style={{ maxWidth: 380 }}>
                        {row.text ? (
                          <details>
                            <summary
                              style={{
                                cursor: 'pointer',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                maxWidth: 360,
                              }}
                              title={row.text}
                            >
                              {row.text}
                            </summary>
                            <div
                              style={{
                                marginTop: '0.35rem',
                                whiteSpace: 'pre-wrap',
                                lineHeight: 1.35,
                                color: 'var(--muted)',
                              }}
                            >
                              {row.text}
                            </div>
                          </details>
                        ) : (
                          <span style={{ color: 'var(--muted)' }}>—</span>
                        )}
                      </td>
                      <td>{row.classification}</td>
                      <td title={row.error ?? undefined}>
                        {renderPipelineStatus(row)}
                      </td>
                      <td>
                        <button
                          className="btn btnSecondary btnSm"
                          type="button"
                          onClick={() =>
                            setTraceModal({
                              chatId: row.chatId,
                              messageId: row.messageId,
                              request: row.aiRequest,
                              response: row.aiResponse,
                            })
                          }
                          disabled={busy !== null}
                          style={{ marginRight: '0.35rem' }}
                        >
                          Trace
                        </button>
                        <button
                          className="btn btnSm"
                          type="button"
                          onClick={() =>
                            void runAction(`reread-${row.id}`, async () => {
                              const res = await fetch(
                                `${getApiBase()}/telegram-userbot/reread/${encodeURIComponent(row.id)}`,
                                { method: 'POST' },
                              );
                              const j = (await res.json()) as {
                                ok?: boolean;
                                error?: string;
                              };
                              if (!j.ok) {
                                throw new Error(j.error ?? 'Не удалось перечитать сообщение');
                              }
                              await loadAll();
                              setMsg({
                                type: 'ok',
                                text: `Сообщение ${row.messageId} перечитано`,
                              });
                            })
                          }
                          disabled={busy !== null}
                        >
                          {busy === `reread-${row.id}` ? 'Перечитывание…' : 'Перечитать'}
                        </button>
                      </td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

      {traceModal && (
        <div
          role="presentation"
          onClick={() => setTraceModal(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            zIndex: 50,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1rem',
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="OpenRouter trace"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 'min(1000px, 100%)',
              maxHeight: '85vh',
              overflowY: 'auto',
              background: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: 10,
              padding: '1rem',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '0.75rem',
              }}
            >
              <h3 style={{ margin: 0 }}>
                OpenRouter trace: {traceModal.chatId} / {traceModal.messageId}
              </h3>
              <button
                className="btn btnSecondary btnSm"
                type="button"
                onClick={() => setTraceModal(null)}
              >
                Закрыть
              </button>
            </div>
            <div style={{ marginBottom: '0.75rem' }}>
              <strong>Request</strong>
              <pre
                style={{
                  marginTop: '0.35rem',
                  whiteSpace: 'pre-wrap',
                  overflowWrap: 'anywhere',
                  fontSize: '0.78rem',
                  color: 'var(--muted)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  padding: '0.6rem',
                  background: 'rgba(0,0,0,0.12)',
                }}
              >
                {traceModal.request ?? '—'}
              </pre>
            </div>
            <div>
              <strong>Response</strong>
              <pre
                style={{
                  marginTop: '0.35rem',
                  whiteSpace: 'pre-wrap',
                  overflowWrap: 'anywhere',
                  fontSize: '0.78rem',
                  color: 'var(--muted)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  padding: '0.6rem',
                  background: 'rgba(0,0,0,0.12)',
                }}
              >
                {traceModal.response ?? '—'}
              </pre>
            </div>
          </div>
        </div>
      )}
      </div>

      {qrVisible && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <h3 style={{ marginBottom: '0.5rem' }}>QR авторизация</h3>
          {status?.qr.qrDataUrl ? (
            <img
              src={status.qr.qrDataUrl}
              alt="Telegram login QR"
              width={260}
              height={260}
              style={{ background: '#fff', padding: '0.5rem', borderRadius: 8 }}
            />
          ) : (
            <p style={{ color: 'var(--muted)' }}>Генерация QR…</p>
          )}
          <p style={{ marginTop: '0.5rem', color: 'var(--muted)' }}>
            Если QR не сканируется, откройте Telegram на телефоне: Настройки -&gt; Устройства
            -&gt; Подключить устройство.
          </p>
          {status?.qr.error && (
            <p className="msg err" style={{ marginTop: '0.5rem' }}>
              {status.qr.error}
            </p>
          )}
        </div>
      )}

      <div className="filters" style={{ marginBottom: '0.75rem' }}>
        <label>
          Поиск по группам
          <input
            type="text"
            placeholder="Название, @username или chat id"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </div>
      {normalizedSearch && (
        <p style={{ color: 'var(--muted)', marginBottom: '0.5rem', fontSize: '0.85rem' }}>
          Найдено: {filteredChats.length} из {chats.length}
        </p>
      )}

      <div className="tableWrap" style={{ maxHeight: 500, overflowY: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Включено</th>
              <th>Название</th>
              <th>Username</th>
              <th>Chat ID</th>
            </tr>
          </thead>
          <tbody>
            {chats.length === 0 && (
              <tr>
                <td colSpan={4} style={{ color: 'var(--muted)' }}>
                  Пока нет чатов. Нажмите «Синхронизировать группы» после авторизации.
                </td>
              </tr>
            )}
            {chats.length > 0 && filteredChats.length === 0 && (
              <tr>
                <td colSpan={4} style={{ color: 'var(--muted)' }}>
                  По запросу ничего не найдено.
                </td>
              </tr>
            )}
            {filteredChats.map((chat) => (
              <tr key={chat.id}>
                <td>
                  <input
                    type="checkbox"
                    checked={chat.enabled}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      void runAction(`toggle-${chat.chatId}`, async () => {
                        const res = await fetch(
                          `${getApiBase()}/telegram-userbot/chats/${encodeURIComponent(chat.chatId)}`,
                          {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ enabled: checked }),
                          },
                        );
                        if (!res.ok) {
                          throw new Error(`Ошибка сохранения (${res.status})`);
                        }
                        setChats((prev) =>
                          prev.map((row) =>
                            row.id === chat.id ? { ...row, enabled: checked } : row,
                          ),
                        );
                        setStatus((prev) =>
                          prev
                            ? {
                                ...prev,
                                chatsEnabled: Math.max(
                                  0,
                                  prev.chatsEnabled + (checked ? 1 : -1),
                                ),
                              }
                            : prev,
                        );
                      });
                    }}
                  />
                </td>
                <td>
                  <span className="chatName">{chat.title}</span>
                </td>
                <td>{chat.username ? `@${chat.username}` : '-'}</td>
                <td>{chat.chatId}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
