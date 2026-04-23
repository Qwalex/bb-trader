'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { getApiBase } from '../../lib/api';

type Period = 'day' | '3d' | 'week' | 'month' | 'year';

type SpendResponse = {
  period: Period;
  startAt: string;
  endAt: string;
  totalUsd: number;
  requests: number;
  bySource: Array<{
    chatId: string;
    source: string;
    totalUsd: number;
    requests: number;
    avgUsd: number;
  }>;
  timeline: Array<{ at: string; totalUsd: number }>;
};

type OpenrouterBalance = {
  ok: boolean;
  balanceUsd: number | null;
  lowBalance?: boolean;
  thresholdUsd?: number;
  error?: string;
};

const PERIOD_OPTIONS: Array<{ id: Period; label: string }> = [
  { id: 'day', label: 'За день' },
  { id: '3d', label: 'За 3 дня' },
  { id: 'week', label: 'За неделю' },
  { id: 'month', label: 'За месяц' },
  { id: 'year', label: 'За год' },
];

function formatUsd(value: number): string {
  return `$${Number(value || 0).toFixed(4)}`;
}

function formatDateLabel(iso: string, period: Period): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  if (period === 'day') {
    return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
}

export default function OpenrouterSpendPage() {
  const router = useRouter();
  const [adminChecked, setAdminChecked] = useState(false);
  const [period, setPeriod] = useState<Period>('day');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<SpendResponse | null>(null);
  const [balance, setBalance] = useState<OpenrouterBalance | null>(null);

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

  useEffect(() => {
    if (!adminChecked) return;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const [spendRes, balanceRes] = await Promise.all([
          fetch(
            `${getApiBase()}/telegram-userbot/openrouter-spend?period=${encodeURIComponent(period)}`,
          ),
          fetch(`${getApiBase()}/telegram-userbot/openrouter-balance`),
        ]);
        if (!spendRes.ok) throw new Error(String(spendRes.status));
        const [spendJson, balanceJson] = await Promise.all([
          spendRes.json() as Promise<SpendResponse>,
          balanceRes.ok
            ? (balanceRes.json() as Promise<OpenrouterBalance>)
            : Promise.resolve<OpenrouterBalance>({
                ok: false,
                balanceUsd: null,
                error: String(balanceRes.status),
              }),
        ]);
        setData(spendJson);
        setBalance(balanceJson);
      } catch {
        setError('Не удалось загрузить аналитику OpenRouter');
      } finally {
        setLoading(false);
      }
    })();
  }, [adminChecked, period]);

  if (!adminChecked) {
    return <p style={{ color: 'var(--muted)' }}>Проверка доступа…</p>;
  }

  const timelineData = useMemo(() => {
    if (!data) return [];
    return data.timeline.map((p) => ({
      ...p,
      label: formatDateLabel(p.at, data.period),
    }));
  }, [data]);

  const topSources = useMemo(() => (data?.bySource ?? []).slice(0, 12), [data]);

  return (
    <>
      <h1 className="pageTitle">OpenRouter: затраты по источникам</h1>
      <p style={{ color: 'var(--muted)', marginBottom: '1rem' }}>
        Аналитика расходов в долларах по источникам userbot. Период можно переключать.
      </p>

      <div className="card" style={{ marginBottom: '0.9rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {PERIOD_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              className={`btn ${period === opt.id ? '' : 'btnSecondary'}`}
              onClick={() => setPeriod(opt.id)}
              disabled={loading}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="msg err">{error}</p>}
      {loading && <p style={{ color: 'var(--muted)' }}>Загрузка…</p>}

      {!loading && data && (
        <>
          <div className="grid" style={{ marginBottom: '1rem' }}>
            <div className={`card ${balance?.lowBalance ? 'cardWarn' : ''}`}>
              <h3>Текущий баланс OpenRouter</h3>
              <div className="value">
                {balance?.balanceUsd != null ? formatUsd(balance.balanceUsd) : '—'}
              </div>
              <p style={{ color: 'var(--muted)', marginTop: '0.35rem', fontSize: '0.8rem' }}>
                {balance?.ok === false
                  ? `Не удалось загрузить: ${balance.error ?? 'ошибка API'}`
                  : balance?.lowBalance
                    ? `Внимание: баланс ниже ${Number(balance.thresholdUsd ?? 2).toFixed(2)}$`
                    : 'Актуальный доступный баланс OpenRouter.'}
              </p>
            </div>
            <div className="card">
              <h3>Всего потрачено</h3>
              <div className="value">{formatUsd(data.totalUsd)}</div>
            </div>
            <div className="card">
              <h3>Запросов</h3>
              <div className="value">{data.requests}</div>
            </div>
            <div className="card">
              <h3>Источников</h3>
              <div className="value">{data.bySource.length}</div>
            </div>
          </div>

          <div className="chartWrap">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={timelineData} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#30363d" />
                <XAxis dataKey="label" tick={{ fill: '#8b949e', fontSize: 10 }} />
                <YAxis width={60} tick={{ fill: '#8b949e', fontSize: 10 }} />
                <Tooltip
                  formatter={(v: number) => [formatUsd(v), 'Расход']}
                  contentStyle={{ background: '#1a2332', border: '1px solid #30363d' }}
                />
                <Line type="monotone" dataKey="totalUsd" stroke="#3b82f6" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="chartWrap">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topSources} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#30363d" />
                <XAxis dataKey="source" hide />
                <YAxis width={60} tick={{ fill: '#8b949e', fontSize: 10 }} />
                <Tooltip
                  formatter={(v: number) => [formatUsd(v), 'Расход']}
                  labelFormatter={(_, payload) => String(payload?.[0]?.payload?.source ?? '')}
                  contentStyle={{ background: '#1a2332', border: '1px solid #30363d' }}
                />
                <Bar dataKey="totalUsd" fill="#22c55e" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Источник</th>
                  <th>chatId</th>
                  <th>Расход, $</th>
                  <th>Запросов</th>
                  <th>Средний чек, $</th>
                </tr>
              </thead>
              <tbody>
                {data.bySource.map((row) => (
                  <tr key={row.chatId}>
                    <td>{row.source}</td>
                    <td>
                      <code>{row.chatId}</code>
                    </td>
                    <td>{formatUsd(row.totalUsd)}</td>
                    <td>{row.requests}</td>
                    <td>{formatUsd(row.avgUsd)}</td>
                  </tr>
                ))}
                {data.bySource.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ color: 'var(--muted)' }}>
                      За выбранный период данных о стоимости нет.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
