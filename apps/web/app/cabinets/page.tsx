'use client';

import { useEffect, useState } from 'react';

import { fetchApiResponse } from '../../lib/api';

type CabinetItem = {
  id: string;
  slug: string;
  name: string;
  isDefault: boolean;
};

export default function CabinetsPage() {
  const [items, setItems] = useState<CabinetItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  async function loadAll() {
    setLoading(true);
    try {
      const res = await fetchApiResponse('/cabinets');
      const json = (await res.json()) as { items?: CabinetItem[] };
      setItems(Array.isArray(json.items) ? json.items : []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
  }, []);

  async function createCabinet() {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setMsg({ type: 'err', text: 'Введите название кабинета' });
      return;
    }
    setBusy('create');
    setMsg(null);
    try {
      const res = await fetchApiResponse('/cabinets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmedName,
          slug: slug.trim() || undefined,
        }),
      });
      const json = (await res.json().catch(() => null)) as { message?: string } | null;
      if (!res.ok) {
        throw new Error(json?.message ?? `${res.status}`);
      }
      setName('');
      setSlug('');
      setMsg({ type: 'ok', text: 'Кабинет создан' });
      await loadAll();
    } catch (e) {
      setMsg({ type: 'err', text: e instanceof Error ? e.message : 'Ошибка создания' });
    } finally {
      setBusy(null);
    }
  }

  async function renameCabinet(item: CabinetItem) {
    const nextName = window.prompt('Новое название кабинета', item.name)?.trim();
    if (!nextName) return;
    setBusy(`rename:${item.id}`);
    setMsg(null);
    try {
      const res = await fetchApiResponse(`/cabinets/${encodeURIComponent(item.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nextName }),
      });
      const json = (await res.json().catch(() => null)) as { message?: string } | null;
      if (!res.ok) throw new Error(json?.message ?? `${res.status}`);
      setMsg({ type: 'ok', text: 'Кабинет обновлён' });
      await loadAll();
    } catch (e) {
      setMsg({ type: 'err', text: e instanceof Error ? e.message : 'Ошибка обновления' });
    } finally {
      setBusy(null);
    }
  }

  async function removeCabinet(item: CabinetItem) {
    if (item.isDefault) return;
    const ok = window.confirm(`Удалить кабинет "${item.name}"?`);
    if (!ok) return;
    setBusy(`delete:${item.id}`);
    setMsg(null);
    try {
      const res = await fetchApiResponse(`/cabinets/${encodeURIComponent(item.id)}`, {
        method: 'DELETE',
      });
      const json = (await res.json().catch(() => null)) as { message?: string } | null;
      if (!res.ok) throw new Error(json?.message ?? `${res.status}`);
      setMsg({ type: 'ok', text: 'Кабинет удалён' });
      await loadAll();
    } catch (e) {
      setMsg({ type: 'err', text: e instanceof Error ? e.message : 'Ошибка удаления' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <h1 className="pageTitle">Управление кабинетами</h1>
      <p style={{ color: 'var(--muted)', marginBottom: '1rem' }}>
        Общие настройки действуют по умолчанию для всех кабинетов. Кабинетные override-настройки
        задаются на странице `Настройки` в режиме `Кабинет`.
      </p>
      {msg && <p className={`msg ${msg.type === 'ok' ? 'ok' : 'err'}`}>{msg.text}</p>}

      <div className="card" style={{ marginBottom: '1rem' }}>
        <h3 style={{ marginBottom: '0.7rem' }}>Создать кабинет</h3>
        <div className="cabinetFormRow">
          <input
            className="settingsAuthInput"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Название"
          />
          <input
            className="settingsAuthInput"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="Slug (необязательно)"
          />
          <button
            type="button"
            className="btn"
            disabled={busy !== null}
            onClick={() => void createCabinet()}
          >
            {busy === 'create' ? 'Создание…' : 'Создать'}
          </button>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginBottom: '0.7rem' }}>Кабинеты</h3>
        {loading ? <p style={{ color: 'var(--muted)' }}>Загрузка…</p> : null}
        {!loading && items.length === 0 ? (
          <p style={{ color: 'var(--muted)' }}>Кабинетов пока нет.</p>
        ) : (
          <div style={{ display: 'grid', gap: '0.6rem' }}>
            {items.map((item) => (
              <div key={item.id} className="card" style={{ margin: 0 }}>
                <div className="cabinetListRow">
                  <div>
                    <div style={{ fontWeight: 700 }}>
                      {item.name} {item.isDefault ? '(default)' : ''}
                    </div>
                    <div style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>
                      id: <code>{item.id}</code>
                    </div>
                    <div style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>
                      slug: <code>{item.slug}</code>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                    <button
                      className="btn btnSecondary"
                      type="button"
                      disabled={busy !== null}
                      onClick={() => void renameCabinet(item)}
                    >
                      Переименовать
                    </button>
                    <button
                      className="btnDanger"
                      type="button"
                      disabled={busy !== null || item.isDefault}
                      onClick={() => void removeCabinet(item)}
                    >
                      Удалить
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

