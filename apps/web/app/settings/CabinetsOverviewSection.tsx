'use client';

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';

import { ACTIVE_CABINET_STORAGE_KEY } from '../../lib/api.constants';
import { fetchApiResponse } from '../../lib/api';
import { LABEL_BY_KEY } from './settings-page.constants';
import { withAppBasePath } from './settings-page.util';
import {
  CABINET_EXCLUDED_SOURCES_KEY,
  CABINET_TELEGRAM_OVERVIEW_KEYS,
  CABINET_TRADING_OVERVIEW_KEYS,
} from './cabinets-overview-page.constants';
import {
  formatBoolean,
  formatCommonValue,
  formatDefaultOrderUsd,
  formatStringList,
  formatTelegramNotifyApiTradeCancelled,
  formatTelegramNotifyTradeEvents,
  formatTpSlStepStart,
  formatTradeEventTypes,
  parseStringList,
  valueOf,
} from './cabinets-overview-page.util';
import type {
  BalanceAlertsResponse,
  CabinetListResponse,
  CabinetOverviewCardData,
  SettingsEffectiveResponse,
} from './cabinets-overview-page.types';

type CabinetsOverviewSectionProps = {
  isAdmin: boolean;
};

const cardButtonStyle: CSSProperties = {
  cursor: 'pointer',
  outline: 'none',
};

function formatSettingValue(key: string, value: string): string {
  if (key === 'DEFAULT_ORDER_USD') return formatDefaultOrderUsd(value);
  if (key === 'TP_SL_STEP_START') return formatTpSlStepStart(value);
  if (key === 'TELEGRAM_NOTIFY_API_TRADE_CANCELLED') {
    return formatTelegramNotifyApiTradeCancelled(value);
  }
  if (key === 'TELEGRAM_NOTIFY_TRADE_EVENTS') {
    return formatTelegramNotifyTradeEvents(value);
  }
  if (key === 'TELEGRAM_NOTIFY_TRADE_EVENT_TYPES') {
    return formatTradeEventTypes(value);
  }
  if (key === 'TELEGRAM_WHITELIST') {
    return formatStringList(value);
  }
  if (
    key === 'BYBIT_TESTNET' ||
    key === 'BUMP_TO_MIN_EXCHANGE_LOT' ||
    key === 'DEFAULT_LEVERAGE_ENABLED'
  ) {
    return formatBoolean(value);
  }
  return formatCommonValue(value);
}

