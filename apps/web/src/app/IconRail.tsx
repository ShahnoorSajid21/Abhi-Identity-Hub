import { useEffect, useRef } from 'react';
import { Link, NavLink } from 'react-router-dom';
import {
  ClipboardList,
  Flag,
  Home,
  ScrollText,
  Settings,
  Upload,
  Users,
  X,
} from 'lucide-react';
import { NAV } from '../copy/strings.ts';
import { RailAvatar } from './RailAvatar.tsx';
import { AbhiMark } from './AbhiLogo.tsx';

/**
 * The floating icon rail.
 *
 * Geometry follows the dashboard reference, rescaled: the reference draws a
 * 76px column with 60px targets on a 1440px frame, which reads oversized on
 * the ~1900px viewports this console runs on. Proportions are kept; the column
 * is 64px with 48px targets. The reference marks the active item with a
 * near-black disc on a white rail; here it is a mint disc on a navy rail — the
 * same figure/ground move carried into ABHI's palette, and navy-on-mint
 * measures 9.1:1 where the reference's white-on-mint would have been 2.0:1.
 *
 * The rail carries NO count badges. Queue depth and compliance holds each had
 * one, and at 48px a chip large enough to read sat on top of the glyph it was
 * annotating — two competing colours fighting the active state for attention
 * in a 64px column. Both numbers already lead the screens they point at: the
 * queue's tab counts and the dashboard's "Waiting on a check" card. A rail is
 * for getting somewhere, not for reporting.
 *
 * Icon-only navigation is a real accessibility risk, so every target carries
 * an accessible name AND a hover tooltip. The label is not optional
 * decoration: a compliance officer who cannot tell "Compliance" from "Audit"
 * by glyph alone has been given a puzzle, not a console.
 */

interface RailItem {
  to: string;
  label: string;
  icon: typeof Home;
  end?: boolean;
}

const PRIMARY: RailItem[] = [
  { to: '/', label: NAV.dashboard, icon: Home, end: true },
  { to: '/customers', label: NAV.customers, icon: Users },
  { to: '/queue', label: NAV.queue, icon: ClipboardList },
  { to: '/onboarding', label: NAV.onboarding, icon: Upload },
  { to: '/compliance', label: NAV.compliance, icon: Flag },
  { to: '/audit', label: NAV.audit, icon: ScrollText },
  { to: '/settings/policies', label: NAV.settings, icon: Settings },
];

function RailLink({ item, onNavigate }: { item: RailItem; onNavigate: () => void }) {
  return (
    <li className="relative">
      <NavLink
        to={item.to}
        end={item.end ?? false}
        onClick={onNavigate}
        title={item.label}
        className={({ isActive }) =>
          [
            'group relative flex h-12 w-12 items-center justify-center rounded-full',
            'transition-colors duration-fast',
            isActive
              ? 'bg-mint-500 text-navy-900'
              : 'text-white/70 hover:bg-navy-700 hover:text-white',
          ].join(' ')
        }
      >
        <item.icon size={19} aria-hidden="true" />
        <span className="sr-only">{item.label}</span>

        {/* Tooltip. An icon rail without one is a memory test. */}
        <span
          role="tooltip"
          className="pointer-events-none absolute left-full z-50 ml-3 hidden whitespace-nowrap rounded-control bg-navy-700 px-3 py-1.5 text-caption font-medium text-white opacity-0 shadow-lg transition-opacity duration-fast group-hover:opacity-100 lg:block"
        >
          {item.label}
        </span>
      </NavLink>
    </li>
  );
}

export function IconRail({ open, onClose }: { open: boolean; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    closeRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-40 bg-navy-900/70 backdrop-blur-sm lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <div
        id="app-rail"
        className={[
          'fixed inset-y-0 left-0 z-50 flex w-24 flex-col items-center gap-7 py-8',
          'transition-transform duration-panel ease-out',
          open ? 'translate-x-0' : '-translate-x-full',
          'lg:translate-x-0',
        ].join(' ')}
      >
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close navigation"
          className="-mb-6 self-end rounded-full bg-navy-800 p-2 text-white/70 transition-colors duration-fast hover:text-white lg:hidden"
        >
          <X size={18} />
        </button>

        {/* The reference places the mark above the rail, 56px square. At this
            column width the full lockup cannot fit, so the monogram carries the
            brand here and the wordmark lives on the sign-in and print
            surfaces. */}
        <Link to="/" aria-label="ABHI — go to dashboard" className="shrink-0 rounded-2xl">
          <AbhiMark className="h-11 w-11" />
        </Link>

        <nav
          aria-label="Main"
          className="flex w-16 flex-col items-center gap-0 rounded-rail bg-navy-800 py-1.5 shadow-panel ring-1 ring-inset ring-navy-600"
        >
          <ul className="flex flex-col items-center">
            {PRIMARY.map((item) => (
              <RailLink key={item.to} item={item} onNavigate={onClose} />
            ))}
          </ul>
        </nav>

        {/* The reference parks a sign-out control and the account avatar at the
            foot of the column. Only the avatar is carried across.

            There is deliberately NO sign-out button. This POC has no
            authentication — identity arrives as X-ABHI-MSP / X-ABHI-Role
            headers and OAuth2 is deferred to Sprint 9 (GAP-03). A sign-out
            control would therefore have nothing to sign out of, and shipping
            one that quietly does nothing is how a demo audience comes away
            believing the POC has access control it does not have. The avatar
            below switches persona, which is the real, working mechanism. */}
        <div className="mt-auto flex flex-col items-center gap-5">
          <RailAvatar />
        </div>
      </div>
    </>
  );
}
