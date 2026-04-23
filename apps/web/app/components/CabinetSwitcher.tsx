'use client';

import { useEffect, useMemo, useState } from 'react';

import { getApiBase } from '../../lib/api';

type CabinetItem = {
  id: string;
  slug: string;
  name: string;
  isDefault: boolean;
};

const STORAGE_KEY = 'active_cabinet_id';

export function CabinetSwitcher() {
  const [items, setItems] = useState<CabinetItem[]>([]);
  const [selected, setSelected] = useState('');

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`${getApiBase()}/cabinets`, { cache: 'no-store' });
        const json = (await res.json()) as { items?: CabinetItem[] };
        const list = Array.isArray(json.items) ? json.items : [];
        setItems(list);
      } catch {
        setItems([]);
      }
    })();
  }, []);

  useEffect(() => {
    const fromStorage = localStorage.getItem(STORAGE_KEY)?.trim() ?? '';
    const fromCookie = document.cookie
      .split(';')
      .map((p) => p.trim())
      .find((p) => p.startsWith('cabinet_id='))
      ?.split('=')[1];
    const initial = fromStorage || (fromCookie ? decodeURIComponent(fromCookie) : '');
    if (initial) {
      setSelected(initial);
    }
  }, []);

  useEffect(() => {
    if (!selected) return;
    localStorage.setItem(STORAGE_KEY, selected);
    document.cookie = `cabinet_id=${encodeURIComponent(selected)}; path=/; max-age=31536000; SameSite=Lax`;
  }, [selected]);

  const effectiveSelected = useMemo(() => {
    if (!items.length) return selected;
    if (items.some((x) => x.id === selected)) return selected;
    const fallback = items.find((x) => x.isDefault)?.id ?? items[0]?.id ?? '';
    if (fallback && fallback !== selected) {
      setSelected(fallback);
    }
    return fallback;
  }, [items, selected]);

  if (items.length === 0) {
    return null;
  }

  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{ color: 'var(--muted)', fontSize: 12 }}>Кабинет:</span>
      <select
        value={effectiveSelected}
        onChange={(e) => {
          const next = e.target.value;
          setSelected(next);
          const url = new URL(window.location.href);
          url.searchParams.set('cabinetId', next);
          window.location.href = url.toString();
        }}
        style={{ minWidth: 140 }}
      >
        {items.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </select>
    </label>
  );
}

