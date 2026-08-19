import { Link } from 'react-router-dom';
import type { EmptyStateCopy } from '../copy/strings.ts';
import { Icon } from './Icon.tsx';

/**
 * Every list in this app has a written empty state, and every one of them says
 * why it is empty and what to do next. "No results" on its own is a bug, not a
 * state.
 *
 * The positive treatment matters: "nothing is blocked" is good news and should
 * not be rendered in the same grey as a failure.
 */
export function EmptyState({
  copy,
  onAction,
  compact = false,
}: {
  copy: EmptyStateCopy;
  /** Called for actions with no `to` — clearing filters, retrying, and so on. */
  onAction?: () => void;
  compact?: boolean;
}) {
  const { action } = copy;

  const button =
    action === undefined ? null : action.to !== undefined ? (
      <Link
        to={action.to}
        className={
          action.intent === 'primary'
            ? 'rounded-control bg-navy-700 px-4 py-2 text-cell font-medium text-white transition-colors duration-fast hover:bg-navy-600'
            : 'rounded-control border border-ink-200 px-4 py-2 text-cell font-medium text-ink-700 transition-colors duration-fast hover:bg-ink-100'
        }
      >
        {action.label}
      </Link>
    ) : (
      <button
        type="button"
        onClick={onAction}
        className={
          action.intent === 'primary'
            ? 'rounded-control bg-navy-700 px-4 py-2 text-cell font-medium text-white transition-colors duration-fast hover:bg-navy-600'
            : 'rounded-control border border-ink-200 px-4 py-2 text-cell font-medium text-ink-700 transition-colors duration-fast hover:bg-ink-100'
        }
      >
        {action.label}
      </button>
    );

  return (
    <div
      className={`flex flex-col items-center gap-3 text-center ${compact ? 'px-4 py-8' : 'px-6 py-12'}`}
    >
      <Icon
        name={copy.icon}
        size={compact ? 22 : 28}
        className={copy.positive === true ? 'text-mint-600' : 'text-ink-500'}
      />
      <p className="text-body font-medium text-ink-900">{copy.title}</p>
      <p className="max-w-md text-cell leading-6 text-ink-500">{copy.body}</p>
      {button !== null && <div className="mt-1">{button}</div>}
    </div>
  );
}
