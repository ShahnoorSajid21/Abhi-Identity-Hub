import { useMemo, useState } from 'react';
import { Upload } from 'lucide-react';
import { api, directory, type AssuranceLevel } from '../lib/api.ts';
import { useApi } from '../lib/useApi.ts';
import { useToast } from '../components/Toast.tsx';
import { formatCount, formatPercent, formatPkr } from '../lib/format.ts';
import { ACTIONS, EMPTY, NOTES, ONBOARDING_STEPS, PAGE_TITLES, TOASTS } from '../copy/strings.ts';
import { EmptyState } from '../components/EmptyState.tsx';
import { ErrorState } from '../components/ErrorState.tsx';

/**
 * Employer bulk onboarding — the business case.
 *
 * An employer sends a list of employees. ABHI checks each against its own
 * records and splits them three ways: ready now, one check away, and never
 * seen before. The saving is what the bank does not have to spend re-verifying
 * people it has already verified.
 *
 * Every money figure here is computed from the rail cost table and carries the
 * modelled-placeholder caveat. The plan's original figures came from a per-head
 * cost this repository does not produce.
 */

/** Rail unit costs, mirroring services/gateway/src/rails.ts. */
const UNIT_COST: Record<string, number> = {
  VERISYS: 25,
  DOC_AUTH: 15,
  BIOMETRIC_1TO1: 40,
  LIVENESS: 20,
};

const JOURNEY: Record<AssuranceLevel, number> = {
  A0: 0,
  A1: UNIT_COST.VERISYS! + UNIT_COST.DOC_AUTH!,
  A2: UNIT_COST.VERISYS! + UNIT_COST.DOC_AUTH! + UNIT_COST.BIOMETRIC_1TO1!,
  A3: UNIT_COST.VERISYS! + UNIT_COST.DOC_AUTH! + UNIT_COST.BIOMETRIC_1TO1! + UNIT_COST.LIVENESS!,
};

interface Split {
  total: number;
  readyNow: string[];
  oneCheck: string[];
  fullOnboarding: string[];
  blocked: string[];
}

type Segment = 'ready' | 'oneCheck' | 'full' | 'blocked';

