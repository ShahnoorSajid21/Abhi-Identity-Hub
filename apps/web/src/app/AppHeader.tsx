import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, HelpCircle, Menu, Search } from 'lucide-react';
import { TOP_BAR } from '../copy/strings.ts';
import { usePersona } from '../lib/useApi.ts';

/**
 * The page header.
 *
 * Geometry is the reference header exactly (node 19:219): a title block of
 * 32px medium over 20px regular at 0.6px tracking with an 8px gap, then a
 * 12px-gap cluster holding a 425px search pill of radius 180 — 7px padding
 * around a 56px circular button, which is what makes it 70px tall — followed
 * by two 70px circular icon buttons.
 *
 * The reference carries no product identity here; its logo sits above the rail,
 * and so does ABHI's.
 *
 * Search now navigates. It previously tracked its own state and never used it,
 * which made the app's headline navigation control inert.
 */
export function AppHeader({
  onOpenGlossary,
  onOpenNav,
}: {
  onOpenGlossary: () => void;
  onOpenNav: () => void;
}) {
  const searchRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const persona = usePersona();
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

  function submit(e: FormEvent) {
    e.preventDefault();
    const term = query.trim();
    // An empty search means "show me everyone", which is the unfiltered
    // directory — not a no-op that strands the user where they were.
    navigate(term.length > 0 ? `/customers?q=${encodeURIComponent(term)}` : '/customers');
    searchRef.current?.blur();
  }

  const firstName = persona.name.split(' ')[0] ?? persona.name;

  return (
    <header className="flex flex-wrap items-center gap-x-10 gap-y-6 pb-2 pt-11">
      <button
        type="button"
        onClick={onOpenNav}
        aria-label="Open navigation"
        aria-controls="app-rail"
        className="-ml-1 shrink-0 rounded-full p-2.5 text-white/80 transition-colors duration-fast hover:bg-navy-700 hover:text-white lg:hidden"
      >
        <Menu size={22} />
      </button>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <h1 className="truncate text-[32px] font-medium leading-none text-white">
          Hello, {firstName}!
        </h1>
        <p className="truncate text-[20px] leading-none tracking-[0.6px] text-white/70">
          {persona.title} · what identity records can tell you today
        </p>
      </div>

      <div className="flex w-full items-center gap-3 sm:w-auto">
        <form onSubmit={submit} role="search" className="relative min-w-0 flex-1 sm:w-[425px]">
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={TOP_BAR.searchPlaceholder}
            aria-label={TOP_BAR.searchPlaceholder}
            className="h-[70px] w-full rounded-[180px] border border-navy-600 bg-navy-800 pl-[22px] pr-[70px] text-[16px] tracking-[0.48px] text-white transition-shadow duration-fast placeholder:text-white/45 focus:border-mint-500 focus:outline-none focus:ring-4 focus:ring-mint-500/25"
          />
          <button
            type="submit"
            aria-label="Search"
            className="absolute right-[7px] top-1/2 flex h-[56px] w-[56px] -translate-y-1/2 items-center justify-center rounded-full bg-mint-500 text-navy-900 transition-colors duration-fast hover:bg-mint-600"
          >
            <Search size={24} />
          </button>
        </form>

        <button
          type="button"
          onClick={onOpenGlossary}
          aria-label={TOP_BAR.helpLabel}
          title={TOP_BAR.helpLabel}
          className="flex h-[70px] w-[70px] shrink-0 items-center justify-center rounded-full border border-navy-600 bg-navy-800 text-white/75 transition-colors duration-fast hover:border-mint-500 hover:text-white"
        >
          <HelpCircle size={30} />
        </button>

        {/* Non-dismissible environment notice, carried on the reference's
            notification button. It is honest, and in a bank it is reassuring —
            it answers "are those real CNICs?" before anyone asks. */}
        <span
          title={TOP_BAR.environmentBadge}
          className="relative hidden h-[70px] w-[70px] shrink-0 items-center justify-center rounded-full border border-navy-600 bg-navy-800 text-white/75 sm:flex"
        >
          <Bell size={30} aria-hidden="true" />
          <span className="absolute right-5 top-5 h-3 w-3 rounded-full bg-warn-line ring-2 ring-navy-800" />
          <span className="sr-only">{TOP_BAR.environmentBadge}</span>
        </span>
      </div>
    </header>
  );
}
