'use client';

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';

import { fetchApiResponse } from '../../lib/api';
import { formatDateTimeRu } from '../../lib/datetime';

type RunRow = {
  id: string;
  status: string;
  caseCount: number;
  summary: string | null;
  error: string | null;
  models: string[];
  startedAt: string;
  finishedAt: string | null;
  createdAt: string;
};

type RunDetails = {
  ok: boolean;
  error?: string;
  run?: {
    id: string;
    status: string;
    summary: string | null;
    error: string | null;
    models: string[];
    startedAt: string;
    finishedAt: string | null;
  };
  cases?: Array<{
    id: string;
    ingestId: string | null;
    signalId: string | null;
    chatId: string | null;
    messageId: string | null;
    title: string | null;
    status: string;
    trace: unknown;
  }>;
  modelResults?: Array<{
    id: string;
    caseId: string;
    model: string;
    status: string;
    summary: string | null;
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
  }>;
  stepResults?: Array<{
    id: string;
    caseId: string;
    modelResultId: string | null;
    stepKey: string;
    status: string;
    comment: string | null;
    issues: string[];
    evidence: string[];
    missingContext: string[];
    recommendedFixes: string[];
    payload: unknown;
  }>;
  logs?: Array<{
    id: string;
    caseId: string | null;
    modelResultId: string | null;
    level: string;
    category: string;
    message: string;
    payload: unknown;
    createdAt: string;
  }>;
};

type ModelResultRow = NonNullable<RunDetails['modelResults']>[number];

