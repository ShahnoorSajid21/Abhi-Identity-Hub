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
import { formatCount } from '../lib/format.ts';
import { RailAvatar } from './RailAvatar.tsx';
import { AbhiMark } from './AbhiLogo.tsx';
import type { DashboardSummary } from '../lib/api.ts';

/**
 * The floating icon rail.
 *
 * Geometry follows the dashboard reference, rescaled: the reference draws a
 * 76px column with 60px targets on a 1440px frame, which reads oversized on the
 * ~1900px viewports this console runs on. Proportions are kept; the column is
 * 64px with 48px targets. The
 * reference marks the active item with a near-black disc on a white rail; here
 * it is a mint disc on a navy rail, which is the same figure/ground move
 * carried into ABHI's palette — and navy-on-mint measures 9.1:1, where the
 * reference's white-on-mint would have measured 2.0:1.
 *
 * Icon-only navigation is a real accessibility risk, so every target carries an
 * accessible name AND a hover tooltip. The label is not optional decoration:
 * a compliance officer who cannot tell "Compliance" from "Audit" by glyph alone
 * has been given a puzzle, not a console.
 */

type BadgeTone = 'neutral' | 'warn' | 'stop';

interface RailItem {
  to: string;
  label: string;
  icon: typeof Home;
  end?: boolean;
  count?: number | null;
  tone?: BadgeTone;
}

const BADGE_TONE: Record<BadgeTone, string> = {
  neutral: 'bg-navy-600 text-white',
  warn: 'bg-warn-line text-navy-900',
  stop: 'bg-stop-line text-white',
};

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

        {/* Shown only when known AND non-zero. An unknown count must not render
            as 0, which would claim "nothing needs attention" when the truth is
            that nobody asked.

            Capped at 99+ and pinned to the icon's top-right corner with a ring
            in the rail colour. Uncapped, a four-digit count grew wider than the
            48px target it sat on and covered the glyph completely. The exact
            figure is still available — it is in the tooltip and on the page the
            item leads to. */}
        {typeof item.count === 'number' && item.count > 0 && (
          <span
            aria-hidden="true"
            className={`tabular absolute -right-1 -top-0.5 min-w-[18px] rounded-pill px-1 text-center text-[10px] font-semibold leading-[16px] ring-2 ring-navy-800 ${BADGE_TONE[item.tone ?? 'neutral']}`}
          >
            {item.count > 99 ? '99+' : formatCount(item.count)}
          </span>
        )}

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

export function IconRail({
  summary,
  open,
  onClose,
}: {
  summary: DashboardSummary | null;
  open: boolean;
  onClose: () => void;
}) {
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

  const primary: RailItem[] = [
    { to: '/', label: NAV.dashboard, icon: Home, end: true },
    // No badge: 1,204 is the size of the customer base, not a number of things
    // waiting. Badging a total put a four-digit chip on top of a 48px icon and
    // said nothing actionable. Only queue depth and compliance holds are badged.
    { to: '/customers', label: NAV.customers, icon: Users },
    {
      to: '/queue',
      label: NAV.queue,
      icon: ClipboardList,
      count: summary?.queueDepth,
      tone: 'warn',
    },
    { to: '/onboarding', label: NAV.onboarding, icon: Upload },
    { to: '/compliance', label: NAV.compliance, icon: Flag, count: summary?.frozen, tone: 'stop' },
    { to: '/audit', label: NAV.audit, icon: ScrollText },
    { to: '/settings/policies', label: NAV.settings, icon: Settings },
  ];

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

        {/* The reference places the mark above the rail, 56px square. At a 76px
            column the full lockup cannot fit, so the monogram carries the brand
            here and the wordmark lives on the sign-in and print surfaces. */}
        <Link to="/" aria-label="ABHI — go to dashboard" className="shrink-0 rounded-2xl">
          <AbhiMark className="h-11 w-11" />
        </Link>

        <nav
          aria-label="Main"
          className="flex w-16 flex-col items-center gap-0 rounded-rail bg-navy-800 py-1.5 shadow-panel ring-1 ring-inset ring-navy-600"
        >
          <ul className="flex flex-col items-center">
            {primary.map((item) => (
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
