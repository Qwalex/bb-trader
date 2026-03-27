'use client';

import { useEffect, useMemo, useState } from 'react';

import { getApiBase } from '../../lib/api';

type FilterKind = 'signal' | 'close' | 'result' | 'reentry';
type FilterItem = {
  id: string;
  groupName: string;
  kind: FilterKind;
  example: string;
  requiresQuote: boolean;
  createdAt: string;
};

type PatternItem = {
  id: string;
  groupName: string;
  kind: FilterKind;
  pattern: string;
  requiresQuote: boolean;
  createdAt: string;
};

const KIND_LABEL: Record<FilterKind, string> = {
  signal: 'Сигналы',
  close: 'Закрытие сделки (closed/cancel)',
  result: 'Результаты (TP/SL/отчеты)',
  reentry: 'Перезаход в позицию',
};

const SAMPLE_HINTS: Record<
  FilterKind,
  {
    patterns: string[];
    examples: string[];
  }
> = {
  signal: {
    patterns: ['entry:', 'stop loss:', 'targets:', 'long'],
    examples: [
      `#ETHUSDT LONG

Entry: 2450-2470
Stop Loss: 2390
Targets: 2520, 2580, 2640`,
    ],
  },
  close: {
    patterns: ['closed!', 'trade closed', 'manual close', 'закрыт'],
    examples: [
      `#TRUMPUSDT - Closed! 🔘
Trade closed with 15.6938% profit.`,
    ],
  },
  result: {
    patterns: ['tp', 'target reached', 'profit:', 'sl hit', 'duration:'],
    examples: [
      `#POLUSDT - 🚨 Target 2 reached
💸 Profit collected 22.2952%
⏰ Posted: 5 hr 38 min Ago`,
    ],
  },
  reentry: {
    patterns: ['reentry', 'перезаход', 'add entry', 'добор'],
    examples: [
      `Перезаход по #BTCUSDT
Новый вход: 64200
SL тот же`,
    ],
  },
};