function prettyJson(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

const payloadStyle: CSSProperties = {
  whiteSpace: 'pre-wrap',
  marginTop: '0.45rem',
  padding: '0.6rem',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'rgba(0,0,0,0.15)',
  fontSize: '0.8rem',
  overflowX: 'auto',
};

export default function DiagnosticsPage() {
  const router = useRouter();
  const [adminChecked, setAdminChecked] = useState(false);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [details, setDetails] = useState<RunDetails | null>(null);
  const [loadingRuns, setLoadingRuns] = useState(true);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [runNowLoading, setRunNowLoading] = useState(false);
  const [limit, setLimit] = useState(5);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/auth', { cache: 'no-store' });
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

  if (!adminChecked) {
    return <p style={{ color: 'var(--muted)' }}>Проверка доступа…</p>;
  }

  const loadRuns = useCallback(async () => {
    setLoadingRuns(true);
    setError(null);
    try {
      const res = await fetchApiResponse('/diagnostics/runs?limit=30');
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data = (await res.json()) as RunRow[];
      setRuns(data);
      setSelectedRunId((current) => current ?? data[0]?.id ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingRuns(false);
    }
  }, []);

  const loadDetails = useCallback(async (runId: string) => {
    setLoadingDetails(true);
    setError(null);
    try {
      const res = await fetchApiResponse(`/diagnostics/runs/${runId}`);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data = (await res.json()) as RunDetails;
      setDetails(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingDetails(false);
    }
  }, []);

  useEffect(() => {
    if (!adminChecked) return;
    void loadRuns();
  }, [adminChecked, loadRuns]);

  useEffect(() => {
    if (!adminChecked) return;
    if (selectedRunId) {
      void loadDetails(selectedRunId);
    }
  }, [adminChecked, selectedRunId, loadDetails]);

  useEffect(() => {
    if (!adminChecked) return;
    const status = details?.run?.status;
    const currentRunId = details?.run?.id;
    if (
      !selectedRunId ||
      (status !== 'running' && status !== 'queued') ||
      currentRunId !== selectedRunId
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      void Promise.all([loadDetails(selectedRunId), loadRuns()]);
    }, 2500);
    return () => window.clearTimeout(timer);
  }, [adminChecked, details?.run?.id, details?.run?.status, selectedRunId, loadDetails, loadRuns]);

  async function runLatestNow() {
    setRunNowLoading(true);
    setError(null);
    try {
      const res = await fetchApiResponse('/diagnostics/run-latest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit }),
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data = (await res.json()) as RunDetails;
      if (data.ok === false) {
        throw new Error(data.error ?? 'Не удалось запустить диагностику');
      }
      const runId = data.run?.id ?? null;
      await loadRuns();
      if (runId) {
        setSelectedRunId(runId);
        await loadDetails(runId);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunNowLoading(false);
    }
  }

  const modelResultById = useMemo(() => {
    const map = new Map<string, ModelResultRow>();
    for (const row of details?.modelResults ?? []) {
      map.set(row.id, row);
    }
    return map;
  }, [details?.modelResults]);

  return (
    <>
      <h1 className="pageTitle">Диагностика workflow</h1>
      <p style={{ color: 'var(--muted)', marginBottom: '1rem' }}>
        Прогоняет последние кейсы userbot-пайплайна (из БД + Bybit), проверяет этапы моделями из
        `OPENROUTER_DIAGNOSTIC_MODELS`, сохраняет детальные логи и пошаговые комментарии.
      </p>

      {error && <p className="msg err">{error}</p>}

      <div className="card" style={{ marginBottom: '1rem' }}>
        <h3 style={{ marginBottom: '0.75rem' }}>Новый прогон</h3>
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            Кейсов:
            <input
              type="number"
              min={1}
              max={50}
              value={limit}
              onChange={(e) => setLimit(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
              style={{
                width: 100,
                padding: '0.35rem 0.5rem',
                background: 'var(--card)',
                color: 'var(--foreground)',
                border: '1px solid var(--border)',
                borderRadius: 6,
              }}
            />
          </label>
          <button type="button" className="btn" onClick={() => void runLatestNow()} disabled={runNowLoading}>
            {runNowLoading ? 'Запуск… (может занять время)' : 'Запустить диагностику'}
          </button>
          <button type="button" className="btn btnSecondary" onClick={() => void loadRuns()} disabled={loadingRuns}>
            Обновить список запусков
          </button>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1fr 2fr', gap: '1rem' }}>
        <div className="card">
          <h3 style={{ marginBottom: '0.75rem' }}>История запусков</h3>
          {loadingRuns && <p style={{ color: 'var(--muted)' }}>Загрузка…</p>}
          {!loadingRuns && runs.length === 0 && (
            <p style={{ color: 'var(--muted)' }}>Пока нет запусков диагностики.</p>
          )}
          <div style={{ display: 'grid', gap: '0.5rem' }}>
            {runs.map((run) => {
              const selected = run.id === selectedRunId;
              return (
                <button
                  key={run.id}
                  type="button"
                  onClick={() => setSelectedRunId(run.id)}
                  style={{
                    textAlign: 'left',
                    border: selected ? '1px solid var(--accent)' : '1px solid var(--border)',
                    background: selected ? 'rgba(90, 120, 255, 0.12)' : 'transparent',
                    color: 'var(--foreground)',
                    borderRadius: 8,
                    padding: '0.65rem',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ fontWeight: 600, marginBottom: 2 }}>{run.status}</div>
                  <div style={{ fontSize: '0.82rem', color: 'var(--muted)' }}>
                    {formatDateTimeRu(run.createdAt)} | кейсов: {run.caseCount}
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--muted)', marginTop: 3 }}>
                    {run.models.join(', ')}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="card">
          <h3 style={{ marginBottom: '0.75rem' }}>Детали запуска</h3>
          {loadingDetails && <p style={{ color: 'var(--muted)' }}>Загрузка деталей…</p>}
          {!loadingDetails && (!details || details.ok === false) && (
            <p style={{ color: 'var(--muted)' }}>{details?.error ?? 'Выберите запуск слева.'}</p>
          )}
          {!loadingDetails && details?.ok && details.run && (
            <div style={{ display: 'grid', gap: '0.85rem' }}>
              <div style={{ fontSize: '0.9rem', color: 'var(--muted)' }}>
                Статус: <strong style={{ color: 'var(--foreground)' }}>{details.run.status}</strong>
                {' | '}Старт: {formatDateTimeRu(details.run.startedAt)}
                {details.run.finishedAt ? ` | Завершение: ${formatDateTimeRu(details.run.finishedAt)}` : ''}
              </div>
              {details.run.summary && (
                <p style={{ margin: 0, color: 'var(--foreground)' }}>{details.run.summary}</p>
              )}
              {details.run.error && <p className="msg err">{details.run.error}</p>}

              {(details.cases ?? []).map((c) => {
                const modelResults = (details.modelResults ?? []).filter((m) => m.caseId === c.id);
                const stepResults = (details.stepResults ?? []).filter((s) => s.caseId === c.id);
                const caseLogs = (details.logs ?? []).filter((l) => l.caseId === c.id);

                return (
                  <details key={c.id} className="card">
                    <summary className="settingsSectionSummary">
                      {c.title ?? c.id} | status: {c.status} | models: {modelResults.length}
                    </summary>
                    <div style={{ marginTop: '0.75rem', display: 'grid', gap: '0.65rem' }}>
                      <div style={{ fontSize: '0.82rem', color: 'var(--muted)' }}>
                        ingestId: {c.ingestId ?? '—'} | signalId: {c.signalId ?? '—'}
                      </div>

                      <details>
                        <summary>Trace (raw)</summary>
                        <pre style={payloadStyle}>{prettyJson(c.trace)}</pre>
                      </details>

                      {modelResults.map((mr) => {
                        const modelSteps = stepResults.filter((s) => s.modelResultId === mr.id);
                        return (
                          <details key={mr.id} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '0.45rem' }}>
                            <summary>
                              {mr.model} | {mr.status} | tokens: {mr.totalTokens ?? 0}
                            </summary>
                            <div style={{ marginTop: '0.5rem', display: 'grid', gap: '0.45rem' }}>
                              <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.86rem' }}>
                                {mr.summary ?? 'Без summary'}
                              </p>
                              {modelSteps.map((step) => (
                                <div key={step.id} style={{ border: '1px dashed var(--border)', borderRadius: 8, padding: '0.5rem' }}>
                                  <div style={{ fontWeight: 600 }}>
                                    {step.stepKey} → {step.status}
                                  </div>
                                  {step.comment && (
                                    <div style={{ marginTop: 4, color: 'var(--muted)', fontSize: '0.85rem' }}>
                                      {step.comment}
                                    </div>
                                  )}
                                  {step.issues.length > 0 && (
                                    <div style={{ marginTop: 4, fontSize: '0.82rem' }}>
                                      <strong>Проблемы:</strong> {step.issues.join(' | ')}
                                    </div>
                                  )}
                                  {step.evidence.length > 0 && (
                                    <div style={{ marginTop: 4, fontSize: '0.82rem' }}>
                                      <strong>Evidence:</strong> {step.evidence.join(' | ')}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </details>
                        );
                      })}

                      {stepResults.some((s) => s.modelResultId == null) && (
                        <details>
                          <summary>Системные шаги (без LLM)</summary>
                          <div style={{ marginTop: '0.5rem', display: 'grid', gap: '0.4rem' }}>
                            {stepResults
                              .filter((s) => s.modelResultId == null)
                              .map((s) => (
                                <div key={s.id}>
                                  {s.stepKey}: <strong>{s.status}</strong> — {s.comment ?? '—'}
                                </div>
                              ))}
                          </div>
                        </details>
                      )}

                      <details>
                        <summary>Подробный лог кейса</summary>
                        <div style={{ marginTop: '0.5rem', display: 'grid', gap: '0.45rem' }}>
                          {caseLogs.length === 0 && (
                            <p style={{ color: 'var(--muted)' }}>Лог по этому кейсу пуст.</p>
                          )}
                          {caseLogs.map((log) => (
                            <div key={log.id} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '0.45rem' }}>
                              <div style={{ fontSize: '0.82rem', color: 'var(--muted)' }}>
                                {formatDateTimeRu(log.createdAt)} | {log.level} | {log.category}
                              </div>
                              <div>{log.message}</div>
                              {log.payload != null && (
                                <pre style={payloadStyle}>{prettyJson(log.payload)}</pre>
                              )}
                              {log.modelResultId && (
                                <div style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
                                  model: {modelResultById.get(log.modelResultId)?.model ?? log.modelResultId}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </details>
                    </div>
                  </details>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
