/**
 * Formatting. British spelling, dates as 11 Apr 2031, currency as PKR 71,850
 * with thousands separators and no decimals, relative times up to 7 days and
 * absolute after — with the exact timestamp always available on hover.
 */

/**
 * Months are spelled out here rather than left to Intl, which renders
 * September as "Sept" in en-GB — four letters where every other month gets
 * three. The plan specifies `11 Apr 2031`, and a column of dates that changes
 * width for one month of the year looks like a defect.
 */
const MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

const DATE_LONG = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

function shortDate(d: Date): string {
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}

const DATE_TIME = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/** 11 Apr 2031 */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return shortDate(d);
}

/** 11 April 2031 — for timeline sentences, where the short form reads clipped. */
export function formatDateLong(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return DATE_LONG.format(d);
}

/** The precise value, for a title attribute. */
export function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return DATE_TIME.format(d);
}

/**
 * Relative up to seven days, absolute after. Past tense only — every
 * timestamp in this app describes something that already happened.
 */
export function formatRelative(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';

  const seconds = Math.floor((now.getTime() - d.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days <= 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  return shortDate(d);
}

/** Whole days between then and now. Negative when the date is in the future. */
export function daysSince(iso: string | null | undefined, now = new Date()): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((now.getTime() - d.getTime()) / 86_400_000);
}

/** Days until a date. Negative once it has passed. */
export function daysUntil(iso: string | null | undefined, now = new Date()): number | null {
  const since = daysSince(iso, now);
  return since === null ? null : -since;
}

/** PKR 71,850 — thousands separators, never decimals. */
export function formatPkr(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return '—';
  return `PKR ${Math.round(amount).toLocaleString('en-PK')}`;
}

/** 1,204 */
export function formatCount(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return n.toLocaleString('en-PK');
}

/** 70% — whole numbers; a decimal place implies a precision we do not have. */
export function formatPercent(fraction: number | null | undefined): string {
  if (fraction === null || fraction === undefined || Number.isNaN(fraction)) return '—';
  return `${Math.round(fraction * 100)}%`;
}

/**
 * 61101-*****-8 — first block, last digit.
 *
 * A CNIC is the primary identifier of a Pakistani citizen. It is masked
 * wherever it is displayed, and it never enters a URL, a query string or a
 * client-side log.
 */
export function maskCnic(cnic: string | null | undefined): string {
  if (!cnic) return '—';
  const digits = cnic.replace(/\D/g, '');
  if (digits.length !== 13) return '—';
  return `${digits.slice(0, 5)}-*****-${digits.slice(12)}`;
}

/** Shorten an identifier for display: first 8 and last 4, full value on copy. */
export function shortenId(id: string | null | undefined): string {
  if (!id) return '—';
  if (id.length <= 14) return id;
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}
