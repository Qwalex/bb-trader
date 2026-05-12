'use client';

import { useEffect, useMemo, useState } from 'react';

import { ACTIVE_CABINET_STORAGE_KEY } from '../../lib/api.constants';
import { readActiveCabinetIdClient } from '../../lib/cabinet-client.util';
import { fetchApiResponse } from '../../lib/api';

type CabinetItem = {
  id: string;
  slug: string;
  name: string;
  isDefault: boolean;
};

type CabinetSwitcherProps = {
  compact?: boolean;
  /** См. TopNav: меняется при смене query, чтобы выровнять селект с `?cabinetId=` */
  cabinetSyncKey?: string;
};

export function CabinetSwitcher({
  compact = false,
  cabinetSyncKey = '',
}: CabinetSwitcherProps) {
  const [items, setItems] = useState<CabinetItem[]>([]);
  const [selected, setSelected] = useState('');

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetchApiResponse('/cabinets');
        const json = (await res.json()) as { items?: CabinetItem[] };
        const list = Array.isArray(json.items) ? json.items : [];
        setItems(list);
      } catch {
        setItems([]);
      }
    })();
  }, []);

  useEffect(() => {
    const preferred = readActiveCabinetIdClient();
    if (!preferred) return;
    setSelected((prev) => (prev === preferred ? prev : preferred));
  }, [items, cabinetSyncKey]);

  useEffect(() => {
    if (!selected) return;
    try {
      window.localStorage.setItem(ACTIVE_CABINET_STORAGE_KEY, selected);
    } catch {
      // ignore
    }
    document.cookie = `cabinet_id=${encodeURIComponent(selected)}; path=/; max-age=31536000; SameSite=Lax`;
  }, [selected]);

  const effectiveSelected = useMemo(() => {
    if (!items.length) return selected;
    if (items.some((x) => x.id === selected)) return selected;
    return items.find((x) => x.isDefault)?.id ?? items[0]?.id ?? '';
  }, [items, selected]);

  useEffect(() => {
    if (!effectiveSelected) return;
    if (effectiveSelected === selected) return;
    setSelected(effectiveSelected);
  }, [effectiveSelected, selected]);

  if (items.length === 0) {
    return null;
  }

  return (
    <label className={`cabinetSwitcher ${compact ? 'compact' : ''}`}>
      <span className="cabinetSwitcherLabel">Кабинет:</span>
      <select
        className="cabinetSwitcherSelect"
        value={effectiveSelected}
        onChange={(e) => {
          const next = e.target.value;
          setSelected(next);
          try {
            window.localStorage.setItem(ACTIVE_CABINET_STORAGE_KEY, next);
          } catch {
            // ignore
          }
          document.cookie = `cabinet_id=${encodeURIComponent(next)}; path=/; max-age=31536000; SameSite=Lax`;
          const url = new URL(window.location.href);
          url.searchParams.set('cabinetId', next);
          window.location.assign(url.toString());
        }}
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