export default function FiltersPage() {
  const [groups, setGroups] = useState<string[]>([]);
  const [exampleItems, setExampleItems] = useState<FilterItem[]>([]);
  const [patternItems, setPatternItems] = useState<PatternItem[]>([]);
  const [groupName, setGroupName] = useState('');
  const [kind, setKind] = useState<FilterKind>('signal');
  const [example, setExample] = useState('');
  const [exampleRequiresQuote, setExampleRequiresQuote] = useState(false);
  const [patternGroupName, setPatternGroupName] = useState('');
  const [patternKind, setPatternKind] = useState<FilterKind>('result');
  const [pattern, setPattern] = useState('');
  const [patternRequiresQuote, setPatternRequiresQuote] = useState(false);
  const [generatedPatterns, setGeneratedPatterns] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  async function loadAll() {
    const [groupsRes, examplesRes, patternsRes] = await Promise.all([
      fetch(`${getApiBase()}/telegram-userbot/filters/groups`).then((r) => r.json()),
      fetch(`${getApiBase()}/telegram-userbot/filters/examples`).then((r) => r.json()),
      fetch(`${getApiBase()}/telegram-userbot/filters/patterns`).then((r) => r.json()),
    ]);
    setGroups(((groupsRes as { groups?: string[] }).groups ?? []).filter(Boolean));
    setExampleItems(((examplesRes as { items?: FilterItem[] }).items ?? []).filter(Boolean));
    setPatternItems(((patternsRes as { items?: PatternItem[] }).items ?? []).filter(Boolean));
  }

  useEffect(() => {
    void (async () => {
      try {
        await loadAll();
      } catch {
        setMsg({ type: 'err', text: 'Не удалось загрузить правила распознавания' });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const groupedExamples = useMemo(() => {
    const map = new Map<string, Record<FilterKind, FilterItem[]>>();
    for (const item of exampleItems) {
      if (!map.has(item.groupName)) {
        map.set(item.groupName, { signal: [], close: [], result: [], reentry: [] });
      }
      map.get(item.groupName)![item.kind].push(item);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0], 'ru'));
  }, [exampleItems]);

  const groupedPatterns = useMemo(() => {
    const map = new Map<string, Record<FilterKind, PatternItem[]>>();
    for (const item of patternItems) {
      if (!map.has(item.groupName)) {
        map.set(item.groupName, { signal: [], close: [], result: [], reentry: [] });
      }
      map.get(item.groupName)![item.kind].push(item);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0], 'ru'));
  }, [patternItems]);

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
        body: JSON.stringify({
          groupName: g,
          kind,
          example: e,
          requiresQuote: exampleRequiresQuote,
        }),
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
      setGeneratedPatterns([]);
      setExampleRequiresQuote(false);
      setMsg({ type: 'ok', text: 'Пример для AI добавлен' });
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
      setMsg({ type: 'ok', text: 'Пример для AI удален' });
    } catch {
      setMsg({ type: 'err', text: 'Не удалось удалить пример' });
    } finally {
      setBusy(null);
    }
  }

  async function addPattern() {
    const g = patternGroupName.trim();
    const p = pattern.trim();
    if (!g || !p) {
      setMsg({ type: 'err', text: 'Укажите группу и паттерн' });
      return;
    }
    setBusy('add-pattern');
    setMsg(null);
    try {
      const res = await fetch(`${getApiBase()}/telegram-userbot/filters/patterns`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          groupName: g,
          kind: patternKind,
          pattern: p,
          requiresQuote: patternRequiresQuote,
        }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? `Ошибка ${res.status}`);
      }
      setPattern('');
      if (!groups.includes(g)) {
        setGroups((prev) => [...prev, g].sort((a, b) => a.localeCompare(b, 'ru')));
      }
      await loadAll();
      setGeneratedPatterns((prev) => prev.filter((item) => item !== p));
      setPatternRequiresQuote(false);
      setMsg({ type: 'ok', text: 'Фильтр-паттерн добавлен' });
    } catch (err) {
      setMsg({ type: 'err', text: err instanceof Error ? err.message : 'Ошибка добавления' });
    } finally {
      setBusy(null);
    }
  }

  async function generatePatternsFromExample() {
    const e = example.trim();
    if (!e) {
      setMsg({ type: 'err', text: 'Сначала вставьте пример сообщения для AI' });
      return;
    }
    setBusy('generate-patterns');
    setMsg(null);
    try {
      const res = await fetch(`${getApiBase()}/telegram-userbot/filters/patterns/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, example: e }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        patterns?: string[];
      };
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? `Ошибка ${res.status}`);
      }
      const patterns = (json.patterns ?? []).filter(Boolean);
      setGeneratedPatterns(patterns);
      setPatternKind(kind);
      setPatternRequiresQuote(exampleRequiresQuote);
      if (groupName.trim()) {
        setPatternGroupName(groupName.trim());
      }
      setMsg({
        type: 'ok',
        text:
          patterns.length > 0
            ? 'AI предложил кандидаты паттернов ниже'
            : 'AI не нашел подходящих паттернов',
      });
    } catch (err) {
      setMsg({ type: 'err', text: err instanceof Error ? err.message : 'Ошибка генерации' });
    } finally {
      setBusy(null);
    }
  }

  function applyGeneratedPattern(value: string) {
    setPattern(value);
    setPatternKind(kind);
    setPatternRequiresQuote(exampleRequiresQuote);
    if (groupName.trim()) {
      setPatternGroupName(groupName.trim());
    }
  }

  async function removePattern(id: string) {
    setBusy(`del-pattern:${id}`);
    setMsg(null);
    try {
      const res = await fetch(
        `${getApiBase()}/telegram-userbot/filters/patterns/${encodeURIComponent(id)}/delete`,
        { method: 'POST' },
      );
      if (!res.ok) {
        throw new Error(`Ошибка ${res.status}`);
      }
      await loadAll();
      setMsg({ type: 'ok', text: 'Фильтр-паттерн удален' });
    } catch {
      setMsg({ type: 'err', text: 'Не удалось удалить паттерн' });
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return <p style={{ color: 'var(--muted)' }}>Загрузка…</p>;
  }

  return (
    <>
      <h1 className="pageTitle">Правила распознавания</h1>
      <p style={{ color: 'var(--muted)', marginBottom: '1rem' }}>
        <code>Фильтры</code> проверяются первыми и, если сообщение попало под паттерн, до AI
        оно не доходит. <code>Примеры</code> используются как подсказки для AI-классификации
        внутри группы.
      </p>
      {msg && <p className={`msg ${msg.type === 'ok' ? 'ok' : 'err'}`}>{msg.text}</p>}

      <div className="card" style={{ marginBottom: '1rem' }}>
        <h3 style={{ marginBottom: '0.65rem' }}>Добавить пример для AI</h3>
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
            Кейс примера
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
          Пример сообщения для AI
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
        <div
          style={{
            marginTop: '0.75rem',
            display: 'grid',
            gap: '0.6rem',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          }}
        >
          {(['signal', 'close', 'result', 'reentry'] as const).map((sampleKind) => (
            <div
              key={`example-hint-${sampleKind}`}
              style={{
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: '0.65rem',
                background: 'rgba(255,255,255,0.02)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: '0.5rem',
                  alignItems: 'center',
                  marginBottom: '0.45rem',
                }}
              >
                <strong style={{ fontSize: '0.9rem' }}>{KIND_LABEL[sampleKind]}</strong>
                <button
                  className="btn btnSecondary btnSm"
                  type="button"
                  disabled={busy !== null}
                  onClick={() => {
                    setKind(sampleKind);
                    setExample(SAMPLE_HINTS[sampleKind].examples[0] ?? '');
                    setExampleRequiresQuote(sampleKind === 'close' || sampleKind === 'reentry');
                  }}
                >
                  Подставить
                </button>
              </div>
              <pre
                style={{
                  margin: 0,
                  whiteSpace: 'pre-wrap',
                  fontFamily: 'var(--font-geist-mono), monospace',
                  fontSize: '0.76rem',
                  lineHeight: 1.35,
                  color: 'var(--muted)',
                }}
              >
                {SAMPLE_HINTS[sampleKind].examples[0]}
              </pre>
            </div>
          ))}
        </div>
        <label
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.45rem',
            marginTop: '0.75rem',
          }}
        >
          <input
            type="checkbox"
            checked={exampleRequiresQuote}
            onChange={(e) => setExampleRequiresQuote(e.target.checked)}
          />
          Только для сообщений с цитатой
        </label>
        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', marginTop: '0.75rem' }}>
          <button
            className="btn"
            type="button"
            onClick={() => void addExample()}
            disabled={busy !== null}
          >
            {busy === 'add' ? 'Сохранение…' : 'Добавить пример для AI'}
          </button>
          <button
            className="btn btnSecondary"
            type="button"
            onClick={() => void generatePatternsFromExample()}
            disabled={busy !== null}
          >
            {busy === 'generate-patterns'
              ? 'Генерация…'
              : 'Сгенерировать паттерны из примера'}
          </button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <h3 style={{ marginBottom: '0.65rem' }}>Добавить фильтр-паттерн</h3>
        <div className="filters">
          <label style={{ minWidth: 260, flex: '1 1 260px' }}>
            Группа
            <input
              list="known-groups-patterns"
              placeholder="Название группы (как в Telegram)"
              value={patternGroupName}
              onChange={(e) => setPatternGroupName(e.target.value)}
            />
            <datalist id="known-groups-patterns">
              {groups.map((g) => (
                <option key={g} value={g} />
              ))}
            </datalist>
          </label>
          <label style={{ minWidth: 220 }}>
            Кейс фильтра
            <select
              value={patternKind}
              onChange={(e) => setPatternKind(e.target.value as FilterKind)}
            >
              <option value="signal">Сигнал</option>
              <option value="close">Закрытие (closed/cancel)</option>
              <option value="result">Результат (TP/SL)</option>
              <option value="reentry">Перезаход</option>
            </select>
          </label>
        </div>
        <label style={{ display: 'block', marginTop: '0.4rem', color: 'var(--muted)' }}>
          Паттерн
          <textarea
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            rows={3}
            placeholder="Например: tp, closed!, target reached"
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
        <div
          style={{
            marginTop: '0.75rem',
            display: 'grid',
            gap: '0.6rem',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          }}
        >
          {(['signal', 'close', 'result', 'reentry'] as const).map((sampleKind) => (
            <div
              key={`pattern-hint-${sampleKind}`}
              style={{
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: '0.65rem',
                background: 'rgba(255,255,255,0.02)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: '0.5rem',
                  alignItems: 'center',
                  marginBottom: '0.45rem',
                }}
              >
                <strong style={{ fontSize: '0.9rem' }}>{KIND_LABEL[sampleKind]}</strong>
                <button
                  className="btn btnSecondary btnSm"
                  type="button"
                  disabled={busy !== null}
                  onClick={() => {
                    setPatternKind(sampleKind);
                    setPattern(SAMPLE_HINTS[sampleKind].patterns[0] ?? '');
                    setPatternRequiresQuote(sampleKind === 'close' || sampleKind === 'reentry');
                  }}
                >
                  Подставить
                </button>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                {SAMPLE_HINTS[sampleKind].patterns.map((samplePattern) => (
                  <code
                    key={`${sampleKind}-${samplePattern}`}
                    style={{
                      padding: '0.12rem 0.4rem',
                      borderRadius: 999,
                      background: 'rgba(255,255,255,0.06)',
                      fontSize: '0.75rem',
                    }}
                  >
                    {samplePattern}
                  </code>
                ))}
              </div>
            </div>
          ))}
        </div>
        <label
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.45rem',
            marginTop: '0.75rem',
          }}
        >
          <input
            type="checkbox"
            checked={patternRequiresQuote}
            onChange={(e) => setPatternRequiresQuote(e.target.checked)}
          />
          Только для сообщений с цитатой
        </label>
        {generatedPatterns.length > 0 && (
          <div
            style={{
              marginTop: '0.75rem',
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: '0.75rem',
              background: 'rgba(255,255,255,0.02)',
            }}
          >
            <strong style={{ display: 'block', marginBottom: '0.5rem' }}>
              Сгенерированные кандидаты
            </strong>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem' }}>
              {generatedPatterns.map((candidate) => (
                <button
                  key={candidate}
                  className="btn btnSecondary btnSm"
                  type="button"
                  disabled={busy !== null}
                  onClick={() => applyGeneratedPattern(candidate)}
                >
                  {candidate}
                </button>
              ))}
            </div>
            <p style={{ marginTop: '0.55rem', color: 'var(--muted)' }}>
              Нажмите на кандидат, чтобы перенести его в поле паттерна.
            </p>
          </div>
        )}
        <button
          className="btn"
          type="button"
          onClick={() => void addPattern()}
          disabled={busy !== null}
          style={{ marginTop: '0.75rem' }}
        >
          {busy === 'add-pattern' ? 'Сохранение…' : 'Добавить фильтр-паттерн'}
        </button>
      </div>

      {groupedPatterns.length === 0 ? (
        <p style={{ color: 'var(--muted)' }}>Пока нет сохраненных фильтров-паттернов.</p>
      ) : (
        <div style={{ display: 'grid', gap: '1rem', marginBottom: '1rem' }}>
          {groupedPatterns.map(([name, byKind]) => (
            <div key={`patterns-${name}`} className="card">
              <h3 style={{ marginBottom: '0.6rem' }}>{name} · Фильтры</h3>
              {(['signal', 'close', 'result', 'reentry'] as const).map((k) => (
                <div key={`${name}-pattern-${k}`} style={{ marginBottom: '0.9rem' }}>
                  <strong style={{ fontSize: '0.9rem' }}>{KIND_LABEL[k]}</strong>
                  {byKind[k].length === 0 ? (
                    <p style={{ color: 'var(--muted)', marginTop: '0.3rem' }}>Нет паттернов</p>
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
                            {it.pattern}
                          </pre>
                          {it.requiresQuote && (
                            <div style={{ marginTop: '0.35rem', color: 'var(--muted)' }}>
                              Только с цитатой
                            </div>
                          )}
                          <div style={{ marginTop: '0.45rem' }}>
                            <button
                              className="btn btnSecondary btnSm"
                              type="button"
                              disabled={busy !== null}
                              onClick={() => void removePattern(it.id)}
                            >
                              {busy === `del-pattern:${it.id}` ? 'Удаление…' : 'Удалить'}
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

      {groupedExamples.length === 0 ? (
        <p style={{ color: 'var(--muted)' }}>Пока нет сохраненных примеров для AI.</p>
      ) : (
        <div style={{ display: 'grid', gap: '1rem' }}>
          {groupedExamples.map(([name, byKind]) => (
            <div key={name} className="card">
              <h3 style={{ marginBottom: '0.6rem' }}>{name} · Примеры для AI</h3>
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
                          {it.requiresQuote && (
                            <div style={{ marginTop: '0.35rem', color: 'var(--muted)' }}>
                              Только с цитатой
                            </div>
                          )}
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
