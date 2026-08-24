/**
 * Who am I signed in as.
 *
 * This is not decoration. It is how a non-technical viewer *sees* that no
 * single part of the bank can change an identity record on its own.
 *
 * The header that governs authority is X-ABHI-MSP: the gateway compares it
 * against COMPLIANCE_MSP ('ABHIComplianceMSP') for the Compliance-only writes.
 * X-ABHI-Role travels alongside it for the audit trail. Both are read by
 * identityFromHeaders in services/gateway/src/security.ts, which throws
 * outright when NODE_ENV=production — headers can never establish identity in
 * production, only mTLS can.
 *
 * Whatever a screen does with its Freeze button is a convenience. The control
 * is the server's rejection, and §5.6 shows it happening on purpose.
 *
 * The two screens differ deliberately. A customer profile OMITS the button for
 * the personas that cannot use it — a dead control there teaches an operator
 * nothing except that the screen has dead controls. /compliance KEEPS it,
 * visible and disabled, beside the tooltip and an "attempt anyway" button,
 * because showing the rejection is that screen's job.
 */

export type PersonaId = 'compliance' | 'lending' | 'bank';

export interface Persona {
  id: PersonaId;
  name: string;
  title: string;
  org: string;
  /** Sent as X-ABHI-MSP. This is what the gateway actually checks. */
  mspId: 'ABHIComplianceMSP' | 'ABHILendingMSP' | 'ABHIBankMSP';
  /** Sent as X-ABHI-Role. */
  role: PersonaId;
  /** Initials for the generated avatar. No photographs, generated or otherwise. */
  initials: string;
  canFreeze: boolean;
}

export const PERSONAS: readonly Persona[] = [
  {
    id: 'compliance',
    name: 'Fatima Khan',
    title: 'Compliance Officer',
    org: 'ABHI Compliance',
    mspId: 'ABHIComplianceMSP',
    role: 'compliance',
    initials: 'FK',
    canFreeze: true,
  },
  {
    id: 'lending',
    name: 'Bilal Ahmed',
    title: 'Lending Operations',
    org: 'ABHI Lending',
    mspId: 'ABHILendingMSP',
    role: 'lending',
    initials: 'BA',
    canFreeze: false,
  },
  {
    id: 'bank',
    name: 'Sana Iqbal',
    title: 'Branch Onboarding',
    org: 'ABHI Bank',
    mspId: 'ABHIBankMSP',
    role: 'bank',
    initials: 'SI',
    canFreeze: false,
  },
];

export function personaById(id: PersonaId): Persona {
  const found = PERSONAS.find((p) => p.id === id);
  // The union type makes this unreachable, but a bad value in sessionStorage
  // should degrade to the least-privileged persona rather than crash the app.
  return found ?? PERSONAS[2]!;
}

const STORAGE_KEY = 'abhi.persona';

function readStored(): PersonaId {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw === 'compliance' || raw === 'lending' || raw === 'bank') return raw;
  } catch {
    // Private browsing or a blocked storage partition. Fall through.
  }
  return 'compliance';
}

/**
 * A three-line store rather than a context provider, because the API client
 * needs the current persona outside React's tree — every fetch carries it.
 */
let current: Persona = personaById(readStored());
const listeners = new Set<() => void>();

export function getPersona(): Persona {
  return current;
}

export function setPersona(id: PersonaId): void {
  current = personaById(id);
  try {
    sessionStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Not being able to remember the choice is survivable; failing is not.
  }
  for (const l of listeners) l();
}

export function subscribePersona(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
