'use strict';

const assert = require('node:assert/strict');
const fc = require('fast-check');
const { clearQueuedPollIfStale } = require('../out/tools/telegramCursorBridgeLive');
const { decideQueuedPollAnswerAction } = require('../out/tools/telegramCursorBridgeCore');

// BL-811 coder property pass (BL-654: first authorship of a declared
// invariant's property test rests with the coder). Two of the ticket's three
// declared invariants get an executable encoding here; the third ("the
// poll-answer path remains live over the existing front-desk fan-out; no
// dark producer/consumer pair is introduced") gets a stated reason instead -
// recorded in backlog/evidence/BL-811-coder-pass.md - because
// attemptCursorBridgePollAnswerForward (telegramFrontDeskBotCore.ts) is an
// unconditional 3-line forwarder with no branching on poll_answer CONTENT
// (only on the truthiness of update.poll_answer and the adapter's
// presence): a generative property over that content would be tautological.
// That invariant is instead encoded end to end, over the REAL file-based
// queue, by acceptance scenario 10 in
// specs/features/BL-810-host-queue-selection-poll-clear-all-and-ttl.feature
// (bl810HostQueuePollClearAllTtlSteps.js).
//
// Runs ONLY via `npm run test:properties` (vitest.properties.config.mjs).

// ── Invariant 1: "No queued Host question can wait indefinitely behind
// stale queue state, stale poll state, or expired items." ──────────────────
//
// clearQueuedPollIfStale is the single gate this invariant reduces to:
// postQueueSelectionPoll (telegramCursorBridgeLive.ts) refuses to post a
// fresh poll ONLY while holder.state.pendingPromptPoll is still truthy after
// this function runs. So starvation is impossible exactly when this holds:
// clearQueuedPollIfStale NEVER leaves a poll in place unless that poll's
// itemIds are byte-identical (same ids, same order) to the CURRENT queue's
// offered head - any queue/poll mismatch (shrunk, grown, reordered, or the
// queue gone entirely) must clear the poll, unblocking the next tick's post.
//
// Generator reach: rather than a uniform random poll shape (which would
// rarely land on the exact-match case needed to prove the function does NOT
// over-clear), an explicit STRATEGY enum forces every interesting relation
// between poll and queue to appear on every run - mirrors
// bl797MutationGateProbeCrashFallback's exhaustive-combination pattern.
const QUEUE_POLL_MAX_OPTIONS = 8;

function mkQueue(n) {
  return Array.from({ length: n }, (_, i) => ({ id: `p${i}`, text: `item ${i}`, createdAtMs: i }));
}

const strategyArb = fc.constantFrom(
  'none', // no outstanding poll at all
  'exact', // poll matches the current head exactly, correct clearAllOptionIndex
  'exact-no-clearall', // poll matches the head exactly, clearAllOptionIndex absent (legacy-poll shape - accepted, unchanged by BL-811)
  'stale-order', // same id SET, different order
  'stale-subset', // poll offers fewer ids than the current head would
  'stale-foreign-id', // poll references an id not in the queue at all
  'stale-clearall', // itemIds match the head, but clearAllOptionIndex is a wrong number
  'empty-queue-poll' // poll present, but the queue itself is now empty
);

const caseArb = fc.integer({ min: 0, max: 10 }).chain((n) =>
  fc.record({ n: fc.constant(n), strategy: strategyArb })
);

function buildCase({ n, strategy }) {
  const queue = mkQueue(n);
  const head = queue.slice(0, Math.min(n, QUEUE_POLL_MAX_OPTIONS)).map((i) => i.id);
  let poll;
  let expectSurvives;
  switch (strategy) {
    case 'none':
      poll = undefined;
      expectSurvives = false; // trivially "survives" as undefined either way
      break;
    case 'exact':
      poll = head.length > 0 ? { pollId: 'p', itemIds: head, clearAllOptionIndex: head.length } : undefined;
      expectSurvives = head.length > 0;
      break;
    case 'exact-no-clearall':
      poll = head.length > 0 ? { pollId: 'p', itemIds: head } : undefined;
      expectSurvives = head.length > 0;
      break;
    case 'stale-order':
      poll = head.length >= 2 ? { pollId: 'p', itemIds: [...head].reverse(), clearAllOptionIndex: head.length } : undefined;
      expectSurvives = false;
      break;
    case 'stale-subset':
      poll =
        head.length >= 1
          ? { pollId: 'p', itemIds: head.slice(0, head.length - 1), clearAllOptionIndex: head.length - 1 }
          : undefined;
      expectSurvives = false;
      break;
    case 'stale-foreign-id':
      poll = { pollId: 'p', itemIds: [...head, 'not-in-queue'], clearAllOptionIndex: head.length + 1 };
      expectSurvives = false;
      break;
    case 'stale-clearall':
      poll = head.length > 0 ? { pollId: 'p', itemIds: head, clearAllOptionIndex: head.length + 5 } : undefined;
      expectSurvives = false;
      break;
    case 'empty-queue-poll':
      poll = { pollId: 'p', itemIds: ['gone-1', 'gone-2'], clearAllOptionIndex: 2 };
      expectSurvives = false;
      break;
    default:
      throw new Error(`unreachable strategy ${strategy}`);
  }
  return { queue, poll, expectSurvives };
}

