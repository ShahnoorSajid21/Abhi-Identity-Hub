import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { GLOSSARY, GLOSSARY_INTRO } from '../copy/strings.ts';

/**
 * The glossary drawer.
 *
 * This is what lets a curious non-technical attendee self-serve instead of
 * interrupting. Opened from the top bar, or from any "What does this mean?"
 * link with the relevant entry scrolled into view and briefly highlighted.
 */
export function GlossaryDrawer({
  open,
  focusId,
  onClose,
}: {
  open: boolean;
  focusId: string | null;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || focusId === null) return;
    const el = panelRef.current?.querySelector(`#glossary-${focusId}`);
    el?.scrollIntoView({ block: 'start' });
  }, [open, focusId]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-navy-900/40"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-label="What these terms mean"
        className="relative flex h-full w-[440px] max-w-full flex-col overflow-y-auto bg-white shadow-2xl"
      >
        <div className="sticky top-0 flex items-start justify-between gap-4 border-b border-ink-200 bg-white px-6 py-4">
          <div>
            <h2 className="text-section font-semibold text-ink-900">What these terms mean</h2>
            <p className="mt-1 text-cell text-ink-500">{GLOSSARY_INTRO}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-control p-1 text-ink-500 transition-colors duration-fast hover:bg-ink-100 hover:text-ink-900"
          >
            <X size={18} />
          </button>
        </div>

        <dl className="divide-y divide-ink-100">
          {GLOSSARY.map((entry) => (
            <div
              key={entry.id}
              id={`glossary-${entry.id}`}
              className={`px-6 py-4 ${entry.id === focusId ? 'bg-mint-100' : ''}`}
            >
              <dt className="flex flex-wrap items-baseline gap-2">
                <span className="text-body font-semibold text-ink-900">{entry.term}</span>
                {entry.alsoKnownAs !== undefined && (
                  <span className="text-caption text-ink-500">also called {entry.alsoKnownAs}</span>
                )}
              </dt>
              <dd className="mt-1 text-cell leading-6 text-ink-700">{entry.definition}</dd>
              {entry.related !== undefined && entry.related.length > 0 && (
                <dd className="mt-3 flex flex-wrap gap-2">
                  {entry.related.map((relatedId) => {
                    const target = GLOSSARY.find((g) => g.id === relatedId);
                    if (target === undefined) return null;
                    return (
                      <a
                        key={relatedId}
                        href={`#glossary-${relatedId}`}
                        className="rounded-pill bg-ink-100 px-3 py-1 text-caption font-medium text-ink-700 transition-colors duration-fast hover:bg-ink-200"
                      >
                        {target.term}
                      </a>
                    );
                  })}
                </dd>
              )}
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
