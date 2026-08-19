import { useEffect, useRef, useState } from 'react';
import { HelpCircle, Search } from 'lucide-react';
import { TOP_BAR } from '../copy/strings.ts';
import { SpendMeter } from '../components/SpendMeter.tsx';

/**
 * The top bar.
 *
 * Global search is the primary way the demo navigates, so it takes the
 * keyboard shortcut and the left-hand position. The environment badge is
 * non-dismissible: it is honest, and in a bank it is reassuring — it answers
 * "are those real CNICs?" before anyone asks.
 */
export function TopBar({ onOpenGlossary }: { onOpenGlossary: () => void }) {
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <header className="fixed inset-x-0 left-sidebar top-0 z-30 flex h-topbar items-center gap-4 border-b border-ink-200 bg-white px-6">
      <div className="relative w-[400px] max-w-[40vw]">
        <Search
          size={16}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-500"
        />
        <input
          ref={searchRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={TOP_BAR.searchPlaceholder}
          aria-label={TOP_BAR.searchPlaceholder}
          className="w-full rounded-control border border-ink-200 bg-ink-50 py-1.5 pl-9 pr-16 text-cell text-ink-900 placeholder:text-ink-500 focus:border-mint-600 focus:bg-white focus:outline-none"
        />
        <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-ink-200 bg-white px-1.5 py-0.5 text-[11px] font-medium text-ink-500">
          Ctrl K
        </kbd>
      </div>

      <div className="ml-auto flex items-center gap-4">
        <span className="rounded-pill border border-warn-line bg-warn-bg px-3 py-1 text-caption font-semibold uppercase tracking-wide text-warn-fg">
          {TOP_BAR.environmentBadge}
        </span>

        <SpendMeter />

        <button
          type="button"
          onClick={onOpenGlossary}
          aria-label={TOP_BAR.helpLabel}
          title={TOP_BAR.helpLabel}
          className="rounded-control p-2 text-ink-500 transition-colors duration-fast hover:bg-ink-100 hover:text-ink-900"
        >
          <HelpCircle size={18} />
        </button>
      </div>
    </header>
  );
}