test('property: clearQueuedPollIfStale never leaves a poll in place unless it exactly reflects the current queue head - every mismatch (order, subset, foreign id, wrong clear-all index, or an emptied queue) is cleared so the next tick is always free to post a fresh poll', () => {
  const sawEveryStrategy = new Set();
  fc.assert(
    fc.property(caseArb, (raw) => {
      sawEveryStrategy.add(raw.strategy);
      const { queue, poll, expectSurvives } = buildCase(raw);
      const input = { updateOffset: 0, pendingPrompts: queue, pendingPromptPoll: poll };
      const result = clearQueuedPollIfStale(input);
      if (!poll) {
        assert.equal(result.pendingPromptPoll, undefined);
        return;
      }
      if (expectSurvives) {
        assert.deepEqual(result.pendingPromptPoll, poll, `expected the poll to survive unchanged for strategy ${raw.strategy}`);
      } else {
        assert.equal(result.pendingPromptPoll, undefined, `expected the poll to be cleared for strategy ${raw.strategy}`);
      }
    }),
    { numRuns: 500 }
  );
  // Generator-reach floor (engineering.prompt): every declared strategy must
  // actually have been exercised, not just theoretically reachable.
  const expectedStrategies = [
    'none',
    'exact',
    'exact-no-clearall',
    'stale-order',
    'stale-subset',
    'stale-foreign-id',
    'stale-clearall',
    'empty-queue-poll',
  ];
  for (const s of expectedStrategies) {
    assert.ok(sawEveryStrategy.has(s), `generator never reached strategy "${s}" in 500 runs`);
  }
});

// ── Invariant 2: "Queue departures remain explicit and auditable:
// run-by-selection, clear-all, or TTL drop receipt." ────────────────────────
//
// decideQueuedPollAnswerAction is BL-811 D1's fix, extracted to a pure,
// exported function so its full input space (not just the one legacy-poll
// example the unit test pins) can be quantified over. The invariant's sharp
// edge is exactly D1: a 'clear-all' departure must never fire from an
// ambiguous undefined===undefined coincidence - it requires a REAL numeric
// match against a REAL numeric clearAllOptionIndex.
const itemIdsArb = fc.array(fc.string({ minLength: 1, maxLength: 4 }), { minLength: 0, maxLength: 6 });
const clearAllArb = fc.option(fc.integer({ min: -3, max: 10 }), { nil: undefined });
const selectedIndexArb = fc.option(fc.integer({ min: -3, max: 10 }), { nil: undefined });

test('property: decideQueuedPollAnswerAction only ever returns clear-all when clearAllOptionIndex is a real number match (BL-811 D1) - a retraction (selectedIndex undefined) against a legacy poll with no clearAllOptionIndex field is always ignored, never treated as a clear-all vote', () => {
  fc.assert(
    fc.property(
      fc.record({ itemIds: itemIdsArb, clearAllOptionIndex: clearAllArb }),
      selectedIndexArb,
      (pollFields, selectedIndex) => {
        const pendingPoll = { pollId: 'p', ...pollFields };
        const action = decideQueuedPollAnswerAction(pendingPoll, selectedIndex);
        assert.ok(['ignore', 'clear-all', 'select'].includes(action.kind));
        if (action.kind === 'clear-all') {
          assert.equal(typeof pendingPoll.clearAllOptionIndex, 'number', 'clear-all fired without a numeric clearAllOptionIndex');
          assert.equal(selectedIndex, pendingPoll.clearAllOptionIndex);
        }
        if (action.kind === 'select') {
          assert.equal(typeof selectedIndex, 'number');
          assert.ok(Number.isInteger(selectedIndex) && selectedIndex >= 0 && selectedIndex < pendingPoll.itemIds.length);
          assert.equal(action.itemId, pendingPoll.itemIds[selectedIndex]);
        }
      }
    ),
    { numRuns: 1000 }
  );
});

// D1's own exact regression shape, pinned directly (the property above
// covers it, but a mismatched fast-check shrink message is a worse debugging
// aid than a named failing example if this specific case ever regresses).
test('property: a vote retraction (option_ids: [] -> selectedIndex undefined) against a poll with no clearAllOptionIndex field never resolves as clear-all', () => {
  const pendingPoll = { pollId: 'legacy-poll', itemIds: ['qp-1'] };
  const action = decideQueuedPollAnswerAction(pendingPoll, undefined);
  assert.equal(action.kind, 'ignore');
});