export function OnboardingPage() {
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [fileName, setFileName] = useState<string | null>(null);
  const [split, setSplit] = useState<Split | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [segment, setSegment] = useState<Segment | null>(null);

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
      const result = await api.employerBulkLookup(list);
      setSplit({
        total: result.total,
        readyNow: result.activateNow,
        oneCheck: [],
        fullOnboarding: result.needsOnboarding,
        blocked: [...result.denied, ...result.invalid, ...result.unauthorised],
      });
      setFileName(label);
      setStep(1);
      toast(TOASTS.csvProcessed(result.total), 'ok');
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
      const found = [...text.matchAll(/\b\d{5}-?\d{7}-?\d\b/g)].map((m) => m[0]);
      if (found.length === 0) {
        setError(new Error('no rows'));
        return;
      }
      void runCheck(found, file.name);
    };
    reader.readAsText(file);
  }

  const economics = useMemo(() => {
    if (split === null) return null;
    // EMPLOYER_BULK requires fingerprint verification, so a from-scratch
    // journey for this product is the A2 cost.
    const perHead = JOURNEY.A2;
    const withoutLedger = split.total * perHead;
    const withLedger =
      split.fullOnboarding.length * perHead + split.oneCheck.length * UNIT_COST.BIOMETRIC_1TO1!;
    const saved = withoutLedger - withLedger;
    return { perHead, withoutLedger, withLedger, saved, share: saved / (withoutLedger || 1) };
  }, [split]);

  const SEGMENTS: { id: Segment; label: string; list: string[]; tone: string }[] =
    split === null
      ? []
      : [
          { id: 'ready', label: 'Ready now', list: split.readyNow, tone: 'bg-ok-line' },
          { id: 'oneCheck', label: 'One check needed', list: split.oneCheck, tone: 'bg-warn-line' },
          { id: 'full', label: 'Full onboarding', list: split.fullOnboarding, tone: 'bg-new-line' },
          { id: 'blocked', label: 'Blocked', list: split.blocked, tone: 'bg-stop-line' },
        ];

  return (
    <>
      <h1 className="text-title font-semibold text-ink-900">{PAGE_TITLES.onboarding}</h1>

      {/* Step rail */}
      <ol className="mt-5 flex flex-wrap gap-2">
        {ONBOARDING_STEPS.map((label, i) => (
          <li
            key={label}
            className={`flex items-center gap-2 rounded-pill px-3 py-1.5 text-cell font-medium ${
              i === step
                ? 'bg-navy-700 text-white'
                : i < step
                  ? 'bg-mint-100 text-ok-fg'
                  : 'bg-ink-100 text-ink-500'
            }`}
          >
            <span className="tabular">{i + 1}</span>
            {label}
          </li>
        ))}
      </ol>

      {error !== null && (
        <div className="mt-5">
          <ErrorState error={error} onRetry={() => setError(null)} />
        </div>
      )}

      {step === 0 && (
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
      )}

      {step >= 1 && split !== null && economics !== null && (
        <>
          <section className="card mt-5 p-5">
            <h2 className="text-section font-semibold text-ink-900">
              {formatCount(split.total)} employees checked against ABHI’s records
            </h2>
            {fileName !== null && <p className="mt-1 text-caption text-ink-500">{fileName}</p>}

            {/* Triage bar. 2px gaps so adjacent fills never touch. */}
            <div className="mt-5 flex h-9 w-full gap-[2px] overflow-hidden">
              {SEGMENTS.filter((s) => s.list.length > 0).map((s, i, arr) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSegment(segment === s.id ? null : s.id)}
                  title={`${s.label} — ${formatCount(s.list.length)}`}
                  style={{ width: `${(s.list.length / split.total) * 100}%` }}
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
                  className={`flex items-start gap-2 rounded-control p-2 text-left transition-colors duration-fast hover:bg-ink-50 ${
                    segment === s.id ? 'bg-ink-100' : ''
                  }`}
                >
                  <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-sm ${s.tone}`} />
                  <span>
                    <span className="tabular block text-body font-semibold text-ink-900">
                      {formatCount(s.list.length)}
                    </span>
                    <span className="block text-caption text-ink-500">{s.label}</span>
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className="card mt-5 p-5">
            <h2 className="text-section font-semibold text-ink-900">What this upload costs</h2>
            <dl className="mt-4 space-y-2">
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-cell text-ink-700">Without the identity ledger</dt>
                <dd className="tabular text-body text-ink-900">
                  {formatPkr(economics.withoutLedger)}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-cell text-ink-700">With the identity ledger</dt>
                <dd className="tabular text-body text-ink-900">{formatPkr(economics.withLedger)}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-4 border-t border-ink-200 pt-3">
                <dt className="text-body font-medium text-ink-900">Saved on this upload</dt>
                <dd className="tabular text-metric font-bold leading-none text-ok-fg">
                  {formatPkr(economics.saved)}
                </dd>
              </div>
              <div className="flex justify-end">
                <span className="text-cell text-ok-fg">
                  {formatPercent(economics.share)} less
                </span>
              </div>
            </dl>
            <p className="mt-3 border-t border-ink-100 pt-3 text-caption leading-5 text-ink-500">
              {NOTES.costsAreModelled} A from-scratch check for this product is{' '}
              {formatPkr(economics.perHead)} per employee.
            </p>
            <p className="mt-2 text-caption leading-5 text-ink-500">{NOTES.reuseScope}</p>
          </section>

          <section className="card mt-5 p-5">
            <h2 className="text-section font-semibold text-ink-900">Activate</h2>
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => {
                  toast(TOASTS.employeesActivated(split.readyNow.length), 'ok');
                  setStep(2);
                }}
                disabled={split.readyNow.length === 0}
                className="rounded-control bg-navy-700 px-4 py-2 text-cell font-medium text-white transition-colors duration-fast hover:bg-navy-600 disabled:opacity-40"
              >
                Activate {formatCount(split.readyNow.length)} employees now
              </button>
              <button
                type="button"
                onClick={() => {
                  toast(TOASTS.employeesQueued(split.fullOnboarding.length), 'info');
                  setStep(2);
                }}
                disabled={split.fullOnboarding.length === 0}
                className="rounded-control border border-ink-200 px-4 py-2 text-cell font-medium text-ink-700 transition-colors duration-fast hover:bg-ink-100 disabled:opacity-40"
              >
                Queue {formatCount(split.fullOnboarding.length)} for full onboarding
              </button>
              <button
                type="button"
                onClick={() => {
                  setStep(0);
                  setSplit(null);
                  setSegment(null);
                  setFileName(null);
                }}
                className="rounded-control px-4 py-2 text-cell font-medium text-ink-500 transition-colors duration-fast hover:text-ink-900"
              >
                {ACTIONS.chooseFile}
              </button>
            </div>
          </section>

          {segment !== null && (
            <section className="card mt-5 p-5">
              <h2 className="text-section font-semibold text-ink-900">
                {SEGMENTS.find((s) => s.id === segment)?.label}
              </h2>
              {(SEGMENTS.find((s) => s.id === segment)?.list ?? []).length === 0 ? (
                <EmptyState copy={EMPTY.onboardingSegmentEmpty!} compact onAction={() => setSegment(null)} />
              ) : (
                <p className="mt-2 text-cell text-ink-700">
                  {formatCount(SEGMENTS.find((s) => s.id === segment)?.list.length ?? 0)} employees
                  in this group.
                </p>
              )}
            </section>
          )}
        </>
      )}
    </>
  );
}
