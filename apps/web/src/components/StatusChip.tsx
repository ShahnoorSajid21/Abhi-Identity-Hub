import { RECORD_STATUS, RECORD_STATUS_SHORT } from '../copy/strings.ts';

/**
 * Record status, as a pill.
 *
 * The ledger's four statuses are ACTIVE, SUSPENDED, SUPERSEDED and SHREDDED.
 * None of those words appears here: a customer is Active, Frozen, Replaced by
 * a newer version, or Erased.
 *
 * Note the colour choice for SUSPENDED. Stop-red is reserved for the decision
 * set, and a frozen customer genuinely is a stop — so it earns the colour
 * rather than borrowing it.
 */
const TONE: Record<string, string> = {
  ACTIVE: 'bg-ok-bg text-ok-fg',
  SUSPENDED: 'bg-stop-bg text-stop-fg',
  SUPERSEDED: 'bg-ink-100 text-ink-700',
  SHREDDED: 'bg-ink-100 text-ink-700',
};

export function StatusChip({ status, short = false }: { status: string; short?: boolean }) {
  const label = short
    ? (RECORD_STATUS_SHORT[status] ?? status)
    : (RECORD_STATUS[status] ?? status);

  return (
    <span
      className={`inline-flex items-center rounded-pill px-2.5 py-0.5 text-caption font-medium ${TONE[status] ?? 'bg-ink-100 text-ink-700'}`}
      title={RECORD_STATUS[status] ?? status}
    >
      {label}
    </span>
  );
}
