import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Search, ShieldX, Snowflake, Trash2 } from 'lucide-react';
import { api, directory, ApiError, type CustomerDetail } from '../lib/api.ts';
import { usePersona } from '../lib/useApi.ts';
import { useToast } from '../components/Toast.tsx';
import { formatDate } from '../lib/format.ts';
import { ACTIONS, EMPTY, NOTES, PAGE_TITLES, PRODUCTS, TABS, TOASTS } from '../copy/strings.ts';
import { IdentityStatus } from '../components/IdentityStatus.tsx';
import { StatusChip } from '../components/StatusChip.tsx';
import { EmptyState } from '../components/EmptyState.tsx';
import { TechnicalDetail, TechnicalRow } from '../components/TechnicalDetail.tsx';
import { Avatar } from '../components/Avatar.tsx';

/**
 * Compliance actions.
 *
 * Note the shape of this screen, which is dictated by the API rather than by
 * preference: freeze, reinstate and erasure all take a CNIC, while every other
 * screen addresses a customer by subject id. So the officer types the CNIC
 * here, it is resolved once, and it lives in component state for the length of
 * the action — never in the URL, never in a link, never in history.
 *
 * The two moments this screen exists for:
 *   1. One freeze, every product refuses, no integration work anywhere.
 *   2. The same write attempted as Lending, refused BY THE LEDGER.
 */

/** The products a freeze propagates to. Read for display only. */
const AFFECTED = ['EWA', 'ASA', 'SBL', 'MERCHANT_FINANCING', 'EMPLOYER_BULK'];

type Tab = 'freeze' | 'erasure';

