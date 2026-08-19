import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { ClipboardList, Flag, Home, ScrollText, Settings, Upload, Users } from 'lucide-react';
import { APP_NAME, APP_SUBTITLE, NAV } from '../copy/strings.ts';
import { formatCount } from '../lib/format.ts';
import { RoleSwitcher } from './RoleSwitcher.tsx';
import type { DashboardSummary } from '../lib/api.ts';

type BadgeTone = 'neutral' | 'warn' | 'stop';

interface NavItem {
  to: string;
  label: string;
  icon: typeof Home;
  count?: number | null;
  tone?: BadgeTone;
}

/**
 * The logo mark.
 *
 * Falls back to a navy rounded square containing a white "A" if the asset is
 * missing. The plan is explicit that a missing image must not block the build.
 */
function Mark() {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-navy-600 text-body font-bold text-white">
        A
      </span>
    );
  }

  return (
    <img
      src="/abhi-mark.png"
      alt=""
      width={32}
      height={32}
      className="h-8 w-8 shrink-0 rounded-lg"
      onError={() => setFailed(true)}
    />
  );
}

function Badge({ count, tone }: { count: number; tone: BadgeTone }) {
  const styles: Record<BadgeTone, string> = {
    neutral: 'bg-navy-700 text-ink-300',
    warn: 'bg-warn-line text-navy-900',
    stop: 'bg-stop-line text-white',
  };
  return (
    <span
      className={`tabular ml-auto rounded-pill px-2 py-0.5 text-caption font-semibold ${styles[tone]}`}
    >
      {formatCount(count)}
    </span>
  );
}

export function Sidebar({ summary }: { summary: DashboardSummary | null }) {
  const items: NavItem[] = [
    { to: '/', label: NAV.dashboard, icon: Home },
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
  ];

  return (
    <nav className="fixed inset-y-0 left-0 flex w-sidebar flex-col bg-navy-800">
      <div className="flex items-center gap-3 px-4 py-4">
        <Mark />
        <span className="min-w-0">
          <span className="block text-body font-semibold tracking-wide text-white">{APP_NAME}</span>
          <span className="block text-[10px] uppercase tracking-widest text-mint-300/70">
            {APP_SUBTITLE}
          </span>
        </span>
      </div>

      <ul className="flex-1 overflow-y-auto border-t border-navy-700 py-2">
        {items.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                [
                  'flex items-center gap-3 border-l-[3px] px-4 py-2.5 text-cell transition-colors duration-fast',
                  isActive
                    ? 'border-mint-500 bg-navy-700 font-medium text-white'
                    : 'border-transparent text-ink-300 hover:bg-navy-700 hover:text-white',
                ].join(' ')
              }
            >
              <item.icon size={18} className="shrink-0" />
              <span className="truncate">{item.label}</span>
              {/* Shown only when known AND non-zero. An unknown count must not
                  render as 0, which would claim "nothing needs attention"
                  when the truth is that nobody asked. A genuine zero is real
                  but not worth an amber badge — the absence says it. */}
              {typeof item.count === 'number' && item.count > 0 && (
                <Badge count={item.count} tone={item.tone ?? 'neutral'} />
              )}
            </NavLink>
          </li>
        ))}
      </ul>

      <ul className="border-t border-navy-700 py-2">
        <li>
          <NavLink
            to="/settings/policies"
            className={({ isActive }) =>
              [
                'flex items-center gap-3 border-l-[3px] px-4 py-2.5 text-cell transition-colors duration-fast',
                isActive
                  ? 'border-mint-500 bg-navy-700 font-medium text-white'
                  : 'border-transparent text-ink-300 hover:bg-navy-700 hover:text-white',
              ].join(' ')
            }
          >
            <Settings size={18} className="shrink-0" />
            <span className="truncate">{NAV.settings}</span>
          </NavLink>
        </li>
      </ul>

      <RoleSwitcher />
    </nav>
  );
}
