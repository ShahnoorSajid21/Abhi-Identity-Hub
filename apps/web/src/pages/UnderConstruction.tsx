import { Construction } from 'lucide-react';

/**
 * Scaffold placeholder.
 *
 * Deliberately plain and deliberately honest: it says the screen is not built
 * rather than showing an empty table that reads as a broken one. Every route
 * in §2.2 resolves from the first day so the shell can be driven and reviewed
 * before the screens land.
 *
 * Delete this component once §5.1–§5.9 are all built. If it survives to the
 * rehearsal, something has gone wrong.
 */
export function UnderConstruction({ title, section }: { title: string; section: string }) {
  return (
    <>
      <h1 className="text-title font-semibold text-white">{title}</h1>
      <div className="card mt-6 flex flex-col items-center gap-3 px-6 py-12 text-center">
        <Construction size={28} className="text-ink-500" />
        <p className="text-body font-medium text-ink-900">This screen is still being built</p>
        <p className="max-w-md text-cell text-ink-500">
          Specified in section {section} of the frontend plan. The shell, navigation and
          sign-in switching around it are working.
        </p>
      </div>
    </>
  );
}