export function CompliancePage() {
  const persona = usePersona();
  const toast = useToast();

  const [tab, setTab] = useState<Tab>('freeze');
  const [cnic, setCnic] = useState('');
  const [searching, setSearching] = useState(false);
  const [subject, setSubject] = useState<{ subjectId: string; detail: CustomerDetail } | null>(null);
  const [searchError, setSearchError] = useState<unknown>(null);

  const [reason, setReason] = useState('Sanctions screening match under review');
  const [legalBasis, setLegalBasis] = useState('Customer request under data protection policy');
  const [busy, setBusy] = useState(false);
  const [rejection, setRejection] = useState<ApiError | null>(null);
  const [frozenTiles, setFrozenTiles] = useState<number>(-1);
  const [erased, setErased] = useState(false);

  async function find() {
    setSearching(true);
    setSearchError(null);
    setSubject(null);
    setRejection(null);
    setFrozenTiles(-1);
    setErased(false);
    try {
      const { subjectId } = await directory.subjectIdFor(cnic);
      const detail = await directory.customer(subjectId);
      setSubject({ subjectId, detail });
    } catch (e) {
      setSearchError(e);
    } finally {
      setSearching(false);
    }
  }

  /**
   * Run the five tiles green→red, staggered.
   *
   * Slow enough to read from the back of a room, fast enough not to feel like
   * a screensaver. Reduced-motion users get the end state immediately, which
   * the token file already handles for the transition itself.
   */
  useEffect(() => {
    if (frozenTiles < 0 || frozenTiles >= AFFECTED.length) return;
    const timer = window.setTimeout(() => setFrozenTiles((n) => n + 1), 120);
    return () => window.clearTimeout(timer);
  }, [frozenTiles]);

  async function freeze() {
    if (subject === null) return;
    setBusy(true);
    setRejection(null);
    try {
      await api.suspend({ cnic, reason, referenceId: `CASE-${Date.now().toString().slice(-6)}` });
      toast(TOASTS.customerFrozen(subject.detail.cbsProfile.displayName), 'stop');
      setFrozenTiles(0);
      const detail = await directory.customer(subject.subjectId);
      setSubject({ ...subject, detail });
    } catch (e) {
      // Not an error state to apologise for — it is the control working, and
      // it is the most convincing three seconds in the demo.
      if (e instanceof ApiError) setRejection(e);
    } finally {
      setBusy(false);
    }
  }

  async function reinstate() {
    if (subject === null) return;
    setBusy(true);
    setRejection(null);
    try {
      await api.reinstate({ cnic, reason: 'Review closed, no match', referenceId: `CASE-${Date.now().toString().slice(-6)}` });
      toast(TOASTS.customerReinstated(subject.detail.cbsProfile.displayName), 'ok');
      setFrozenTiles(-1);
      const detail = await directory.customer(subject.subjectId);
      setSubject({ ...subject, detail });
    } catch (e) {
      if (e instanceof ApiError) setRejection(e);
    } finally {
      setBusy(false);
    }
  }

  async function erase() {
    if (subject === null) return;
    setBusy(true);
    setRejection(null);
    try {
      await api.shred({ cnic, reason: 'Customer erasure request', legalBasis });
      toast(TOASTS.dataErased(subject.detail.cbsProfile.displayName), 'ok');
      setErased(true);
      const detail = await directory.customer(subject.subjectId);
      setSubject({ ...subject, detail });
    } catch (e) {
      if (e instanceof ApiError) setRejection(e);
    } finally {
      setBusy(false);
    }
  }

  const record = subject?.detail.record;
  const isFrozen = record?.status === 'SUSPENDED';

  return (
    <>
      <h1 className="text-title font-semibold text-white">{PAGE_TITLES.compliance}</h1>

      <div className="mt-5 flex gap-1 border-b border-navy-600">
        {([
          { id: 'freeze' as const, label: TABS.freezeReinstate },
          { id: 'erasure' as const, label: TABS.erasureRequests },
        ]).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-4 py-2.5 text-cell font-medium transition-colors duration-fast ${
              tab === t.id
                ? 'border-mint-500 text-white'
                : 'border-transparent text-white/60 hover:text-white'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* --- Find the customer ------------------------------------------ */}
      <section className="card mt-5 p-5">
        <label className="block">
          <span className="label-caption">Find a customer by CNIC</span>
          <div className="mt-2 flex flex-wrap gap-2">
            <input
              value={cnic}
              onChange={(e) => setCnic(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void find();
              }}
              placeholder="61101-1234567-8"
              className="min-w-[240px] flex-1 rounded-control border border-ink-200 px-3 py-2 text-cell text-ink-900 placeholder:text-ink-500 focus:border-mint-600 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => void find()}
              disabled={cnic.trim().length === 0 || searching}
              className="inline-flex items-center gap-2 rounded-control bg-navy-700 px-4 py-2 text-cell font-medium text-white transition-colors duration-fast hover:bg-navy-600 disabled:opacity-40"
            >
              <Search size={15} />
              {searching ? 'Searching…' : 'Find customer'}
            </button>
          </div>
        </label>
        <p className="mt-2 text-caption text-ink-500">
          The CNIC is used to locate the record and is not stored by this screen or placed in the
          address bar.
        </p>

        {searchError !== null && (
          <p className="mt-3 rounded-control border border-stop-line bg-stop-bg px-3 py-2 text-cell text-stop-fg">
            No customer found for that CNIC.
          </p>
        )}
      </section>

      {subject === null ? (
        <div className="card mt-5">
          <EmptyState copy={EMPTY.complianceNoSelection!} />
        </div>
      ) : (
        <div className="mt-5 grid gap-5 lg:grid-cols-3">
          <div className="space-y-5 lg:col-span-2">
            {/* --- The customer ---------------------------------------- */}
            <section className="card p-5">
              <div className="flex flex-wrap items-start gap-4">
                <Avatar
                  name={subject.detail.cbsProfile.displayName}
                  seed={subject.detail.cbsProfile.avatarSeed}
                  size={44}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-3">
                    <Link
                      to={`/customers/${subject.subjectId}`}
                      className="text-section font-semibold text-ink-900 hover:underline"
                    >
                      {subject.detail.cbsProfile.displayName}
                    </Link>
                    {record?.status != null && <StatusChip status={record.status} />}
                  </div>
                  <p className="text-cell text-ink-500">
                    {subject.detail.cbsProfile.designation} · {subject.detail.cbsProfile.employer}
                  </p>
                </div>
              </div>

              {record?.found === true && record.assuranceLevel !== null && (
                <div className="mt-4">
                  <IdentityStatus
                    level={record.assuranceLevel}
                    verifiedAt={record.verifiedAt}
                    cnicExpiryAt={record.cnicExpiryAt}
                  />
                </div>
              )}
            </section>

            {/* --- The action ------------------------------------------- */}
            {tab === 'freeze' ? (
              <section className="card p-5">
                <h2 className="text-section font-semibold text-ink-900">
                  {isFrozen ? 'Reinstate this customer' : 'Freeze this customer'}
                </h2>

                <label className="mt-4 block">
                  <span className="label-caption">Reason</span>
                  <input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    className="mt-1 w-full rounded-control border border-ink-200 px-3 py-2 text-cell text-ink-900 focus:border-mint-600 focus:outline-none"
                  />
                </label>

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  {isFrozen ? (
                    <button
                      type="button"
                      onClick={() => void reinstate()}
                      disabled={!persona.canFreeze || busy}
                      title={persona.canFreeze ? undefined : NOTES.freezeRestricted}
                      className="rounded-control bg-ok-fg px-4 py-2 text-cell font-medium text-white transition-opacity duration-fast hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {ACTIONS.reinstate}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void freeze()}
                      disabled={!persona.canFreeze || busy}
                      title={persona.canFreeze ? undefined : NOTES.freezeRestricted}
                      className="inline-flex items-center gap-2 rounded-control bg-stop-line px-4 py-2 text-cell font-medium text-white transition-opacity duration-fast hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Snowflake size={15} />
                      {ACTIONS.freezeCustomer}
                    </button>
                  )}

                  {/* The demo's sharpest moment: let a Lending sign-in try it
                      and watch the server refuse. The UI never pretends to be
                      the control. */}
                  {!persona.canFreeze && (
                    <button
                      type="button"
                      onClick={() => void (isFrozen ? reinstate() : freeze())}
                      disabled={busy}
                      className="text-cell font-medium text-ink-500 underline underline-offset-2 transition-colors duration-fast hover:text-ink-900"
                    >
                      {ACTIONS.attemptAnyway}
                    </button>
                  )}
                </div>

                {!persona.canFreeze && (
                  <p className="mt-3 flex items-start gap-2 text-caption leading-5 text-ink-500">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                    {NOTES.freezeRestricted}
                  </p>
                )}

                {rejection !== null && (
                  <div className="mt-4 rounded-card border-l-4 border-y border-r border-stop-line bg-stop-bg p-4">
                    <p className="flex items-center gap-2 text-body font-semibold text-stop-fg">
                      <ShieldX size={18} />
                      The record refused this change
                    </p>
                    <p className="mt-1 text-cell leading-6 text-ink-900">
                      A change to a customer’s identity has to be approved by Compliance together
                      with the team making it. This one was not, so nothing was recorded.
                    </p>
                    <TechnicalDetail>
                      <TechnicalRow label="Error code">{rejection.code}</TechnicalRow>
                      <TechnicalRow label="HTTP status">{rejection.status}</TechnicalRow>
                      {rejection.detail !== null && (
                        <TechnicalRow label="Detail">{rejection.detail}</TechnicalRow>
                      )}
                      <TechnicalRow label="Signed in as">
                        {persona.mspId} · {persona.role}
                      </TechnicalRow>
                    </TechnicalDetail>
                  </div>
                )}

                {/* --- Propagation ------------------------------------- */}
                {frozenTiles >= 0 && (
                  <div className="mt-6">
                    <p className="label-caption">Products that just changed state</p>
                    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
                      {AFFECTED.map((productId, i) => {
                        const flipped = i < frozenTiles;
                        return (
                          <div
                            key={productId}
                            className={`rounded-card border p-3 text-center transition-all duration-panel ${
                              flipped
                                ? 'scale-100 border-stop-line bg-stop-bg text-stop-fg'
                                : 'scale-[0.98] border-ok-line bg-ok-bg text-ok-fg'
                            }`}
                          >
                            <p className="text-caption font-medium leading-4">
                              {PRODUCTS[productId] ?? productId}
                            </p>
                            <p className="mt-1 text-caption font-semibold">
                              {flipped ? 'Refusing' : 'Allowing'}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                    <p className="mt-3 text-body font-medium text-ink-900">
                      {NOTES.freezePropagation}
                    </p>
                  </div>
                )}
              </section>
            ) : (
              <section className="card p-5">
                <h2 className="text-section font-semibold text-ink-900">Erase personal data</h2>
                <p className="mt-2 text-cell leading-6 text-ink-700">
                  This permanently destroys the customer’s personal details. The record that a
                  verification took place is kept, because the bank is separately required to keep
                  it. Nothing erased can be recovered by anyone, including ABHI.
                </p>

                <label className="mt-4 block">
                  <span className="label-caption">Legal basis</span>
                  <input
                    value={legalBasis}
                    onChange={(e) => setLegalBasis(e.target.value)}
                    className="mt-1 w-full rounded-control border border-ink-200 px-3 py-2 text-cell text-ink-900 focus:border-mint-600 focus:outline-none"
                  />
                </label>

                <button
                  type="button"
                  onClick={() => void erase()}
                  disabled={!persona.canFreeze || busy || erased}
                  title={persona.canFreeze ? undefined : NOTES.freezeRestricted}
                  className="mt-4 inline-flex items-center gap-2 rounded-control bg-stop-line px-4 py-2 text-cell font-medium text-white transition-opacity duration-fast hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Trash2 size={15} />
                  {ACTIONS.erase}
                </button>

                {erased && (
                  <div className="mt-5 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-card border border-ink-200 bg-ink-50 p-4">
                      <p className="label-caption">Secure store</p>
                      <p className="mt-2 text-body font-semibold text-ink-900">Empty</p>
                      <p className="mt-1 text-cell text-ink-500">
                        The personal details are gone.
                      </p>
                    </div>
                    <div className="rounded-card border border-mint-300 bg-mint-100 p-4">
                      <p className="label-caption">Identity record</p>
                      <p className="mt-2 text-body font-semibold text-ink-900">Still present</p>
                      <p className="mt-1 text-cell text-ink-700">
                        Status {record?.status === 'SHREDDED' ? 'Erased' : record?.status} · the
                        proof of verification is intact.
                      </p>
                    </div>
                    <p className="text-caption leading-5 text-ink-500 sm:col-span-2">
                      {NOTES.erasureResult}
                    </p>
                  </div>
                )}

                {rejection !== null && (
                  <div className="mt-4 rounded-card border border-stop-line bg-stop-bg p-4">
                    <p className="flex items-center gap-2 text-body font-semibold text-stop-fg">
                      <ShieldX size={18} />
                      The record refused this change
                    </p>
                    <TechnicalDetail>
                      <TechnicalRow label="Error code">{rejection.code}</TechnicalRow>
                      <TechnicalRow label="HTTP status">{rejection.status}</TechnicalRow>
                    </TechnicalDetail>
                  </div>
                )}
              </section>
            )}
          </div>

          <aside className="card h-fit p-5">
            <h2 className="text-section font-semibold text-ink-900">What a freeze does</h2>
            <ul className="mt-3 space-y-2 text-cell leading-6 text-ink-700">
              <li>Every product refuses the customer from that moment on.</li>
              <li>No product team has to change anything.</li>
              <li>The action is recorded and cannot be edited or removed.</li>
              <li>Only Compliance can do it, and the ledger is what enforces that.</li>
            </ul>
            {record?.cnicExpiryAt != null && (
              <p className="mt-4 border-t border-ink-100 pt-3 text-caption text-ink-500">
                CNIC valid until {formatDate(record.cnicExpiryAt)}
              </p>
            )}
          </aside>
        </div>
      )}
    </>
  );
}
