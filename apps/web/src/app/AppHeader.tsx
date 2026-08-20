import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, HelpCircle, Menu, Search } from 'lucide-react';
import { TOP_BAR } from '../copy/strings.ts';
import { usePersona } from '../lib/useApi.ts';

/**
 * The page header.
 *
 * Structure is the reference header (node 19:219): a title block on the left,
 * then a pill search and circular icon buttons on the right.
 *
 * The reference's absolute sizes are NOT copied. It draws a 1440px frame, where
 * a 70px search and 32px greeting are proportionate; at the ~1900px this console
 * actually runs at they read oversized and unprofessional. The proportions are
 * kept and the scale is dropped one step: a 46px search with a 36px button, and
 * 46px icon buttons.
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
    <header className="flex flex-wrap items-center gap-x-8 gap-y-5 pb-1 pt-7">
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
        <h1 className="truncate text-title font-semibold text-white">
          Hello, {firstName}!
        </h1>
        {/* The persona's role, and nothing else. The previous line ran to a
            sentence that the header could not fit and clipped mid-word. */}
        <p className="truncate text-cell leading-5 text-white/65">{persona.title}</p>
      </div>

      <div className="flex w-full items-center gap-3 sm:w-auto">
        <form onSubmit={submit} role="search" className="relative min-w-0 flex-1 sm:w-[340px]">
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={TOP_BAR.searchPlaceholder}
            aria-label={TOP_BAR.searchPlaceholder}
            className="h-[46px] w-full rounded-pill border border-navy-600 bg-navy-800 pl-4 pr-[46px] text-cell text-white transition-shadow duration-fast placeholder:text-white/45 focus:border-mint-500 focus:outline-none focus:ring-4 focus:ring-mint-500/25"
          />
          <button
            type="submit"
            aria-label="Search"
            className="absolute right-[5px] top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-mint-500 text-navy-900 transition-colors duration-fast hover:bg-mint-600"
          >
            <Search size={17} />
          </button>
        </form>

        <button
          type="button"
          onClick={onOpenGlossary}
          aria-label={TOP_BAR.helpLabel}
          title={TOP_BAR.helpLabel}
          className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-full border border-navy-600 bg-navy-800 text-white/75 transition-colors duration-fast hover:border-mint-500 hover:text-white"
        >
          <HelpCircle size={19} />
        </button>

        {/* Non-dismissible environment notice, carried on the reference's
            notification button. It is honest, and in a bank it is reassuring —
            it answers "are those real CNICs?" before anyone asks. */}
        <span
          title={TOP_BAR.environmentBadge}
          className="relative hidden h-[46px] w-[46px] shrink-0 items-center justify-center rounded-full border border-navy-600 bg-navy-800 text-white/75 sm:flex"
        >
          <Bell size={19} aria-hidden="true" />
          <span className="absolute right-3 top-3 h-2.5 w-2.5 rounded-full bg-warn-line ring-2 ring-navy-800" />
          <span className="sr-only">{TOP_BAR.environmentBadge}</span>
        </span>
      </div>
    </header>
  );
}
