'use client';

import { formatDateTimeRu } from '../../lib/datetime';
import { CLASSIFICATION_LABEL, STATUS_LABEL } from './content-editor-page.util';
import type { ContentPostItem } from './content-editor-page.types';

type Props = {
  posts: ContentPostItem[];
  selectedId: string | null;
  selectedIds: Set<string>;
  busy: string | null;
  onSelect: (id: string) => void;
  onToggleSelect: (id: string) => void;
  onDelete: (post: ContentPostItem) => void;
};

export function ContentEditorList({
  posts,
  selectedId,
  selectedIds,
  busy,
  onSelect,
  onToggleSelect,
  onDelete,
}: Props) {
  if (posts.length === 0) {
    return <p style={{ color: 'var(--muted)' }}>Пока нет постов по выбранным фильтрам</p>;
  }

  return (
    <div className="contentEditorList">
      {posts.map((p) => (
        <div key={p.id} className="contentEditorListItem">
          <input
            type="checkbox"
            checked={selectedIds.has(p.id)}
            title="Выбрать для генерации"
            onChange={() => onToggleSelect(p.id)}
            style={{ marginRight: '0.35rem', flexShrink: 0 }}
          />
          <button
            type="button"
            className={`contentEditorListSelect${
              selectedId === p.id ? ' contentEditorListSelectSelected' : ''
            }`}
            onClick={() => onSelect(p.id)}
          >
            <div className="contentEditorListMeta">
              {CLASSIFICATION_LABEL[p.classification]} · {STATUS_LABEL[p.status]}
              {p.sourceTitle ? ` · ${p.sourceTitle}` : ''}
              {p.createdAt ? ` · ${formatDateTimeRu(p.createdAt)}` : ''}
            </div>
            <div className="contentEditorListPreview">{p.displayText}</div>
          </button>
          <button
            type="button"
            className="contentEditorListDelete"
            title="Удалить"
            disabled={busy !== null}
            onClick={(e) => {
              e.stopPropagation();
              onDelete(p);
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