export function CabinetsOverviewSection({ isAdmin }: CabinetsOverviewSectionProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cards, setCards] = useState<CabinetOverviewCardData[]>([]);

  useEffect(() => {
    if (!isAdmin) {
      setLoading(false);
      setError(null);
      setCards([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const cabinetsRes = await fetchApiResponse('/cabinets');
        if (!cabinetsRes.ok) throw new Error(String(cabinetsRes.status));
        const cabinetsJson = (await cabinetsRes.json()) as CabinetListResponse;
        const cabinets = Array.isArray(cabinetsJson.items) ? cabinetsJson.items : [];

        const nextCards = await Promise.all(
          cabinets.map(async (cabinet): Promise<CabinetOverviewCardData> => {
            try {
              const [settingsRes, alertsRes] = await Promise.all([
                fetchApiResponse('/settings/effective', undefined, cabinet.id),
                fetchApiResponse('/bybit/balance-alerts', undefined, cabinet.id),
              ]);
              if (!settingsRes.ok || !alertsRes.ok) {
                throw new Error('load_failed');
              }
              const settingsJson = (await settingsRes.json()) as SettingsEffectiveResponse;
              const alertsJson = (await alertsRes.json()) as BalanceAlertsResponse;
              return {
                cabinet,
                settings: Array.isArray(settingsJson.settings) ? settingsJson.settings : [],
                balanceAlerts: Array.isArray(alertsJson.items) ? alertsJson.items : [],
                error: null,
              };
            } catch {
              return {
                cabinet,
                settings: [],
                balanceAlerts: [],
                error: 'Не удалось загрузить данные кабинета',
              };
            }
          }),
        );

        if (!cancelled) {
          setCards(nextCards);
        }
      } catch {
        if (!cancelled) {
          setError('Не удалось загрузить список кабинетов');
          setCards([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  const openCabinetSettings = useCallback(
    (cabinetId: string) => {
      try {
        window.localStorage.setItem(ACTIVE_CABINET_STORAGE_KEY, cabinetId);
      } catch {
        // ignore write errors
      }
      document.cookie = `cabinet_id=${encodeURIComponent(cabinetId)}; path=/; max-age=31536000; SameSite=Lax`;
      router.push(withAppBasePath(`/settings?scope=cabinet&cabinetId=${encodeURIComponent(cabinetId)}`));
    },
    [router],
  );

  const hasCards = useMemo(() => cards.length > 0, [cards.length]);

  if (!isAdmin) return null;

  return (
    <section className="card" style={{ marginTop: '1rem' }}>
      <h2 style={{ marginBottom: '0.45rem', fontSize: '1.05rem' }}>Сравнение настроек кабинетов</h2>
      <p style={{ color: 'var(--muted)', marginBottom: '0.9rem' }}>
        Быстрый обзор cabinet-scoped настроек. Нажмите карточку, чтобы перейти в настройки выбранного кабинета.
      </p>
      {loading ? <p style={{ color: 'var(--muted)' }}>Загрузка кабинетов...</p> : null}
      {error ? <p className="msg err">{error}</p> : null}
      {!loading && !error && !hasCards ? (
        <p style={{ color: 'var(--muted)' }}>Кабинеты не найдены.</p>
      ) : null}
      {!loading && hasCards ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
            gap: '0.8rem',
          }}
        >
          {cards.map((card) => {
            const excludedSources = parseStringList(
              valueOf(card.settings, CABINET_EXCLUDED_SOURCES_KEY),
            );
            return (
              <article
                key={card.cabinet.id}
                className="card"
                role="button"
                tabIndex={0}
                style={cardButtonStyle}
                onClick={() => openCabinetSettings(card.cabinet.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    openCabinetSettings(card.cabinet.id);
                  }
                }}
              >
                <div
                  style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginBottom: '0.65rem' }}
                >
                  <h3 style={{ margin: 0, fontSize: '1rem' }}>{card.cabinet.name}</h3>
                  {card.cabinet.isDefault ? (
                    <span
                      style={{
                        border: '1px solid var(--border)',
                        borderRadius: 999,
                        padding: '0.05rem 0.45rem',
                        fontSize: '0.72rem',
                        color: 'var(--muted)',
                      }}
                    >
                      По умолчанию
                    </span>
                  ) : null}
                </div>
                <p style={{ color: 'var(--muted)', marginBottom: '0.75rem', fontSize: '0.82rem' }}>
                  {card.cabinet.slug}
                </p>
                {card.error ? (
                  <p className="msg err" style={{ marginBottom: 0 }}>
                    {card.error}
                  </p>
                ) : (
                  <>
                    <section style={{ marginBottom: '0.8rem' }}>
                      <h4 style={{ margin: '0 0 0.35rem 0', fontSize: '0.9rem' }}>Торговые параметры</h4>
                      <div style={{ display: 'grid', gap: '0.28rem' }}>
                        {CABINET_TRADING_OVERVIEW_KEYS.map((key) => (
                          <div
                            key={key}
                            style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: '0.5rem' }}
                          >
                            <span style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>
                              {LABEL_BY_KEY[key] ?? key}
                            </span>
                            <span style={{ fontSize: '0.82rem', wordBreak: 'break-word' }}>
                              {formatSettingValue(key, valueOf(card.settings, key))}
                            </span>
                          </div>
                        ))}
                      </div>
                    </section>

                    <section style={{ marginBottom: '0.8rem' }}>
                      <h4 style={{ margin: '0 0 0.35rem 0', fontSize: '0.9rem' }}>Telegram / Userbot</h4>
                      <div style={{ display: 'grid', gap: '0.28rem' }}>
                        {CABINET_TELEGRAM_OVERVIEW_KEYS.map((key) => (
                          <div
                            key={key}
                            style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: '0.5rem' }}
                          >
                            <span style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>
                              {LABEL_BY_KEY[key] ?? key}
                            </span>
                            <span style={{ fontSize: '0.82rem', wordBreak: 'break-word' }}>
                              {formatSettingValue(key, valueOf(card.settings, key))}
                            </span>
                          </div>
                        ))}
                      </div>
                    </section>

                    <section style={{ marginBottom: '0.8rem' }}>
                      <h4 style={{ margin: '0 0 0.35rem 0', fontSize: '0.9rem' }}>Уведомления о балансе</h4>
                      {card.balanceAlerts.length === 0 ? (
                        <p style={{ color: 'var(--muted)', fontSize: '0.82rem', margin: 0 }}>Правил нет.</p>
                      ) : (
                        <div style={{ display: 'grid', gap: '0.28rem' }}>
                          {card.balanceAlerts.map((rule) => (
                            <div
                              key={rule.id}
                              style={{
                                display: 'grid',
                                gridTemplateColumns: '1.1fr 0.9fr auto',
                                gap: '0.45rem',
                                fontSize: '0.82rem',
                              }}
                            >
                              <span>{rule.operator === 'gt' ? 'Выше порога' : 'Ниже порога'}</span>
                              <span>{rule.thresholdUsd} USDT</span>
                              <span style={{ color: rule.enabled ? 'inherit' : 'var(--muted)' }}>
                                {rule.enabled ? 'Вкл' : 'Выкл'}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </section>

                    <section>
                      <h4 style={{ margin: '0 0 0.35rem 0', fontSize: '0.9rem' }}>
                        Исключённые источники из аналитики
                      </h4>
                      {excludedSources.length === 0 ? (
                        <p style={{ color: 'var(--muted)', fontSize: '0.82rem', margin: 0 }}>
                          Нет исключений.
                        </p>
                      ) : (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                          {excludedSources.map((source) => (
                            <span
                              key={`${card.cabinet.id}-${source}`}
                              style={{
                                border: '1px solid var(--border)',
                                borderRadius: 999,
                                padding: '0.15rem 0.45rem',
                                fontSize: '0.76rem',
                                color: 'var(--muted)',
                              }}
                            >
                              {source}
                            </span>
                          ))}
                        </div>
                      )}
                    </section>
                  </>
                )}
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
