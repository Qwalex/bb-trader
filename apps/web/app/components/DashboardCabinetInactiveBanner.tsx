import Link from 'next/link';

type DashboardCabinetInactiveBannerProps = {
  /** compact — в карточке кабинета; default — в блоке текущего кабинета */
  variant?: 'compact' | 'default';
};

export function DashboardCabinetInactiveBanner({
  variant = 'default',
}: DashboardCabinetInactiveBannerProps) {
  const compact = variant === 'compact';

  return (
    <div
      className={`dashboardCabinetInactiveBanner${
        compact ? ' dashboardCabinetInactiveBannerCompact' : ''
      }`}
      role="status"
    >
      <div className="dashboardCabinetInactiveBannerTitle">
        {compact ? 'Деактивирован' : 'Кабинет деактивирован'}
      </div>
      <p className="dashboardCabinetInactiveBannerText">
        Userbot и опрос Bybit для этого кабинета остановлены. История и настройки доступны для
        просмотра.
      </p>
      {compact ? (
        <span className="dashboardCabinetInactiveBannerHint">Включить — в разделе «Кабинеты»</span>
      ) : (
        <Link href="/cabinets" className="dashboardCabinetInactiveBannerLink">
          Управление активностью →
        </Link>
      )}
    </div>
  );
}
