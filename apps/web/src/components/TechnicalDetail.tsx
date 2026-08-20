import { useEffect, useState, type ReactNode } from 'react';
import { ChevronRight, Copy } from 'lucide-react';
import { ACTIONS } from '../copy/strings.ts';
import { shortenId } from '../lib/format.ts';

/**
 * The expander that keeps every hash, identifier and organisation name off the
 * visible surface without hiding any of it.
 *
 * Collapsed by default everywhere. The open/closed choice is remembered for
 * the session, so a presenter can expand it once for an engineering audience
 * and have it stay expanded as they move around the app.
 */

const STORAGE_KEY = 'abhi.technicalDetail.open';

function readStored(): boolean {
  try {
    return sessionStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function TechnicalDetail({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(readStored);

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, String(open));
    } catch {
      // Remembering the preference is a nicety, not a requirement.
    }
  }, [open]);

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-1 text-caption font-medium text-ink-500 transition-colors duration-fast hover:text-ink-700"
      >
        <ChevronRight
          size={14}
          className={`transition-transform duration-fast ${open ? 'rotate-90' : ''}`}
        />
        {ACTIONS.technicalDetail}
      </button>

      {open && (
        <div className="mt-2 rounded-control border border-ink-200 bg-ink-50 p-4 font-mono text-caption leading-5 tracking-normal text-ink-700">
          {children}
        </div>
      )}
    </div>
  );
}

/** One labelled row inside the expander. */
export function TechnicalRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-1">
      <span className="w-48 shrink-0 font-sans text-caption text-ink-500">{label}</span>
      <span className="min-w-0 break-all">{children}</span>
    </div>
  );
}

/** A long identifier, shortened, with the full value one click away. */
export function CopyableId({ value, onCopied }: { value: string; onCopied?: () => void }) {
  return (
    <button
      type="button"
      title={value}
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => onCopied?.());
      }}
      className="inline-flex items-center gap-1.5 rounded px-1 font-mono transition-colors duration-fast hover:bg-ink-200"
    >
      {shortenId(value)}
      <Copy size={12} className="text-ink-500" />
    </button>
  );
}
