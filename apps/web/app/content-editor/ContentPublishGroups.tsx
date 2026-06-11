'use client';

import type { PublishGroupItem } from './content-editor-page.types';

type Props = {
  groups: PublishGroupItem[];
  busy: string | null;
  onToggle: (groupId: string, checked: boolean) => void;
};

export function ContentPublishGroups({ groups, busy, onToggle }: Props) {
  return (
    <div className="card" style={{ marginBottom: '1rem' }}>
      <h3 style={{ marginBottom: '0.5rem' }}>Группы для публикации контента</h3>
      <p style={{ color: 'var(--muted)', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
        Отметьте группы, куда отправлять посты после нажатия «Опубликовать». Выбор сохраняется в базе
        данных.
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
                  onChange={(e) => onToggle(g.id, e.target.checked)}
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
  );
}
