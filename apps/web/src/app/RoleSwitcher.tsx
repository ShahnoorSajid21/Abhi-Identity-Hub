import { useEffect, useRef, useState } from 'react';
import { Check, ChevronUp } from 'lucide-react';
import { PERSONAS, setPersona } from '../lib/roles.ts';
import { usePersona } from '../lib/useApi.ts';
import { Avatar } from '../components/Avatar.tsx';
import { ROLE_SWITCHER } from '../copy/strings.ts';

/**
 * Who am I signed in as.
 *
 * Not decoration: it is how a non-technical viewer sees that authority is
 * split across parts of the bank. Switching changes the identity headers on
 * every subsequent call, so what the ledger permits changes with it — not just
 * what this screen shows.
 */
export function RoleSwitcher() {
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
    <div ref={ref} className="relative border-t border-navy-700 p-3">
      {open && (
        <div className="absolute bottom-full left-3 right-3 mb-2 overflow-hidden rounded-card border border-ink-200 bg-white shadow-xl">
          <p className="label-caption px-3 pt-3">{ROLE_SWITCHER.heading}</p>
          <ul className="py-1">
            {PERSONAS.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => {
                    setPersona(p.id);
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors duration-fast hover:bg-ink-100"
                >
                  <Avatar name={p.name} initials={p.initials} size={28} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-cell font-medium text-ink-900">
                      {p.name}
                    </span>
                    <span className="block truncate text-caption text-ink-500">{p.title}</span>
                  </span>
                  {p.id === persona.id && <Check size={16} className="text-mint-600" />}
                </button>
              </li>
            ))}
          </ul>
          <p className="border-t border-ink-100 px-3 py-2 text-caption leading-5 text-ink-500">
            {ROLE_SWITCHER.hint}
          </p>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 rounded-control p-2 text-left transition-colors duration-fast hover:bg-navy-700"
      >
        <Avatar name={persona.name} initials={persona.initials} size={32} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-cell font-medium text-white">{persona.name}</span>
          <span className="block truncate text-caption text-ink-300">{persona.title}</span>
        </span>
        <ChevronUp
          size={16}
          className={`shrink-0 text-ink-300 transition-transform duration-fast ${open ? '' : 'rotate-180'}`}
        />
      </button>
    </div>
  );
}
