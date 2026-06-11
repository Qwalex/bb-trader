'use client';

import { formatDateTimeRu } from '../../lib/datetime';
import { CLASSIFICATION_LABEL, STATUS_LABEL } from './content-editor-page.util';
import type { ContentPostItem } from './content-editor-page.types';

type Props = {
  post: ContentPostItem | null;
  draftText: string;
  aiInstruction: string;
  busy: string | null;
  onDraftChange: (text: string) => void;
  onAiInstructionChange: (text: string) => void;
  onSave: () => void;
  onAiRewrite: () => void;
  onPublish: () => void;
  onDelete: () => void;
};

export function ContentEditorPanel({
  post,
  draftText,
  aiInstruction,
  busy,
  onDraftChange,
  onAiInstructionChange,
  onSave,
  onAiRewrite,
  onPublish,
  onDelete,
}: Props) {
  if (!post) {
    return <p style={{ color: 'var(--muted)' }}>Выберите сообщение слева</p>;
  }

  return (
    <>
      <div className="contentEditorPanelMeta">
        {CLASSIFICATION_LABEL[post.classification]} · {STATUS_LABEL[post.status]}
        {post.publishedAt ? ` · опубликован ${formatDateTimeRu(post.publishedAt)}` : ''}
        {post.publicationCount > 0 ? ` · публикаций: ${post.publicationCount}` : ''}
        {post.ingestId ? (
          <>
            {' '}
            ·{' '}
            <span style={{ color: 'var(--muted)' }} title="ingest id">
              ingest: {post.ingestId.slice(0, 12)}…
            </span>
          </>
        ) : null}
      </div>

      <div className="contentEditorEditGrid">
        <div>
          <span className="contentEditorFieldLabel">Предпросмотр</span>
          <div className="contentEditorPreview" aria-label="Предпросмотр сообщения">
            <div className="contentEditorPreviewBubble">
              {draftText.trim() ? (
                draftText
              ) : (
                <span className="contentEditorPreviewEmpty">Пустой текст</span>
              )}
            </div>
          </div>
        </div>
        <div>
          <label className="contentEditorFieldLabel" htmlFor="content-editor-textarea">
            Редактор
          </label>
          <textarea
            id="content-editor-textarea"
            className="contentEditorTextarea"
            value={draftText}
            onChange={(e) => onDraftChange(e.target.value)}
            spellCheck
          />
        </div>
      </div>

      <label className="contentEditorFieldLabel" htmlFor="content-editor-ai">
        Инструкция для AI (необязательно)
      </label>
      <input
        id="content-editor-ai"
        type="text"
        className="contentEditorAiInput"
        value={aiInstruction}
        onChange={(e) => onAiInstructionChange(e.target.value)}
        placeholder="Например: сократи до 3 абзацев, добавь эмодзи умеренно"
      />

      <div className="contentEditorActions">
        <button type="button" className="btn" disabled={busy !== null} onClick={onSave}>
          {busy === 'save' ? '…' : 'Сохранить черновик'}
        </button>
        <button type="button" className="btn" disabled={busy !== null} onClick={onAiRewrite}>
          {busy === 'ai' ? '…' : 'Переписать через AI'}
        </button>
        <button type="button" className="btn primary" disabled={busy !== null} onClick={onPublish}>
          {busy === 'publish' ? '…' : 'Опубликовать'}
        </button>
        <span className="contentEditorActionsSpacer" />
        <button type="button" className="btn btnDanger" disabled={busy !== null} onClick={onDelete}>
          {busy === `delete:${post.id}` ? '…' : 'Удалить'}
        </button>
      </div>

      <details style={{ marginTop: '1rem' }}>
        <summary style={{ cursor: 'pointer', color: 'var(--muted)' }}>Оригинал из источника</summary>
        <pre className="contentEditorOriginal">{post.originalText}</pre>
      </details>
    </>
  );
}
