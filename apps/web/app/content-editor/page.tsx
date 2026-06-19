'use client';

import { PageTitle } from '../components/PageTitle';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { withAppBasePath } from '../../lib/base-path';
import { readActiveCabinetIdClient } from '../../lib/cabinet-client.util';
import { ContentEditorFilters } from './ContentEditorFilters';
import { ContentEditorList } from './ContentEditorList';
import { ContentEditorPanel } from './ContentEditorPanel';
import { ContentEditorPresets } from './ContentEditorPresets';
import { ContentPublishGroups } from './ContentPublishGroups';
import type {
  CollectSettingsState,
  ContentEditorFiltersState,
  ContentGenerationPresetItem,
  ContentGenerationRunItem,
  ContentPostItem,
  PublishGroupItem,
} from './content-editor-page.types';
import { buildPostsQuery, contentEditorApiFetch } from './content-editor-page.util';

const EMPTY_FILTERS: ContentEditorFiltersState = {
  classification: 'all',
  status: '',
  sourceChatId: '',
  q: '',
  from: '',
  to: '',
};

const EMPTY_PRESET_DRAFT = (): Partial<ContentGenerationPresetItem> & { name: string } => ({
  name: '',
  enabled: true,
  sourceKinds: ['analysis'],
  sourceGroupIds: [],
  aiInstruction: '',
  outputStyle: null,
  dailyLimit: 1,
  scheduleCron: null,
  autoPublish: false,
  targetGroupIds: [],
});

