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

const truncatedLabelStyle: CSSProperties = {
  maxWidth: '280px',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const tableCellStyle: CSSProperties = {
  borderBottom: '1px solid var(--border)',
  padding: '0.45rem 0.55rem',
  fontSize: '0.82rem',
  verticalAlign: 'top',
};

const uniformRowCellStyle: CSSProperties = {
  background: 'rgba(34, 197, 94, 0.12)',
};

const uniformRowFirstCellStyle: CSSProperties = {
  ...uniformRowCellStyle,
  boxShadow: 'inset 3px 0 0 rgba(34, 197, 94, 0.45)',
};

const EXTRA_ROW_LABELS: Record<string, string> = {
  BALANCE_ALERTS: 'Уведомления о балансе',
  SOURCE_EXCLUDE_LIST: 'Исключённые источники из аналитики',
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

function formatBalanceAlertsCell(card: CabinetOverviewCardData): string {
  if (card.error) return 'Ошибка загрузки';
  if (card.balanceAlerts.length === 0) return 'Правил нет';
  return card.balanceAlerts
    .map((rule) => {
      const condition = rule.operator === 'gt' ? 'Выше' : 'Ниже';
      const status = rule.enabled ? 'вкл' : 'выкл';
      return `${condition} ${rule.thresholdUsd} USDT (${status})`;
    })
    .join('; ');
}

function formatExcludedSourcesCell(card: CabinetOverviewCardData): string {
  if (card.error) return 'Ошибка загрузки';
  const excluded = parseStringList(valueOf(card.settings, CABINET_EXCLUDED_SOURCES_KEY));
  if (excluded.length === 0) return 'Нет исключений';
  return excluded.join(', ');
}

export function CabinetsOverviewSection({ isAdmin }: CabinetsOverviewSectionProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cards, setCards] = useState<CabinetOverviewCardData[]>([]);
  const [enabledCabinetIds, setEnabledCabinetIds] = useState<string[]>([]);
  const [cabinetFilterInitialized, setCabinetFilterInitialized] = useState(false);

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

  useEffect(() => {
    if (cards.length === 0) {
      if (!cabinetFilterInitialized) {
        setEnabledCabinetIds([]);
      }
      return;
    }
    const allCabinetIds = cards.map((card) => card.cabinet.id);
    setEnabledCabinetIds((prev) => {
      if (!cabinetFilterInitialized) {
        return allCabinetIds;
      }
      return prev.filter((id) => allCabinetIds.includes(id));
    });
    if (!cabinetFilterInitialized) {
      setCabinetFilterInitialized(true);
    }
  }, [cards, cabinetFilterInitialized]);

  const openCabinetSettings = useCallback(
    (cabinetId: string) => {
      try {
        window.localStorage.setItem(ACTIVE_CABINET_STORAGE_KEY, cabinetId);
      } catch {
        // ignore write errors
      }
      document.cookie = `cabinet_id=${encodeURIComponent(cabinetId)}; path=/; max-age=31536000; SameSite=Lax`;
      router.push(
        withAppBasePath(
          `/settings?scope=cabinet&cabinetId=${encodeURIComponent(cabinetId)}`,
        ),
      );
    },
    [router],
  );

  const hasCards = useMemo(() => cards.length > 0, [cards.length]);
  const visibleCards = useMemo(
    () => cards.filter((card) => enabledCabinetIds.includes(card.cabinet.id)),
    [cards, enabledCabinetIds],
  );
  const hasEnabledCabinets = visibleCards.length > 0;

  const toggleCabinet = useCallback((cabinetId: string) => {
    setEnabledCabinetIds((prev) =>
      prev.includes(cabinetId) ? prev.filter((id) => id !== cabinetId) : [...prev, cabinetId],
    );
  }, []);

  const renderSettingsTable = useCallback(
    (
      title: string,
      keys: readonly string[],
      valueFormatter: (card: CabinetOverviewCardData, key: string) => string,
    ) => (
      <section style={{ marginBottom: '1rem' }}>
        <h4 style={{ margin: '0 0 0.45rem 0', fontSize: '0.92rem' }}>{title}</h4>
        <div className="settingsCompareScrollbar" style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', minWidth: '860px', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th
                  style={{
                    ...tableCellStyle,
                    width: '280px',
                    textAlign: 'left',
                    color: 'var(--muted)',
                  }}
                >
                  Параметр
                </th>
                {visibleCards.map((card) => (
                  <th
                    key={`${title}-${card.cabinet.id}`}
                    style={{ ...tableCellStyle, textAlign: 'left', minWidth: '220px' }}
                  >
                    <button
                      type="button"
                      className="btn btnSecondary"
                      style={{ padding: '0.2rem 0.45rem', fontSize: '0.76rem' }}
                      onClick={() => openCabinetSettings(card.cabinet.id)}
                      title={`Перейти в настройки кабинета ${card.cabinet.name}`}
                    >
                      {card.cabinet.name}
                      {card.cabinet.isDefault ? ' (по умолчанию)' : ''}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => {
                const label = EXTRA_ROW_LABELS[key] ?? LABEL_BY_KEY[key] ?? key;
                const rowValues = visibleCards.map((card) =>
                  card.error ? '__error__' : valueFormatter(card, key),
                );
                const isUniformAcrossCabinets =
                  rowValues.length > 1 &&
                  rowValues.every((value) => value === rowValues[0]);
                return (
                  <tr key={`${title}-${key}`}>
                    <td
                      style={
                        isUniformAcrossCabinets
                          ? { ...tableCellStyle, ...uniformRowFirstCellStyle }
                          : tableCellStyle
                      }
                    >
                      <div style={truncatedLabelStyle} title={label}>
                        {label}
                      </div>
                    </td>
                    {visibleCards.map((card) => (
                      <td
                        key={`${title}-${key}-${card.cabinet.id}`}
                        style={
                          isUniformAcrossCabinets
                            ? {
                                ...tableCellStyle,
                                ...uniformRowCellStyle,
                                wordBreak: 'break-word',
                              }
                            : { ...tableCellStyle, wordBreak: 'break-word' }
                        }
                      >
                        {card.error ? 'Ошибка загрузки' : valueFormatter(card, key)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    ),
    [visibleCards, openCabinetSettings],
  );

  if (!isAdmin) return null;

  return (
    <section className="card" style={{ marginTop: '1rem' }}>
      <h2 style={{ marginBottom: '0.45rem', fontSize: '1.05rem' }}>
        Сравнение настроек кабинетов
      </h2>
      <p style={{ color: 'var(--muted)', marginBottom: '0.9rem' }}>
        Таблицы сравнения: строки — параметры, столбцы — кабинеты. Если таблица шире
        экрана, используйте горизонтальный скролл. Название кабинета в заголовке
        ведёт в его настройки.
      </p>
      {!loading ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem', marginBottom: '0.85rem' }}>
          {cards.map((card) => {
            const enabled = enabledCabinetIds.includes(card.cabinet.id);
            return (
              <button
                key={card.cabinet.id}
                type="button"
                onClick={() => toggleCabinet(card.cabinet.id)}
                className={enabled ? 'btn' : 'btn btnSecondary'}
                style={{ padding: '0.2rem 0.55rem', fontSize: '0.78rem' }}
                title={enabled ? 'Скрыть кабинет из сравнения' : 'Показать кабинет в сравнении'}
              >
                {card.cabinet.name}
                {card.cabinet.isDefault ? ' (по умолчанию)' : ''}
              </button>
            );
          })}
        </div>
      ) : null}
      {loading ? <p style={{ color: 'var(--muted)' }}>Загрузка кабинетов...</p> : null}
      {error ? <p className="msg err">{error}</p> : null}
      {!loading && !error && !hasCards ? (
        <p style={{ color: 'var(--muted)' }}>Кабинеты не найдены.</p>
      ) : null}
      {!loading && !error && hasCards && !hasEnabledCabinets ? (
        <p style={{ color: 'var(--muted)' }}>
          Выключены все кабинеты. Включите хотя бы один лейбл кабинета.
        </p>
      ) : null}

      {!loading && hasCards && hasEnabledCabinets ? (
        <>
          {renderSettingsTable(
            'Торговые параметры',
            CABINET_TRADING_OVERVIEW_KEYS,
            (card, key) => formatSettingValue(key, valueOf(card.settings, key)),
          )}

          {renderSettingsTable(
            'Telegram / Userbot',
            CABINET_TELEGRAM_OVERVIEW_KEYS,
            (card, key) => formatSettingValue(key, valueOf(card.settings, key)),
          )}

          {renderSettingsTable(
            'Дополнительно',
            ['BALANCE_ALERTS', 'SOURCE_EXCLUDE_LIST'],
            (card, key) => {
              if (key === 'BALANCE_ALERTS') return formatBalanceAlertsCell(card);
              return formatExcludedSourcesCell(card);
            },
          )}
        </>
      ) : null}
    </section>
  );
}
