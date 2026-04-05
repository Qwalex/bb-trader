'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { ACTIVE_WORKSPACE_STORAGE_KEY } from '../../lib/active-workspace';
import { getApiBase } from '../../lib/api';

type Ws = { id: string; name: string; slug: string; role: string };

export function WorkspaceSwitcher() {
  const router = useRouter();
  const [workspaces, setWorkspaces] = useState<Ws[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [newLogin, setNewLogin] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${getApiBase()}/workspaces`);
        if (!res.ok) {
          if (!cancelled) {
            setLoadError('Не удалось загрузить кабинеты');
            setLoaded(true);
          }
          return;
        }
        const data = (await res.json()) as { workspaces?: Ws[] };
        const list = data.workspaces ?? [];
        if (cancelled) return;
        setWorkspaces(list);
        const first = list[0];
        if (!first) {
          setLoaded(true);
          return;
        }
        let stored = '';
        try {
          stored = localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY)?.trim() ?? '';
        } catch {
          /* noop */
        }
        const valid = Boolean(stored && list.some((w) => w.id === stored));
        const nextId = valid ? stored : first.id;
        if (!valid) {
          try {
            localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, nextId);
          } catch {
            /* noop */
          }
        }
        setSelectedId(nextId);
      } catch {
        if (!cancelled) setLoadError('Не удалось загрузить кабинеты');
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onSelect = useCallback(
    (id: string) => {
      setSelectedId(id);
      try {
        localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, id);
      } catch {
        /* noop */
      }
      router.refresh();
    },
    [router],
  );

  const onCreate = useCallback(async () => {
    const login = newLogin.trim();
    if (!login || busy) return;
    setBusy(true);
    setLoadError(null);
    try {
      const res = await fetch(`${getApiBase()}/workspaces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login }),
      });
      if (!res.ok) {
        setLoadError('Не удалось создать кабинет');
        return;
      }
      const data = (await res.json()) as { workspace?: Ws };
      const w = data.workspace;
      if (!w?.id) return;
      setWorkspaces((prev) => [...prev, { id: w.id, name: w.name, slug: w.slug, role: w.role }]);
      setNewLogin('');
      onSelect(w.id);
    } catch {
      setLoadError('Не удалось создать кабинет');
    } finally {
      setBusy(false);
    }
  }, [busy, newLogin, onSelect]);

  if (!loaded) {
    return <span className="workspaceSwitcherMuted">…</span>;
  }

  if (workspaces.length === 0) {
    return null;
  }

  return (
    <div className="workspaceSwitcher">
      {loadError ? <span className="workspaceSwitcherErr">{loadError}</span> : null}
      <label className="workspaceSwitcherLabel">
        <span className="workspaceSwitcherTitle">Кабинет</span>
        <select
          className="workspaceSwitcherSelect"
          value={selectedId}
          onChange={(e) => onSelect(e.target.value)}
          aria-label="Выбор кабинета"
        >
          {workspaces.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
      </label>
      <span className="workspaceSwitcherAdd">
        <input
          className="workspaceSwitcherInput"
          value={newLogin}
          onChange={(e) => setNewLogin(e.target.value)}
          placeholder="Новый логин"
          aria-label="Логин нового кабинета"
        />
        <button
          type="button"
          className="btn btnSecondary workspaceSwitcherBtn"
          disabled={busy}
          onClick={() => void onCreate()}
        >
          Добавить
        </button>
      </span>
    </div>
  );
}
