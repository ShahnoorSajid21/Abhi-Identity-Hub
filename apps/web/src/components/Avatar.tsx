/**
 * Initials avatar.
 *
 * Generated from a seed, never a photograph — not a real one and not a
 * synthesised one. A generated face in a bank's customer directory is a
 * liability nobody asked for.
 */

const TINTS = [
  { bg: 'var(--abhi-mint-100)', fg: 'var(--ok-fg)' },
  { bg: 'var(--new-bg)', fg: 'var(--new-fg)' },
  { bg: 'var(--slate-100)', fg: 'var(--slate-700)' },
  { bg: 'var(--warn-bg)', fg: 'var(--warn-fg)' },
];

function initialsFrom(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ''}${parts[parts.length - 1]![0] ?? ''}`.toUpperCase();
}

function tintFor(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return TINTS[hash % TINTS.length]!;
}

export function Avatar({
  name,
  seed,
  size = 32,
  initials,
}: {
  name: string;
  seed?: string;
  size?: number;
  initials?: string;
}) {
  const text = initials ?? initialsFrom(name);
  const tint = tintFor(seed ?? name);

  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 items-center justify-center rounded-pill font-semibold"
      style={{
        width: size,
        height: size,
        background: tint.bg,
        color: tint.fg,
        fontSize: Math.max(12, Math.round(size * 0.375)),
      }}
    >
      {text}
    </span>
  );
}
