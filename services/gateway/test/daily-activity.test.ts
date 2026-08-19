import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PresentationStore, type ActivityEntry } from '../src/presentation.ts';

/**
 * Daily bucketing for the dashboard chart.
 *
 * A chart is read as fact, so the ways this can quietly lie are the ways worth
 * testing: counting the wrong action, bucketing against UTC when the operator
 * lives in PKT, dropping the empty days that give a gap its meaning, and —
 * the one that motivated moving this server-side — reporting a truncated
 * window as though it were complete.
 */

const NOW = new Date('2026-08-19T14:00:00+05:00');

function entry(at: string, over: Partial<ActivityEntry> = {}): ActivityEntry {
  return {
    at,
    actorMsp: 'ABHILendingMSP',
    actorRole: 'gateway',
    action: 'VERIFICATION',
    subjectId: 'a'.repeat(64),
    productId: 'EWA',
    decision: 'ALLOW',
    detail: null,
    ...over,
  };
}

/** Newest first, which is the order the store maintains. */
function storeWith(entries: ActivityEntry[]): PresentationStore {
  const store = new PresentationStore();
  for (const e of [...entries].reverse()) store.recordActivity(e);
  return store;
}

// ===========================================================================
describe('dailyActivity — bucketing', () => {
  test('returns one bucket per day, newest last, including empty days', () => {
    const store = storeWith([entry('2026-08-19T09:00:00+05:00')]);
    const { buckets } = store.dailyActivity(7, NOW);

    assert.equal(buckets.length, 7);
    assert.equal(buckets[0]!.date, '2026-08-13');
    assert.equal(buckets[6]!.date, '2026-08-19');

    // A day with nothing in it is a real observation and must be drawn as
    // zero. Omitting it would close the gap and misstate the trend.
    assert.equal(buckets[0]!.verifications, 0);
    assert.equal(buckets[6]!.verifications, 1);
  });

  test('counts verifications and, separately, the reused subset', () => {
    const store = storeWith([
      entry('2026-08-19T09:00:00+05:00', { decision: 'ALLOW' }),
      entry('2026-08-19T10:00:00+05:00', { decision: 'ALLOW' }),
      entry('2026-08-19T11:00:00+05:00', { decision: 'STEP_UP' }),
      entry('2026-08-19T12:00:00+05:00', { decision: 'DENY' }),
    ]);
    const today = store.dailyActivity(7, NOW).buckets[6]!;

    assert.equal(today.verifications, 4);
    assert.equal(today.reused, 2, 'only ALLOW is a reused identity');
  });

  test('ignores actions that are not verifications', () => {
    const store = storeWith([
      entry('2026-08-19T09:00:00+05:00', { action: 'FROZEN', decision: null }),
      entry('2026-08-19T10:00:00+05:00', { action: 'CONSENT_GRANTED', decision: null }),
      entry('2026-08-19T11:00:00+05:00', { action: 'VERIFICATION' }),
    ]);
    assert.equal(store.dailyActivity(7, NOW).buckets[6]!.verifications, 1);
  });

  test('events outside the window are excluded, not folded into the edge bucket', () => {
    const store = storeWith([
      entry('2026-08-19T09:00:00+05:00'),
      // Eight days back — one day outside a seven-day window.
      entry('2026-08-11T09:00:00+05:00'),
    ]);
    const { buckets } = store.dailyActivity(7, NOW);

    assert.equal(buckets.reduce((n, b) => n + b.verifications, 0), 1);
    assert.equal(buckets[0]!.verifications, 0, 'the oldest bucket must not absorb older events');
  });

  test('buckets by local calendar day, not by UTC', () => {
    // 02:00 on the 19th in PKT is 21:00 on the 18th in UTC. An operator in
    // Karachi calling that "yesterday" would be wrong.
    const store = storeWith([entry('2026-08-19T02:00:00+05:00')]);
    const { buckets } = store.dailyActivity(7, NOW);

    const byDate = new Map(buckets.map((b) => [b.date, b.verifications]));
    assert.equal(byDate.get('2026-08-19'), 1);
    assert.equal(byDate.get('2026-08-18'), 0);
  });

  test('the span is clamped, so a hostile days= cannot allocate unbounded buckets', () => {
    const store = storeWith([]);
    assert.equal(store.dailyActivity(9999, NOW).buckets.length, 90);
    assert.equal(store.dailyActivity(0, NOW).buckets.length, 1);
    assert.equal(store.dailyActivity(-5, NOW).buckets.length, 1);
  });

  test('an empty store still returns a full, zeroed window', () => {
    const { buckets, complete } = new PresentationStore().dailyActivity(7, NOW);
    assert.equal(buckets.length, 7);
    assert.ok(buckets.every((b) => b.verifications === 0 && b.reused === 0));
    assert.equal(complete, true, 'empty is not the same as truncated');
  });
});

// ===========================================================================
describe('dailyActivity — the completeness flag', () => {
  test('reports complete when retention covers the window', () => {
    const store = storeWith([entry('2026-08-14T09:00:00+05:00')]);
    assert.equal(store.dailyActivity(7, NOW).complete, true);
  });

  test('reports INCOMPLETE once the store is full and its oldest event is inside the window', () => {
    // Fill to capacity with events that all land today, so the oldest retained
    // event is newer than the window start.
    const entries: ActivityEntry[] = [];
    for (let i = 0; i < 5000; i++) entries.push(entry('2026-08-19T09:00:00+05:00'));
    const store = storeWith(entries);

    const { buckets, complete } = store.dailyActivity(7, NOW);
    assert.equal(complete, false, 'the earliest buckets cannot be trusted and must say so');

    // The counts it CAN see are still returned — the flag qualifies them, it
    // does not blank the chart.
    assert.equal(buckets[6]!.verifications, 5000);
  });

  test('a full store whose oldest event predates the window is still complete', () => {
    const entries: ActivityEntry[] = [];
    for (let i = 0; i < 4999; i++) entries.push(entry('2026-08-19T09:00:00+05:00'));
    entries.push(entry('2026-07-01T09:00:00+05:00'));
    const store = storeWith(entries);

    assert.equal(store.dailyActivity(7, NOW).complete, true);
  });
});
