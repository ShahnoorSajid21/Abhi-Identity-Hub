import { useSyncExternalStore } from 'react';
import type { VerificationMethod } from './api.ts';

/**
 * Where a customer's in-flight application lives between the two sides of the
 * POC.
 *
 * The ledger commits an assurance level atomically — the gateway runs the
 * missing checks and appends one new version, all or nothing. It has no way to
 * hold "CNIC done, fingerprint still pending", because a half-run step-up is
 * not a state the record is ever allowed to be in. But that half-done state is
 * exactly what the two screens here need to share: the customer app writes a
 * check the moment it passes, and the internal dashboard reads it to show
 * progress without pretending a verification it has not seen has happened.
 *
 * So this is a small client-side store, persisted to localStorage exactly like
 * the attempt-cap counter in verify.ts. It is the POC's own state, not a
 * cosmetic flag: the customer app is the only writer of check completions, the
 * dashboard is a reader, and the value survives a refresh or a navigation
 * because it is on disk rather than in a component's memory.
 *
 * What it is NOT: an identity record. Nothing here is signed, nothing here is
 * on-chain, and completing every check here does not by itself raise the
 * customer's confirmed level — that remains the gateway's write to make. This
 * store tracks the *application*: which product was opened, which of its checks
 * the customer has cleared, and whether the operator has confirmed it.
 */

export type ApplicationStatus = 'awaiting_customer' | 'checks_complete' | 'confirmed';

export interface CustomerApplication {
  subjectId: string;
  /** The product this application was opened for. */
  productId: string;
  /** The checks identified as outstanding when the application was opened. */
  requiredMethods: VerificationMethod[];
  /** The subset the customer has since cleared in the customer app. */
  completedMethods: VerificationMethod[];
  /** Set when the operator confirms the application. Null until then. */
  confirmedAt: string | null;
  openedAt: string;
}

const STORAGE_KEY = 'abhi.applications';

type Store = Record<string, CustomerApplication>;

function store(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    // Private browsing and some embedded webviews throw on access. The app
    // must still run; it just loses persistence for the session.
    return null;
  }
}

function load(): Store {
  const s = store();
  if (s === null) return {};
  try {
    const raw = s.getItem(STORAGE_KEY);
    if (raw === null) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed !== null && typeof parsed === 'object' ? (parsed as Store) : {};
  } catch {
    return {};
  }
}

/**
 * The single in-memory copy. Its reference only changes when the data changes,
 * which is what lets useSyncExternalStore below avoid an infinite render loop —
 * a getSnapshot that parsed localStorage afresh each call would return a new
 * object every time and never settle.
 */
let state: Store = load();
const listeners = new Set<() => void>();

function persist(next: Store): void {
  state = next;
  const s = store();
  if (s !== null) {
    try {
      s.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Quota or a blocked partition. The in-memory copy is still correct for
      // this session; only cross-refresh durability is lost.
    }
  }
  for (const l of listeners) l();
}

/** Dedupe while preserving order — completion order is not meaningful. */
function withMethod(
  methods: readonly VerificationMethod[],
  method: VerificationMethod,
): VerificationMethod[] {
  return methods.includes(method) ? [...methods] : [...methods, method];
}

export function getApplication(subjectId: string): CustomerApplication | null {
  return state[subjectId] ?? null;
}

/**
 * Open (or re-open) an application for a product.
 *
 * Called when the operator opens the application from the profile — this is
 * what "identifies the required checks and makes them available to the
 * customer app". Re-opening the same product keeps any progress the customer
 * has already made; switching products starts the checklist over, because the
 * outstanding checks are then a different set.
 */
export function openApplication(
  subjectId: string,
  productId: string,
  requiredMethods: readonly VerificationMethod[],
): void {
  const existing = state[subjectId];
  const completed =
    existing !== undefined && existing.productId === productId ? existing.completedMethods : [];
  const confirmedAt =
    existing !== undefined && existing.productId === productId ? existing.confirmedAt : null;
  persist({
    ...state,
    [subjectId]: {
      subjectId,
      productId,
      requiredMethods: [...requiredMethods],
      completedMethods: completed.filter((m) => requiredMethods.includes(m)),
      confirmedAt,
      openedAt: existing?.openedAt ?? new Date().toISOString(),
    },
  });
}

/**
 * Record that the customer cleared one check in the customer app.
 *
 * Tolerant of an application that was never explicitly opened (a customer can
 * reach /apply by URL): it creates the entry, seeding requiredMethods with at
 * least the method just completed so the checklist is never shorter than what
 * has actually been done.
 */
export function recordCheckComplete(
  subjectId: string,
  productId: string,
  method: VerificationMethod,
): void {
  const existing = state[subjectId];
  if (existing === undefined || existing.productId !== productId) {
    persist({
      ...state,
      [subjectId]: {
        subjectId,
        productId,
        requiredMethods: [method],
        completedMethods: [method],
        confirmedAt: null,
        openedAt: new Date().toISOString(),
      },
    });
    return;
  }
  persist({
    ...state,
    [subjectId]: {
      ...existing,
      requiredMethods: withMethod(existing.requiredMethods, method),
      completedMethods: withMethod(existing.completedMethods, method),
    },
  });
}

/** Confirm the application. Records the moment; changes no identity data. */
export function confirmApplication(subjectId: string, productId: string): void {
  const existing = state[subjectId];
  const now = new Date().toISOString();
  persist({
    ...state,
    [subjectId]: {
      subjectId,
      productId,
      requiredMethods: existing?.productId === productId ? existing.requiredMethods : [],
      completedMethods: existing?.productId === productId ? existing.completedMethods : [],
      confirmedAt: now,
      openedAt: existing?.openedAt ?? now,
    },
  });
}

export function clearApplication(subjectId: string): void {
  if (state[subjectId] === undefined) return;
  const next = { ...state };
  delete next[subjectId];
  persist(next);
}

/**
 * Derived status. Confirmed wins; otherwise it turns on the checklist.
 *
 * `ledgerMethods` is the record's own confirmed methods, and it is part of the
 * answer rather than an optional extra: a check the ledger already proves is
 * done, whoever ran it. Leaving it out let the chip read "waiting for the
 * customer" beside a list that showed every check complete — one panel
 * disagreeing with itself, which is worse than either message alone.
 */
export function statusOf(
  app: CustomerApplication,
  ledgerMethods: readonly VerificationMethod[] = [],
): ApplicationStatus {
  if (app.confirmedAt !== null) return 'confirmed';
  const done = new Set<VerificationMethod>([...app.completedMethods, ...ledgerMethods]);
  const allDone = app.requiredMethods.every((m) => done.has(m));
  return allDone ? 'checks_complete' : 'awaiting_customer';
}

/* ------------------------------------------------------------------ */
/* React binding                                                       */
/* ------------------------------------------------------------------ */

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Cross-tab: another tab (the customer on their own device, in the demo
  // story) writing the key fires a storage event here. Same-tab writes go
  // through persist() and never raise one, so both paths are covered.
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) {
      state = load();
      listener();
    }
  };
  globalThis.addEventListener?.('storage', onStorage);
  return () => {
    listeners.delete(listener);
    globalThis.removeEventListener?.('storage', onStorage);
  };
}

function snapshot(): Store {
  return state;
}

/** The whole map, re-rendering consumers when any application changes. */
export function useApplications(): Store {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** One customer's application, or null. */
export function useApplication(subjectId: string): CustomerApplication | null {
  return useApplications()[subjectId] ?? null;
}
