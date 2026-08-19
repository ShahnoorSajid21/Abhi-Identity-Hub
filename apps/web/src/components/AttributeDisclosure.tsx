import { Check, Lock } from 'lucide-react';
import { ATTRIBUTES, DISCLOSURE } from '../copy/strings.ts';

/**
 * What a product did and did not see.
 *
 * This is what makes selective disclosure legible to somebody who does not
 * know the term. Seeing "Source of funds — Not disclosed" greyed out does more
 * work than any explanation.
 *
 * The full attribute set is the canonical list from packages/merkle; anything
 * not shared is shown explicitly rather than simply omitted. An absence you
 * cannot see proves nothing.
 */

export interface AttributeDisclosureProps {
  /** Attribute names this product was shown. */
  disclosed: string[];
  /** The full set it could have asked for. Defaults to every known attribute. */
  universe?: string[];
  /** Values, where one is available to display. Booleans render as a tick. */
  values?: Record<string, string | boolean | number>;
}

function displayValue(value: string | boolean | number | undefined): string {
  if (value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

export function AttributeDisclosure({
  disclosed,
  universe = Object.keys(ATTRIBUTES),
  values = {},
}: AttributeDisclosureProps) {
  const shared = universe.filter((a) => disclosed.includes(a));
  const withheld = universe.filter((a) => !disclosed.includes(a));

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <section>
        <h3 className="label-caption">{DISCLOSURE.sharedHeading}</h3>
        <ul className="mt-3 space-y-2">
          {shared.map((attribute) => (
            <li
              key={attribute}
              className="flex items-center justify-between gap-3 rounded-control border border-ink-200 bg-white px-3 py-2"
            >
              <span className="min-w-0">
                <span className="block truncate text-cell text-ink-900">
                  {ATTRIBUTES[attribute] ?? attribute}
                </span>
                {values[attribute] !== undefined && (
                  <span className="block truncate text-caption text-ink-500">
                    {displayValue(values[attribute])}
                  </span>
                )}
              </span>
              <span className="inline-flex shrink-0 items-center gap-1 rounded-pill bg-ok-bg px-2 py-0.5 text-caption font-medium text-ok-fg">
                <Check size={12} />
                {DISCLOSURE.provenChip}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3 className="label-caption">{DISCLOSURE.notSharedHeading}</h3>
        <ul className="mt-3 space-y-2">
          {withheld.map((attribute) => (
            <li
              key={attribute}
              className="flex items-center justify-between gap-3 rounded-control border border-ink-200 bg-ink-50 px-3 py-2"
            >
              <span className="min-w-0 truncate text-cell text-ink-500">
                {ATTRIBUTES[attribute] ?? attribute}
              </span>
              <span className="inline-flex shrink-0 items-center gap-1 text-caption text-ink-500">
                <Lock size={12} />
                {DISCLOSURE.notDisclosedLabel}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
