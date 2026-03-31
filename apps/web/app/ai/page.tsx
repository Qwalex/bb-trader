'use client';

import { useState } from 'react';

import { getApiBase } from '../../lib/api';
import { formatDateTimeRu } from '../../lib/datetime';

type Recommendation = {
  area: 'entry_size' | 'leverage' | 'risk_management';
  priority: 'high' | 'medium' | 'low';
  recommendation: string;
  rationale: string;
};

type GroupRecommendation = Recommendation & {
  groupName: string;
};

type AdviceResponse = {
  ok: boolean;
  error?: string;
  model?: string;
  summary?: string;
  alerts?: string[];
  globalRecommendations?: Recommendation[];
  groupRecommendations?: GroupRecommendation[];
  contextMeta?: {
    generatedAt?: string;
    closedTradesAnalysed?: number;
  };
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
};

function areaLabel(area: Recommendation['area']): string {
  if (area === 'entry_size') return 'Входы';
  if (area === 'leverage') return 'Плечо';
  return 'Риск-менеджмент';
}

function priorityLabel(priority: Recommendation['priority']): string {
  if (priority === 'high') return 'Высокий';
  if (priority === 'low') return 'Низкий';
  return 'Средний';
}

export default function AiPage() {
  const [loading, setLoading] = useState(false);
  const [closedLimit, setClosedLimit] = useState(600);
  const [data, setData] = useState<AdviceResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runAdvice() {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${getApiBase()}/diagnostics/trading-advice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ closedLimit }),
      });
      if (!res.ok) {
        throw new Error(`${res.status} ${res.statusText}`);
      }
      const json = (await res.json()) as AdviceResponse;
      if (!json.ok) {
        throw new Error(json.error ?? 'AI не смог сформировать рекомендации');
      }
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <h1 className="pageTitle">AI рекомендации</h1>
      <p style={{ color: 'var(--muted)', marginBottom: '1rem' }}>
        AI анализирует торговую историю, метрики, глобальные настройки и настройки по группам, после
        чего предлагает корректировки по входам, плечу и риск-менеджменту.
      </p>

      {error && <p className="msg err">{error}</p>}

      <div className="card" style={{ marginBottom: '1rem' }}>
        <h3 style={{ marginBottom: '0.6rem' }}>Запуск анализа</h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.7rem', alignItems: 'center' }}>
          <label style={{ display: 'flex', gap: '0.45rem', alignItems: 'center' }}>
            Закрытых сделок для анализа:
            <input
              type="number"
              min={100}
              max={4000}
              value={closedLimit}
              onChange={(e) =>
                setClosedLimit(Math.max(100, Math.min(4000, Number(e.target.value) || 100)))
              }
              style={{
                width: 120,
                padding: '0.35rem 0.5rem',
                background: 'var(--card)',
                color: 'var(--foreground)',
                border: '1px solid var(--border)',
                borderRadius: 6,
              }}
            />
          </label>
          <button type="button" className="btn" onClick={() => void runAdvice()} disabled={loading}>
            {loading ? 'AI анализирует…' : 'Сформировать рекомендации'}
          </button>
        </div>
      </div>

      {data?.ok && (
        <div style={{ display: 'grid', gap: '1rem' }}>
          <div className="card">
            <h3 style={{ marginBottom: '0.6rem' }}>Итог AI</h3>
            <p style={{ margin: 0 }}>{data.summary ?? '—'}</p>
            <p style={{ marginTop: '0.65rem', color: 'var(--muted)', fontSize: '0.84rem' }}>
              Модель: {data.model ?? '—'} · Сделок проанализировано:{' '}
              {data.contextMeta?.closedTradesAnalysed ?? '—'}
              {data.contextMeta?.generatedAt
                ? ` · Сформировано: ${formatDateTimeRu(data.contextMeta.generatedAt)}`
                : ''}
            </p>
            {data.usage?.totalTokens != null && (
              <p style={{ marginTop: '0.35rem', color: 'var(--muted)', fontSize: '0.82rem' }}>
                Токены: input {data.usage.inputTokens ?? 0}, output {data.usage.outputTokens ?? 0},
                total {data.usage.totalTokens}
              </p>
            )}
          </div>

          {Array.isArray(data.alerts) && data.alerts.length > 0 && (
            <div className="card">
              <h3 style={{ marginBottom: '0.6rem' }}>Алерты</h3>
              <ul style={{ margin: 0, paddingLeft: '1.2rem', display: 'grid', gap: '0.4rem' }}>
                {data.alerts.map((item, i) => (
                  <li key={`${item}-${i}`}>{item}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="card">
            <h3 style={{ marginBottom: '0.6rem' }}>Рекомендации (глобально)</h3>
            {(data.globalRecommendations ?? []).length === 0 ? (
              <p style={{ color: 'var(--muted)' }}>Пока нет рекомендаций.</p>
            ) : (
              <div style={{ display: 'grid', gap: '0.7rem' }}>
                {(data.globalRecommendations ?? []).map((row, i) => (
                  <div
                    key={`${row.area}-${i}`}
                    style={{
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      padding: '0.6rem 0.75rem',
                    }}
                  >
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>
                      {areaLabel(row.area)} · Приоритет: {priorityLabel(row.priority)}
                    </div>
                    <div>{row.recommendation}</div>
                    <div style={{ marginTop: 4, color: 'var(--muted)', fontSize: '0.84rem' }}>
                      Почему: {row.rationale}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card">
            <h3 style={{ marginBottom: '0.6rem' }}>Рекомендации по группам</h3>
            {(data.groupRecommendations ?? []).length === 0 ? (
              <p style={{ color: 'var(--muted)' }}>Пока нет рекомендаций по группам.</p>
            ) : (
              <div style={{ display: 'grid', gap: '0.7rem' }}>
                {(data.groupRecommendations ?? []).map((row, i) => (
                  <div
                    key={`${row.groupName}-${row.area}-${i}`}
                    style={{
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      padding: '0.6rem 0.75rem',
                    }}
                  >
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>
                      {row.groupName} · {areaLabel(row.area)} · Приоритет: {priorityLabel(row.priority)}
                    </div>
                    <div>{row.recommendation}</div>
                    <div style={{ marginTop: 4, color: 'var(--muted)', fontSize: '0.84rem' }}>
                      Почему: {row.rationale}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

