'use client';

import { useEffect, useState } from 'react';

import { getApiBase, withCabinetQuery } from '../../lib/api';

type PublishGroup = {
  id: string;
  title: string;
  chatId: string;
  enabled: boolean;
  publishEveryN: number;
  signalCounter: number;
};

export default function MyGroupPage() {
  const [items, setItems] = useState<PublishGroup[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [title, setTitle] = useState('');
  const [chatId, setChatId] = useState('');
  const [publishEveryN, setPublishEveryN] = useState('1');

  const withCabinet = (path: string) => {
    const cabinetId = localStorage.getItem('active_cabinet_id');
    return `${getApiBase()}${withCabinetQuery(path, cabinetId)}`;
  };

  async function loadAll() {
    const res = await fetch(withCabinet('/telegram-userbot/publish-groups'), {
      cache: 'no-store',
    });
    const j = (await res.json()) as { items?: PublishGroup[] };
    setItems(Array.isArray(j.items) ? j.items : []);
  }

  useEffect(() => {
    void loadAll();
  }, []);

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
              placeholder="Например: Моя VIP группа"
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
        </div>
        <div style={{ marginTop: '0.75rem' }}>
          <button
            className="btn"
            disabled={busy !== null}
            onClick={() =>
              void runBusy('create', async () => {
                const res = await fetch(withCabinet('/telegram-userbot/publish-groups'), {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    title,
                    chatId,
                    enabled: true,
                    publishEveryN: Number(publishEveryN || '1'),
                  }),
                });
                const j = (await res.json()) as { ok?: boolean; error?: string };
                if (!j.ok) throw new Error(j.error ?? 'Не удалось добавить группу');
                setTitle('');
                setChatId('');
                setPublishEveryN('1');
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
                    <div style={{ fontWeight: 700 }}>{g.title}</div>
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
                        void runBusy(`toggle-${g.id}`, async () => {
                          const res = await fetch(withCabinet('/telegram-userbot/publish-groups'), {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              id: g.id,
                              title: g.title,
                              chatId: g.chatId,
                              enabled: !g.enabled,
                              publishEveryN: g.publishEveryN,
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
                          const res = await fetch(
                            withCabinet(`/telegram-userbot/publish-groups/${encodeURIComponent(g.id)}/delete`),
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

