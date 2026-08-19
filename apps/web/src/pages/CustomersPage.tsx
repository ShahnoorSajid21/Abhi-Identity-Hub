import { useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Link } from 'react-router-dom';
import { UserPlus } from 'lucide-react';
import { directory, type CustomerRow } from '../lib/api.ts';
import { useApi } from '../lib/useApi.ts';
import { daysUntil, formatDate, formatRelative, formatTimestamp } from '../lib/format.ts';
import {
  ACTIONS,
  COLUMNS,
  EMPTY,
  FILTERS,
  LEVELS,
  PAGE_TITLES,
  RECORD_STATUS_SHORT,
} from '../copy/strings.ts';
import { DataTable, type Column } from '../components/DataTable.tsx';
import { ErrorState } from '../components/ErrorState.tsx';
import { IdentityStatus } from '../components/IdentityStatus.tsx';
import { StatusChip } from '../components/StatusChip.tsx';
import { Avatar } from '../components/Avatar.tsx';

/**
 * The customer directory.
 *
 * Filters live in the URL query string, so a filtered view can be sent to
 * somebody, survives a reload, and can be typed directly during a demo —
 * `?level=A0` is the entire problem statement in one address.
 */

const LEVEL_OPTIONS = ['A0', 'A1', 'A2', 'A3'] as const;
const STATUS_OPTIONS = ['ACTIVE', 'SUSPENDED', 'SUPERSEDED', 'SHREDDED'] as const;

/** CNIC expiry is the one date on this screen that changes what can happen. */
function ExpiryCell({ iso }: { iso: string }) {
  const days = daysUntil(iso);
  const expired = days !== null && days < 0;
  const soon = days !== null && days >= 0 && days <= 90;

  return (
    <span
      title={formatTimestamp(iso)}
      className={expired ? 'text-stop-fg' : soon ? 'text-warn-fg' : 'text-ink-700'}
    >
      {formatDate(iso)}
      {expired && ' · expired'}
      {soon && ` · ${days} days`}
    </span>
  );
}

