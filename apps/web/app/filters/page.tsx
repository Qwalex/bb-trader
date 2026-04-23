'use client';

import { useEffect, useMemo, useState } from 'react';

import { getApiBase, withCabinetQuery } from '../../lib/api';

type FilterKind = 'signal' | 'close' | 'result' | 'reentry' | 'ignore';
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
  ignore: 'Игнорировать (не отправлять в AI)',
};

const SECTION_TITLE_STYLE = {
  marginBottom: '0.7rem',
  display: 'inline-block',
  padding: '0.3rem 0.55rem',
  borderRadius: 8,
  background: 'rgba(0, 200, 255, 0.12)',
  border: '1px solid rgba(0, 200, 255, 0.28)',
  color: 'var(--accent)',
} as const;

const KIND_TITLE_STYLE = {
  fontSize: '0.8rem',
  display: 'inline-block',
  marginBottom: '0.25rem',
  padding: '0.15rem 0.45rem',
  borderRadius: 999,
  background: 'rgba(255, 255, 255, 0.06)',
  color: 'var(--foreground)',
} as const;

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
  ignore: {
    patterns: ['free trial', 'vip доступ', 'реклама', 'subscribe'],
    examples: [
      `Открыт набор в VIP-группу.
Переходите по ссылке и оформляйте подписку.
Промокод действует 24 часа.`,
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
  const [activeFilterGroup, setActiveFilterGroup] = useState('');
  const [generatedPatterns, setGeneratedPatterns] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const withCabinet = (path: string) => {
    const cabinetId = localStorage.getItem('active_cabinet_id');
    return `${getApiBase()}${withCabinetQuery(path, cabinetId)}`;
  };

  async function loadAll() {
    const [groupsRes, examplesRes, patternsRes] = await Promise.all([
      fetch(withCabinet('/telegram-userbot/filters/groups')).then((r) => r.json()),
      fetch(withCabinet('/telegram-userbot/filters/examples')).then((r) => r.json()),
      fetch(withCabinet('/telegram-userbot/filters/patterns')).then((r) => r.json()),
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
        map.set(item.groupName, { signal: [], close: [], result: [], reentry: [], ignore: [] });
      }
      map.get(item.groupName)![item.kind].push(item);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0], 'ru'));
  }, [exampleItems]);

  const groupedPatterns = useMemo(() => {
    const map = new Map<string, Record<FilterKind, PatternItem[]>>();
    for (const item of patternItems) {
      if (!map.has(item.groupName)) {
        map.set(item.groupName, { signal: [], close: [], result: [], reentry: [], ignore: [] });
      }
      map.get(item.groupName)![item.kind].push(item);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0], 'ru'));
  }, [patternItems]);

  const filterGroupTabs = useMemo(() => {
    const names = new Set<string>();
    for (const [name] of groupedPatterns) {
      names.add(name);
    }
    for (const [name] of groupedExamples) {
      names.add(name);
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b, 'ru'));
  }, [groupedPatterns, groupedExamples]);

  const activePatternEntry = useMemo(
    () => groupedPatterns.find(([name]) => name === activeFilterGroup),
    [groupedPatterns, activeFilterGroup],
  );

  const activeExampleEntry = useMemo(
    () => groupedExamples.find(([name]) => name === activeFilterGroup),
    [groupedExamples, activeFilterGroup],
  );

  useEffect(() => {
    if (filterGroupTabs.length === 0) {
      if (activeFilterGroup) {
        setActiveFilterGroup('');
      }
      return;
    }
    const exists = filterGroupTabs.includes(activeFilterGroup);
    if (!exists) {
      const firstGroup = filterGroupTabs[0];
      if (firstGroup) {
        setActiveFilterGroup(firstGroup);
      }
    }
  }, [filterGroupTabs, activeFilterGroup]);

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
      const res = await fetch(withCabinet('/telegram-userbot/filters/examples'), {
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
        withCabinet(`/telegram-userbot/filters/examples/${encodeURIComponent(id)}/delete`),
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
      const res = await fetch(withCabinet('/telegram-userbot/filters/patterns'), {
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

  async function generatePatternsFromSource(params: {
    exampleText: string;
    kind: FilterKind;
    groupName?: string;
    requiresQuote?: boolean;
  }) {
    const e = params.exampleText.trim();
    if (!e) {
      setMsg({ type: 'err', text: 'Сначала вставьте пример сообщения для AI' });
      return;
    }
    setBusy('generate-patterns');
    setMsg(null);
    try {
      const res = await fetch(withCabinet('/telegram-userbot/filters/patterns/generate'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: params.kind, example: e }),
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
      setPatternKind(params.kind);
      setPatternRequiresQuote(params.requiresQuote === true);
      const nextGroupName = params.groupName?.trim() ?? '';
      if (nextGroupName) {
        setPatternGroupName(nextGroupName);
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

  async function generatePatternsFromExample() {
    await generatePatternsFromSource({
      exampleText: example,
      kind,
      groupName,
      requiresQuote: exampleRequiresQuote,
    });
  }

  function applyGeneratedPattern(value: string) {
    setPattern(value);
    setPatternKind(kind);
    setPatternRequiresQuote(exampleRequiresQuote);
    if (groupName.trim()) {
      setPatternGroupName(groupName.trim());
    }
  }

  function jumpToSection(sectionId: 'example-form' | 'pattern-form') {
    if (typeof window === 'undefined') {
      return;
    }
    const node = document.getElementById(sectionId);
    node?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function quickAddExample(group: string, nextKind: FilterKind) {
    setGroupName(group);
    setKind(nextKind);
    jumpToSection('example-form');
  }

  function quickAddPattern(group: string, nextKind: FilterKind) {
    setPatternGroupName(group);
    setPatternKind(nextKind);
    jumpToSection('pattern-form');
  }

  async function removePattern(id: string) {
    setBusy(`del-pattern:${id}`);
    setMsg(null);
    try {
      const res = await fetch(
        withCabinet(`/telegram-userbot/filters/patterns/${encodeURIComponent(id)}/delete`),
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

      <div id="example-form" className="card" style={{ marginBottom: '1rem' }}>
        <h3 style={SECTION_TITLE_STYLE}>Добавить пример для AI</h3>
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
              <option value="ignore">Игнорировать</option>
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
          {(['signal', 'close', 'result', 'reentry', 'ignore'] as const).map((sampleKind) => (
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
                  justifyContent: 'space-between',
                  gap: '0.5rem',
                  alignItems: 'center',
                  marginBottom: '0.45rem',
                }}
              >
                <strong style={KIND_TITLE_STYLE}>{KIND_LABEL[sampleKind]}</strong>
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

      <div id="pattern-form" className="card" style={{ marginBottom: '1rem' }}>
        <h3 style={SECTION_TITLE_STYLE}>Добавить фильтр-паттерн</h3>
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
              <option value="ignore">Игнорировать</option>
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
          {(['signal', 'close', 'result', 'reentry', 'ignore'] as const).map((sampleKind) => (
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
                <strong style={KIND_TITLE_STYLE}>{KIND_LABEL[sampleKind]}</strong>
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

      {filterGroupTabs.length === 0 ? (
        <p style={{ color: 'var(--muted)' }}>Пока нет сохраненных фильтров.</p>
      ) : (
        <div style={{ display: 'grid', gap: '1rem', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {filterGroupTabs.map((name) => {
              const patternsCount = groupedPatterns
                .find(([group]) => group === name)?.[1]
                ? Object.values(groupedPatterns.find(([group]) => group === name)![1]).reduce(
                    (sum, items) => sum + items.length,
                    0,
                  )
                : 0;
              const examplesCount = groupedExamples
                .find(([group]) => group === name)?.[1]
                ? Object.values(groupedExamples.find(([group]) => group === name)![1]).reduce(
                    (sum, items) => sum + items.length,
                    0,
                  )
                : 0;
              const active = name === activeFilterGroup;
              return (
                <button
                  key={`filters-tab-${name}`}
                  type="button"
                  className="btn btnSecondary btnSm"
                  onClick={() => setActiveFilterGroup(name)}
                  style={{
                    borderColor: active ? 'var(--accent)' : undefined,
                    color: active ? 'var(--accent)' : undefined,
                    background: active ? 'rgba(0, 200, 255, 0.08)' : undefined,
                  }}
                >
                  {name} (P:{patternsCount} / E:{examplesCount})
                </button>
              );
            })}
          </div>
        </div>
      )}

      {filterGroupTabs.length > 0 && (
        <div style={{ display: 'grid', gap: '1rem', marginBottom: '1rem' }}>
          <div className="card" style={{ padding: '0.85rem 1rem' }}>
            <h3 style={SECTION_TITLE_STYLE}>{activeFilterGroup} · Фильтры-паттерны</h3>
            {activePatternEntry ? (
              (['signal', 'close', 'result', 'reentry', 'ignore'] as const).map((k) => (
                <div key={`${activeFilterGroup}-pattern-${k}`} style={{ marginBottom: '0.9rem' }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '0.5rem',
                      marginBottom: '0.2rem',
                    }}
                  >
                    <strong style={KIND_TITLE_STYLE}>{KIND_LABEL[k]}</strong>
                    <button
                      className="btn btnSecondary btnSm"
                      type="button"
                      disabled={busy !== null}
                      onClick={() => quickAddPattern(activeFilterGroup, k)}
                    >
                      Добавить
                    </button>
                  </div>
                  {activePatternEntry[1][k].length === 0 ? (
                    <p style={{ color: 'var(--muted)', marginTop: '0.3rem' }}>Нет паттернов</p>
                  ) : (
                    <div style={{ display: 'grid', gap: '0.5rem', marginTop: '0.4rem' }}>
                      {activePatternEntry[1][k].map((it) => (
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
              ))
            ) : (
              <p style={{ color: 'var(--muted)' }}>Для этой группы нет паттернов.</p>
            )}
          </div>
        </div>
      )}

      {filterGroupTabs.length === 0 ? (
        <p style={{ color: 'var(--muted)' }}>Пока нет сохраненных примеров для AI.</p>
      ) : (
        <div style={{ display: 'grid', gap: '1rem' }}>
          <div key={activeFilterGroup} className="card">
            <h3 style={SECTION_TITLE_STYLE}>{activeFilterGroup} · Примеры для AI</h3>
            {activeExampleEntry ? (
              (['signal', 'close', 'result', 'reentry', 'ignore'] as const).map((k) => (
                <div key={`${activeFilterGroup}-${k}`} style={{ marginBottom: '0.9rem' }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '0.5rem',
                      marginBottom: '0.2rem',
                    }}
                  >
                    <strong style={KIND_TITLE_STYLE}>{KIND_LABEL[k]}</strong>
                    <button
                      className="btn btnSecondary btnSm"
                      type="button"
                      disabled={busy !== null}
                      onClick={() => quickAddExample(activeFilterGroup, k)}
                    >
                      Добавить
                    </button>
                  </div>
                  {activeExampleEntry[1][k].length === 0 ? (
                    <p style={{ color: 'var(--muted)', marginTop: '0.3rem' }}>Нет примеров</p>
                  ) : (
                    <div style={{ display: 'grid', gap: '0.5rem', marginTop: '0.4rem' }}>
                      {activeExampleEntry[1][k].map((it) => (
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
                              onClick={() =>
                                void generatePatternsFromSource({
                                  exampleText: it.example,
                                  kind: it.kind,
                                  groupName: it.groupName,
                                  requiresQuote: it.requiresQuote,
                                })
                              }
                              style={{ marginRight: '0.35rem' }}
                            >
                              {busy === 'generate-patterns'
                                ? 'Генерация…'
                                : 'Сгенерировать паттерны'}
                            </button>
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
              ))
            ) : (
              <p style={{ color: 'var(--muted)' }}>Для этой группы нет примеров.</p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
