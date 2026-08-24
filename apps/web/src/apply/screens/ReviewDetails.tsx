import { ArrowLeft, CheckCircle2 } from 'lucide-react';
import type { VerifyResult } from '../../lib/verify.ts';
import { PRODUCTS } from '../../copy/strings.ts';
import { confirmApplication, useApplication } from '../../lib/applications.ts';
import { useToast } from '../../components/Toast.tsx';
import { AttributeDisclosure } from '../../components/AttributeDisclosure.tsx';

/**
 * The application-details screen, and the point at which the application is
 * confirmed.
 *
 * Reached two ways: directly when the customer's existing record already
 * satisfied the policy (nothing to capture), or at the end of a step-up once
 * every outstanding check has been cleared. Either way it answers the question
 * the customer will actually have — "why didn't you ask me for anything?" —
 * and then gives them the two controls the screen was previously missing: a
 * Confirm that records the confirmation, and a Back that does not.
 *
 * Navigation is injected rather than taken with useNavigate, because this
 * screen is mounted bare (no Router) in the step-up routing tests. Confirming
 * still writes the shared application store whether or not a navigation
 * callback was supplied, so the status update never depends on the caller.
 */
export function ReviewDetails({
  result,
  productId,
  steppedUp = false,
  onBack,
  onExit,
}: {
  result: VerifyResult;
  productId: string;
  /**
   * True when this screen was reached by finishing a step-up rather than
   * straight from an ALLOW.
   *
   * The two arrivals need different sentences. "There was nothing further to
   * check" is the whole point on the ALLOW path and simply false on the other,
   * where the customer has just been through a capture — and the reuse figure
   * beside it belongs to the ALLOW path too: it reads 0 after a step-up, which
   * lands as "we reused nothing" directly beneath a banner saying the opposite.
   */
  steppedUp?: boolean;
  /** Pre-confirm Back — a plain history step. Confirms nothing. */
  onBack?: () => void;
  /** Leave for the customer's profile once confirmed. */
  onExit?: () => void;
}) {
  const product = PRODUCTS[productId] ?? productId;
  const toast = useToast();
  const application = useApplication(result.subjectId);
  const confirmed = application?.productId === productId && application.confirmedAt !== null;

  const disclosed =
    result.proof?.attributes.map((a) => a.name) ?? result.decision.disclosableAttributes;

  return (
    <section className="card p-6" data-testid="review-details">
      <div className="flex items-start gap-4">
        <CheckCircle2 size={30} className="mt-0.5 shrink-0 text-ok-fg" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h2 className="text-section font-semibold text-ink-900">
            Review your {product} details
          </h2>
          <p className="mt-2 max-w-prose text-body leading-6 text-ink-700">
            {steppedUp
              ? `That was the only check ${product} still needed — everything else was already on your record. Confirm the details below to continue.`
              : `Your identity is already confirmed to the level ${product} requires, so there was nothing further to check. Confirm the details below to continue.`}
          </p>
        </div>
      </div>

      <dl className="mt-6 grid gap-5 sm:grid-cols-2">
        <div>
          <dt className="label-caption">Confirmation level</dt>
          <dd className="tabular mt-1 text-body font-semibold text-ink-900">
            {result.decision.currentAssurance}
          </dd>
        </div>
        {/* Both of these describe the record as it stood when the journey
            began, so a finished step-up has just made them wrong: the reuse
            count is the ALLOW path's figure, and the age is of a confirmation
            that has since been superseded. The level above is refreshed from
            the ledger's answer; these two are dropped rather than restated
            from a number this screen would have to invent. */}
        {!steppedUp && (
          <>
            <div>
              <dt className="label-caption">Checks you did not have to repeat</dt>
              <dd className="tabular mt-1 text-body font-semibold text-ok-fg">
                {result.railCallsAvoided}
              </dd>
            </div>
            <div>
              <dt className="label-caption">Confirmed</dt>
              <dd className="tabular mt-1 text-body text-ink-900">
                {result.decision.ageDays === null ? '—' : `${result.decision.ageDays} days ago`}
              </dd>
            </div>
          </>
        )}
      </dl>

      <div className="mt-6">
        {/*
          Two different claims, and the difference is not cosmetic.

          With a proof, these attributes really were handed to the product and
          each one is verifiable against the root on the ledger. Without one,
          this is only what the product's policy ENTITLES it to ask for —
          nothing has crossed. Saying "was shown" in both cases would tell a
          compliance audience that a disclosure happened when none did.
        */}
        <h3 className="text-cell font-semibold text-ink-900">
          {result.proof !== null
            ? `What ${product} was shown`
            : `What ${product} may see`}
        </h3>
        {result.proof === null && (
          <p className="mt-1 text-caption leading-5 text-ink-500">
            Handed over only once consent is recorded and a proof is issued.
          </p>
        )}
        <div className="mt-3">
          <AttributeDisclosure disclosed={disclosed} />
        </div>
      </div>

      {/* The credit check is not an identity check and was not skipped. Saying
          so here, next to "we asked you for nothing", is the only place a
          customer or an auditor would think to look.

          The OUTCOME is stated too, not just the fact that it ran. The gateway
          used to return only "it happened", so an adverse credit record and a
          clean one produced the same screen — which quietly invited the reader
          to take a green identity result as an approval. It is not one. */}
      {result.eCibCalled && (
        <p className="mt-6 border-t border-ink-200 pt-3 text-caption leading-5 text-ink-700">
          Your credit record was still checked with e-CIB for this application. Reusing your
          identity does not reuse your credit assessment.
          {result.eCib?.clean === false && (
            <span className="mt-1 block font-medium text-stop-fg">
              That check returned an adverse record. Identity is confirmed; this application
              still needs a credit decision before it can proceed.
            </span>
          )}
        </p>
      )}

      {/* --- Confirm / Back -------------------------------------------- */}
      <div className="mt-6 border-t border-ink-200 pt-5">
        {confirmed ? (
          <div className="flex flex-wrap items-center gap-3" data-testid="application-confirmed">
            <span className="inline-flex items-center gap-2 rounded-pill bg-ok-bg px-3 py-1 text-cell font-medium text-ok-fg">
              <CheckCircle2 size={15} aria-hidden="true" />
              Application confirmed
            </span>
            {onExit !== undefined && (
              <button
                type="button"
                onClick={onExit}
                className="text-cell font-medium text-ink-700 underline underline-offset-2 hover:text-ink-900"
              >
                Back to the customer
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              data-testid="confirm-application"
              onClick={() => {
                confirmApplication(result.subjectId, productId);
                toast(`${product} application confirmed.`, 'ok');
              }}
              className="rounded-control bg-mint-500 px-5 py-2.5 text-cell font-semibold text-navy-900 transition-colors duration-fast hover:bg-mint-600"
            >
              Confirm application
            </button>
            {/* Back returns to the previous screen and confirms nothing, so the
                customer/application context the operator arrived with is
                exactly what they return to. */}
            {onBack !== undefined && (
              <button
                type="button"
                data-testid="back-to-previous"
                onClick={onBack}
                className="inline-flex items-center gap-2 rounded-control border border-ink-200 px-4 py-2.5 text-cell font-medium text-ink-700 transition-colors duration-fast hover:border-mint-500 hover:text-ink-900"
              >
                <ArrowLeft size={15} aria-hidden="true" />
                Back
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
