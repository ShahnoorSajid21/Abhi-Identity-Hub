import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, BadgeCheck, Fingerprint, FileCheck2, ScanFace } from 'lucide-react';
import { api, ApiError, type AssuranceLevel, type VerificationMethod } from '../lib/api.ts';
import { formatCount } from '../lib/format.ts';
import { useToast } from '../components/Toast.tsx';
import { CUSTOMER_FACING_PRODUCTS, LEVELS, METHODS, PAGE_TITLES, PRODUCTS } from '../copy/strings.ts';

/**
 * Register a customer the ledger has never seen.
 *
 * This screen did not exist. `/customers/new` resolved to the "still being
 * built" placeholder while POST /kyc/register sat working and unreachable, so
 * the console could read and amend the customer base but never add to it —
 * the one operation the whole ledger begins with.
 *
 * The checks below are what the operator is about to RUN, not what they are
 * claiming. The gateway calls a rail for each one and derives the assurance
 * level from which of them actually succeeded; a client cannot assert A3.
 * The form says so, because an operator who believes these are checkboxes
 * granting a level has misunderstood the control that matters most.
 */

interface Check {
  method: Exclude<VerificationMethod, 'ASSERTED'>;
  attribute: string;
  icon: typeof BadgeCheck;
  detail: string;
}

/** Weakest first, which is also the order the rails run in. */
const CHECKS: Check[] = [
  {
    method: 'VERISYS',
    attribute: 'verisys_match',
    icon: BadgeCheck,
    detail: 'Matches the CNIC against NADRA’s record.',
  },
  {
    method: 'DOC_AUTH',
    attribute: 'document_authenticity_pass',
    icon: FileCheck2,
    detail: 'Confirms the card itself is genuine, not just readable.',
  },
  {
    method: 'BIOMETRIC_1TO1',
    attribute: 'biometric_match',
    icon: Fingerprint,
    detail: 'Matches a fingerprint against the one NADRA holds.',
  },
  {
    method: 'LIVENESS',
    attribute: 'liveness_pass',
    icon: ScanFace,
    detail: 'Confirms a real person is present, not a photograph.',
  },
];

/** What the selected checks would reach, if every one of them passes. */
function levelIfAllPass(selected: Set<string>): AssuranceLevel {
  const has = (m: string) => selected.has(m);
  if (has('VERISYS') && has('DOC_AUTH') && has('BIOMETRIC_1TO1') && has('LIVENESS')) return 'A3';
  if (has('VERISYS') && has('DOC_AUTH') && has('BIOMETRIC_1TO1')) return 'A2';
  if (has('VERISYS') && has('DOC_AUTH')) return 'A1';
  return 'A0';
}

interface Registered {
  subjectId: string;
  assuranceLevel: AssuranceLevel;
  methods: VerificationMethod[];
  railCallsMade: number;
  costSpentPkr: number;
}

