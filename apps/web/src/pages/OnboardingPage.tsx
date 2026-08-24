import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Info, Upload } from 'lucide-react';
import {
  api,
  directory,
  type EmployerBulkBucket,
  type EmployerBulkResult,
  type EmployerBulkRow,
} from '../lib/api.ts';
import { useApi } from '../lib/useApi.ts';
import { useToast } from '../components/Toast.tsx';
import { formatCount } from '../lib/format.ts';
import {
  ACTIONS,
  DECISION_REASONS,
  EMPTY,
  LEVELS,
  METHODS,
  NOTES,
  ONBOARDING_STEPS,
  PAGE_TITLES,
  TOASTS,
} from '../copy/strings.ts';
import { DataTable, type Column } from '../components/DataTable.tsx';
import { EmptyState } from '../components/EmptyState.tsx';
import { ErrorState } from '../components/ErrorState.tsx';
import { CustomerReviewDrawer } from '../components/CustomerReviewDrawer.tsx';

/**
 * Employer bulk onboarding — the business case, and the honest version of it.
 *
 * An employer sends a list of employees. ABHI checks each against its own
 * records and splits them four ways: ready now, one check away, never seen
 * before, and blocked. The saving is what the bank does not have to spend
 * re-verifying people it has already verified.
 *
 * Two things this screen previously got wrong, both in the programme's own
 * favour, and both fixed here:
 *
 *  1. The "one check needed" bucket was hard-coded empty while the gateway
 *     folded STEP_UP into needsOnboarding. Against the seeded cohort that
 *     reported 768 full onboardings where the true number is 300 — 469
 *     employees ABHI already knows were being counted as strangers.
 *  2. Every one of those was then priced at a full from-scratch journey, so
 *     the screen understated its own saving by roughly a third.
 *
 * Money is now computed by the gateway from its live rail table rather than
 * mirrored here, because a mirrored constant is a number waiting to disagree
 * with the one /metrics reports.
 *
 * WHAT AN UPLOAD IS NOT. Per Consolidated Product Manual v2 §8.2, the bulk
 * template carries fifteen columns and verifies none of them: an uploaded
 * employee is their employer's assertion. Full KYC/CDD attaches to the
 * employee at disbursement (§6.1), and CNIC screening plus the e-CIB check are
 * performed by ABHI Bank on every origination (§6.3a). None of that is
 * displaced by identity reuse, and the screen says so rather than leaving the
 * reader to assume a green bar means "cleared".
 */

type Segment = EmployerBulkBucket;

interface SegmentSpec {
  id: Segment;
  label: string;
  hint: string;
  tone: string;
  chip: string;
}

const SEGMENTS: SegmentSpec[] = [
  {
    id: 'ready',
    label: 'Ready now',
    hint: 'Already confirmed to the standard this product needs. No check runs.',
    tone: 'bg-ok-line',
    chip: 'bg-ok-bg text-ok-fg',
  },
  {
    id: 'oneCheck',
    label: 'One check needed',
    hint: 'Already known to ABHI. Only the missing method runs, not the pack.',
    tone: 'bg-warn-line',
    chip: 'bg-warn-bg text-warn-fg',
  },
  {
    id: 'full',
    label: 'Full onboarding',
    hint: 'No record at all. These are the genuinely new applicants.',
    tone: 'bg-new-line',
    chip: 'bg-new-bg text-new-fg',
  },
  {
    id: 'blocked',
    label: 'Blocked',
    hint: 'Nothing the employer can do here. Each carries its own reason.',
    tone: 'bg-stop-line',
    chip: 'bg-stop-bg text-stop-fg',
  },
];

/** Bucket sizes, read from the rows so the bar can never disagree with the table. */
function countsOf(rows: EmployerBulkRow[]): Record<Segment, number> {
  const out: Record<Segment, number> = { ready: 0, oneCheck: 0, full: 0, blocked: 0 };
  for (const r of rows) out[r.bucket] += 1;
  return out;
}