export function CustomersPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();

  const q = params.get('q') ?? '';
  const level = params.get('level') ?? '';
  const status = params.get('status') ?? '';
  const employer = params.get('employer') ?? '';
  const expiringSoon = params.get('expiringSoon') === 'true';

  const filtered = q !== '' || level !== '' || status !== '' || employer !== '' || expiringSoon;

  const { data, error, loading, reload } = useApi(
    (signal) =>
      directory.customers(
        { q, level, status, employer, expiringSoon, pageSize: 1500 },
        signal,
      ),
    [q, level, status, employer, expiringSoon],
  );

  const setFilter = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(params);
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  const clearAll = useCallback(() => setParams(new URLSearchParams(), { replace: true }), [setParams]);

  const columns: Column<CustomerRow>[] = useMemo(
    () => [
      {
        key: 'customer',
        header: COLUMNS.customer,
        value: (r) => r.displayName,
        width: '28%',
        render: (r) => (
          <span className="flex items-center gap-3">
            <Avatar name={r.displayName} seed={r.avatarSeed} size={28} />
            <span className="min-w-0">
              <span className="block truncate font-medium text-ink-900">{r.displayName}</span>
              <span className="block truncate text-caption text-ink-500">
                {r.cnicMasked ?? r.employeeCode}
              </span>
            </span>
          </span>
        ),
      },
      {
        key: 'employer',
        header: COLUMNS.employer,
        value: (r) => r.employer,
        render: (r) => (
          <span className="min-w-0">
            <span className="block truncate">{r.employer}</span>
            <span className="block truncate text-caption text-ink-500">{r.designation}</span>
          </span>
        ),
      },
      {
        key: 'identity',
        header: COLUMNS.identityStatus,
        value: (r) => r.assuranceLevel,
        render: (r) => <IdentityStatus level={r.assuranceLevel} size="sm" />,
      },
      {
        key: 'verified',
        header: COLUMNS.lastVerified,
        value: (r) => r.verifiedAt,
        render: (r) => <span title={formatTimestamp(r.verifiedAt)}>{formatRelative(r.verifiedAt)}</span>,
      },
      {
        key: 'expiry',
        header: COLUMNS.cnicExpiry,
        value: (r) => r.cnicExpiryAt,
        render: (r) => <ExpiryCell iso={r.cnicExpiryAt} />,
      },
      {
        key: 'status',
        header: COLUMNS.recordStatus,
        value: (r) => RECORD_STATUS_SHORT[r.status] ?? r.status,
        render: (r) => <StatusChip status={r.status} short />,
      },
    ],
    [],
  );

  if (error !== null) {
    return (
      <>
        <h1 className="text-title font-semibold text-white">{PAGE_TITLES.customers}</h1>
        <div className="mt-6">
          <ErrorState error={error} onRetry={reload} />
        </div>
      </>
    );
  }

  const rows = data?.rows ?? [];
  const employers = data?.employers ?? [];

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-title font-semibold text-white">{PAGE_TITLES.customers}</h1>
          <p className="mt-1 text-cell text-white/70">
            {loading ? 'Loading…' : `${(data?.total ?? 0).toLocaleString('en-PK')} customers`}
          </p>
        </div>
        <Link
          to="/customers/new"
          className="inline-flex items-center gap-2 rounded-control bg-navy-700 px-4 py-2 text-cell font-medium text-white transition-colors duration-fast hover:bg-navy-600"
        >
          <UserPlus size={16} />
          {ACTIONS.newCustomer}
        </Link>
      </div>

      <div className="card mt-6 flex flex-wrap items-end gap-3 p-4">
        <label className="flex min-w-[220px] flex-1 flex-col gap-1">
          <span className="label-caption">{FILTERS.search}</span>
          <input
            type="search"
            value={q}
            onChange={(e) => setFilter('q', e.target.value)}
            placeholder="Name, employee code or employer"
            className="rounded-control border border-ink-200 px-3 py-1.5 text-cell text-ink-900 placeholder:text-ink-500 focus:border-mint-600 focus:outline-none"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="label-caption">{FILTERS.identityLevel}</span>
          <select
            value={level}
            onChange={(e) => setFilter('level', e.target.value)}
            className="rounded-control border border-ink-200 bg-white px-3 py-1.5 text-cell text-ink-900"
          >
            <option value="">Any</option>
            {LEVEL_OPTIONS.map((l) => (
              <option key={l} value={l}>
                {LEVELS[l].label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="label-caption">{FILTERS.recordStatus}</span>
          <select
            value={status}
            onChange={(e) => setFilter('status', e.target.value)}
            className="rounded-control border border-ink-200 bg-white px-3 py-1.5 text-cell text-ink-900"
          >
            <option value="">Any</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {RECORD_STATUS_SHORT[s]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="label-caption">{FILTERS.employer}</span>
          <select
            value={employer}
            onChange={(e) => setFilter('employer', e.target.value)}
            className="rounded-control border border-ink-200 bg-white px-3 py-1.5 text-cell text-ink-900"
          >
            <option value="">Any</option>
            {employers.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2 py-1.5 text-cell text-ink-700">
          <input
            type="checkbox"
            checked={expiringSoon}
            onChange={(e) => setFilter('expiringSoon', e.target.checked ? 'true' : null)}
            className="h-4 w-4 rounded border-ink-300 text-mint-600 focus:ring-mint-600"
          />
          {FILTERS.expiringSoon}
        </label>

        {filtered && (
          <button
            type="button"
            onClick={clearAll}
            className="rounded-control border border-ink-200 px-3 py-1.5 text-cell font-medium text-ink-700 transition-colors duration-fast hover:bg-ink-100"
          >
            {FILTERS.clearAll}
          </button>
        )}
      </div>

      <div className="mt-4">
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(r) => r.subjectId}
          loading={loading}
          // "Nothing exists yet" and "your filters excluded everything" are
          // different states needing different wording and different actions.
          empty={filtered ? EMPTY.customersNoMatch! : EMPTY.customersNone!}
          onEmptyAction={filtered ? clearAll : undefined}
          onRowClick={(r) => navigate(`/customers/${r.subjectId}`)}
          exportName="abhi-customers"
          caption={
            data === null
              ? undefined
              : `Showing ${rows.length.toLocaleString('en-PK')} of ${data.total.toLocaleString('en-PK')}`
          }
        />
      </div>
    </>
  );
}