export default function ContentEditorPage() {
  const router = useRouter();
  const [accessChecked, setAccessChecked] = useState(false);
  const [canAccess, setCanAccess] = useState(false);
  const [posts, setPosts] = useState<ContentPostItem[]>([]);
  const [groups, setGroups] = useState<PublishGroupItem[]>([]);
  const [presets, setPresets] = useState<ContentGenerationPresetItem[]>([]);
  const [runs, setRuns] = useState<ContentGenerationRunItem[]>([]);
  const [collectSettings, setCollectSettings] = useState<CollectSettingsState>({
    kinds: ['analysis', 'content', 'news', 'other'],
  });
  const [filters, setFilters] = useState<ContentEditorFiltersState>(EMPTY_FILTERS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [draftText, setDraftText] = useState('');
  const [aiInstruction, setAiInstruction] = useState('');
  const [activePresetId, setActivePresetId] = useState<string | null>(null);
  const [presetDraft, setPresetDraft] = useState(EMPTY_PRESET_DRAFT());
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const selectedPost = useMemo(
    () => posts.find((p) => p.id === selectedId) ?? null,
    [posts, selectedId],
  );

  const sourceChatOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of posts) {
      if (!map.has(p.sourceChatId)) {
        map.set(p.sourceChatId, p.sourceTitle ?? p.sourceChatId);
      }
    }
    for (const g of groups) {
      if (!map.has(g.chatId)) map.set(g.chatId, g.title);
    }
    return [...map.entries()].map(([chatId, title]) => ({ chatId, title }));
  }, [posts, groups]);

  async function loadPosts() {
    const qs = buildPostsQuery(filters);
    const res = await contentEditorApiFetch(`/telegram-userbot/content/posts${qs}`);
    const j = (await res.json()) as { items?: ContentPostItem[] };
    setPosts(Array.isArray(j.items) ? j.items : []);
  }

  async function loadGroups() {
    const res = await contentEditorApiFetch('/telegram-userbot/publish-groups');
    const j = (await res.json()) as { items?: PublishGroupItem[] };
    setGroups(Array.isArray(j.items) ? j.items : []);
  }

  async function loadCollectSettings() {
    const res = await contentEditorApiFetch('/telegram-userbot/content/collect-settings');
    const j = (await res.json()) as CollectSettingsState;
    if (Array.isArray(j.kinds)) setCollectSettings({ kinds: j.kinds });
  }

  async function loadPresets() {
    const res = await contentEditorApiFetch('/telegram-userbot/content/presets');
    const j = (await res.json()) as { items?: ContentGenerationPresetItem[] };
    setPresets(Array.isArray(j.items) ? j.items : []);
  }

  async function loadRuns(presetId: string | null) {
    if (!presetId) {
      setRuns([]);
      return;
    }
    const res = await contentEditorApiFetch(
      `/telegram-userbot/content/presets/${presetId}/runs?limit=10`,
    );
    const j = (await res.json()) as { items?: ContentGenerationRunItem[] };
    setRuns(Array.isArray(j.items) ? j.items : []);
  }

  const loadAll = useCallback(async () => {
    await Promise.all([loadPosts(), loadGroups(), loadCollectSettings(), loadPresets()]);
  }, [filters]);

  useEffect(() => {
    void (async () => {
      try {
        const [authRes] = await Promise.all([
          fetch(withAppBasePath('/api/auth'), { cache: 'no-store' }),
        ]);
        const auth = (await authRes.json().catch(() => null)) as
          | { authenticated?: boolean; role?: string }
          | null;
        if (!auth?.authenticated) {
          router.replace('/');
          return;
        }
        const isAdmin = String(auth.role ?? '').trim().toLowerCase() === 'admin';
        if (isAdmin) {
          setCanAccess(true);
          return;
        }
        const cabinetId = readActiveCabinetIdClient();
        const res = await contentEditorApiFetch('/cabinets');
        let purpose = 'trading';
        if (res.ok) {
          const j = (await res.json()) as { items?: Array<{ id: string; purpose?: string }> };
          const items = Array.isArray(j.items) ? j.items : [];
          const active =
            (cabinetId ? items.find((c) => c.id === cabinetId) : null) ?? items[0] ?? null;
          purpose = String(active?.purpose ?? 'trading').toLowerCase();
        }
        if (purpose === 'content') {
          setCanAccess(true);
        } else {
          router.replace('/');
        }
      } catch {
        router.replace('/');
      } finally {
        setAccessChecked(true);
      }
    })();
  }, [router]);

  useEffect(() => {
    if (!accessChecked || !canAccess) return;
    void loadAll().catch(() => setMsg({ type: 'err', text: 'Не удалось загрузить данные' }));
  }, [accessChecked, canAccess, loadAll]);

  useEffect(() => {
    void loadRuns(activePresetId);
  }, [activePresetId]);

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
      if (j.ok === false || !j.item) throw new Error(j.error ?? 'Не удалось сохранить');
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
      if (j.ok === false || !j.item) throw new Error(j.error ?? 'AI не переписал текст');
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
      if (j.ok === false || !j.item) throw new Error(j.error ?? 'Публикация не удалась');
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
      if (j.ok !== true) throw new Error(j.error ?? 'Не удалось удалить');
      setPosts((prev) => prev.filter((p) => p.id !== post.id));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(post.id);
        return next;
      });
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

  async function saveCollectSettings() {
    await runBusy('collect-settings', async () => {
      const res = await contentEditorApiFetch('/telegram-userbot/content/collect-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kinds: collectSettings.kinds }),
      });
      const j = (await res.json()) as { ok?: boolean; kinds?: string[]; error?: string };
      if (j.ok !== true) throw new Error(j.error ?? 'Не удалось сохранить');
      if (Array.isArray(j.kinds)) setCollectSettings({ kinds: j.kinds });
      setMsg({ type: 'ok', text: 'Настройки сбора сохранены' });
    });
  }

  function selectPreset(id: string) {
    setActivePresetId(id);
    const p = presets.find((x) => x.id === id);
    if (p) {
      setPresetDraft({
        name: p.name,
        enabled: p.enabled,
        sourceKinds: p.sourceKinds,
        sourceGroupIds: p.sourceGroupIds,
        aiInstruction: p.aiInstruction,
        outputStyle: p.outputStyle,
        dailyLimit: p.dailyLimit,
        scheduleCron: p.scheduleCron,
        autoPublish: p.autoPublish,
        targetGroupIds: p.targetGroupIds,
      });
    }
  }

  async function savePreset() {
    await runBusy('preset-save', async () => {
      const body = {
        name: presetDraft.name.trim(),
        enabled: presetDraft.enabled !== false,
        sourceKinds: presetDraft.sourceKinds ?? ['analysis'],
        sourceGroupIds: presetDraft.sourceGroupIds ?? [],
        aiInstruction: presetDraft.aiInstruction ?? '',
        outputStyle: presetDraft.outputStyle ?? null,
        dailyLimit: presetDraft.dailyLimit ?? 1,
        scheduleCron: presetDraft.scheduleCron ?? null,
        autoPublish: presetDraft.autoPublish === true,
        targetGroupIds: presetDraft.targetGroupIds ?? [],
      };
      if (!body.name) throw new Error('Укажите название пресета');
      const path = activePresetId
        ? `/telegram-userbot/content/presets/${activePresetId}`
        : '/telegram-userbot/content/presets';
      const res = await contentEditorApiFetch(path, {
        method: activePresetId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = (await res.json()) as {
        ok?: boolean;
        error?: string;
        item?: ContentGenerationPresetItem;
      };
      if (j.ok === false || !j.item) throw new Error(j.error ?? 'Не удалось сохранить пресет');
      await loadPresets();
      setActivePresetId(j.item.id);
      setMsg({ type: 'ok', text: activePresetId ? 'Пресет обновлён' : 'Пресет создан' });
    });
  }

  async function deletePreset(id: string) {
    if (!window.confirm('Удалить пресет?')) return;
    await runBusy(`preset-del:${id}`, async () => {
      const res = await contentEditorApiFetch(`/telegram-userbot/content/presets/${id}`, {
        method: 'DELETE',
      });
      const j = (await res.json()) as { ok?: boolean; error?: string };
      if (j.ok !== true) throw new Error(j.error ?? 'Не удалось удалить');
      if (activePresetId === id) {
        setActivePresetId(null);
        setPresetDraft(EMPTY_PRESET_DRAFT());
      }
      await loadPresets();
      setMsg({ type: 'ok', text: 'Пресет удалён' });
    });
  }

  async function runPreset(id: string) {
    await runBusy(`preset-run:${id}`, async () => {
      const postIds = [...selectedIds];
      const res = await contentEditorApiFetch(`/telegram-userbot/content/presets/${id}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postIds: postIds.length > 0 ? postIds : undefined, force: true }),
      });
      const j = (await res.json()) as {
        ok?: boolean;
        error?: string;
        postId?: string;
        published?: boolean;
      };
      if (j.ok === false) throw new Error(j.error ?? 'Запуск не удался');
      await Promise.all([loadPosts(), loadRuns(id)]);
      setMsg({
        type: 'ok',
        text: j.published ? 'Сгенерировано и опубликовано' : 'Создан черновик из пресета',
      });
    });
  }

  async function generateSelected() {
    const postIds = [...selectedIds];
    if (postIds.length === 0) return;
    await runBusy('generate-selected', async () => {
      const res = await contentEditorApiFetch('/telegram-userbot/content/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          postIds,
          instruction: aiInstruction.trim() || undefined,
        }),
      });
      const j = (await res.json()) as {
        ok?: boolean;
        error?: string;
        item?: ContentPostItem;
        postId?: string;
      };
      if (j.ok === false) throw new Error(j.error ?? 'Генерация не удалась');
      await loadPosts();
      if (j.item?.id ?? j.postId) setSelectedId(j.item?.id ?? j.postId ?? null);
      setMsg({ type: 'ok', text: 'Новый черновик создан из выбранных постов' });
    });
  }

  function toggleSelectPost(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (!accessChecked) {
    return <p style={{ color: 'var(--muted)' }}>Проверка доступа…</p>;
  }

  if (!canAccess) {
    return null;
  }

  return (
    <>
      <PageTitle titleKey="pages.contentEditor" />
      <p style={{ color: 'var(--muted)', marginBottom: '1rem', fontSize: '0.9rem' }}>
        Сбор analysis, content, news и other из userbot. Редактируйте вручную или через AI-пресеты,
        затем публикуйте в выбранные группы.
      </p>
      {msg && <div className={`msg ${msg.type === 'ok' ? 'ok' : 'err'}`}>{msg.text}</div>}

      <ContentPublishGroups groups={groups} busy={busy} onToggle={(id, checked) => void toggleGroup(id, checked)} />

      <ContentEditorPresets
        presets={presets}
        runs={runs}
        groups={groups}
        selectedPostCount={selectedIds.size}
        busy={busy}
        draftPreset={presetDraft}
        activePresetId={activePresetId}
        onDraftChange={setPresetDraft}
        onSavePreset={() => void savePreset()}
        onDeletePreset={(id) => void deletePreset(id)}
        onRunPreset={(id) => void runPreset(id)}
        onGenerateSelected={() => void generateSelected()}
        onSelectPreset={selectPreset}
      />

      <ContentEditorFilters
        filters={filters}
        collectSettings={collectSettings}
        sourceChatOptions={sourceChatOptions}
        resultCount={posts.length}
        busy={busy}
        onFiltersChange={setFilters}
        onCollectKindsChange={(kinds) => setCollectSettings({ kinds })}
        onSaveCollectSettings={() => void saveCollectSettings()}
      />

      <div className="contentEditorWorkspace">
        <div className="card">
          <ContentEditorList
            posts={posts}
            selectedId={selectedId}
            selectedIds={selectedIds}
            busy={busy}
            onSelect={setSelectedId}
            onToggleSelect={toggleSelectPost}
            onDelete={(p) => void deletePost(p)}
          />
        </div>

        <div className="card">
          <ContentEditorPanel
            post={selectedPost}
            draftText={draftText}
            aiInstruction={aiInstruction}
            busy={busy}
            onDraftChange={setDraftText}
            onAiInstructionChange={setAiInstruction}
            onSave={() => void saveDraft()}
            onAiRewrite={() => void aiRewrite()}
            onPublish={() => void publishPost()}
            onDelete={() => selectedPost && void deletePost(selectedPost)}
          />
        </div>
      </div>
    </>
  );
}
