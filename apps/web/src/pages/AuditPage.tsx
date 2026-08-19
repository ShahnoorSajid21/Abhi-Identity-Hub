import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ScrollText } from 'lucide-react';
import { directory, type ActivityRow } from '../lib/api.ts';
import { useApi } from '../lib/useApi.ts';
import { formatRelative, formatTimestamp } from '../lib/format.ts';
import { COLUMNS, EMPTY, FILTERS, NOTES, PAGE_TITLES, PRODUCTS } from '../copy/strings.ts';
import { DataTable, type Column } from '../components/DataTable.tsx';
import { ErrorState } from '../components/ErrorState.tsx';
import { Avatar } from '../components/Avatar.tsx';

/**
 * The audit trail.
 *
 * Frame this screen as what an SBP inspector would be given — and say so on
 * the page, because that framing is what makes the screen land.
 *
 * One honesty note, which the callout carries: this list is an index kept for
 * the screens. The authoritative record is the ledger's own per-subject audit
 * trail, which is what an inspection would actually be run against. Every row
 * here corresponds to one of those entries.
 */

const ACTION_LABEL: Record<string, string> = {
  IDENTITY_CONFIRMED: 'Identity confirmed',
  IDENTITY_UPDATED: 'Identity updated',
  VERIFICATION: 'Verification requested',
  FROZEN: 'Frozen by Compliance',
  REINSTATED: 'Reinstated by Compliance',
  ERASED: 'Personal details erased',
  CONSENT_GRANTED: 'Consent given',
  CONSENT_REVOKED: 'Consent withdrawn',
};

const ORG_LABEL: Record<string, string> = {
  ABHIComplianceMSP: 'ABHI Compliance',
  ABHILendingMSP: 'ABHI Lending',
  ABHIBankMSP: 'ABHI Bank',
};

const DECISION_LABEL: Record<string, string> = {
  ALLOW: 'Ready to proceed',
  STEP_UP: 'One more check needed',
  FULL_KYC: 'Full onboarding needed',
  DENY: 'Refused',
};

const ACTION_OPTIONS = Object.keys(ACTION_LABEL);

export function AuditPage() {
  const [params, setParams] = useSearchParams();
  const action = params.get('action') ?? '';
  const subjectId = params.get('subjectId') ?? '';
  const filtered = action !== '' || subjectId !== '';

  const { data, error, loading, reload } = useApi(
    (signal) => directory.audit({ action, subjectId, pageSize: 500 }, signal),
    [action, subjectId],
  );

  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value === '') next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  }

  const columns: Column<ActivityRow>[] = useMemo(
    () => [
      {
        key: 'when',
        header: COLUMNS.when,
        value: (r) => r.at,
        render: (r) => <span title={formatTimestamp(r.at)}>{formatRelative(r.at)}</span>,
      },
      {
        key: 'who',
        header: COLUMNS.who,
        value: (r) => ORG_LABEL[r.actorMsp] ?? r.actorMsp,
        render: (r) => (
          <span className="min-w-0">
            <span className="block truncate">{ORG_LABEL[r.actorMsp] ?? r.actorMsp}</span>
            {r.actorRole !== null && (
              <span className="block truncate text-caption text-ink-500">{r.actorRole}</span>
            )}
          </span>
        ),
      },
      {
        key: 'action',
        header: COLUMNS.whatHappened,
        value: (r) => ACTION_LABEL[r.action] ?? r.action,
        render: (r) => (
          <span className="min-w-0">
            <span className="block truncate text-ink-900">
              {ACTION_LABEL[r.action] ?? r.action}
            </span>
            {r.productId !== null && r.productId !== '' && (
              <span className="block truncate text-caption text-ink-500">
                {PRODUCTS[r.productId] ?? r.productId}
                {r.decision !== null && ` · ${DECISION_LABEL[r.decision] ?? r.decision}`}
              </span>
            )}
          </span>
        ),
      },
      {
        key: 'customer',
        header: COLUMNS.customer,
        value: (r) => r.displayName,
        render: (r) => (
          <Link
            to={`/customers/${r.subjectId}`}
            onClick={(e) => e.stopPropagation()}
            className="flex items-center gap-2 hover:underline"
          >
            <Avatar name={r.displayName} seed={r.subjectId.slice(0, 8)} size={24} />
            <span className="truncate">{r.displayName}</span>
          </Link>
        ),
      },
    ],
    [],
  );

  if (error !== null) {
    return (
      <>
        <h1 className="text-title font-semibold text-ink-900">{PAGE_TITLES.audit}</h1>
        <div className="mt-6">
          <ErrorState error={error} onRetry={reload} />
        </div>
      </>
    );
  }

  return (
    <>
      <h1 className="text-title font-semibold text-ink-900">{PAGE_TITLES.audit}</h1>
      <p className="mt-1 text-cell text-ink-500">
        This is the record an SBP inspector would be given.
      </p>

      <div className="card mt-5 flex items-start gap-3 border-l-4 border-l-mint-500 p-4">
        <ScrollText size={18} className="mt-0.5 shrink-0 text-mint-600" />
        <p className="text-cell leading-6 text-ink-700">{NOTES.auditVerifiable}</p>
      </div>

      <div className="card mt-4 flex flex-wrap items-end gap-3 p-4">
        <label className="flex flex-col gap-1">
          <span className="label-caption">{FILTERS.actionType}</span>
          <select
            value={action}
            onChange={(e) => setFilter('action', e.target.value)}
            className="rounded-control border border-ink-200 bg-white px-3 py-1.5 text-cell text-ink-900"
          >
            <option value="">Any</option>
            {ACTION_OPTIONS.map((a) => (
              <option key={a} value={a}>
                {ACTION_LABEL[a]}
              </option>
            ))}
          </select>
        </label>

        {subjectId !== '' && (
          <p className="py-1.5 text-cell text-ink-500">Filtered to one customer.</p>
        )}

        {filtered && (
          <button
            type="button"
            onClick={() => setParams(new URLSearchParams(), { replace: true })}
            className="rounded-control border border-ink-200 px-3 py-1.5 text-cell font-medium text-ink-700 transition-colors duration-fast hover:bg-ink-100"
          >
            {FILTERS.clearAll}
          </button>
        )}
      </div>

      <div className="mt-4">
        <DataTable
          rows={data?.rows ?? []}
          columns={columns}
          rowKey={(r) => `${r.at}-${r.subjectId}-${r.action}`}
          loading={loading}
          empty={filtered ? EMPTY.auditNoMatch! : EMPTY.auditNone!}
          onEmptyAction={filtered ? () => setParams(new URLSearchParams(), { replace: true }) : undefined}
          exportName="abhi-audit-trail"
          caption={data === null ? undefined : `${data.total.toLocaleString('en-PK')} entries`}
        />
      </div>
    </>
  );
}
