'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { formatDateTimeRu } from '../../lib/datetime';
import { withAppBasePath } from '../../lib/base-path';
import type { ContentPostItem, PublishGroupItem } from './content-editor-page.types';
import {
  CLASSIFICATION_LABEL,
  STATUS_LABEL,
  contentEditorApiFetch,
} from './content-editor-page.util';

export default function ContentEditorPage() {
  const router = useRouter();
  const [adminChecked, setAdminChecked] = useState(false);
  const [posts, setPosts] = useState<ContentPostItem[]>([]);
  const [groups, setGroups] = useState<PublishGroupItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftText, setDraftText] = useState('');
  const [aiInstruction, setAiInstruction] = useState('');
  const [filterClassification, setFilterClassification] = useState<'all' | 'analysis' | 'content'>(
    'all',
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const selectedPost = useMemo(
    () => posts.find((p) => p.id === selectedId) ?? null,
    [posts, selectedId],
  );

  async function loadPosts() {
    const qs =
      filterClassification === 'all' ? '' : `?classification=${filterClassification}`;
    const res = await contentEditorApiFetch(`/telegram-userbot/content/posts${qs}`);
    const j = (await res.json()) as { items?: ContentPostItem[] };
    setPosts(Array.isArray(j.items) ? j.items : []);
  }

  async function loadGroups() {
    const res = await contentEditorApiFetch('/telegram-userbot/publish-groups');
    const j = (await res.json()) as { items?: PublishGroupItem[] };
    setGroups(Array.isArray(j.items) ? j.items : []);
  }

  async function loadAll() {
    await Promise.all([loadPosts(), loadGroups()]);
  }

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(withAppBasePath('/api/auth'), { cache: 'no-store' });
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
    void loadAll().catch(() => setMsg({ type: 'err', text: 'Не удалось загрузить данные' }));
  }, [adminChecked, filterClassification]);

  useEffect(() => {
    if (selectedId && !posts.some((p) => p.id === selectedId)) {
      setSelectedId(null);
    }
  }, [posts, selectedId]);

  useEffect(() => {
    if (!selectedPost) {
      setDraftText('');
      return;
    }
    setDraftText(selectedPost.displayText);
  }, [selectedPost?.id, selectedPost?.displayText]);

  async function runBusy(key: string, fn: () => Promise<void>) {
    setBusy(key);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setMsg({ type: 'err', text: e instanceof Error ? e.message : 'Ошибка' });
    } finally {
      setBusy(null);
    }
  }

  async function saveDraft() {
    if (!selectedPost) return;
    await runBusy('save', async () => {
      const res = await contentEditorApiFetch(`/telegram-userbot/content/posts/${selectedPost.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ editedText: draftText }),
      });
      const j = (await res.json()) as { ok?: boolean; error?: string; item?: ContentPostItem };
      if (j.ok === false || !j.item) {
        throw new Error(j.error ?? 'Не удалось сохранить');
      }
      setPosts((prev) => prev.map((p) => (p.id === j.item!.id ? j.item! : p)));
      setMsg({ type: 'ok', text: 'Черновик сохранён' });
    });
  }

  async function aiRewrite() {
    if (!selectedPost) return;
    await runBusy('ai', async () => {
      const res = await contentEditorApiFetch(
        `/telegram-userbot/content/posts/${selectedPost.id}/ai-rewrite`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ instruction: aiInstruction.trim() || undefined }),
        },
      );
      const j = (await res.json()) as { ok?: boolean; error?: string; item?: ContentPostItem };
      if (j.ok === false || !j.item) {
        throw new Error(j.error ?? 'AI не переписал текст');
      }
      setPosts((prev) => prev.map((p) => (p.id === j.item!.id ? j.item! : p)));
      setDraftText(j.item.displayText);
      setMsg({ type: 'ok', text: 'Текст переписан через AI' });
    });
  }

  async function publishPost() {
    if (!selectedPost) return;
    await runBusy('publish', async () => {
      const res = await contentEditorApiFetch(
        `/telegram-userbot/content/posts/${selectedPost.id}/publish`,
        { method: 'POST' },
      );
      const j = (await res.json()) as {
        ok?: boolean;
        error?: string;
        item?: ContentPostItem;
        results?: Array<{ title: string; status: string; error?: string | null }>;
      };
      if (j.ok === false || !j.item) {
        throw new Error(j.error ?? 'Публикация не удалась');
      }
      setPosts((prev) => prev.map((p) => (p.id === j.item!.id ? j.item! : p)));
      const failed = (j.results ?? []).filter((r) => r.status !== 'posted');
      setMsg({
        type: failed.length ? 'err' : 'ok',
        text:
          failed.length > 0
            ? `Частично: ${failed.map((r) => `${r.title}: ${r.error ?? 'ошибка'}`).join('; ')}`
            : 'Опубликовано во все выбранные группы',
      });
    });
  }

  async function deletePost(post: ContentPostItem) {
    const label = post.displayText.slice(0, 80).trim() || post.id;
    const ok = window.confirm(
      `Удалить сообщение из редактора?\n\n«${label}${post.displayText.length > 80 ? '…' : ''}»\n\nПубликации в Telegram не отзываются.`,
    );
    if (!ok) return;
    await runBusy(`delete:${post.id}`, async () => {
      const res = await contentEditorApiFetch(`/telegram-userbot/content/posts/${post.id}`, {
        method: 'DELETE',
      });
      const j = (await res.json()) as { ok?: boolean; error?: string };
      if (j.ok !== true) {
        throw new Error(j.error ?? 'Не удалось удалить');
      }
      setPosts((prev) => prev.filter((p) => p.id !== post.id));
      if (selectedId === post.id) {
        setSelectedId(null);
        setDraftText('');
      }
      setMsg({ type: 'ok', text: 'Сообщение удалено' });
    });
  }

  async function toggleGroup(groupId: string, checked: boolean) {
    const nextIds = groups
      .filter((g) => (g.id === groupId ? checked : Boolean(g.contentPublishEnabled)))
      .map((g) => g.id);
    await runBusy(`group-${groupId}`, async () => {
      const res = await contentEditorApiFetch('/telegram-userbot/content/publish-groups', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabledGroupIds: nextIds }),
      });
      const j = (await res.json()) as {
        ok?: boolean;
        items?: Array<{ id: string; contentPublishEnabled: boolean }>;
      };
      if (j.ok !== true || !Array.isArray(j.items)) {
        throw new Error('Не удалось сохранить выбор групп');
      }
      const map = new Map(j.items.map((i) => [i.id, i.contentPublishEnabled]));
      setGroups((prev) =>
        prev.map((g) => ({
          ...g,
          contentPublishEnabled: map.get(g.id) ?? false,
        })),
      );
      setMsg({ type: 'ok', text: 'Выбор групп сохранён' });
    });
  }

  if (!adminChecked) {
    return <p style={{ color: 'var(--muted)' }}>Проверка доступа…</p>;
  }

  return (
    <>
      <h1 className="pageTitle">Редактор контента</h1>
      <p style={{ color: 'var(--muted)', marginBottom: '1rem', fontSize: '0.9rem' }}>
        Сообщения userbot с типом «анализ» и «контент». Редактируйте вручную или через OpenRouter,
        затем публикуйте в выбранные группы.
      </p>
      {msg && <div className={`msg ${msg.type === 'ok' ? 'ok' : 'err'}`}>{msg.text}</div>}

      <div className="card" style={{ marginBottom: '1rem' }}>
        <h3 style={{ marginBottom: '0.5rem' }}>Группы для публикации контента</h3>
        <p style={{ color: 'var(--muted)', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
          Отметьте группы, куда отправлять посты после нажатия «Опубликовать». Выбор сохраняется в
          базе данных.
        </p>
        {groups.length === 0 ? (
          <p style={{ color: 'var(--muted)' }}>
            Нет publish-групп. Добавьте их на странице «Моя группа».
          </p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {groups.map((g) => (
              <li key={g.id} style={{ marginBottom: '0.35rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input
                    type="checkbox"
                    checked={Boolean(g.contentPublishEnabled)}
                    disabled={busy === `group-${g.id}` || !g.enabled}
                    onChange={(e) => void toggleGroup(g.id, e.target.checked)}
                  />
                  <span>
                    {g.title}{' '}
                    <span style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>
                      ({g.chatId})
                      {!g.enabled ? ' — группа выключена' : ''}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="contentEditorWorkspace">
        <div className="card">
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
            {(['all', 'analysis', 'content'] as const).map((key) => (
              <button
                key={key}
                type="button"
                className={filterClassification === key ? 'btn primary' : 'btn'}
                onClick={() => setFilterClassification(key)}
              >
                {key === 'all' ? 'Все' : CLASSIFICATION_LABEL[key]}
              </button>
            ))}
          </div>
          <div className="contentEditorList">
            {posts.length === 0 ? (
              <p style={{ color: 'var(--muted)' }}>Пока нет постов analysis/content</p>
            ) : (
              posts.map((p) => (
                <div key={p.id} className="contentEditorListItem">
                  <button
                    type="button"
                    className={`contentEditorListSelect${
                      selectedId === p.id ? ' contentEditorListSelectSelected' : ''
                    }`}
                    onClick={() => setSelectedId(p.id)}
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
                      void deletePost(p);
                    }}
                  >
                    ×
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="card">
          {!selectedPost ? (
            <p style={{ color: 'var(--muted)' }}>Выберите сообщение слева</p>
          ) : (
            <>
              <div className="contentEditorPanelMeta">
                {CLASSIFICATION_LABEL[selectedPost.classification]} ·{' '}
                {STATUS_LABEL[selectedPost.status]}
                {selectedPost.publishedAt
                  ? ` · опубликован ${formatDateTimeRu(selectedPost.publishedAt)}`
                  : ''}
                {selectedPost.publicationCount > 0
                  ? ` · публикаций: ${selectedPost.publicationCount}`
                  : ''}
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
                    onChange={(e) => setDraftText(e.target.value)}
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
                onChange={(e) => setAiInstruction(e.target.value)}
                placeholder="Например: сократи до 3 абзацев, добавь эмодзи умеренно"
              />

              <div className="contentEditorActions">
                <button
                  type="button"
                  className="btn"
                  disabled={busy !== null}
                  onClick={() => void saveDraft()}
                >
                  {busy === 'save' ? '…' : 'Сохранить черновик'}
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={busy !== null}
                  onClick={() => void aiRewrite()}
                >
                  {busy === 'ai' ? '…' : 'Переписать через AI'}
                </button>
                <button
                  type="button"
                  className="btn primary"
                  disabled={busy !== null}
                  onClick={() => void publishPost()}
                >
                  {busy === 'publish' ? '…' : 'Опубликовать'}
                </button>
                <span className="contentEditorActionsSpacer" />
                <button
                  type="button"
                  className="btn btnDanger"
                  disabled={busy !== null}
                  onClick={() => void deletePost(selectedPost)}
                >
                  {busy === `delete:${selectedPost.id}` ? '…' : 'Удалить'}
                </button>
              </div>

              <details style={{ marginTop: '1rem' }}>
                <summary style={{ cursor: 'pointer', color: 'var(--muted)' }}>
                  Оригинал из источника
                </summary>
                <pre className="contentEditorOriginal">{selectedPost.originalText}</pre>
              </details>
            </>
          )}
        </div>
      </div>
    </>
  );
}
