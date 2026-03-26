'use client';

import { useEffect, useMemo, useState } from 'react';

import { getApiBase } from '../../lib/api';

type FilterKind = 'signal' | 'close' | 'result' | 'reentry';
type FilterItem = {
  id: string;
  groupName: string;
  kind: FilterKind;
  example: string;
  createdAt: string;
};

const KIND_LABEL: Record<FilterKind, string> = {
  signal: 'Сигналы',
  close: 'Закрытие сделки (closed/cancel)',
  result: 'Результаты (TP/SL/отчеты)',
  reentry: 'Перезаход в позицию',
};

export default function FiltersPage() {
  const [groups, setGroups] = useState<string[]>([]);
  const [items, setItems] = useState<FilterItem[]>([]);
  const [groupName, setGroupName] = useState('');
  const [kind, setKind] = useState<FilterKind>('signal');
  const [example, setExample] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  async function loadAll() {
    const [groupsRes, itemsRes] = await Promise.all([
      fetch(`${getApiBase()}/telegram-userbot/filters/groups`).then((r) => r.json()),
      fetch(`${getApiBase()}/telegram-userbot/filters/examples`).then((r) => r.json()),
    ]);
    setGroups(((groupsRes as { groups?: string[] }).groups ?? []).filter(Boolean));
    setItems(((itemsRes as { items?: FilterItem[] }).items ?? []).filter(Boolean));
  }

  useEffect(() => {
    void (async () => {
      try {
        await loadAll();
      } catch {
        setMsg({ type: 'err', text: 'Не удалось загрузить фильтры' });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const grouped = useMemo(() => {
    const map = new Map<string, Record<FilterKind, FilterItem[]>>();
    for (const item of items) {
      if (!map.has(item.groupName)) {
        map.set(item.groupName, { signal: [], close: [], result: [], reentry: [] });
      }
      map.get(item.groupName)![item.kind].push(item);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0], 'ru'));
  }, [items]);

  async function addExample() {
    const g = groupName.trim();
    const e = example.trim();
    if (!g || !e) {
      setMsg({ type: 'err', text: 'Укажите группу и пример сообщения' });
      return;
    }
    setBusy('add');
    setMsg(null);
    try {
      const res = await fetch(`${getApiBase()}/telegram-userbot/filters/examples`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupName: g, kind, example: e }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? `Ошибка ${res.status}`);
      }
      setExample('');
      if (!groups.includes(g)) {
        setGroups((prev) => [...prev, g].sort((a, b) => a.localeCompare(b, 'ru')));
      }
      await loadAll();
      setMsg({ type: 'ok', text: 'Пример добавлен' });
    } catch (err) {
      setMsg({ type: 'err', text: err instanceof Error ? err.message : 'Ошибка добавления' });
    } finally {
      setBusy(null);
    }
  }

  async function removeExample(id: string) {
    setBusy(`del:${id}`);
    setMsg(null);
    try {
      const res = await fetch(
        `${getApiBase()}/telegram-userbot/filters/examples/${encodeURIComponent(id)}/delete`,
        { method: 'POST' },
      );
      if (!res.ok) {
        throw new Error(`Ошибка ${res.status}`);
      }
      await loadAll();
      setMsg({ type: 'ok', text: 'Пример удален' });
    } catch {
      setMsg({ type: 'err', text: 'Не удалось удалить пример' });
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return <p style={{ color: 'var(--muted)' }}>Загрузка…</p>;
  }

  return (
    <>
      <h1 className="pageTitle">Фильтры распознавания</h1>
      <p style={{ color: 'var(--muted)', marginBottom: '1rem' }}>
        Для каждой группы можно добавлять примеры сообщений. Если для группы есть примеры,
        userbot сверяет новые сообщения с ними и использует совпадения как подсказку для
        распознавания типа сообщения.
      </p>
      {msg && <p className={`msg ${msg.type === 'ok' ? 'ok' : 'err'}`}>{msg.text}</p>}

      <div className="card" style={{ marginBottom: '1rem' }}>
        <h3 style={{ marginBottom: '0.65rem' }}>Добавить пример</h3>
        <div className="filters">
          <label style={{ minWidth: 260, flex: '1 1 260px' }}>
            Группа
            <input
              list="known-groups"
              placeholder="Название группы (как в Telegram)"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
            />
            <datalist id="known-groups">
              {groups.map((g) => (
                <option key={g} value={g} />
              ))}
            </datalist>
          </label>
          <label style={{ minWidth: 220 }}>
            Кейс
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as FilterKind)}
            >
              <option value="signal">Сигнал</option>
              <option value="close">Закрытие (closed/cancel)</option>
              <option value="result">Результат (TP/SL)</option>
              <option value="reentry">Перезаход</option>
            </select>
          </label>
        </div>
        <label style={{ display: 'block', marginTop: '0.4rem', color: 'var(--muted)' }}>
          Пример сообщения
          <textarea
            value={example}
            onChange={(e) => setExample(e.target.value)}
            rows={5}
            placeholder="Вставьте реальный пример текста сообщения"
            style={{
              width: '100%',
              marginTop: '0.35rem',
              padding: '0.55rem',
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: 'var(--card)',
              color: 'var(--foreground)',
            }}
          />
        </label>
        <button
          className="btn"
          type="button"
          onClick={() => void addExample()}
          disabled={busy !== null}
          style={{ marginTop: '0.75rem' }}
        >
          {busy === 'add' ? 'Сохранение…' : 'Добавить пример'}
        </button>
      </div>

      {grouped.length === 0 ? (
        <p style={{ color: 'var(--muted)' }}>Пока нет сохраненных примеров.</p>
      ) : (
        <div style={{ display: 'grid', gap: '1rem' }}>
          {grouped.map(([name, byKind]) => (
            <div key={name} className="card">
              <h3 style={{ marginBottom: '0.6rem' }}>{name}</h3>
              {(['signal', 'close', 'result', 'reentry'] as const).map((k) => (
                <div key={`${name}-${k}`} style={{ marginBottom: '0.9rem' }}>
                  <strong style={{ fontSize: '0.9rem' }}>{KIND_LABEL[k]}</strong>
                  {byKind[k].length === 0 ? (
                    <p style={{ color: 'var(--muted)', marginTop: '0.3rem' }}>Нет примеров</p>
                  ) : (
                    <div style={{ display: 'grid', gap: '0.5rem', marginTop: '0.4rem' }}>
                      {byKind[k].map((it) => (
                        <div
                          key={it.id}
                          style={{
                            border: '1px solid var(--border)',
                            borderRadius: 8,
                            padding: '0.55rem 0.6rem',
                            background: 'rgba(255,255,255,0.02)',
                          }}
                        >
                          <pre
                            style={{
                              margin: 0,
                              whiteSpace: 'pre-wrap',
                              color: 'var(--foreground)',
                              fontFamily: 'var(--font-geist-mono), monospace',
                              fontSize: '0.78rem',
                              lineHeight: 1.35,
                            }}
                          >
                            {it.example}
                          </pre>
                          <div style={{ marginTop: '0.45rem' }}>
                            <button
                              className="btn btnSecondary btnSm"
                              type="button"
                              disabled={busy !== null}
                              onClick={() => void removeExample(it.id)}
                            >
                              {busy === `del:${it.id}` ? 'Удаление…' : 'Удалить'}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
