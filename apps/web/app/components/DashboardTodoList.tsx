'use client';

import { useCallback, useEffect, useState } from 'react';

import { getApiAuthHeaders, getApiBase } from '../../lib/api';

export type DashboardTodoItem = {
  id: string;
  text: string;
};

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

async function persistDashboardTodos(items: DashboardTodoItem[]): Promise<void> {
  const headers = getApiAuthHeaders({ 'Content-Type': 'application/json' });
  const res = await fetch(`${getApiBase()}/settings/dashboard-todos`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ items }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(errText || `${res.status} ${res.statusText}`);
  }
}

type Props = {
  initialItems: DashboardTodoItem[];
  /** Под метриками, узкая карточка без метрик, или боковая колонка (легаси) */
  layout?: 'below' | 'full' | 'sidebar';
};

export function DashboardTodoList({ initialItems, layout = 'below' }: Props) {
  const [todos, setTodos] = useState<DashboardTodoItem[]>(initialItems);
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setTodos(initialItems);
  }, [initialItems]);

  const persist = useCallback(async (next: DashboardTodoItem[]) => {
    setBusy(true);
    setSaveErr(null);
    try {
      await persistDashboardTodos(next);
    } catch (e) {
      setSaveErr(
        e instanceof Error
          ? e.message
          : 'Не удалось сохранить в БД. Проверьте API и токен доступа.',
      );
      throw e;
    } finally {
      setBusy(false);
    }
  }, []);

  const add = useCallback(async () => {
    const text = draft.trim();
    if (!text) return;
    const item: DashboardTodoItem = { id: newId(), text };
    const prev = todos;
    const next = [...prev, item];
    setTodos(next);
    setDraft('');
    try {
      await persist(next);
    } catch {
      setTodos(prev);
    }
  }, [draft, todos, persist]);

  const remove = useCallback(
    async (id: string) => {
      const prev = todos;
      const next = prev.filter((t) => t.id !== id);
      setTodos(next);
      setEditingId((cur) => (cur === id ? null : cur));
      try {
        await persist(next);
      } catch {
        setTodos(prev);
      }
    },
    [todos, persist],
  );

  const startEdit = useCallback((t: DashboardTodoItem) => {
    setEditingId(t.id);
    setEditText(t.text);
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setEditText('');
  }, []);

  const saveEdit = useCallback(async () => {
    const text = editText.trim();
    if (!editingId) return;
    const prev = todos;
    if (!text) {
      const next = prev.filter((t) => t.id !== editingId);
      setTodos(next);
      cancelEdit();
      try {
        await persist(next);
      } catch {
        setTodos(prev);
      }
      return;
    }
    const next = prev.map((t) => (t.id === editingId ? { ...t, text } : t));
    setTodos(next);
    cancelEdit();
    try {
      await persist(next);
    } catch {
      setTodos(prev);
    }
  }, [editText, editingId, todos, persist, cancelEdit]);

  const cardClass =
    layout === 'full'
      ? 'card dashboardTodoCard dashboardTodoCardFull'
      : layout === 'below'
        ? 'card dashboardTodoCard dashboardTodoCardBelow'
        : 'card dashboardTodoCard';

  return (
    <div className={cardClass}>
      <h3>Заметки / todo</h3>
      <p className="dashboardTodoHint">Сохраняются в базе (SQLite), общие для этой инсталляции API</p>
      {saveErr && (
        <p className="msg err" style={{ fontSize: '0.8rem', marginBottom: '0.65rem' }}>
          {saveErr}
        </p>
      )}
      <div className="dashboardTodoAddRow">
        <input
          type="text"
          className="dashboardTodoInput"
          placeholder="Новая задача…"
          value={draft}
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void add();
            }
          }}
        />
        <button
          type="button"
          className="btn btnSm"
          onClick={() => void add()}
          disabled={!draft.trim() || busy}
        >
          Добавить
        </button>
      </div>
      <ul className="dashboardTodoList">
        {todos.length === 0 && (
          <li className="dashboardTodoEmpty">Пока пусто — добавьте пункт выше</li>
        )}
        {todos.map((t) => (
          <li key={t.id} className="dashboardTodoItem">
            {editingId === t.id ? (
              <div className="dashboardTodoEdit">
                <textarea
                  className="dashboardTodoTextarea"
                  value={editText}
                  disabled={busy}
                  onChange={(e) => setEditText(e.target.value)}
                  rows={3}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') cancelEdit();
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault();
                      void saveEdit();
                    }
                  }}
                />
                <div className="dashboardTodoEditActions">
                  <button
                    type="button"
                    className="btn btnSm"
                    onClick={() => void saveEdit()}
                    disabled={busy}
                  >
                    Сохранить
                  </button>
                  <button
                    type="button"
                    className="btn btnSm btnSecondary"
                    onClick={cancelEdit}
                    disabled={busy}
                  >
                    Отмена
                  </button>
                </div>
                <span className="dashboardTodoKeyHint">Ctrl+Enter — сохранить</span>
              </div>
            ) : (
              <div className="dashboardTodoRow">
                <p className="dashboardTodoText">{t.text}</p>
                <div className="dashboardTodoActions">
                  <button
                    type="button"
                    className="btn btnSm btnSecondary"
                    onClick={() => startEdit(t)}
                    disabled={busy}
                  >
                    Изменить
                  </button>
                  <button
                    type="button"
                    className="btn btnSm btnDanger"
                    onClick={() => void remove(t.id)}
                    disabled={busy}
                  >
                    Удалить
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
