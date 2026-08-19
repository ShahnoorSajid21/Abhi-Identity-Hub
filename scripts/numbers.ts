/**
 * The arbiter for every figure on screen.
 *
 *   npm run numbers
 *
 * If a number in the app disagrees with this script's output, the app is
 * wrong. It exists because the frontend plan quoted money figures — PKR 205 a
 * journey, PKR 71,850 saved on an upload — that nothing in this repository
 * produces, and a dashboard that cannot be reconciled costs more credibility
 * than the chart earns.
 *
 * EVERY FIGURE BELOW IS MODELLED, NOT MEASURED.
 * The unit costs come from DEFAULT_RAIL_COSTS, which services/gateway/src/
 * rails.ts marks as placeholder grid points pending Finance ([OPEN-3]). ABHI
 * has not measured its repeat-verification rate, its per-call NADRA cost, or
 * its volumes. Nothing printed here may be presented as an ABHI number.
 */
import { REQUIRED_METHODS, type AssuranceLevel } from '@abhi/types';
import { DEFAULT_RAIL_COSTS } from '../services/gateway/src/rails.ts';
import { COHORT, FROZEN_COUNT, EXPIRING_SOON_COUNT } from '../services/gateway/src/seed-cohort.ts';

const LEVELS: AssuranceLevel[] = ['A0', 'A1', 'A2', 'A3'];

const PLAIN: Record<AssuranceLevel, string> = {
  A0: 'Claimed',
  A1: 'ID checked',
  A2: 'Fingerprint verified',
  A3: 'Fingerprint + selfie',
};

function pkr(n: number): string {
  return `PKR ${Math.round(n).toLocaleString('en-PK')}`;
}

function journeyCost(level: AssuranceLevel): number {
  return REQUIRED_METHODS[level].reduce(
    (total, method) => total + DEFAULT_RAIL_COSTS[method].unitCostPkr,
    0,
  );
}

const rule = '─'.repeat(74);

console.log(`\n${rule}\nRAIL UNIT COSTS — modelled placeholders, not ABHI's contracted rates\n${rule}`);
for (const cost of Object.values(DEFAULT_RAIL_COSTS)) {
  console.log(`  ${cost.method.padEnd(16)} ${cost.provider.padEnd(22)} ${pkr(cost.unitCostPkr)}`);
}

console.log(`\n${rule}\nCOST OF A FULL JOURNEY, BY CONFIRMATION LEVEL\n${rule}`);
for (const level of LEVELS) {
  const methods = REQUIRED_METHODS[level];
  console.log(
    `  ${PLAIN[level].padEnd(22)} ${String(methods.length).padStart(2)} check(s)  ` +
      `${pkr(journeyCost(level)).padStart(9)}   ${methods.join(', ')}`,
  );
}

const total = LEVELS.reduce((sum, level) => sum + COHORT[level], 0);
const confirmed = total - COHORT.A0;

console.log(`\n${rule}\nSEEDED COHORT\n${rule}`);
for (const level of LEVELS) {
  const count = COHORT[level];
  const share = ((count / total) * 100).toFixed(1);
  console.log(
    `  ${PLAIN[level].padEnd(22)} ${String(count).padStart(5)}  ${share.padStart(5)}%  ` +
      `${pkr(count * journeyCost(level)).padStart(11)} to establish`,
  );
}
console.log(`  ${'─'.repeat(70)}`);
console.log(`  ${'Total'.padEnd(22)} ${String(total).padStart(5)}`);
console.log(
  `  ${'Confirmed'.padEnd(22)} ${String(confirmed).padStart(5)}  ` +
    `${((confirmed / total) * 100).toFixed(1).padStart(5)}%  of the base`,
);
console.log(
  `  ${'Never checked'.padEnd(22)} ${String(COHORT.A0).padStart(5)}  ` +
    `${((COHORT.A0 / total) * 100).toFixed(1).padStart(5)}%  employer-asserted`,
);
console.log(`\n  Needs attention: ${FROZEN_COUNT} frozen · ${EXPIRING_SOON_COUNT} CNICs expiring within 90 days`);

/**
 * The employer upload.
 *
 * The comparison the business case rests on: what a 1,000-employee onboarding
 * costs when every identity is established from scratch, against what it costs
 * when the ones ABHI has already confirmed are reused.
 */
const UPLOAD = 1000;
const employerLevel: AssuranceLevel = 'A2'; // EMPLOYER_BULK minimum
const perHead = journeyCost(employerLevel);

// Apply the cohort's own proportions to the uploaded list — the employees of a
// new employer are not more or less likely to be existing ABHI customers than
// the base is.
const readyNow = Math.round(UPLOAD * (COHORT.A2 + COHORT.A3) / total);
const oneCheck = Math.round(UPLOAD * COHORT.A1 / total);
const fullOnboarding = UPLOAD - readyNow - oneCheck;

const withoutLedger = UPLOAD * perHead;
const stepUpCost = DEFAULT_RAIL_COSTS.BIOMETRIC_1TO1.unitCostPkr;
const withLedger = fullOnboarding * perHead + oneCheck * stepUpCost;
const saved = withoutLedger - withLedger;

console.log(`\n${rule}\nMODELLED EMPLOYER UPLOAD — ${UPLOAD.toLocaleString('en-PK')} employees\n${rule}`);
console.log(`  ${'Ready now'.padEnd(28)} ${String(readyNow).padStart(5)}   no new checks`);
console.log(`  ${'One check needed'.padEnd(28)} ${String(oneCheck).padStart(5)}   fingerprint only, ${pkr(stepUpCost)} each`);
console.log(`  ${'Full onboarding'.padEnd(28)} ${String(fullOnboarding).padStart(5)}   ${pkr(perHead)} each`);
console.log(`  ${'─'.repeat(70)}`);
console.log(`  ${'Without the identity ledger'.padEnd(28)} ${pkr(withoutLedger).padStart(12)}`);
console.log(`  ${'With the identity ledger'.padEnd(28)} ${pkr(withLedger).padStart(12)}`);
console.log(
  `  ${'Saved on this upload'.padEnd(28)} ${pkr(saved).padStart(12)}   ` +
    `${((saved / withoutLedger) * 100).toFixed(0)}% less`,
);

console.log(`\n${rule}`);
console.log('  Unit costs are modelled placeholders, not ABHI\'s contracted rates.');
console.log('  Repeat-verification rate, per-call cost and volumes are all unmeasured.');
console.log('  Do not present any figure above as an ABHI measurement.');
console.log(`${rule}\n`);
