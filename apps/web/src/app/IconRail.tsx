import { useEffect, useRef } from 'react';
import { NavLink } from 'react-router-dom';
import {
  ClipboardList,
  Flag,
  Home,
  LogOut,
  ScrollText,
  Settings,
  Upload,
  Users,
  X,
} from 'lucide-react';
import { NAV } from '../copy/strings.ts';
import { formatCount } from '../lib/format.ts';
import { RailAvatar } from './RailAvatar.tsx';
import type { DashboardSummary } from '../lib/api.ts';

/**
 * The floating icon rail.
 *
 * Geometry is taken from the dashboard reference: a 76px column, a pill of
 * radius 38 (fully rounded at that width), and 60px circular targets. The
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
            'group relative flex h-[60px] w-[60px] items-center justify-center rounded-full',
            'transition-colors duration-fast',
            isActive
              ? 'bg-mint-500 text-navy-900'
              : 'text-white/70 hover:bg-navy-700 hover:text-white',
          ].join(' ')
        }
      >
        <item.icon size={22} aria-hidden="true" />
        <span className="sr-only">{item.label}</span>

        {/* Shown only when known AND non-zero. An unknown count must not render
            as 0, which would claim "nothing needs attention" when the truth is
            that nobody asked. */}
        {typeof item.count === 'number' && item.count > 0 && (
          <span
            className={`tabular absolute -right-0.5 top-1 min-w-[20px] rounded-pill px-1.5 text-[11px] font-semibold leading-[18px] ${BADGE_TONE[item.tone ?? 'neutral']}`}
          >
            {formatCount(item.count)}
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
    { to: '/customers', label: NAV.customers, icon: Users, count: summary?.totalCustomers },
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
          'fixed inset-y-0 left-0 z-50 flex w-[116px] flex-col items-center py-6',
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
          className="mb-2 self-end rounded-full bg-navy-800 p-2 text-white/70 transition-colors duration-fast hover:text-white lg:hidden"
        >
          <X size={18} />
        </button>

        <nav
          aria-label="Main"
          className="flex w-[76px] flex-col items-center gap-0 rounded-rail bg-navy-800 py-1.5 shadow-panel ring-1 ring-inset ring-navy-600"
        >
          <ul className="flex flex-col items-center">
            {primary.map((item) => (
              <RailLink key={item.to} item={item} onNavigate={onClose} />
            ))}
          </ul>
        </nav>

        {/* The reference parks a sign-out control and the account avatar at the
            foot of the column, separated from navigation by a large gap. */}
        <div className="mt-auto flex flex-col items-center gap-5 pt-10">
          <button
            type="button"
            title="Sign out"
            className="flex h-12 w-12 items-center justify-center rounded-full text-white/60 transition-colors duration-fast hover:bg-navy-700 hover:text-white"
          >
            <LogOut size={20} aria-hidden="true" />
            <span className="sr-only">Sign out</span>
          </button>
          <RailAvatar />
        </div>
      </div>
    </>
  );
}
