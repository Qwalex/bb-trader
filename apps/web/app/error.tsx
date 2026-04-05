'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="card" style={{ margin: '2rem auto', maxWidth: 480, textAlign: 'center' }}>
      <h2>Произошла ошибка</h2>
      <p style={{ color: 'var(--muted)' }}>{error.message || 'Неизвестная ошибка'}</p>
      <button className="btn" onClick={reset} style={{ marginTop: '1rem' }}>
        Попробовать снова
      </button>
    </div>
  );
}
