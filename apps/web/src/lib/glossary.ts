import { createContext, useContext } from 'react';

/**
 * Opens the glossary drawer, optionally at a specific entry.
 *
 * Lives in its own module so that any component — a decision banner, an
 * identity meter, a table cell — can offer "What does this mean?" without
 * importing the shell and creating a cycle.
 */
export type OpenGlossary = (entryId?: string) => void;

export const GlossaryContext = createContext<OpenGlossary>(() => {});

export function useGlossary(): OpenGlossary {
  return useContext(GlossaryContext);
}
