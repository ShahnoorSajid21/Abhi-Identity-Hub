import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { getPersona, subscribePersona, type Persona } from './roles.ts';

/** The signed-in persona, re-rendering every consumer when it changes. */
export function usePersona(): Persona {
  return useSyncExternalStore(subscribePersona, getPersona, getPersona);
}

export interface AsyncState<T> {
  data: T | null;
  error: unknown;
  loading: boolean;
  reload: () => void;
}

/**
 * Minimal data fetching. No cache library — the app is small, the endpoints
 * are cheap, and a stale-cache bug during a live demo is not a trade worth
 * making.
 *
 * Refetches whenever the persona changes, because the answer genuinely can
 * differ: a Compliance sign-in and a Lending sign-in are not entitled to the
 * same things.
 */
export function useApi<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  deps: readonly unknown[] = [],
): AsyncState<T> {
  const persona = usePersona();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    let live = true;

    setLoading(true);
    setError(null);

    fetcher(controller.signal)
      .then((result) => {
        if (!live) return;
        setData(result);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (!live || controller.signal.aborted) return;
        setError(e);
        setLoading(false);
      });

    return () => {
      live = false;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce, persona.id, ...deps]);

  return { data, error, loading, reload };
}
