'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { fetchApiResponse } from '../../lib/api';
import { withAppBasePath } from '../../lib/base-path';
import { readActiveCabinetIdClient } from '../../lib/cabinet-client.util';

type PublishGroup = {
  id: string;
  title: string;
  chatId: string;
  enabled: boolean;
  publishEveryN: number;
  signalCounter: number;
  linkedToApp?: boolean;
};

type QpulseSettings = {
  enabled: boolean;
  apiUrl: string;
  apiKeyConfigured: boolean;
};

export default function MyGroupPage() {
  const router = useRouter();
  const [adminChecked, setAdminChecked] = useState(false);
  const [items, setItems] = useState<PublishGroup[]>([]);
  const [qpulse, setQpulse] = useState<QpulseSettings>({
    enabled: false,
    apiUrl: '',
    apiKeyConfigured: false,
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [title, setTitle] = useState('');
  const [chatId, setChatId] = useState('');
  const [publishEveryN, setPublishEveryN] = useState('1');
  const [linkedToApp, setLinkedToApp] = useState(false);
  const [qpulseEnabled, setQpulseEnabled] = useState(false);
  const [qpulseApiUrl, setQpulseApiUrl] = useState('');
  const [qpulseApiKey, setQpulseApiKey] = useState('');

  const apiFetch = (path: string, init?: RequestInit) => {
    return fetchApiResponse(path, init, readActiveCabinetIdClient());
  };

  async function loadAll() {
    const [groupsRes, qpulseRes] = await Promise.all([
      apiFetch('/telegram-userbot/publish-groups'),
      apiFetch('/telegram-userbot/qpulse-settings'),
    ]);
    const j = (await groupsRes.json()) as { items?: PublishGroup[] };
    setItems(Array.isArray(j.items) ? j.items : []);
    const q = (await qpulseRes.json()) as QpulseSettings;
    setQpulse(q);
    setQpulseEnabled(Boolean(q.enabled));
    setQpulseApiUrl(q.apiUrl ?? '');
  }

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(withAppBasePath('/api/auth'), { cache: 'no-store' });
        const json = (await res.json().catch(() => null)) as
          | { authenticated?: boolean; role?: string }
          | null;
        const ok =
          Boolean(json?.authenticated) &&
          String(json?.role ?? '').trim().toLowerCase() === 'admin';
        if (!ok) {
          router.replace('/');
          return;
        }
      } catch {
        router.replace('/');
        return;
      } finally {
        setAdminChecked(true);
      }
    })();
  }, [router]);

  useEffect(() => {
    if (!adminChecked) return;
    void loadAll();
  }, [adminChecked]);

  if (!adminChecked) {
    return <p style={{ color: 'var(--muted)' }}>Проверка доступа…</p>;
  }

  async function runBusy(key: string, fn: () => Promise<void>) {
    setBusy(key);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setMsg({ type: 'err', text: e instanceof Error ? e.message : 'Ошибка' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <h1 className="pageTitle">Моя группа</h1>
      {msg && <div className={`msg ${msg.type === 'ok' ? 'ok' : 'err'}`}>{msg.text}</div>}

      <div className="card" style={{ marginBottom: '1rem' }}>
        <h3 style={{ marginBottom: '0.5rem' }}>Подключение QPulse</h3>
        <p style={{ color: 'var(--muted)', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
          Группы с «Подключить к приложению» отправляют сигналы (с учётом N) в QPulse. Группы без
          галочки — только Telegram.
        </p>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))',
            gap: '0.75rem',
          }}
        >
          <label className="inlineCheckboxLabel">
            <input
              type="checkbox"
              checked={qpulseEnabled}
              onChange={(e) => setQpulseEnabled(e.target.checked)}
            />
            Синхронизация с QPulse включена
          </label>
          <div>
            <label className="inlineCheckboxLabel" style={{ marginBottom: '0.35rem' }}>
              API URL
            </label>
            <input
              value={qpulseApiUrl}
              onChange={(e) => setQpulseApiUrl(e.target.value)}
              placeholder="https://example.up.railway.app/api/v1"
              className="userbotDefaultsInput"
            />
          </div>
          <div>
            <label className="inlineCheckboxLabel" style={{ marginBottom: '0.35rem' }}>
              API Key {qpulse.apiKeyConfigured ? '(задан)' : ''}
            </label>
            <input
              value={qpulseApiKey}
              onChange={(e) => setQpulseApiKey(e.target.value)}
              placeholder="Новый ключ (оставьте пустым, чтобы не менять)"
              className="userbotDefaultsInput"
              type="password"
              autoComplete="off"
            />
          </div>
        </div>
        <div style={{ marginTop: '0.75rem' }}>
          <button
            className="btn btnSecondary"
            disabled={busy !== null}
            onClick={() =>
              void runBusy('qpulse', async () => {
                const res = await apiFetch('/telegram-userbot/qpulse-settings', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    enabled: qpulseEnabled,
                    apiUrl: qpulseApiUrl,
                    ...(qpulseApiKey.trim() ? { apiKey: qpulseApiKey.trim() } : {}),
                  }),
                });
                const j = (await res.json()) as { ok?: boolean; error?: string };
                if (!j.ok) throw new Error(j.error ?? 'Не удалось сохранить QPulse');
                setQpulseApiKey('');
                setMsg({ type: 'ok', text: 'Настройки QPulse сохранены' });
                await loadAll();
              })
            }
          >
            {busy === 'qpulse' ? 'Сохранение…' : 'Сохранить QPulse'}
          </button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <h3 style={{ marginBottom: '0.5rem' }}>Добавить группу для публикации</h3>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))',
            gap: '0.75rem',
          }}
        >
          <div>
            <label className="inlineCheckboxLabel" style={{ marginBottom: '0.35rem' }}>
              Название
            </label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Например: Публичная группа"
              className="userbotDefaultsInput"
            />
          </div>
          <div>
            <label className="inlineCheckboxLabel" style={{ marginBottom: '0.35rem' }}>
              Chat ID
            </label>
            <input
              value={chatId}
              onChange={(e) => setChatId(e.target.value)}
              placeholder="Например: -1001234567890"
              className="userbotDefaultsInput"
            />
          </div>
          <div>
            <label className="inlineCheckboxLabel" style={{ marginBottom: '0.35rem' }}>
              Публиковать каждый N сигнал
            </label>
            <input
              value={publishEveryN}
              onChange={(e) => setPublishEveryN(e.target.value)}
              className="userbotDefaultsInput"
              inputMode="numeric"
              placeholder="1"
            />
          </div>
          <label className="inlineCheckboxLabel" style={{ alignSelf: 'end' }}>
            <input
              type="checkbox"
              checked={linkedToApp}
              onChange={(e) => setLinkedToApp(e.target.checked)}
            />
            Подключить к приложению (QPulse)
          </label>
        </div>
        <div style={{ marginTop: '0.75rem' }}>
          <button
            className="btn"
            disabled={busy !== null}
            onClick={() =>
              void runBusy('create', async () => {
                const res = await apiFetch('/telegram-userbot/publish-groups', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    title,
                    chatId,
                    enabled: true,
                    publishEveryN: Number(publishEveryN || '1'),
                    linkedToApp,
                  }),
                });
                const j = (await res.json()) as { ok?: boolean; error?: string };
                if (!j.ok) throw new Error(j.error ?? 'Не удалось добавить группу');
                setTitle('');
                setChatId('');
                setPublishEveryN('1');
                setLinkedToApp(false);
                setMsg({ type: 'ok', text: 'Группа добавлена' });
                await loadAll();
              })
            }
          >
            {busy === 'create' ? 'Сохранение…' : 'Добавить'}
          </button>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginBottom: '0.5rem' }}>Группы публикации</h3>
        {items.length === 0 ? (
          <p style={{ color: 'var(--muted)' }}>Пока нет ни одной группы.</p>
        ) : (
          <div style={{ display: 'grid', gap: '0.7rem' }}>
            {items.map((g) => (
              <div key={g.id} className="card" style={{ margin: 0, padding: '0.8rem 0.95rem' }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: '0.75rem',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 700 }}>
                      {g.title}
                      {g.linkedToApp ? (
                        <span style={{ color: 'var(--accent)', fontSize: '0.8rem', marginLeft: '0.5rem' }}>
                          · QPulse
                        </span>
                      ) : null}
                    </div>
                    <div style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>{g.chatId}</div>
                    <div style={{ color: 'var(--muted)', fontSize: '0.82rem', marginTop: '0.25rem' }}>
                      Публиковать каждый <b>{g.publishEveryN}</b> сигнал · счетчик: {g.signalCounter}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
                    <button
                      className="btn btnSecondary btnSm"
                      disabled={busy !== null}
                      onClick={() =>
                        void runBusy(`link-${g.id}`, async () => {
                          const res = await apiFetch('/telegram-userbot/publish-groups', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              id: g.id,
                              title: g.title,
                              chatId: g.chatId,
                              enabled: g.enabled,
                              publishEveryN: g.publishEveryN,
                              linkedToApp: !g.linkedToApp,
                            }),
                          });
                          const j = (await res.json()) as { ok?: boolean; error?: string };
                          if (!j.ok) throw new Error(j.error ?? 'Не удалось обновить группу');
                          await loadAll();
                        })
                      }
                    >
                      {g.linkedToApp ? 'Отключить QPulse' : 'Подключить QPulse'}
                    </button>
                    <button
                      className="btn btnSecondary btnSm"
                      disabled={busy !== null}
                      onClick={() =>
                        void runBusy(`toggle-${g.id}`, async () => {
                          const res = await apiFetch('/telegram-userbot/publish-groups', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              id: g.id,
                              title: g.title,
                              chatId: g.chatId,
                              enabled: !g.enabled,
                              publishEveryN: g.publishEveryN,
                              linkedToApp: g.linkedToApp === true,
                            }),
                          });
                          const j = (await res.json()) as { ok?: boolean; error?: string };
                          if (!j.ok) throw new Error(j.error ?? 'Не удалось обновить группу');
                          await loadAll();
                        })
                      }
                    >
                      {g.enabled ? 'Выключить' : 'Включить'}
                    </button>
                    <button
                      className="btn btnDanger btnSm"
                      disabled={busy !== null}
                      onClick={() =>
                        void runBusy(`delete-${g.id}`, async () => {
                          const res = await apiFetch(
                            `/telegram-userbot/publish-groups/${encodeURIComponent(g.id)}/delete`,
                            { method: 'POST' },
                          );
                          const j = (await res.json()) as { ok?: boolean; error?: string };
                          if (!j.ok) throw new Error(j.error ?? 'Не удалось удалить группу');
                          await loadAll();
                        })
                      }
                    >
                      Удалить
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
