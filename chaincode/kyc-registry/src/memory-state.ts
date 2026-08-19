import type { StateStore, TxContext } from './state.ts';

/**
 * In-memory StateStore. Used by the unit/integration suites and by the
 * gateway's simulator mode, which is what lets the POC be demonstrated and
 * tested on a machine without Docker.
 *
 * It is NOT a Fabric substitute and must never be used above development: it
 * has no endorsement, no ordering, no independent peers, and therefore none of
 * the governance properties that justify the ledger in the first place. The
 * gateway refuses to start in simulator mode when NODE_ENV=production.
 */
export class MemoryStateStore implements StateStore {
  readonly #state = new Map<string, string>();

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.#state.get(key) ?? null);
  }

  put(key: string, value: string): Promise<void> {
    this.#state.set(key, value);
    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    this.#state.delete(key);
    return Promise.resolve();
  }

  getRange(startKey: string, endKey: string): Promise<{ key: string; value: string }[]> {
    const out: { key: string; value: string }[] = [];
    for (const [key, value] of this.#state) {
      if (key >= startKey && key < endKey) out.push({ key, value });
    }
    out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    return Promise.resolve(out);
  }

  /** Test-only: total key count. */
  get size(): number {
    return this.#state.size;
  }

  /**
   * Test-only: write raw state bypassing all chaincode validation.
   *
   * This deliberately simulates the malicious-DBA scenario (S-1) — an operator
   * editing the state database directly. It is how the tamper-detection tests
   * prove GetVersionChain catches what chaincode validation cannot prevent.
   */
  tamper(key: string, value: string): void {
    this.#state.set(key, value);
  }

  snapshot(): Record<string, string> {
    return Object.fromEntries(this.#state);
  }
}

export interface MemoryContextOptions {
  mspId?: string;
  role?: string | null;
  txId?: string;
  timestamp?: Date;
}

export interface CapturedEvent {
  name: string;
  payload: unknown;
}

export function memoryContext(opts: MemoryContextOptions = {}): TxContext & {
  events: CapturedEvent[];
} {
  const events: CapturedEvent[] = [];
  // Per-transaction, starting at zero. See TxContext.nextOrdinal (SEC-11).
  let ordinal = 0;
  return {
    mspId: opts.mspId ?? 'ABHIBankMSP',
    role: opts.role ?? 'gateway',
    txId: opts.txId ?? `tx-${Math.random().toString(16).slice(2, 10)}`,
    timestamp: opts.timestamp ?? new Date('2026-08-17T10:00:00Z'),
    events,
    setEvent(name, payload) {
      events.push({ name, payload });
    },
    nextOrdinal() {
      ordinal += 1;
      return ordinal;
    },
  };
}
