import { useCallback, useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { IconRail } from './IconRail.tsx';
import { AppHeader } from './AppHeader.tsx';
import { GlossaryDrawer } from '../components/GlossaryDrawer.tsx';
import { GlossaryContext } from '../lib/glossary.ts';

/**
 * App shell.
 *
 * Structure follows the dashboard reference: a floating icon rail in a 116px
 * gutter, then a single scrolling column holding the header and the content
 * rows. Nothing is fixed to the viewport except the rail, so the header scrolls
 * away with the page exactly as the reference intends.
 *
 * The rail is permanent from lg up and an off-canvas drawer below it. The old
 * shell had no breakpoint at all — a fixed 240px column with a hard
 * `ml-sidebar` on the content — so every viewport under about 1000px had the
 * navigation sitting on top of the page it was navigating.
 */
export function Shell() {
  const [glossaryOpen, setGlossaryOpen] = useState(false);
  const [glossaryFocus, setGlossaryFocus] = useState<string | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();

  const openGlossary = useCallback((entryId?: string) => {
    setGlossaryFocus(entryId ?? null);
    setGlossaryOpen(true);
  }, []);

  const closeNav = useCallback(() => setNavOpen(false), []);

  // A drawer that survives navigation would cover the page it just opened.
  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  // The page behind an open drawer must not scroll under it.
  useEffect(() => {
    if (!navOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [navOpen]);

  return (
    <GlossaryContext.Provider value={openGlossary}>
      <div className="min-h-screen bg-navy-900">
        <IconRail open={navOpen} onClose={closeNav} />

        <div className="lg:pl-24">
          <div className="mx-auto max-w-content px-4 pb-10 sm:px-6 lg:pr-10">
            <AppHeader onOpenGlossary={() => openGlossary()} onOpenNav={() => setNavOpen(true)} />
            <main className="pt-4">
              <Outlet />
            </main>
          </div>
        </div>

        <GlossaryDrawer
          open={glossaryOpen}
          focusId={glossaryFocus}
          onClose={() => setGlossaryOpen(false)}
        />
      </div>
    </GlossaryContext.Provider>
  );
}
