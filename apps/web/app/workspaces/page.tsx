'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { ACTIVE_WORKSPACE_STORAGE_KEY } from '../../lib/active-workspace';
import { getApiBase } from '../../lib/api';

type Ws = { id: string; name: string; slug: string; role: string };

function dedupeById(list: Ws[]): Ws[] {
  const m = new Map<string, Ws>();
  for (const w of list) {
    if (!m.has(w.id)) m.set(w.id, w);
  }
  return Array.from(m.values());
}

export default function WorkspacesPage() {
  const [list, setList] = useState<Ws[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [newLogin, setNewLogin] = useState('');
  const [editing, setEditing] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch(`${getApiBase()}/workspaces`);
      if (!res.ok) {
        setMsg({ type: 'err', text: 'Не удалось загрузить кабинеты' });
        setList([]);
        return;
      }
      const data = (await res.json()) as { workspaces?: Ws[] };
      const ws = dedupeById(data.workspaces ?? []);
      setList(ws);
      const nextEditing: Record<string, string> = {};
      for (const w of ws) nextEditing[w.id] = w.name;
      setEditing(nextEditing);
    } catch {
      setMsg({ type: 'err', text: 'Сеть или API недоступны' });
      setList([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const [activeWsId, setActiveWsId] = useState('');
  useEffect(() => {
    try {
      setActiveWsId(localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY)?.trim() ?? '');
    } catch {
      setActiveWsId('');
    }
  }, [list]);

  const onRename = async (id: string) => {
    const name = (editing[id] ?? '').trim();
    if (!name || busyId) return;
    setBusyId(id);
    setMsg(null);
    try {
      const res = await fetch(`${getApiBase()}/workspaces/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const t = await res.text();
        setMsg({ type: 'err', text: t || 'Не удалось сохранить' });
        return;
      }
      setMsg({ type: 'ok', text: 'Название сохранено' });
      await load();
    } catch {
      setMsg({ type: 'err', text: 'Ошибка запроса' });
    } finally {
      setBusyId(null);
    }
  };

  const onDelete = async (id: string) => {
    if (list.length <= 1) {
      setMsg({ type: 'err', text: 'Нельзя удалить последний кабинет' });
      return;
    }
    if (!window.confirm('Удалить кабинет и все связанные данные (сделки, настройки и т.д.)?')) {
      return;
    }
    setBusyId(id);
    setMsg(null);
    try {
      const res = await fetch(`${getApiBase()}/workspaces/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const t = await res.text();
        setMsg({ type: 'err', text: t || 'Не удалось удалить' });
        return;
      }
      try {
        const cur = localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY)?.trim();
        if (cur === id) {
          const rest = list.filter((w) => w.id !== id);
          const next = rest[0]?.id;
          if (next) localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, next);
        }
      } catch {
        /* noop */
      }
      setMsg({ type: 'ok', text: 'Кабинет удалён' });
      await load();
    } catch {
      setMsg({ type: 'err', text: 'Ошибка запроса' });
    } finally {
      setBusyId(null);
    }
  };

  const onCreate = async () => {
    const login = newLogin.trim();
    if (!login || busyId) return;
    setBusyId('__new__');
    setMsg(null);
    try {
      const res = await fetch(`${getApiBase()}/workspaces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login }),
      });
      if (!res.ok) {
        const t = await res.text();
        setMsg({ type: 'err', text: t || 'Не удалось создать' });
        return;
      }
      const data = (await res.json()) as { workspace?: Ws };
      const w = data.workspace;
      setNewLogin('');
      setMsg({ type: 'ok', text: 'Кабинет создан' });
      if (w?.id) {
        try {
          localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, w.id);
        } catch {
          /* noop */
        }
      }
      await load();
    } catch {
      setMsg({ type: 'err', text: 'Ошибка запроса' });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <h1 className="pageTitle">Кабинеты</h1>
      <p style={{ color: 'var(--muted)', marginBottom: '1rem', maxWidth: '42rem' }}>
        Переключение активного кабинета — в шапке сайта. Здесь можно переименовать, удалить (если их
        больше одного) или добавить новый по логину (как при регистрации).
      </p>
      {msg ? (
        <p className={msg.type === 'err' ? 'msg err' : 'msg ok'} style={{ marginBottom: '1rem' }}>
          {msg.text}
        </p>
      ) : null}

      <div className="card" style={{ marginBottom: '1.25rem' }}>
        <h3 style={{ marginTop: 0 }}>Новый кабинет</h3>
        <div className="workspacesAddRow">
          <input
            className="workspaceSwitcherInput"
            style={{ flex: '1 1 12rem', maxWidth: '20rem' }}
            value={newLogin}
            onChange={(e) => setNewLogin(e.target.value)}
            placeholder="Логин нового кабинета"
            disabled={busyId === '__new__'}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void onCreate();
            }}
          />
          <button
            type="button"
            className="btn"
            disabled={busyId === '__new__' || !newLogin.trim()}
            onClick={() => void onCreate()}
          >
            {busyId === '__new__' ? 'Создание…' : 'Добавить'}
          </button>
        </div>
      </div>

      {loading ? (
        <p className="workspaceSwitcherMuted">Загрузка…</p>
      ) : list.length === 0 ? (
        <p>Кабинетов нет.</p>
      ) : (
        <div className="workspacesTableWrap">
          <table className="workspacesTable">
            <thead>
              <tr>
                <th>Название</th>
                <th>Slug</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((w) => {
                const owner = w.role === 'owner';
                return (
                  <tr key={w.id}>
                    <td>
                      <div className="workspacesNameCell">
                        <input
                          className="workspaceSwitcherInput"
                          value={editing[w.id] ?? w.name}
                          onChange={(e) =>
                            setEditing((prev) => ({ ...prev, [w.id]: e.target.value }))
                          }
                          disabled={busyId === w.id || !owner}
                          aria-label={`Название: ${w.name}`}
                        />
                        {owner ? (
                          <button
                            type="button"
                            className="btn btnSecondary"
                            disabled={
                              busyId === w.id ||
                              (editing[w.id] ?? w.name).trim() === w.name.trim()
                            }
                            onClick={() => void onRename(w.id)}
                          >
                            Сохранить
                          </button>
                        ) : (
                          <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
                            только просмотр
                          </span>
                        )}
                      </div>
                    </td>
                    <td>
                      <code style={{ fontSize: '0.85em', color: 'var(--muted)' }}>{w.slug}</code>
                      {activeWsId === w.id ? (
                        <span className="workspacesActiveBadge">активен</span>
                      ) : null}
                    </td>
                    <td>
                      {owner ? (
                        <button
                          type="button"
                          className="btn btnSecondary"
                          style={{ color: '#f87171', borderColor: 'rgba(248,113,113,0.35)' }}
                          disabled={busyId === w.id || list.length <= 1}
                          onClick={() => void onDelete(w.id)}
                        >
                          Удалить
                        </button>
                      ) : (
                        <span style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p style={{ marginTop: '1.5rem' }}>
        <Link href="/">← На дашборд</Link>
      </p>
    </>
  );
}
