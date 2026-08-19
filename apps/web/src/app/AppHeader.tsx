import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, HelpCircle, Menu, Search } from 'lucide-react';
import { TOP_BAR } from '../copy/strings.ts';
import { usePersona } from '../lib/useApi.ts';
import { SpendMeter } from '../components/SpendMeter.tsx';
import { AbhiLogo } from './AbhiLogo.tsx';

/**
 * The page header.
 *
 * Layout follows the dashboard reference: a greeting block on the left, and a
 * 70px-tall pill search with circular icon buttons on the right. The reference
 * has no product identity in the header at all — its logo sits above the rail —
 * so the ABHI lockup takes that slot here, which is also where a bank's
 * identity is expected to be.
 *
 * Search now navigates. It previously tracked its own state and did nothing
 * with it, which made the app's headline navigation control inert.
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

  // The greeting names the signed-in persona, so switching identity is visible
  // in the chrome and not only in what the ledger allows.
  const firstName = persona.name.split(' ')[0] ?? persona.name;

  return (
    <header className="flex flex-wrap items-start gap-x-6 gap-y-5 pb-2 pt-8">
      <button
        type="button"
        onClick={onOpenNav}
        aria-label="Open navigation"
        aria-controls="app-rail"
        className="-ml-1 shrink-0 rounded-full p-2.5 text-white/80 transition-colors duration-fast hover:bg-navy-700 hover:text-white lg:hidden"
      >
        <Menu size={22} />
      </button>

      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-6 gap-y-4">
        <AbhiLogo className="h-[54px] w-auto shrink-0" />

        <div className="min-w-0">
          <h1 className="truncate text-[28px] font-semibold leading-9 text-white">
            Hello, {firstName}
          </h1>
          <p className="mt-0.5 truncate text-cell text-white/65">
            {persona.title} · what identity records can tell you today
          </p>
        </div>
      </div>

      <div className="flex w-full items-center gap-3 sm:w-auto">
        <form onSubmit={submit} role="search" className="relative min-w-0 flex-1 sm:w-[360px]">
          <Search
            size={17}
            className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-white/45"
          />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={TOP_BAR.searchPlaceholder}
            aria-label={TOP_BAR.searchPlaceholder}
            className="h-[60px] w-full rounded-pill border border-navy-600 bg-navy-800 pl-12 pr-[60px] text-cell text-white transition-shadow duration-fast placeholder:text-white/45 focus:border-mint-500 focus:outline-none focus:ring-4 focus:ring-mint-500/25"
          />
          <button
            type="submit"
            aria-label="Search"
            className="absolute right-1.5 top-1/2 flex h-[48px] w-[48px] -translate-y-1/2 items-center justify-center rounded-full bg-mint-500 text-navy-900 transition-colors duration-fast hover:bg-mint-600"
          >
            <Search size={19} />
          </button>
        </form>

        <SpendMeter />

        <button
          type="button"
          onClick={onOpenGlossary}
          aria-label={TOP_BAR.helpLabel}
          title={TOP_BAR.helpLabel}
          className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full border border-navy-600 bg-navy-800 text-white/75 transition-colors duration-fast hover:border-mint-500 hover:text-white"
        >
          <HelpCircle size={20} />
        </button>

        {/* Non-dismissible environment notice. It is honest, and in a bank it is
            reassuring — it answers "are those real CNICs?" before anyone asks.
            The reference's notification bell carries it, so the badge is a dot
            rather than a word once the viewport gets tight. */}
        <span
          title={TOP_BAR.environmentBadge}
          className="relative hidden h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full border border-navy-600 bg-navy-800 text-white/75 sm:flex"
        >
          <Bell size={20} aria-hidden="true" />
          <span className="absolute right-3.5 top-3.5 h-2.5 w-2.5 rounded-full bg-warn-line ring-2 ring-navy-800" />
          <span className="sr-only">{TOP_BAR.environmentBadge}</span>
        </span>
      </div>
    </header>
  );
}
