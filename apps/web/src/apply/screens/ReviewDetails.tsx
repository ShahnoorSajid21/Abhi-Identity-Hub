import { CheckCircle2 } from 'lucide-react';
import type { VerifyResult } from '../../lib/verify.ts';
import { PRODUCTS } from '../../copy/strings.ts';
import { formatPkr } from '../../lib/format.ts';
import { AttributeDisclosure } from '../../components/AttributeDisclosure.tsx';

/**
 * The ALLOW destination: the product's own review screen.
 *
 * Reached with no capture at all — the customer's existing record satisfied
 * the policy. The screen therefore has to answer the question a customer will
 * actually have: "why didn't you ask me for anything?"
 */
export function ReviewDetails({ result, productId }: { result: VerifyResult; productId: string }) {
  const product = PRODUCTS[productId] ?? productId;
  const disclosed = result.proof?.attributes.map((a) => a.name) ?? result.decision.disclosableAttributes;

  return (
    <section className="card p-6" data-testid="review-details">
      <div className="flex items-start gap-4">
        <CheckCircle2 size={30} className="mt-0.5 shrink-0 text-ok-fg" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h2 className="text-section font-semibold text-ink-900">
            Review your {product} details
          </h2>
          <p className="mt-2 max-w-prose text-body leading-6 text-ink-700">
            Your identity is already confirmed to the level {product} requires, so there was nothing
            further to check. Confirm the details below to continue.
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
        <div>
          <dt className="label-caption">Cost avoided</dt>
          <dd className="tabular mt-1 text-body text-ok-fg">{formatPkr(result.costAvoidedPkr)}</dd>
        </div>
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
          customer or an auditor would think to look. */}
      {result.eCibCalled && (
        <p className="mt-6 border-t border-ink-200 pt-3 text-caption leading-5 text-ink-700">
          Your credit record was still checked with e-CIB for this application. Reusing your
          identity does not reuse your credit assessment.
        </p>
      )}
    </section>
  );
}
