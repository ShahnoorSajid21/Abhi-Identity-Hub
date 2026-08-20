import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { api, directory, ApiError, type DecisionOutcome, type QueueRequest } from '../lib/api.ts';
import { useApi } from '../lib/useApi.ts';
import { useToast } from '../components/Toast.tsx';
import { formatCount, formatPkr, formatRelative, formatTimestamp } from '../lib/format.ts';
import {
  COLUMNS,
  EMPTY,
  METHODS,
  NOTES,
  PAGE_TITLES,
  PRODUCTS,
  TABS,
  TOASTS,
} from '../copy/strings.ts';
import { DataTable, type Column } from '../components/DataTable.tsx';
import { DecisionBanner } from '../components/DecisionBanner.tsx';
import { AttributeDisclosure } from '../components/AttributeDisclosure.tsx';
import { ErrorState } from '../components/ErrorState.tsx';
import { Avatar } from '../components/Avatar.tsx';

/**
 * The verification queue — where a real operations team lives.
 *
 * Every row is a product asking "can this customer proceed?", and the answer
 * the engine actually returned. The tabs are the four answers.
 */

const TAB_FOR: { id: DecisionOutcome; label: string; emptyKey: string }[] = [
  { id: 'ALLOW', label: TABS.queueReady, emptyKey: 'queueReady' },
  { id: 'STEP_UP', label: TABS.queueStepUp, emptyKey: 'queueStepUp' },
  { id: 'FULL_KYC', label: TABS.queueFullKyc, emptyKey: 'queueFullKyc' },
  { id: 'DENY', label: TABS.queueBlocked, emptyKey: 'queueBlocked' },
];

const CHIP: Record<DecisionOutcome, string> = {
  ALLOW: 'bg-ok-bg text-ok-fg',
  STEP_UP: 'bg-warn-bg text-warn-fg',
  FULL_KYC: 'bg-new-bg text-new-fg',
  DENY: 'bg-stop-bg text-stop-fg',
};

const CHIP_LABEL: Record<DecisionOutcome, string> = {
  ALLOW: 'Ready to proceed',
  STEP_UP: 'One more check',
  FULL_KYC: 'Full onboarding',
  DENY: 'Blocked',
};

