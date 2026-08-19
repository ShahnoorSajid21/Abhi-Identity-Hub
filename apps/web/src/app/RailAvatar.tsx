import { useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { PERSONAS, setPersona } from '../lib/roles.ts';
import { usePersona } from '../lib/useApi.ts';
import { Avatar } from '../components/Avatar.tsx';
import { ROLE_SWITCHER } from '../copy/strings.ts';

/**
 * Who am I signed in as — as the rail's foot avatar.
 *
 * Not decoration: it is how a non-technical viewer sees that authority is split
 * across parts of the bank. Switching changes the identity headers on every
 * subsequent call, so what the ledger permits changes with it — not just what
 * this screen shows.
 *
 * The reference puts a bare avatar here with no affordance. That works for a
 * mockup and not for a demo where switching persona is the point being made,
 * so the avatar keeps a mint ring and an aria-expanded popover.
 */
export function RailAvatar() {
  const persona = usePersona();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current !== null && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      {open && (
        <div className="absolute bottom-0 left-full z-50 ml-3 w-[260px] overflow-hidden rounded-card border border-ink-200 bg-white shadow-panel">
          <p className="label-caption px-4 pt-4">{ROLE_SWITCHER.heading}</p>
          <ul className="py-1">
            {PERSONAS.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => {
                    setPersona(p.id);
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors duration-fast hover:bg-ink-100"
                >
                  <Avatar name={p.name} initials={p.initials} size={30} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-cell font-medium text-ink-900">
                      {p.name}
                    </span>
                    <span className="block truncate text-caption text-ink-500">{p.title}</span>
                  </span>
                  {p.id === persona.id && <Check size={16} className="shrink-0 text-mint-700" />}
                </button>
              </li>
            ))}
          </ul>
          <p className="border-t border-ink-100 px-4 py-2.5 text-caption leading-5 text-ink-500">
            {ROLE_SWITCHER.hint}
          </p>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        title={`${persona.name} — ${persona.title}`}
        className={`rounded-full transition-shadow duration-fast ${
          open ? 'ring-2 ring-mint-500 ring-offset-2 ring-offset-navy-900' : 'ring-2 ring-navy-600'
        }`}
      >
        <Avatar name={persona.name} initials={persona.initials} size={48} />
        <span className="sr-only">Change who you are signed in as</span>
      </button>
    </div>
  );
}
