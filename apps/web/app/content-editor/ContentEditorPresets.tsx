'use client';

import { formatDateTimeRu } from '../../lib/datetime';
import type {
  ContentGenerationPresetItem,
  ContentGenerationRunItem,
  PublishGroupItem,
} from './content-editor-page.types';

type Props = {
  presets: ContentGenerationPresetItem[];
  runs: ContentGenerationRunItem[];
  groups: PublishGroupItem[];
  selectedPostCount: number;
  busy: string | null;
  draftPreset: Partial<ContentGenerationPresetItem> & { name: string };
  onDraftChange: (next: Partial<ContentGenerationPresetItem> & { name: string }) => void;
  onSavePreset: () => void;
  onDeletePreset: (id: string) => void;
  onRunPreset: (id: string) => void;
  onGenerateSelected: () => void;
  onSelectPreset: (id: string) => void;
  activePresetId: string | null;
};

export function ContentEditorPresets({
  presets,
  runs,
  groups,
  selectedPostCount,
  busy,
  draftPreset,
  onDraftChange,
  onSavePreset,
  onDeletePreset,
  onRunPreset,
  onGenerateSelected,
  onSelectPreset,
  activePresetId,
}: Props) {
  return (
    <div className="card" style={{ marginBottom: '1rem' }}>
      <h3 style={{ marginBottom: '0.5rem' }}>AI-пресеты генерации</h3>
      <p style={{ color: 'var(--muted)', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
        Пресеты сохраняют промпт и расписание. «Автопубликация» отправляет пост сразу в выбранные
        группы; иначе создаётся черновик.
      </p>

      {presets.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 0.75rem' }}>
          {presets.map((p) => (
            <li
              key={p.id}
              style={{
                marginBottom: '0.35rem',
                padding: '0.35rem 0.5rem',
                borderRadius: 8,
                background:
                  activePresetId === p.id ? 'rgba(0, 200, 255, 0.08)' : 'rgba(255,255,255,0.03)',
              }}
            >
              <button type="button" className="btn" style={{ marginRight: '0.35rem' }} onClick={() => onSelectPreset(p.id)}>
                {p.name}
              </button>
              <span style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>
                {p.enabled ? 'вкл' : 'выкл'} · лимит {p.dailyLimit}/день
                {p.autoPublish ? ' · автопубликация' : ' · черновик'}
                {p.lastRunAt ? ` · запуск ${formatDateTimeRu(p.lastRunAt)}` : ''}
              </span>
              <button
                type="button"
                className="btn"
                style={{ marginLeft: '0.35rem' }}
                disabled={busy !== null}
                onClick={() => onRunPreset(p.id)}
              >
                Запустить
              </button>
              <button
                type="button"
                className="btn btnDanger"
                style={{ marginLeft: '0.35rem' }}
                disabled={busy !== null}
                onClick={() => onDeletePreset(p.id)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <div style={{ display: 'grid', gap: '0.5rem', marginBottom: '0.75rem' }}>
        <input
          type="text"
          className="contentEditorAiInput"
          placeholder="Название пресета"
          value={draftPreset.name}
          onChange={(e) => onDraftChange({ ...draftPreset, name: e.target.value })}
        />
        <textarea
          className="contentEditorTextarea"
          style={{ minHeight: 80 }}
          placeholder="Инструкция для AI"
          value={draftPreset.aiInstruction ?? ''}
          onChange={(e) => onDraftChange({ ...draftPreset, aiInstruction: e.target.value })}
        />
        <input
          type="text"
          className="contentEditorAiInput"
          placeholder="Стиль вывода (необязательно)"
          value={draftPreset.outputStyle ?? ''}
          onChange={(e) => onDraftChange({ ...draftPreset, outputStyle: e.target.value || null })}
        />
        <input
          type="text"
          className="contentEditorAiInput"
          placeholder="Cron UTC, напр. 0 9 * * *"
          value={draftPreset.scheduleCron ?? ''}
          onChange={(e) => onDraftChange({ ...draftPreset, scheduleCron: e.target.value || null })}
        />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
          <label>
            <input
              type="checkbox"
              checked={draftPreset.enabled !== false}
              onChange={(e) => onDraftChange({ ...draftPreset, enabled: e.target.checked })}
            />{' '}
            Включён
          </label>
          <label>
            <input
              type="checkbox"
              checked={draftPreset.autoPublish === true}
              onChange={(e) => onDraftChange({ ...draftPreset, autoPublish: e.target.checked })}
            />{' '}
            Автопубликация
          </label>
          <label>
            Лимит/день{' '}
            <input
              type="number"
              min={1}
              style={{ width: 60 }}
              value={draftPreset.dailyLimit ?? 1}
              onChange={(e) =>
                onDraftChange({
                  ...draftPreset,
                  dailyLimit: Math.max(1, Number.parseInt(e.target.value, 10) || 1),
                })
              }
            />
          </label>
        </div>
        {groups.length > 0 && (
          <div>
            <span className="contentEditorFieldLabel">Группы автопубликации</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              {groups.map((g) => (
                <label key={g.id}>
                  <input
                    type="checkbox"
                    checked={(draftPreset.targetGroupIds ?? []).includes(g.id)}
                    onChange={(e) => {
                      const cur = draftPreset.targetGroupIds ?? [];
                      const next = e.target.checked
                        ? [...cur, g.id]
                        : cur.filter((id) => id !== g.id);
                      onDraftChange({ ...draftPreset, targetGroupIds: next });
                    }}
                  />{' '}
                  {g.title}
                </label>
              ))}
            </div>
          </div>
        )}
        <button type="button" className="btn primary" disabled={busy !== null} onClick={onSavePreset}>
          {busy === 'preset-save' ? '…' : activePresetId ? 'Обновить пресет' : 'Создать пресет'}
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy !== null || selectedPostCount === 0}
          onClick={onGenerateSelected}
        >
          {busy === 'generate-selected'
            ? '…'
            : `Сгенерировать из выбранных (${selectedPostCount})`}
        </button>
      </div>

      {runs.length > 0 && (
        <details>
          <summary style={{ cursor: 'pointer' }}>Журнал последних запусков</summary>
          <ul style={{ fontSize: '0.85rem', color: 'var(--muted)', paddingLeft: '1.2rem' }}>
            {runs.map((r) => (
              <li key={r.id}>
                {formatDateTimeRu(r.createdAt)} · {r.status}
                {r.error ? ` · ${r.error}` : ''}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