export function OnboardingPage() {
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [fileName, setFileName] = useState<string | null>(null);
  const [result, setResult] = useState<EmployerBulkResult | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [segment, setSegment] = useState<Segment | null>(null);
  const [activated, setActivated] = useState<{ now: number; queued: number } | null>(null);
  /** The customer whose profile is open for review, over the list. */
  const [reviewSubject, setReviewSubject] = useState<string | null>(null);

  /**
   * The sample employer file.
   *
   * The bulk lookup is keyed by CNIC, because that is what an employer's
   * spreadsheet contains. These screens hold no CNICs — customers are
   * addressed by subject id, which cannot be reversed — so the sample comes
   * from the gateway, standing in for the file an employer would send.
   */
  const sample = useApi((signal) => directory.sampleEmployerList(1000, signal));

  async function runCheck(list: string[], label: string) {
    setBusy(true);
    setError(null);
    try {
      const r = await api.employerBulkLookup(list);
      setResult(r);
      setFileName(label);
      setActivated(null);
      setStep(1);
      toast(TOASTS.csvProcessed(r.total), 'ok');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  function onFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      // Pull anything CNIC-shaped out of the file, with or without dashes.
      // The employer template issues them undashed (Product Manual §8.2); the
      // app captures them dashed. Both must reach the same subject.
      const found = [...text.matchAll(/\b\d{5}-?\d{7}-?\d\b/g)].map((m) => m[0]);
      if (found.length === 0) {
        setError(new Error('no rows'));
        return;
      }
      void runCheck(found, file.name);
    };
    reader.readAsText(file);
  }

  const counts = useMemo(
    () => (result === null ? null : countsOf(result.rows)),
    [result],
  );

  /** Blocked is a bucket of unrelated problems; an ops user needs them apart. */
  const blockedByReason = useMemo(() => {
    if (result === null) return [];
    const map = new Map<string, number>();
    for (const r of result.rows) {
      if (r.bucket !== 'blocked') continue;
      map.set(r.reason, (map.get(r.reason) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [result]);

  /** Why the one-check bucket exists, in the engine's own words. */
  const oneCheckByReason = useMemo(() => {
    if (result === null) return [];
    const map = new Map<string, number>();
    for (const r of result.rows) {
      if (r.bucket !== 'oneCheck') continue;
      map.set(r.reason, (map.get(r.reason) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [result]);

  const visibleRows = useMemo(
    () => (result === null || segment === null ? [] : result.rows.filter((r) => r.bucket === segment)),
    [result, segment],
  );

  const columns: Column<EmployerBulkRow>[] = [
    {
      key: 'cnic',
      header: 'CNIC',
      render: (r) => <span className="tabular text-ink-900">{r.cnicMasked}</span>,
      value: (r) => r.cnicMasked,
      width: '150px',
    },
    {
      key: 'level',
      header: 'On record',
      render: (r) =>
        r.currentAssurance === null ? (
          <span className="text-ink-500">Not known to ABHI</span>
        ) : (
          <span className="text-ink-900">{LEVELS[r.currentAssurance].label}</span>
        ),
      value: (r) => r.currentAssurance ?? '',
      width: '160px',
    },
    {
      key: 'needs',
      header: 'What still has to run',
      render: (r) =>
        r.missingMethods.length === 0 ? (
          <span className="text-ink-500">Nothing</span>
        ) : (
          <span className="text-ink-900">
            {r.missingMethods.map((m) => METHODS[m] ?? m).join(', ')}
          </span>
        ),
      value: (r) => r.missingMethods.join(' + '),
    },
    {
      key: 'reason',
      header: 'Why',
      render: (r) => <span className="text-ink-700">{DECISION_REASONS[r.reason] ?? r.reason}</span>,
      value: (r) => r.reason,
    },
    {
      key: 'age',
      header: 'Confirmed',
      render: (r) =>
        r.ageDays === null ? (
          <span className="text-ink-500">—</span>
        ) : (
          <span className="tabular text-ink-700">{formatCount(r.ageDays)} days ago</span>
        ),
      value: (r) => r.ageDays,
      align: 'right',
      width: '130px',
    },
    {
      key: 'review',
      header: 'Review',
      align: 'right',
      width: '130px',
      // The reviewable entry, per customer. Known subjects open a profile;
      // genuinely new applicants have no ABHI record to open yet, and the
      // column says so rather than offering a dead control.
      render: (r) =>
        r.subjectId === null ? (
          <span className="text-caption text-ink-500">New applicant</span>
        ) : (
          <button
            type="button"
            onClick={() => setReviewSubject(r.subjectId)}
            className="text-caption font-medium text-mint-700 underline-offset-2 hover:text-ink-900 hover:underline"
          >
            View profile
          </button>
        ),
      value: (r) => r.subjectId ?? '',
    },
  ];

  const activeSpec = SEGMENTS.find((s) => s.id === segment) ?? null;

  return (
    <>
      <h1 className="text-title font-semibold text-white">{PAGE_TITLES.onboarding}</h1>

      {/*
        Step rail — navigation, not decoration.

        These were three static pills. A numbered rail that highlights a
        current step is a promise that the steps are places you can be, so
        they are now buttons: Upload is always reachable, and Review and
        Activate open as soon as there is a result to review. Going back to
        Upload deliberately does NOT discard that result — it shows the
        dropzone with Review still one click away, because losing a
        thousand-row triage to a mis-click is not a recoverable mistake.
        Discarding is what "Choose another file" is for, and it says so.
      */}
      <ol className="mt-5 flex flex-wrap gap-2" aria-label="Upload progress">
        {ONBOARDING_STEPS.map((label, i) => {
          const reachable = i === 0 || result !== null;
          const current = i === step;
          return (
            <li key={label}>
              <button
                type="button"
                disabled={!reachable}
                aria-current={current ? 'step' : undefined}
                onClick={() => {
                  setStep(i);
                  // The drill-down belongs to Review; carrying an open table
                  // onto another step would leave it stranded there.
                  if (i !== 1) setSegment(null);
                }}
                title={reachable ? undefined : 'Check a file first'}
                className={`flex items-center gap-2 rounded-pill px-3 py-1.5 text-cell font-medium transition-colors duration-fast ${
                  current
                    ? 'bg-navy-700 text-white'
                    : i < step
                      ? 'bg-mint-100 text-ok-fg hover:bg-mint-200'
                      : 'bg-ink-100 text-ink-700 hover:bg-ink-200'
                } disabled:cursor-not-allowed disabled:bg-ink-100 disabled:text-ink-500 disabled:hover:bg-ink-100`}
              >
                <span className="tabular">{i + 1}</span>
                {label}
              </button>
            </li>
          );
        })}
      </ol>

      {error !== null && (
        <div className="mt-5">
          <ErrorState error={error} onRetry={() => setError(null)} />
        </div>
      )}

      {step === 0 && (
        <>
          <section className="card mt-5">
            <label
              className="block cursor-pointer"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const file = e.dataTransfer.files[0];
                if (file !== undefined) onFile(file);
              }}
            >
              <input
                type="file"
                accept=".csv,text/csv,text/plain"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file !== undefined) onFile(file);
                }}
              />
              <EmptyState copy={EMPTY.onboardingStart!} />
            </label>

            <div className="border-t border-ink-200 p-4 text-center">
              <button
                type="button"
                disabled={busy || sample.data === null}
                onClick={() => {
                  void runCheck(sample.data?.cnics ?? [], 'employee-list.csv');
                }}
                className="inline-flex items-center gap-2 rounded-control border border-ink-200 px-4 py-2 text-cell font-medium text-ink-700 transition-colors duration-fast hover:bg-ink-100 disabled:opacity-40"
              >
                <Upload size={15} />
                {busy ? 'Checking…' : 'Use a sample employee list'}
              </button>
              <p className="mt-2 text-caption text-ink-500">
                Drop a CSV above, or check a sample list drawn from the seeded base.
              </p>
            </div>
          </section>

          {/* What the file is expected to contain, per the issued template. */}
          <section className="card mt-5 p-5">
            <h2 className="text-section font-semibold text-ink-900">What the file should contain</h2>
            <p className="mt-2 text-cell leading-6 text-ink-500">
              The employer template issues fifteen columns. Only the CNIC column is read here —
              this screen answers “who do we already know?”, nothing else.
            </p>
            <dl className="mt-4 grid gap-x-8 gap-y-2 sm:grid-cols-2">
              {[
                ['Mandatory', 'First name, last name, CNIC, date of birth, date of joining'],
                ['Also mandatory', 'Salary bank, salary account number, net salary'],
                ['Either one', 'Email or phone'],
                ['CNIC format', 'Thirteen digits, issued without dashes'],
              ].map(([k, v]) => (
                <div key={k} className="flex flex-wrap gap-x-2 border-b border-ink-100 py-1.5">
                  <dt className="label-caption min-w-[120px]">{k}</dt>
                  <dd className="flex-1 text-cell text-ink-700">{v}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 flex items-start gap-2 text-caption leading-5 text-ink-500">
              <Info size={14} className="mt-0.5 shrink-0" />
              {NOTES.employerCnicNormalised}
            </p>
          </section>
        </>
      )}

      {step === 1 && result !== null && counts !== null && (
        <>
          <section className="card mt-5 p-5">
            <h2 className="text-section font-semibold text-ink-900">
              {formatCount(result.total)} employees checked against ABHI’s records
            </h2>
            {fileName !== null && <p className="mt-1 text-caption text-ink-500">{fileName}</p>}

            {/* Triage bar. 2px gaps so adjacent fills never touch. */}
            <div className="mt-5 flex h-9 w-full gap-[2px] overflow-hidden">
              {SEGMENTS.filter((s) => counts[s.id] > 0).map((s, i, arr) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSegment(segment === s.id ? null : s.id)}
                  title={`${s.label} — ${formatCount(counts[s.id])}`}
                  style={{ width: `${(counts[s.id] / result.total) * 100}%` }}
                  className={`${s.tone} transition-opacity duration-fast hover:opacity-80 ${
                    i === 0 ? 'rounded-l' : ''
                  } ${i === arr.length - 1 ? 'rounded-r' : ''}`}
                />
              ))}
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {SEGMENTS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSegment(segment === s.id ? null : s.id)}
                  className={`rounded-control p-2 text-left transition-colors duration-fast hover:bg-ink-50 ${
                    segment === s.id ? 'bg-ink-100' : ''
                  }`}
                >
                  <span className="flex items-start gap-2">
                    <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-sm ${s.tone}`} />
                    <span>
                      <span className="tabular block text-body font-semibold text-ink-900">
                        {formatCount(counts[s.id])}
                      </span>
                      <span className="block text-caption text-ink-500">{s.label}</span>
                    </span>
                  </span>
                  <span className="mt-1.5 block text-caption leading-4 text-ink-500">{s.hint}</span>
                </button>
              ))}
            </div>

            {/* The middle bucket is the whole argument, so it gets its reasons
                spelled out rather than left as a number to be trusted. */}
            {oneCheckByReason.length > 0 && (
              <div className="mt-4 rounded-control border border-warn-line bg-warn-bg px-4 py-3">
                <p className="text-cell font-medium text-warn-fg">
                  {formatCount(counts.oneCheck)} of these are people ABHI already knows
                </p>
                <ul className="mt-1.5 space-y-1">
                  {oneCheckByReason.map(([reason, n]) => (
                    <li key={reason} className="text-caption leading-5 text-warn-fg">
                      <span className="tabular font-semibold">{formatCount(n)}</span> ·{' '}
                      {DECISION_REASONS[reason] ?? reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {blockedByReason.length > 0 && (
              <div className="mt-3 rounded-control border border-stop-line bg-stop-bg px-4 py-3">
                <p className="text-cell font-medium text-stop-fg">
                  {formatCount(counts.blocked)} blocked
                </p>
                <ul className="mt-1.5 space-y-1">
                  {blockedByReason.map(([reason, n]) => (
                    <li key={reason} className="text-caption leading-5 text-stop-fg">
                      <span className="tabular font-semibold">{formatCount(n)}</span> ·{' '}
                      {DECISION_REASONS[reason] ?? reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          {/* ---------------------------------------------------------- */}
          {/* What this screen does NOT establish                         */}
          {/* ---------------------------------------------------------- */}
          <section className="card mt-5 p-5">
            <h2 className="text-section font-semibold text-ink-900">
              What an upload does and does not establish
            </h2>
            <ul className="mt-3 space-y-2.5">
              {[
                NOTES.employerUploadIsAsserted,
                NOTES.employerUploadCompliance,
                NOTES.employerExposureCeiling,
              ].map((note) => (
                <li key={note} className="flex items-start gap-2 text-cell leading-6 text-ink-700">
                  <AlertTriangle size={15} className="mt-1 shrink-0 text-warn-fg" />
                  <span>{note}</span>
                </li>
              ))}
            </ul>
          </section>

          {/* Forward motion. The rail can jump, but the primary path is a
              button that says what happens next. */}
          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => { setSegment(null); setStep(2); }}
              className="rounded-control bg-mint-500 px-4 py-2 text-cell font-semibold text-navy-900 transition-colors duration-fast hover:bg-mint-600"
            >
              Continue to activate
            </button>
            <button
              type="button"
              onClick={() => { setStep(0); setSegment(null); }}
              className="rounded-control border border-ink-200 px-4 py-2 text-cell font-medium text-ink-700 transition-colors duration-fast hover:bg-ink-100"
            >
              Back to upload
            </button>
          </div>


          {/* ---------------------------------------------------------- */}
          {/* Drill-down                                                  */}
          {/* ---------------------------------------------------------- */}
          {activeSpec !== null && (
            <section className="card mt-5 p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-section font-semibold text-ink-900">{activeSpec.label}</h2>
                  <p className="mt-1 text-caption leading-5 text-ink-500">{activeSpec.hint}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setSegment(null)}
                  className="text-caption font-medium text-ink-500 underline-offset-2 hover:underline"
                >
                  Close
                </button>
              </div>

              <div className="mt-4">
                <DataTable
                  rows={visibleRows}
                  columns={columns}
                  rowKey={(r) => r.subjectId ?? r.cnicMasked}
                  empty={EMPTY.onboardingSegmentEmpty!}
                  onEmptyAction={() => setSegment(null)}
                  exportName={`employer-upload-${activeSpec.id}`}
                  caption={
                    <span>
                      {formatCount(visibleRows.length)} employees. CNICs are masked here and in the
                      export.
                    </span>
                  }
                />
              </div>
            </section>
          )}
        </>
      )}

      {step === 2 && result !== null && counts !== null && (
        <>
          {/* Carried forward from Review, because activation is a decision and
              a decision taken without the numbers in front of you is a guess.
              Every figure links back to the table it came from. */}
          <section className="card mt-5 p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="text-section font-semibold text-ink-900">
                {formatCount(result.total)} employees in {fileName ?? 'this upload'}
              </h2>
              <button
                type="button"
                onClick={() => setStep(1)}
                className="text-caption font-medium text-ink-500 underline-offset-2 hover:underline"
              >
                Back to review
              </button>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {SEGMENTS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    setSegment(s.id);
                    setStep(1);
                  }}
                  className="rounded-control p-2 text-left transition-colors duration-fast hover:bg-ink-50"
                >
                  <dt className="flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-sm ${s.tone}`} />
                    <span className="text-caption text-ink-500">{s.label}</span>
                  </dt>
                  <dd className="tabular mt-0.5 text-body font-semibold text-ink-900">
                    {formatCount(counts[s.id])}
                  </dd>
                </button>
              ))}
            </dl>
          </section>

          {/* ---------------------------------------------------------- */}
          {/* Activate                                                    */}
          {/* ---------------------------------------------------------- */}
          <section className="card mt-5 p-5">
            <h2 className="text-section font-semibold text-ink-900">Activate</h2>

            {activated === null ? (
              <>
                <p className="mt-2 text-cell leading-6 text-ink-500">
                  Activation grants product access on the strength of what the ledger already
                  holds. It writes nothing to the identity record.
                </p>
                <div className="mt-4 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      toast(TOASTS.employeesActivated(counts.ready), 'ok');
                      setActivated({ now: counts.ready, queued: counts.oneCheck + counts.full });
                      setStep(2);
                    }}
                    disabled={counts.ready === 0}
                    className="rounded-control bg-navy-700 px-4 py-2 text-cell font-medium text-white transition-colors duration-fast hover:bg-navy-600 disabled:opacity-40"
                  >
                    Activate {formatCount(counts.ready)} employees now
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      toast(TOASTS.employeesQueued(counts.oneCheck + counts.full), 'info');
                      setActivated({ now: 0, queued: counts.oneCheck + counts.full });
                      setStep(2);
                    }}
                    disabled={counts.oneCheck + counts.full === 0}
                    className="rounded-control border border-ink-200 px-4 py-2 text-cell font-medium text-ink-700 transition-colors duration-fast hover:bg-ink-100 disabled:opacity-40"
                  >
                    Queue {formatCount(counts.oneCheck + counts.full)} for verification
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setStep(0);
                      setResult(null);
                      setSegment(null);
                      setFileName(null);
                      setActivated(null);
                    }}
                    className="rounded-control px-4 py-2 text-cell font-medium text-ink-500 transition-colors duration-fast hover:text-ink-900"
                  >
                    {ACTIONS.chooseFile}
                  </button>
                </div>
              </>
            ) : (
              /* A receipt, not a toast that vanishes. What happened, what did
                 not, and where the outstanding work went. */
              <div className="mt-3">
                <dl className="grid gap-4 sm:grid-cols-3">
                  <div>
                    <dt className="label-caption">Activated</dt>
                    <dd className="tabular mt-1 text-title font-semibold text-ok-fg">
                      {formatCount(activated.now)}
                    </dd>
                  </div>
                  <div>
                    <dt className="label-caption">Queued for verification</dt>
                    <dd className="tabular mt-1 text-title font-semibold text-ink-900">
                      {formatCount(activated.queued)}
                    </dd>
                  </div>
                  <div>
                    <dt className="label-caption">Blocked, no action possible</dt>
                    <dd className="tabular mt-1 text-title font-semibold text-stop-fg">
                      {formatCount(counts.blocked)}
                    </dd>
                  </div>
                </dl>
                <p className="mt-4 border-t border-ink-100 pt-3 text-caption leading-5 text-ink-500">
                  Queued employees appear in the verification queue. Nothing here changed an
                  identity record — activation is a product-access grant, and the checks these
                  employees still owe run at their first request.
                </p>
                <div className="mt-4 flex flex-wrap gap-3">
                  <Link
                    to="/queue"
                    className="rounded-control bg-navy-700 px-4 py-2 text-cell font-medium text-white transition-colors duration-fast hover:bg-navy-600"
                  >
                    Open the verification queue
                  </Link>
                  <button
                    type="button"
                    onClick={() => {
                      setStep(0);
                      setResult(null);
                      setSegment(null);
                      setFileName(null);
                      setActivated(null);
                    }}
                    className="rounded-control border border-ink-200 px-4 py-2 text-cell font-medium text-ink-700 transition-colors duration-fast hover:bg-ink-100"
                  >
                    Upload another file
                  </button>
                </div>
              </div>
            )}
          </section>
        </>
      )}

      {/* Review, over the list. The onboarding page stays mounted underneath,
          so a reviewer moves between customers without losing the employer
          context they are reviewing within. */}
      {reviewSubject !== null && (
        <CustomerReviewDrawer subjectId={reviewSubject} onClose={() => setReviewSubject(null)} />
      )}
    </>
  );
}
