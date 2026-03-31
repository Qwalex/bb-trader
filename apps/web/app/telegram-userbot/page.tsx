'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';

import { EntrySizingControl } from '../components/EntrySizingControl';
import { UserbotMessageCard } from '../components/UserbotMessageCard';
import { getApiBase } from '../../lib/api';
import type { EntrySizingMode } from '../../lib/entry-sizing';
import { parseStoredEntry, serializeEntry } from '../../lib/entry-sizing';

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
  balanceGuard?: {
    minBalanceUsd: number;
    balanceUsd: number | null;
    totalBalanceUsd: number | null;
    paused: boolean;
    reason?: string;
  };
};

type UserbotChat = {
  id: string;
  chatId: string;
  title: string;
  username: string | null;
  enabled: boolean;
  defaultLeverage: number | null;
  defaultEntryUsd: string | null;
  martingaleMultiplier: number | null;
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
  const [sourceStatsBySource, setSourceStatsBySource] = useState<
    Record<string, { winrate: number; totalPnl: number }>
  >({});
  const sourceStatsInFlightRef = useRef<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [onlySignals, setOnlySignals] = useState(true);
  const [groupByChat, setGroupByChat] = useState(true);
  const [traceModal, setTraceModal] = useState<TraceModalState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [globalEntryMode, setGlobalEntryMode] = useState<EntrySizingMode>('usdt');
  const [globalEntryAmount, setGlobalEntryAmount] = useState('');
  const [globalLev, setGlobalLev] = useState('');
  const [globalMartingaleDefault, setGlobalMartingaleDefault] = useState('');
  const [globalDefaultsLoaded, setGlobalDefaultsLoaded] = useState(false);
  const [entryByChat, setEntryByChat] = useState<
    Record<string, { mode: EntrySizingMode; amount: string }>
  >({});

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

  const recentByChatAccordion = useMemo(() => {
    if (!groupByChat) return null;
    const map = new Map<string, TodayMetrics['recent'][number][]>();
    for (const row of filteredRecent) {
      const list = map.get(row.chatId) ?? [];
      list.push(row);
      map.set(row.chatId, list);
    }
    return Array.from(map.entries())
      .map(([chatId, rows]) => ({
        chatId,
        rows: [...rows].sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        ),
      }))
      .sort((a, b) => a.chatId.localeCompare(b.chatId));
  }, [filteredRecent, groupByChat]);

  useEffect(() => {
    if (!groupByChat || !recentByChatAccordion) return;

    const sources = Array.from(
      new Set(
        recentByChatAccordion
          .map((g) => chatTitleById.get(g.chatId) ?? g.chatId)
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    );
    if (sources.length === 0) return;

    const missing = sources.filter((s) => sourceStatsBySource[s] == null).filter((s) => !sourceStatsInFlightRef.current.has(s));
    if (missing.length === 0) return;

    for (const s of missing) sourceStatsInFlightRef.current.add(s);

    let cancelled = false;
    void (async () => {
      try {
        const results = await Promise.all(
          missing.map(async (source) => {
            const res = await fetch(
              `${getApiBase()}/orders/stats?source=${encodeURIComponent(source)}`,
            );
            if (!res.ok) {
              return { source, winrate: 0, totalPnl: 0 };
            }
            const j = (await res.json()) as { winrate?: number; totalPnl?: number };
            return {
              source,
              winrate: typeof j.winrate === 'number' ? j.winrate : 0,
              totalPnl: typeof j.totalPnl === 'number' ? j.totalPnl : 0,
            };
          }),
        );

        if (cancelled) return;
        setSourceStatsBySource((prev) => ({
          ...prev,
          ...Object.fromEntries(
            results.map((r) => [r.source, { winrate: r.winrate, totalPnl: r.totalPnl }]),
          ),
        }));
      } finally {
        for (const s of missing) sourceStatsInFlightRef.current.delete(s);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [groupByChat, recentByChatAccordion, chatTitleById, sourceStatsBySource]);

  async function loadAll() {
    const [s, c, m, raw] = await Promise.all([
      fetch(`${getApiBase()}/telegram-userbot/status`).then((r) => r.json()),
      fetch(`${getApiBase()}/telegram-userbot/chats`).then((r) => r.json()),
      fetch(`${getApiBase()}/telegram-userbot/metrics/today`).then((r) => r.json()),
      fetch(`${getApiBase()}/settings/raw`).then((r) => r.json()),
    ]);
    setStatus(s as BotStatus);
    const chatsList = c as UserbotChat[];
    setChats(chatsList);
    setMetrics(m as TodayMetrics);
    const rows = (raw as { settings?: { key: string; value: string }[] })?.settings ?? [];
    const byKey = new Map(rows.map((r) => [r.key, r.value]));
    const ge = parseStoredEntry(byKey.get('DEFAULT_ORDER_USD'));
    setGlobalEntryMode(ge.mode);
    setGlobalEntryAmount(ge.amount);
    setEntryByChat(
      Object.fromEntries(chatsList.map((x) => [x.chatId, parseStoredEntry(x.defaultEntryUsd)])),
    );
    setGlobalLev(byKey.get('DEFAULT_LEVERAGE') ?? '');
    setGlobalMartingaleDefault(byKey.get('SOURCE_MARTINGALE_DEFAULT_MULTIPLIER') ?? '');
    setGlobalDefaultsLoaded(true);
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

  async function commitChatDefaultEntry(
    chat: UserbotChat,
    mode: EntrySizingMode,
    amount: string,
  ) {
    const raw = serializeEntry(mode, amount);
    const next = raw === '' ? null : raw;
    const same =
      (next === null && chat.defaultEntryUsd === null) || next === chat.defaultEntryUsd;
    if (same) return;
    await runAction(`ent-${chat.chatId}`, async () => {
      const res = await fetch(
        `${getApiBase()}/telegram-userbot/chats/${encodeURIComponent(chat.chatId)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ defaultEntryUsd: next }),
        },
      );
      if (!res.ok) {
        throw new Error(`Ошибка сохранения (${res.status})`);
      }
      setChats((prev) =>
        prev.map((row) => (row.id === chat.id ? { ...row, defaultEntryUsd: next } : row)),
      );
      setEntryByChat((prev) => ({
        ...prev,
        [chat.chatId]: parseStoredEntry(next),
      }));
      setMsg({ type: 'ok', text: 'Сумма входа для источника сохранена' });
    });
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
      case 'reentry_placed':
        return 'Прочитано -> распознан перезаход -> старый закрыт -> новый установлен';
      case 'reentry_updated':
        return 'Прочитано -> распознан перезаход -> обновлены SL/TP в текущем сигнале';
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
      {msg && (
        <p className={`msg ${msg.type === 'ok' ? 'ok' : 'err'}`} style={{ marginBottom: '1rem' }}>
          {msg.text}
        </p>
      )}
      {status?.balanceGuard?.paused && (
        <p className="msg err" style={{ marginBottom: '1rem' }}>
          {status.balanceGuard.reason ??
            `Автоматическая установка ордеров приостановлена: доступный баланс ниже порога ${(status?.balanceGuard?.minBalanceUsd ?? 3).toFixed(2)}$`}
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
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: '0.75rem',
            marginTop: '0.75rem',
          }}
        >
          <div
            className="card"
            style={{ margin: 0, padding: '0.85rem 1rem' }}
          >
            <h4 style={{ fontSize: '0.95rem', marginBottom: '0.35rem' }}>Баланс (Bybit)</h4>
            <div style={{ fontSize: '1.35rem', fontWeight: 700 }}>
              {status?.balanceGuard?.totalBalanceUsd != null
                ? `${status.balanceGuard.totalBalanceUsd.toFixed(2)}$`
                : '—'}
            </div>
            <p style={{ color: 'var(--muted)', marginTop: '0.5rem', fontSize: '0.8rem' }}>
              Суммарный USDT
            </p>
          </div>
          <div
            className="card"
            style={{ margin: 0, padding: '0.85rem 1rem' }}
          >
            <h4 style={{ fontSize: '0.95rem', marginBottom: '0.35rem' }}>Доступный баланс (Bybit)</h4>
            <div style={{ fontSize: '1.35rem', fontWeight: 700 }}>
              {status?.balanceGuard?.balanceUsd != null
                ? `${status.balanceGuard.balanceUsd.toFixed(2)}$`
                : '—'}
            </div>
            <p style={{ color: 'var(--muted)', marginTop: '0.5rem', fontSize: '0.8rem' }}>
              Порог автоторговли: {(status?.balanceGuard?.minBalanceUsd ?? 3).toFixed(2)}$
            </p>
          </div>
        </div>
        {status?.balanceGuard?.paused && (
          <p className="msg err" style={{ marginTop: '0.5rem' }}>
            {status.balanceGuard.reason ??
              `Автоматическая установка ордеров приостановлена: доступный баланс ниже порога ${(status?.balanceGuard?.minBalanceUsd ?? 3).toFixed(2)}$`}
          </p>
        )}
        <p style={{ color: 'var(--muted)', marginTop: '0.5rem' }}>
          Обработка сообщений: только за текущий день.
        </p>
      </div>

      <div className="card userbotDefaultsCard" style={{ marginBottom: '1rem' }}>
        <h3 className="sectionTitle">Общие дефолты для сигналов</h3>
        <p className="userbotDefaultsIntro">
          Используются для всех источников, пока у чата нет своих значений. Сумма входа: переключатель
          USDT или % от суммарного баланса Bybit, в поле — только число (например при 10% и балансе 80
          USDT номинал будет 8 USDT).
        </p>
        {globalDefaultsLoaded && (
          <>
            <div className="userbotDefaultsGrid">
              <div className="userbotDefaultsField">
                <span className="userbotDefaultsFieldLabel">Сумма входа</span>
                <span className="userbotDefaultsFieldName">Глобально</span>
                <span className="userbotDefaultsFieldHint">USDT или % — переключатель и число</span>
                <EntrySizingControl
                  mode={globalEntryMode}
                  amount={globalEntryAmount}
                  disabled={busy !== null}
                  onChange={(m, amt) => {
                    setGlobalEntryMode(m);
                    setGlobalEntryAmount(amt);
                  }}
                />
              </div>
              <div className="userbotDefaultsField">
                <span className="userbotDefaultsFieldLabel">Плечо</span>
                <span className="userbotDefaultsFieldName">Глобально</span>
                <span className="userbotDefaultsFieldHint">Целое число, напр. 5 или 10</span>
                <input
                  className="userbotDefaultsInput"
                  value={globalLev}
                  onChange={(e) => setGlobalLev(e.target.value)}
                  placeholder="10"
                  inputMode="numeric"
                  autoComplete="off"
                  aria-label="Дефолт кредитного плеча"
                />
              </div>
              <div className="userbotDefaultsField">
                <span className="userbotDefaultsFieldLabel">Мартингейл</span>
                <span className="userbotDefaultsFieldName">Глобально (дефолт)</span>
                <span className="userbotDefaultsFieldHint">
                  Множитель после убыточной сделки, напр. 1.2 (пусто = выключено)
                </span>
                <input
                  className="userbotDefaultsInput"
                  value={globalMartingaleDefault}
                  onChange={(e) => setGlobalMartingaleDefault(e.target.value)}
                  placeholder="1.2"
                  inputMode="decimal"
                  autoComplete="off"
                  aria-label="Дефолтный множитель мартингейла"
                />
              </div>
            </div>
            <div className="userbotDefaultsActions">
              <button
                className="btn"
                type="button"
                disabled={busy !== null}
                onClick={() =>
                  void runAction('save-global-defaults', async () => {
                    await fetch(`${getApiBase()}/settings`, {
                      method: 'PUT',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        key: 'DEFAULT_ORDER_USD',
                        value: serializeEntry(globalEntryMode, globalEntryAmount),
                      }),
                    });
                    await fetch(`${getApiBase()}/settings`, {
                      method: 'PUT',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ key: 'DEFAULT_LEVERAGE', value: globalLev.trim() }),
                    });
                    await fetch(`${getApiBase()}/settings`, {
                      method: 'PUT',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        key: 'SOURCE_MARTINGALE_DEFAULT_MULTIPLIER',
                        value: globalMartingaleDefault.trim(),
                      }),
                    });
                    setMsg({ type: 'ok', text: 'Общие дефолты сохранены' });
                  })
                }
              >
                {busy === 'save-global-defaults' ? 'Сохранение…' : 'Сохранить'}
              </button>
            </div>
          </>
        )}
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
      <div style={{ height: 30 }} ></div>
      <div>
        <h3 style={{ marginBottom: '0.5rem' }}>Последние сообщения</h3>
        <div className="filters" style={{ marginBottom: '0.75rem' }}>
          <label className="inlineCheckboxLabel">
            <input
              className="inlineCheckbox"
              type="checkbox"
              checked={onlySignals}
              onChange={(e) => setOnlySignals(e.target.checked)}
            />
            Показывать только сигналы
          </label>
          <label className="inlineCheckboxLabel">
            <input
              className="inlineCheckbox"
              type="checkbox"
              checked={groupByChat}
              onChange={(e) => setGroupByChat(e.target.checked)}
            />
            Разбивать по группам
          </label>
        </div>
        {groupByChat && recentByChatAccordion ? (
          <div className="userbotRecentScroll">
            {recentByChatAccordion.map((group) => {
              const chatTitle = chatTitleById.get(group.chatId) ?? group.chatId;
              const chatTitleKey = chatTitle.trim();
              const rows = group.rows;
              const st = sourceStatsBySource[chatTitleKey];
              const pnlStr =
                st?.totalPnl != null
                  ? `${st.totalPnl >= 0 ? '+' : ''}${st.totalPnl.toFixed(2)}`
                  : '—';
              const winrateStr = st ? `${st.winrate.toFixed(1)}%` : '—';
              return (
                <details key={group.chatId} className="userbotRecentGroup">
                  <summary title={group.chatId}>
                    <span>{chatTitle}</span>
                    <span
                      className="userbotRecentGroupBadge"
                      style={{ display: 'flex', gap: '0.65rem', alignItems: 'baseline' }}
                    >
                      <span>{rows.length} сообщ.</span>
                      <span title={`PnL: ${pnlStr}`}>PnL {pnlStr}</span>
                      <span title={`Winrate: ${winrateStr}`}>WR {winrateStr}</span>
                    </span>
                  </summary>
                  <div className="userbotMessageCardList">
                    {rows.map((row, idx) => {
                      const prev = idx > 0 ? rows[idx - 1] : null;
                      const showTodayDivider =
                        row.isToday && (!prev || prev.isToday === false);
                      const showOldDivider = !row.isToday && prev?.isToday === true;

                      return (
                        <Fragment key={row.id}>
                          {(showTodayDivider || showOldDivider) && (
                            <div className="userbotMessageDayDivider">
                              {showTodayDivider ? 'Сегодня' : 'Старые сообщения'}
                            </div>
                          )}
                          <UserbotMessageCard
                            row={row}
                            pipelineStatus={renderPipelineStatus(row)}
                            disabled={busy !== null}
                            rereadBusy={busy === `reread-${row.id}`}
                            onTrace={() =>
                              setTraceModal({
                                chatId: row.chatId,
                                messageId: row.messageId,
                                request: row.aiRequest,
                                response: row.aiResponse,
                              })
                            }
                            onReread={() =>
                              void runAction(`reread-${row.id}`, async () => {
                                const res = await fetch(
                                  `${getApiBase()}/telegram-userbot/reread/${encodeURIComponent(
                                    row.id,
                                  )}`,
                                  { method: 'POST' },
                                );
                                const j = (await res.json()) as {
                                  ok?: boolean;
                                  error?: string;
                                };
                                if (!j.ok) {
                                  throw new Error(
                                    j.error ?? 'Не удалось перечитать сообщение',
                                  );
                                }
                                await loadAll();
                                setMsg({
                                  type: 'ok',
                                  text: `Сообщение ${row.messageId} перечитано`,
                                });
                              })
                            }
                          />
                        </Fragment>
                      );
                    })}
                  </div>
                </details>
              );
            })}
          </div>
        ) : (
          <div className="userbotRecentScroll">
            <div className="userbotMessageListFlat">
              {filteredRecent.length === 0 && (
                <div className="userbotRecentEmpty">
                  Сообщения по текущему фильтру не найдены.
                </div>
              )}
              {filteredRecent.map((row, idx, arr) => {
                const prev = idx > 0 ? arr[idx - 1] : null;
                const showChatDivider =
                  groupByChat && (!prev || prev.chatId !== row.chatId);
                const showTodayDivider =
                  (!prev || showChatDivider) && row.isToday;
                const showOldDivider =
                  !showChatDivider &&
                  (prev?.isToday ?? false) &&
                  row.isToday === false;
                const showChatMeta =
                  !groupByChat && (!prev || prev.chatId !== row.chatId);

                return (
                  <Fragment key={row.id}>
                    {showChatDivider && (
                      <div className="userbotMessageChatDivider">
                        <span className="userbotMessageChatDividerTitle">
                          {chatTitleById.get(row.chatId) ?? row.chatId}
                        </span>
                        <span className="userbotMessageChatDividerMeta">{row.chatId}</span>
                      </div>
                    )}
                    {(showTodayDivider || showOldDivider) && (
                      <div className="userbotMessageDayDivider">
                        {showTodayDivider ? 'Сегодня' : 'Старые сообщения'}
                      </div>
                    )}
                    <UserbotMessageCard
                      row={row}
                      showChatMeta={showChatMeta}
                      chatTitle={chatTitleById.get(row.chatId) ?? row.chatId}
                      pipelineStatus={renderPipelineStatus(row)}
                      disabled={busy !== null}
                      rereadBusy={busy === `reread-${row.id}`}
                      onTrace={() =>
                        setTraceModal({
                          chatId: row.chatId,
                          messageId: row.messageId,
                          request: row.aiRequest,
                          response: row.aiResponse,
                        })
                      }
                      onReread={() =>
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
                            throw new Error(
                              j.error ?? 'Не удалось перечитать сообщение',
                            );
                          }
                          await loadAll();
                          setMsg({
                            type: 'ok',
                            text: `Сообщение ${row.messageId} перечитано`,
                          });
                        })
                      }
                    />
                  </Fragment>
                );
              })}
            </div>
          </div>
        )}

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

      <div className="userbotChatCards">
        {chats.length === 0 && (
          <p className="userbotChatEmpty">
            Пока нет чатов. Нажмите «Синхронизировать группы» после авторизации.
          </p>
        )}
        {chats.length > 0 && filteredChats.length === 0 && (
          <p className="userbotChatEmpty">По запросу ничего не найдено.</p>
        )}
        {filteredChats.map((chat) => (
          <article key={chat.id} className="userbotChatCard">
            <div className="userbotChatCardHeader">
              <h4 className="userbotChatCardTitle">{chat.title}</h4>
              <label className="userbotChatCardToggle">
                <input
                  className="inlineCheckbox"
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
                <span>Включено</span>
              </label>
            </div>
            <div className="userbotChatCardMeta">
              {chat.username ? (
                <>
                  <span>@{chat.username}</span>
                  <span aria-hidden="true"> · </span>
                </>
              ) : (
                <span>— · </span>
              )}
              <code>{chat.chatId}</code>
            </div>
            <div className="userbotChatCardParams">
              <div>
                <span className="userbotChatCardParamLabel">Плечо</span>
                <input
                  className="userbotCellInput"
                  type="number"
                  min={1}
                  step={1}
                  key={`lev-${chat.chatId}-${chat.defaultLeverage ?? 'x'}`}
                  defaultValue={chat.defaultLeverage ?? ''}
                  placeholder="авто"
                  title="Пусто — общий DEFAULT_LEVERAGE"
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    const num = v === '' ? null : Number.parseInt(v, 10);
                    if (
                      v !== '' &&
                      (!Number.isFinite(num) || num === null || num < 1)
                    ) {
                      setMsg({
                        type: 'err',
                        text: 'Плечо: целое число не меньше 1 или пусто',
                      });
                      return;
                    }
                    const same =
                      (num === null && chat.defaultLeverage === null) ||
                      num === chat.defaultLeverage;
                    if (same) return;
                    void runAction(`lev-${chat.chatId}`, async () => {
                      const res = await fetch(
                        `${getApiBase()}/telegram-userbot/chats/${encodeURIComponent(chat.chatId)}`,
                        {
                          method: 'PUT',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ defaultLeverage: num }),
                        },
                      );
                      if (!res.ok) {
                        throw new Error(`Ошибка сохранения (${res.status})`);
                      }
                      setChats((prev) =>
                        prev.map((row) =>
                          row.id === chat.id ? { ...row, defaultLeverage: num } : row,
                        ),
                      );
                      setMsg({ type: 'ok', text: 'Плечо для источника сохранено' });
                    });
                  }}
                />
              </div>
              <div>
                <span className="userbotChatCardParamLabel">Мартингейл</span>
                <input
                  className="userbotCellInput"
                  type="number"
                  min={1}
                  step={0.01}
                  key={`mrt-${chat.chatId}-${chat.martingaleMultiplier ?? 'x'}`}
                  defaultValue={chat.martingaleMultiplier ?? ''}
                  placeholder="дефолт"
                  title="Пусто — дефолтный множитель из настроек"
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    const num = v === '' ? null : Number.parseFloat(v);
                    if (v !== '' && (!Number.isFinite(num) || num === null || num <= 1)) {
                      setMsg({
                        type: 'err',
                        text: 'Мартингейл: число больше 1 или пусто',
                      });
                      return;
                    }
                    const same =
                      (num === null && chat.martingaleMultiplier === null) ||
                      num === chat.martingaleMultiplier;
                    if (same) return;
                    void runAction(`mrt-${chat.chatId}`, async () => {
                      const res = await fetch(
                        `${getApiBase()}/telegram-userbot/chats/${encodeURIComponent(chat.chatId)}`,
                        {
                          method: 'PUT',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ martingaleMultiplier: num }),
                        },
                      );
                      if (!res.ok) {
                        throw new Error(`Ошибка сохранения (${res.status})`);
                      }
                      setChats((prev) =>
                        prev.map((row) =>
                          row.id === chat.id ? { ...row, martingaleMultiplier: num } : row,
                        ),
                      );
                      setMsg({ type: 'ok', text: 'Мартингейл для источника сохранен' });
                    });
                  }}
                />
              </div>
              <div>
                <span className="userbotChatCardParamLabel">Сумма входа</span>
                <EntrySizingControl
                  mode={
                    entryByChat[chat.chatId]?.mode ??
                    parseStoredEntry(chat.defaultEntryUsd).mode
                  }
                  amount={
                    entryByChat[chat.chatId]?.amount ??
                    parseStoredEntry(chat.defaultEntryUsd).amount
                  }
                  disabled={busy !== null}
                  onChange={(m, amt) => {
                    setEntryByChat((prev) => ({
                      ...prev,
                      [chat.chatId]: { mode: m, amount: amt },
                    }));
                  }}
                  onBlur={(m, amt) => void commitChatDefaultEntry(chat, m, amt)}
                  onModeChange={(m, amt) => void commitChatDefaultEntry(chat, m, amt)}
                />
              </div>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
