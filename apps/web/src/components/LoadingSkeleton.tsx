/**
 * Shimmer placeholders.
 *
 * Never a spinner on a full page. A page that blanks looks broken on a
 * projector, and "broken" is the one impression this build cannot afford.
 * A skeleton keeps the layout standing while the data arrives.
 */

export function SkeletonBar({ width = '100%', height = 12 }: { width?: string; height?: number }) {
  return (
    <span
      aria-hidden="true"
      className="block animate-pulse rounded bg-ink-100"
      style={{ width, height }}
    />
  );
}

export function SkeletonRows({ rows = 8, columns = 5 }: { rows?: number; columns?: number }) {
  const widths = ['32%', '20%', '18%', '14%', '16%', '12%'];

  return (
    <div role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex h-11 items-center gap-4 border-b border-ink-100 px-4">
          {Array.from({ length: columns }, (_, c) => (
            <SkeletonBar key={c} width={widths[c % widths.length]} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div role="status" aria-label="Loading" className="card p-6">
      <SkeletonBar width="40%" height={16} />
      <div className="mt-4 space-y-3">
        {Array.from({ length: lines }, (_, i) => (
          <SkeletonBar key={i} width={i === lines - 1 ? '60%' : '100%'} />
        ))}
      </div>
    </div>
  );
}