export function NewCustomerPage() {
  const navigate = useNavigate();
  const toast = useToast();

  const [cnic, setCnic] = useState('');
  const [expiry, setExpiry] = useState('');
  const [product, setProduct] = useState('EWA');
  const [selected, setSelected] = useState<Set<string>>(
    new Set(['VERISYS', 'DOC_AUTH', 'BIOMETRIC_1TO1']),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Registered | null>(null);

  const digits = cnic.replace(/\D/g, '');
  const cnicValid = digits.length === 13;
  const canSubmit = cnicValid && expiry !== '' && selected.size > 0 && !busy;

  function toggle(method: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(method)) next.delete(method);
      else next.add(method);
      return next;
    });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);

    // Only the selected outcomes are sent as true. The gateway attempts a rail
    // for each true attribute and ignores the rest, so an unticked check is
    // never run and never billed.
    const attributes: Record<string, string | boolean | number> = {};
    for (const c of CHECKS) attributes[c.attribute] = selected.has(c.method);

    try {
      const r = await api.register({
        cnic,
        attributes,
        originProduct: product,
        // The picker gives a date; the ledger wants RFC 3339.
        cnicExpiryAt: `${expiry}T00:00:00Z`,
      });
      setDone(r);
      toast(`Identity confirmed to ${LEVELS[r.assuranceLevel].label.toLowerCase()}.`, 'ok');
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.code) : String(err));
    } finally {
      setBusy(false);
    }
  }

  const field =
    'w-full rounded-control border border-ink-200 px-3 py-2 text-cell text-ink-900 placeholder:text-ink-500 focus:border-mint-500 focus:outline-none focus:ring-2 focus:ring-mint-500/25';

  if (done !== null) {
    return (
      <>
        <h1 className="text-title font-semibold text-white">{PAGE_TITLES.newCustomer}</h1>
        <section className="card mt-5 p-6">
          <p className="text-section font-semibold text-ok-fg">Identity recorded on the ledger</p>
          <dl className="mt-5 grid gap-5 sm:grid-cols-3">
            <div>
              <dt className="label-caption">Confirmation level</dt>
              <dd className="mt-1 text-body font-semibold text-ink-900">
                {LEVELS[done.assuranceLevel].label}
              </dd>
            </div>
            <div>
              <dt className="label-caption">Checks that passed</dt>
              <dd className="mt-1 text-cell text-ink-900">
                {done.methods
                  .filter((m) => m !== 'ASSERTED')
                  .map((m) => METHODS[m] ?? m)
                  .join(', ') || 'None — nothing was verified'}
              </dd>
            </div>
            <div>
              <dt className="label-caption">External checks run</dt>
              <dd className="tabular mt-1 text-cell text-ink-900">
                {formatCount(done.railCallsMade)}
              </dd>
            </div>
          </dl>

          {/* The level is what the rails returned, not what was requested.
              Saying so here is the difference between a demo that survives a
              compliance question and one that does not. */}
          <p className="mt-5 border-t border-ink-100 pt-4 text-caption leading-5 text-ink-500">
            The level above was derived from the checks that actually succeeded. A check that fails
            simply does not count towards it — nothing here was asserted.
          </p>

          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => navigate(`/customers/${done.subjectId}`)}
              className="rounded-control bg-mint-500 px-4 py-2 text-cell font-semibold text-navy-900 transition-colors duration-fast hover:bg-mint-600"
            >
              Open this customer
            </button>
            <button
              type="button"
              onClick={() => {
                setDone(null);
                setCnic('');
                setExpiry('');
              }}
              className="rounded-control border border-ink-200 px-4 py-2 text-cell font-medium text-ink-700 transition-colors duration-fast hover:border-mint-500 hover:text-ink-900"
            >
              Register another
            </button>
          </div>
        </section>
      </>
    );
  }

  return (
    <>
      <Link
        to="/customers"
        className="inline-flex items-center gap-2 text-cell font-medium text-white/70 transition-colors duration-fast hover:text-white"
      >
        <ArrowLeft size={15} />
        Back to customers
      </Link>

      <h1 className="mt-4 text-title font-semibold text-white">{PAGE_TITLES.newCustomer}</h1>
      <p className="mt-1 text-cell text-white/70">
        For a customer the ledger has never seen. Everything is recorded as proof, never as data.
      </p>

      <form onSubmit={submit} className="card mt-5 max-w-3xl p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="label-caption">CNIC</span>
            <input
              value={cnic}
              onChange={(e) => setCnic(e.target.value)}
              placeholder="61101-1234567-8"
              inputMode="numeric"
              autoComplete="off"
              className={`${field} mt-1`}
              aria-invalid={cnic.length > 0 && !cnicValid}
            />
            <span className="mt-1 block text-caption text-ink-500">
              {cnic.length > 0 && !cnicValid
                ? `${digits.length} of 13 digits`
                : 'Never stored. It is turned into an identifier inside the HSM and discarded.'}
            </span>
          </label>

          <label className="block">
            <span className="label-caption">CNIC expiry date</span>
            <input
              type="date"
              value={expiry}
              onChange={(e) => setExpiry(e.target.value)}
              className={`${field} mt-1`}
            />
            <span className="mt-1 block text-caption text-ink-500">
              An expired card is a hard stop for every product.
            </span>
          </label>
        </div>

        <label className="mt-4 block max-w-xs">
          <span className="label-caption">Opening this for</span>
          <select
            value={product}
            onChange={(e) => setProduct(e.target.value)}
            className={`${field} mt-1 bg-white`}
          >
            {CUSTOMER_FACING_PRODUCTS.map((p) => (
              <option key={p} value={p}>
                {PRODUCTS[p] ?? p}
              </option>
            ))}
          </select>
        </label>

        <fieldset className="mt-6">
          <legend className="text-cell font-semibold text-ink-900">Checks to run now</legend>
          <p className="mt-1 text-caption leading-5 text-ink-500">
            Each one calls an external provider. The confirmation level is worked out from the
            checks that pass — it cannot be set here.
          </p>

          <ul className="mt-3 space-y-2">
            {CHECKS.map((c) => (
              <li key={c.method}>
                <label className="flex cursor-pointer items-start gap-3 rounded-control border border-ink-200 p-3 transition-colors duration-fast hover:border-mint-500">
                  <input
                    type="checkbox"
                    checked={selected.has(c.method)}
                    onChange={() => toggle(c.method)}
                    className="mt-1 h-4 w-4 shrink-0 accent-[color:var(--abhi-mint-600)]"
                  />
                  <c.icon size={18} className="mt-0.5 shrink-0 text-mint-700" aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block text-cell font-medium text-ink-900">
                      {METHODS[c.method] ?? c.method}
                    </span>
                    <span className="block text-caption leading-5 text-ink-500">{c.detail}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>

          <p className="mt-3 rounded-control bg-mint-100 px-3 py-2 text-caption text-ok-fg">
            If every selected check passes, this customer reaches{' '}
            <span className="font-semibold">{LEVELS[levelIfAllPass(selected)].label}</span>.{' '}
            {LEVELS[levelIfAllPass(selected)].meaning}
          </p>
        </fieldset>

        {error !== null && (
          <p className="mt-4 rounded-control border border-stop-line bg-stop-bg px-3 py-2 text-cell text-stop-fg">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={!canSubmit}
          className="mt-6 rounded-control bg-mint-500 px-5 py-2.5 text-cell font-semibold text-navy-900 transition-colors duration-fast hover:bg-mint-600 disabled:opacity-40"
        >
          {busy ? 'Running the checks…' : 'Run the checks and record the identity'}
        </button>
      </form>
    </>
  );
}