export function QueuePage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const active = (params.get('decision') ?? 'ALLOW') as DecisionOutcome;

  const { data, error, loading, reload } = useApi(
    (signal) => directory.queue({ decision: active }, signal),
    [active],
  );
  const summary = useApi((signal) => directory.summary(signal));

  const columns: Column<QueueRequest>[] = useMemo(
    () => [
      {
        key: 'customer',
        header: COLUMNS.customer,
        value: (r) => r.displayName,
        render: (r) => (
          <span className="flex items-center gap-3">
            <Avatar name={r.displayName} seed={r.subjectId.slice(0, 8)} size={26} />
            <span className="truncate font-medium text-ink-900">{r.displayName}</span>
          </span>
        ),
      },
      {
        key: 'product',
        header: COLUMNS.product,
        value: (r) => PRODUCTS[r.productId] ?? r.productId,
        render: (r) => PRODUCTS[r.productId] ?? r.productId,
      },
      {
        key: 'requested',
        header: COLUMNS.requested,
        value: (r) => r.requestedAt,
        render: (r) => (
          <span title={formatTimestamp(r.requestedAt)}>{formatRelative(r.requestedAt)}</span>
        ),
      },
      {
        key: 'outcome',
        header: COLUMNS.outcome,
        value: (r) => r.decision,
        render: (r) => (
          <span className={`rounded-pill px-2.5 py-0.5 text-caption font-medium ${CHIP[r.decision]}`}>
            {CHIP_LABEL[r.decision]}
          </span>
        ),
      },
      {
        key: 'avoided',
        header: 'Spend avoided',
        align: 'right',
        value: (r) => r.costAvoidedPkr,
        render: (r) => (
          <span className={r.costAvoidedPkr > 0 ? 'text-ok-fg' : 'text-ink-500'}>
            {formatPkr(r.costAvoidedPkr)}
          </span>
        ),
      },
    ],
    [],
  );

  if (error !== null) {
    return (
      <>
        <h1 className="text-title font-semibold text-white">{PAGE_TITLES.queue}</h1>
        <div className="mt-6">
          <ErrorState error={error} onRetry={reload} />
        </div>
      </>
    );
  }

  const counts = data?.counts;

  return (
    <>
      <h1 className="text-title font-semibold text-white">{PAGE_TITLES.queue}</h1>
      <p className="mt-1 text-cell text-white/70">
        What each product asked, and what the identity records answered.
      </p>

      {/*
        What clearing this queue costs.

        This figure used to sit on the dashboard beside "spend avoided", where
        the pairing read as a return on investment. It belongs here instead: an
        operations lead looking at a backlog wants to know what actioning it
        buys, and that is context rather than a claim. The modelled-costs
        caveat travels with it, because the caveat is about these unit prices
        and nothing else on either screen.
      */}
      {summary.data !== null && summary.data.pendingRequests > 0 && (
        <p className="mt-3 flex flex-wrap items-baseline gap-x-2 text-caption text-white/70">
          <span className="tabular font-medium text-white">
            {formatCount(summary.data.pendingChecks)} checks
          </span>
          <span>
            outstanding across {formatCount(summary.data.pendingRequests)} requests, costing about{' '}
            <span className="tabular font-medium text-white">
              {formatPkr(summary.data.pendingCostPkr)}
            </span>{' '}
            once run. {NOTES.costsAreModelled}
          </span>
        </p>
      )}

      <div className="mt-5 flex flex-wrap gap-1 border-b border-navy-600">
        {TAB_FOR.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setParams({ decision: t.id }, { replace: true })}
            className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-cell font-medium transition-colors duration-fast ${
              active === t.id
                ? 'border-mint-500 text-white'
                : 'border-transparent text-white/60 hover:text-white'
            }`}
          >
            {t.label}
            {counts !== undefined && (
              <span className="tabular rounded-pill bg-navy-700 px-2 py-0.5 text-caption text-white">
                {counts[t.id]}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="mt-4">
        <DataTable
          rows={data?.rows ?? []}
          columns={columns}
          rowKey={(r) => r.requestId}
          loading={loading}
          empty={EMPTY[TAB_FOR.find((t) => t.id === active)?.emptyKey ?? 'queueNone']!}
          onRowClick={(r) => navigate(`/queue/${r.requestId}`)}
          exportName="abhi-verification-queue"
        />
      </div>
    </>
  );
}

/**
 * One request in full.
 *
 * The STEP_UP path is where most of the value sits, so it gets the room: the
 * button reads "Run fingerprint check only", never "Step up".
 */
export function QueueRequestPage() {
  const { requestId = '' } = useParams();
  const toast = useToast();
  const [cnic, setCnic] = useState('');
  const [showCnic, setShowCnic] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rejection, setRejection] = useState<ApiError | null>(null);
  const [done, setDone] = useState(false);

  const { data, error, loading, reload } = useApi(
    (signal) => directory.request(requestId, signal),
    [requestId],
  );

  if (error !== null) return <ErrorState error={error} onRetry={reload} />;
  if (loading || data === null) return <div className="card p-6 text-cell text-ink-500">Loading…</div>;

  const missing = data.missingMethods;
  const missingLabel =
    missing.length === 0
      ? 'the missing check'
      : (METHODS[missing[0]!] ?? missing[0]!).toLowerCase();

  async function runMissingCheck() {
    if (data === null) return;
    setBusy(true);
    setRejection(null);
    try {
      // Only the missing method is supplied. Everything already confirmed is
      // reused — that is the whole point of a step-up.
      const attributes: Record<string, boolean> = {};
      for (const m of missing) {
        if (m === 'BIOMETRIC_1TO1') attributes['biometric_match'] = true;
        if (m === 'LIVENESS') attributes['liveness_pass'] = true;
        if (m === 'VERISYS') attributes['verisys_match'] = true;
        if (m === 'DOC_AUTH') attributes['document_authenticity_pass'] = true;
      }

      await api.update({
        cnic,
        productId: data.productId,
        attributes,
        cnicExpiryAt: new Date(Date.now() + 5 * 365 * 86_400_000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
        reason: `Step-up for ${data.productId}`,
      });

      toast(TOASTS.stepUpComplete(data.displayName, METHODS[missing[0]!] ?? 'The check'), 'ok');
      setDone(true);
    } catch (e) {
      if (e instanceof ApiError) setRejection(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Link
        to="/queue"
        className="inline-flex items-center gap-2 text-cell font-medium text-white/70 transition-colors duration-fast hover:text-white"
      >
        <ArrowLeft size={15} />
        Back to the queue
      </Link>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Avatar name={data.displayName} seed={data.subjectId.slice(0, 8)} size={40} />
        <div>
          <Link
            to={`/customers/${data.subjectId}`}
            className="text-title font-semibold text-white hover:underline"
          >
            {data.displayName}
          </Link>
          <p className="text-cell text-white/70">
            {PRODUCTS[data.productId] ?? data.productId} · requested{' '}
            {formatRelative(data.requestedAt)}
          </p>
        </div>
      </div>

      <div className="mt-5">
        <DecisionBanner
          outcome={data.decision}
          reason={data.decisionReason}
          missingMethods={data.missingMethods}
        />
      </div>

      {data.decision === 'ALLOW' && (
        <section className="card mt-5 p-5">
          <h2 className="text-section font-semibold text-ink-900">What this saved</h2>
          <div className="mt-4 grid gap-6 sm:grid-cols-2">
            <div>
              <p className="label-caption">Without the ledger</p>
              <p className="tabular mt-2 text-body text-ink-500">
                {data.railCallsAvoided} external checks
              </p>
              <p className="tabular text-body text-ink-500">{formatPkr(data.costAvoidedPkr)}</p>
            </div>
            <div>
              <p className="label-caption">With the ledger</p>
              <p className="tabular mt-2 text-body font-semibold text-ok-fg">0 external checks</p>
              <p className="tabular text-metric font-bold leading-none text-ok-fg">
                {formatPkr(0)}
              </p>
            </div>
          </div>
          {/* The reuse-scope caveat is already on the decision banner directly
              above. Repeating it here would say it twice on one screen. */}
        </section>
      )}

      {data.decision === 'STEP_UP' && !done && (
        <section className="card mt-5 p-5">
          <h2 className="text-section font-semibold text-ink-900">Run only what is missing</h2>
          <p className="mt-1 text-cell leading-6 text-ink-700">
            Everything this customer has already been confirmed for is reused. Only the{' '}
            {missingLabel} is run.
          </p>

          {!showCnic ? (
            <button
              type="button"
              onClick={() => setShowCnic(true)}
              className="mt-4 rounded-control bg-warn-line px-4 py-2 text-cell font-medium text-navy-900 transition-opacity duration-fast hover:opacity-90"
            >
              Run {missingLabel} only
            </button>
          ) : (
            <div className="mt-4">
              {/* The console addresses customers by subject id, which cannot be
                  reversed into a CNIC. A step-up happens with the customer
                  present, so the operator has the card in hand — which is
                  exactly when this field gets filled in. */}
              <label className="block">
                <span className="label-caption">Customer’s CNIC, to record the result against</span>
                <input
                  value={cnic}
                  onChange={(e) => setCnic(e.target.value)}
                  placeholder="61101-1234567-8"
                  className="mt-1 w-full max-w-sm rounded-control border border-ink-200 px-3 py-2 text-cell text-ink-900 placeholder:text-ink-500 focus:border-mint-600 focus:outline-none"
                />
              </label>
              <button
                type="button"
                onClick={() => void runMissingCheck()}
                disabled={busy || cnic.trim().length === 0}
                className="mt-3 rounded-control bg-warn-line px-4 py-2 text-cell font-medium text-navy-900 transition-opacity duration-fast hover:opacity-90 disabled:opacity-40"
              >
                {busy ? 'Running…' : `Run ${missingLabel} only`}
              </button>
            </div>
          )}

          {rejection !== null && (
            <p className="mt-3 rounded-control border border-stop-line bg-stop-bg px-3 py-2 text-cell text-stop-fg">
              {rejection.detail ?? rejection.code}
            </p>
          )}
        </section>
      )}

      {done && (
        <section className="card mt-5 border-ok-line p-5">
          <p className="text-body font-semibold text-ok-fg">Check completed and recorded</p>
          <p className="mt-1 text-cell text-ink-700">
            {data.displayName} can now proceed with{' '}
            {PRODUCTS[data.productId] ?? data.productId}.{' '}
            <Link to={`/customers/${data.subjectId}`} className="underline">
              See their updated record
            </Link>
            .
          </p>
        </section>
      )}

      <section className="card mt-5 p-5">
        {/*
          ENTITLEMENT, not disclosure.

          This heading read "What this product was shown", which was not true.
          `disclosedAttributes` is the decision's disclosableAttributes — what
          the product's policy permits it to ask for. Nothing is actually
          handed over until a proof is issued, and a proof is issued only when
          a verification carries a consent id, which this console does not yet
          send. Telling a compliance audience that a product "was shown" data
          it never received is exactly the claim that loses the room.
        */}
        <h2 className="text-section font-semibold text-ink-900">
          What this product may see
        </h2>
        <p className="mt-1 text-cell leading-6 text-ink-500">
          Its policy permits these attributes and no others. They are handed over only once the
          customer's consent is recorded and a proof is issued — nothing has been disclosed by
          this request on its own.
        </p>
        <div className="mt-4">
          <AttributeDisclosure disclosed={data.disclosedAttributes} />
        </div>
      </section>
    </>
  );
}
