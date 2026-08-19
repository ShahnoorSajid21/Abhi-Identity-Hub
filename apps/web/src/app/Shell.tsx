import { useCallback, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar.tsx';
import { TopBar } from './TopBar.tsx';
import { GlossaryDrawer } from '../components/GlossaryDrawer.tsx';
import { dashboardSummary } from '../lib/api.ts';
import { useApi } from '../lib/useApi.ts';
import { GlossaryContext } from '../lib/glossary.ts';

/**
 * App shell: fixed 240px sidebar, 56px top bar, content on slate-50 with a
 * 1280px maximum width.
 */
export function Shell() {
  const [glossaryOpen, setGlossaryOpen] = useState(false);
  const [glossaryFocus, setGlossaryFocus] = useState<string | null>(null);

  // Sidebar counts. Returns null until GET /dashboard/summary exists, and the
  // badges are simply absent until then rather than showing a zero.
  const { data: summary } = useApi((signal) => dashboardSummary(signal));

  const openGlossary = useCallback((entryId?: string) => {
    setGlossaryFocus(entryId ?? null);
    setGlossaryOpen(true);
  }, []);

  return (
    <GlossaryContext.Provider value={openGlossary}>
      <div className="min-h-screen bg-ink-50">
        <Sidebar summary={summary} />
        <TopBar onOpenGlossary={() => openGlossary()} />

        <main className="ml-sidebar pt-topbar">
          <div className="mx-auto max-w-content px-6 py-6">
            <Outlet />
          </div>
        </main>

        <GlossaryDrawer
          open={glossaryOpen}
          focusId={glossaryFocus}
          onClose={() => setGlossaryOpen(false)}
        />
      </div>
    </GlossaryContext.Provider>
  );
}
