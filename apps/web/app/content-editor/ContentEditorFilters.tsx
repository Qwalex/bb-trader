'use client';

import {
  COLLECT_KIND_OPTIONS,
  FILTER_CLASSIFICATION_OPTIONS,
  FILTER_STATUS_OPTIONS,
} from './content-editor-page.constants';
import { CLASSIFICATION_LABEL } from './content-editor-page.util';
import type { CollectSettingsState, ContentEditorFiltersState } from './content-editor-page.types';

type Props = {
  filters: ContentEditorFiltersState;
  collectSettings: CollectSettingsState;
  sourceChatOptions: Array<{ chatId: string; title: string }>;
  resultCount: number;
  busy: string | null;
  onFiltersChange: (next: ContentEditorFiltersState) => void;
  onCollectKindsChange: (kinds: string[]) => void;
  onSaveCollectSettings: () => void;
};

export function ContentEditorFilters({
  filters,
  collectSettings,
  sourceChatOptions,
  resultCount,
  busy,
  onFiltersChange,
  onCollectKindsChange,
  onSaveCollectSettings,
}: Props) {
  return (
    <div className="card" style={{ marginBottom: '1rem' }}>
      <h3 style={{ marginBottom: '0.75rem' }}>Фильтры и сбор</h3>
      <div
        style={{
          display: 'grid',
          gap: '0.75rem',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          marginBottom: '0.75rem',
        }}
      >
        <label>
          <span className="contentEditorFieldLabel">Тип</span>
          <select
            className="contentEditorAiInput"
            value={filters.classification}
            onChange={(e) =>
              onFiltersChange({
                ...filters,
                classification: e.target.value as ContentEditorFiltersState['classification'],
              })
            }
          >
            {FILTER_CLASSIFICATION_OPTIONS.map((key) => (
              <option key={key} value={key}>
                {key === 'all' ? 'Все типы' : CLASSIFICATION_LABEL[key]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="contentEditorFieldLabel">Статус</span>
          <select
            className="contentEditorAiInput"
            value={filters.status}
            onChange={(e) =>
              onFiltersChange({
                ...filters,
                status: e.target.value as ContentEditorFiltersState['status'],
              })
            }
          >
            {FILTER_STATUS_OPTIONS.map((opt) => (
              <option key={opt.value || 'any'} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="contentEditorFieldLabel">Источник</span>
          <select
            className="contentEditorAiInput"
            value={filters.sourceChatId}
            onChange={(e) => onFiltersChange({ ...filters, sourceChatId: e.target.value })}
          >
            <option value="">Все группы</option>
            {sourceChatOptions.map((g) => (
              <option key={g.chatId} value={g.chatId}>
                {g.title} ({g.chatId})
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="contentEditorFieldLabel">Поиск</span>
          <input
            type="search"
            className="contentEditorAiInput"
            value={filters.q}
            placeholder="Текст поста…"
            onChange={(e) => onFiltersChange({ ...filters, q: e.target.value })}
          />
        </label>
        <label>
          <span className="contentEditorFieldLabel">С даты</span>
          <input
            type="date"
            className="contentEditorAiInput"
            value={filters.from}
            onChange={(e) => onFiltersChange({ ...filters, from: e.target.value })}
          />
        </label>
        <label>
          <span className="contentEditorFieldLabel">По дату</span>
          <input
            type="date"
            className="contentEditorAiInput"
            value={filters.to}
            onChange={(e) => onFiltersChange({ ...filters, to: e.target.value })}
          />
        </label>
      </div>
      <p style={{ color: 'var(--muted)', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
        Найдено: {resultCount}
      </p>

      <details>
        <summary style={{ cursor: 'pointer', marginBottom: '0.5rem' }}>
          Какие типы сообщений собирать в редактор
        </summary>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '0.5rem' }}>
          {COLLECT_KIND_OPTIONS.map((kind) => (
            <label key={kind} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <input
                type="checkbox"
                checked={collectSettings.kinds.includes(kind)}
                onChange={(e) => {
                  const next = e.target.checked
                    ? [...collectSettings.kinds, kind]
                    : collectSettings.kinds.filter((k) => k !== kind);
                  onCollectKindsChange(next);
                }}
              />
              {CLASSIFICATION_LABEL[kind]}
            </label>
          ))}
        </div>
        <button
          type="button"
          className="btn"
          disabled={busy === 'collect-settings'}
          onClick={onSaveCollectSettings}
        >
          {busy === 'collect-settings' ? '…' : 'Сохранить настройки сбора'}
        </button>
      </details>
    </div>
  );
}
