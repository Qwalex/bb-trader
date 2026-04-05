'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { ACTIVE_WORKSPACE_STORAGE_KEY } from '../../lib/active-workspace';
import { getApiBase } from '../../lib/api';

type Ws = { id: string; name: string; slug: string; role: string };

function dedupeWorkspacesById(list: Ws[]): Ws[] {
  const byId = new Map<string, Ws>();
  for (const w of list) {
    if (!byId.has(w.id)) byId.set(w.id, w);
  }
  return Array.from(byId.values());
}

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
        const list = dedupeWorkspacesById(data.workspaces ?? []);
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
      setWorkspaces((prev) =>
        dedupeWorkspacesById([...prev, { id: w.id, name: w.name, slug: w.slug, role: w.role }]),
      );
      setNewLogin('');
      onSelect(w.id);
    } catch {
      setLoadError('Не удалось создать кабинет');
    } finally {
      setBusy(false);
    }
  }, [busy, newLogin, onSelect]);

  const nameCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const w of workspaces) {
      m.set(w.name, (m.get(w.name) ?? 0) + 1);
    }
    return m;
  }, [workspaces]);

  if (!loaded) {
    return <span className="workspaceSwitcherMuted">…</span>;
  }

  if (workspaces.length === 0) {
    return null;
  }

  const optionLabel = (w: Ws) =>
    (nameCounts.get(w.name) ?? 0) > 1 ? `${w.name} · ${w.slug}` : w.name;

  return (
    <div className="workspaceSwitcher">
      {loadError ? <span className="workspaceSwitcherErr">{loadError}</span> : null}
      <div className="workspaceSwitcherRow">
        <div className="workspaceSwitcherPick">
          <span className="workspaceSwitcherPrefix">Кабинет</span>
          <select
            className="workspaceSwitcherSelect"
            value={selectedId}
            onChange={(e) => onSelect(e.target.value)}
            aria-label="Выбор кабинета"
          >
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {optionLabel(w)}
              </option>
            ))}
          </select>
        </div>
        <span className="workspaceSwitcherSep" aria-hidden />
        <div className="workspaceSwitcherAdd">
          <input
            className="workspaceSwitcherInput"
            value={newLogin}
            onChange={(e) => setNewLogin(e.target.value)}
            placeholder="Новый логин"
            aria-label="Логин нового кабинета"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void onCreate();
              }
            }}
          />
          <button
            type="button"
            className="btn btnSecondary workspaceSwitcherBtn"
            disabled={busy}
            onClick={() => void onCreate()}
          >
            Добавить
          </button>
        </div>
      </div>
    </div>
  );
}
