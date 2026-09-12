'use strict';

// BL-1455 declared invariants (coder first authorship - BL-654):
//
// 1. A ticket whose human_approval transitions to pending has a live
//    buttoned ask reflecting its CURRENT ruling_options within one
//    concierge tick, whatever ask history the store holds for that id.
// 2. A closed (decided) ask is never counted as a live ask by any consumer
//    deciding whether to post; the edge path and reconcile answer that
//    question through one predicate and agree (BL-1090 invariant 1 stays:
//    at most one LIVE ask per ticket).
// 3. BL-1090's guarantee is preserved: a crash between the Telegram post
//    and the durable tick-state write still produces no duplicate of an
//    undecided ask.
//
// Runs ONLY via `npm run test:properties` (vitest.properties.config.mjs);
// excluded from unit/coverage/mutation.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const { runConciergeTick } = require('../out/concierge/conciergeTick');
const { approvalAskRecordedOnLiveTopic } = require('../out/concierge/approvalAskReconcile');
const {
  readApprovalAskMessages,
  recordApprovalAskMessage,
  updateApprovalAskMessageText,
  approvalAskMessagesPath,
} = require('../out/tools/telegram-front-desk-bot');

const LIVE_TOPIC = 750;
const STALE_TOPIC = 100;

function noopIconAdapters() {
  return {
    getIconStickers: async () => [],
    setTopicIcon: async () => true,
    readSwarmIconId: () => undefined,
    recordSwarmIconId: () => 'recorded',
  };
}

// Wires the concierge tick's ask machinery to the REAL on-disk store
// (telegram-front-desk-bot.ts's readApprovalAskMessages/recordApprovalAskMessage),
// exactly as telegram-front-desk-bot.ts's own buildConciergeTickAdapters does
// - never a second, hand-rolled approximation of the store's overwrite
// semantics (the thing scenario 05's loop guard actually depends on).
function conciergeAdaptersForApprovals(root, folders, sent) {
  const state = { snapshot: null, emittedKeys: [] };
  return {
    state,
    readFolders: () => folders,
    readGates: () => [],
    readRoleTicket: () => ({}),
    readTickState: () => state,
    writeTickState: (s) => {
      state.snapshot = s.snapshot;
      state.emittedKeys = s.emittedKeys;
    },
    readApprovalAskMessages: () => readApprovalAskMessages(root),
    routeAdapters: {
      getTopicMap: () => ({}),
      createTopic: async () => ({ success: true, topicId: 1 }),
      recordTopicId: () => {},
      sendMessage: async () => true,
      closeTopic: async () => true,
      recordMessage: () => {},
      ensureOperatorTopic: async () => 700,
      ensureApprovalsTopic: async () => LIVE_TOPIC,
      sendApprovalAsk: async (topicId, text, buttons) => {
        const messageId = 1000 + sent.length;
        sent.push({ topicId, text, buttons });
        return { success: true, messageId };
      },
      recordApprovalAskMessageId: (backlogId, topicId, messageId, text) =>
        recordApprovalAskMessage(root, backlogId, topicId, messageId, text),
      ensureBacklogTopic: async () => 760,
      postMessage: async () => 1,
      editMessage: async () => true,
      getTicketMessageState: () => undefined,
      setTicketMessageState: () => {},
    },
    iconAdapters: noopIconAdapters(),
  };
}

function emptySnapshot() {
  return { backlog: { active: [], paused: [], done: [] }, gates: [], roleTicket: {}, ticketSummaries: {}, pendingApproval: [] };
}

const rulingOptionArb = fc
  .stringMatching(/^[A-Za-z][A-Za-z0-9 ]{0,20}$/)
  .map((s) => s.trim())
  .filter((s) => s.length > 0);
const rulingOptionsArb = fc.uniqueArray(rulingOptionArb, { maxLength: 4 });

// The five prior-ask-history shapes the ticket's own text singles out:
// no record at all, closed on the live topic (structured flag), closed on
// the live topic via ONLY the legacy decided-text suffix (a record written
// before this ticket landed), closed on a stale topic id (remint), and a
// still-live undecided ask (the BL-1090 crash-recovery case).
const priorAskKindArb = fc.constantFrom('none', 'closedOnLive', 'closedOnLiveLegacyText', 'closedOnStale', 'liveUndecided');

function seedPriorAsk(root, id, kind) {
  if (kind === 'none') {
    return;
  }
  if (kind === 'closedOnLive') {
    recordApprovalAskMessage(root, id, LIVE_TOPIC, 1, `${id} needs your approval`);
    updateApprovalAskMessageText(root, id, `${id} needs your approval\n-- Ruled: X 2026-01-01 00:00 UTC`);
    return;
  }
  if (kind === 'closedOnLiveLegacyText') {
    // Bypasses updateApprovalAskMessageText on purpose: this simulates a
    // record persisted BEFORE BL-1455 landed, which never got a `closed`
    // field at all - only the decided-text suffix BL-484 always appended.
    fs.mkdirSync(path.dirname(approvalAskMessagesPath(root)), { recursive: true });
    fs.writeFileSync(
      approvalAskMessagesPath(root),
      JSON.stringify({ [id]: { topicId: LIVE_TOPIC, messageId: 1, text: `${id} needs your approval\n-- Approved 2026-01-01 00:00 UTC` } })
    );
    return;
  }
  if (kind === 'closedOnStale') {
    recordApprovalAskMessage(root, id, STALE_TOPIC, 1, `${id} needs your approval`);
    updateApprovalAskMessageText(root, id, `${id} needs your approval\n-- Approved 2026-01-01 00:00 UTC`);
    return;
  }
  // liveUndecided
  recordApprovalAskMessage(root, id, LIVE_TOPIC, 1, `${id} needs your approval`);
}

// ── Invariant 1 ───────────────────────────────────────────────────────────
//
// Non-vacuity (checked by hand): reverting approvalAsksNeedingRepost's
// closed-on-live-topic branch (so a closed ask on the live topic reads as
// "no repost needed", the pre-fix behaviour) fails this property on the
// first closedOnLive*/closedOnStale case generated, since sent.length stays
// 0 where the property demands 1. Restored, all runs pass.
test('BL-1455 invariant 1: a not-pending to pending transition ends the tick with a live ask reflecting current ruling_options, whatever prior ask history the store holds', async () => {
  const reached = new Set();
  await fc.assert(
    fc.asyncProperty(fc.integer({ min: 1, max: 1000000 }), rulingOptionsArb, priorAskKindArb, async (n, rulingOptions, priorAskKind) => {
      const id = `BL-${1455000 + n}`;
      const root = mkTmpDir('bl1455-inv1-');
      const folderItem = { id, title: 'fixture', humanApproval: 'pending' };
      if (rulingOptions.length) {
        folderItem.rulingOptions = rulingOptions;
      }
      const folders = { active: [], paused: [folderItem], done: [] };
      const sent = [];
      const adapters = conciergeAdaptersForApprovals(root, folders, sent);
      // Baseline: the ticket was NOT pending before this tick (it was
      // approved earlier) - the not-pending -> pending edge fires this tick.
      adapters.writeTickState({ snapshot: emptySnapshot(), emittedKeys: priorAskKind === 'none' ? [] : [`ApprovalRequested:${id}`] });
      seedPriorAsk(root, id, priorAskKind);
      reached.add(priorAskKind);

      await runConciergeTick(adapters);

      const recordedAsks = readApprovalAskMessages(root);
      assert.ok(recordedAsks[id], `expected a stored ask record for ${id} after the tick`);
      assert.equal(recordedAsks[id].topicId, LIVE_TOPIC, 'the record must target the live Approvals topic');
      assert.equal(approvalAskRecordedOnLiveTopic(id, recordedAsks, LIVE_TOPIC), true, 'the record must read as a LIVE ask');

      if (priorAskKind === 'liveUndecided') {
        // Already had a live, undecided ask for THIS transition - BL-1090's
        // guarantee: no duplicate.
        assert.equal(sent.length, 0, 'an already-live undecided ask must not be reposted');
        return;
      }
      assert.equal(sent.length, 1, `expected exactly one fresh ask for ${priorAskKind}, got ${sent.length}`);
      const buttons = sent[0].buttons;
      if (rulingOptions.length) {
        assert.equal(buttons.length, rulingOptions.length + 2, 'one row per ruling option plus the two default verb rows');
        rulingOptions.forEach((label, i) => {
          assert.deepEqual(
            buttons[i].map((b) => b.text),
            [label]
          );
        });
      } else {
        assert.equal(buttons.length, 2, 'no ruling options declared: only the two default verb rows');
        assert.ok(buttons[0].some((b) => b.text === 'Approve'), 'plain decision buttons when no options are declared');
      }
    }),
    { numRuns: 40 }
  );
  for (const kind of ['none', 'closedOnLive', 'closedOnLiveLegacyText', 'closedOnStale', 'liveUndecided']) {
    assert.ok(reached.has(kind), `generator reach: priorAskKind=${kind} was never generated`);
  }
});

// ── Invariant 2 ───────────────────────────────────────────────────────────
//
// Non-vacuity (checked by hand): approvalAskRecordedOnLiveTopic without the
// isAskClosed check (the pre-fix body) reads BOTH the closed and open
// fixtures below as live, failing the first assertion. Restored, all runs
// pass.
test('BL-1455 invariant 2: a decided ask never reads as live, whether marked by the structured flag or only the legacy decided-text suffix - the ONE predicate both the edge guard and reconcile share', () => {
  const reached = new Set();
  fc.assert(
    fc.property(fc.integer({ min: 1, max: 100 }), fc.boolean(), (topicId, useLegacyTextOnly) => {
      reached.add(useLegacyTextOnly);
      const decidedText = 'ask text\n-- Approved 2026-09-05 08:14 UTC';
      const closedRecord = useLegacyTextOnly ? { topicId, text: decidedText } : { topicId, closed: true };
      const openRecord = useLegacyTextOnly ? { topicId, text: 'ask text' } : { topicId, closed: false };

      assert.equal(approvalAskRecordedOnLiveTopic('X', { X: closedRecord }, topicId), false, 'a decided ask must never read as live');
      assert.equal(approvalAskRecordedOnLiveTopic('X', { X: openRecord }, topicId), true, 'an undecided ask on the live topic must read as live');
    }),
    { numRuns: 50 }
  );
  for (const flag of [true, false]) {
    assert.ok(reached.has(flag), `generator reach: useLegacyTextOnly=${flag} was never generated`);
  }
});

// ── Invariant 3 ───────────────────────────────────────────────────────────
//
// Non-vacuity (checked by hand): dropping suppressEdgeApprovalRequestedWhenAskOnLiveTopic's
// call entirely (so the edge re-derives ApprovalRequested every tick
// regardless of the ask store) makes sent.length grow past 1 across the
// retried ticks below, failing this property on the first crashTicks>=1
// case generated. Restored, all runs pass.
test('BL-1455 invariant 3: a crash between the Telegram post and the durable tick-state write produces no duplicate of an undecided ask, across any number of retried ticks', async () => {
  await fc.assert(
    fc.asyncProperty(fc.integer({ min: 1, max: 1000000 }), fc.integer({ min: 1, max: 5 }), async (n, crashTicks) => {
      const id = `BL-${1455100 + n}`;
      const root = mkTmpDir('bl1455-inv3-');
      const folders = { active: [], paused: [{ id, title: 'fixture', humanApproval: 'pending' }], done: [] };
      const sent = [];
      const adapters = conciergeAdaptersForApprovals(root, folders, sent);

      // Tick 1: the edge fires, posts, and the store write lands - but the
      // durable tick-state write "crashes" (never called), so the baseline
      // still shows not-pending for every retry below.
      adapters.writeTickState({ snapshot: emptySnapshot(), emittedKeys: [] });
      await runConciergeTick(adapters);
      assert.equal(sent.length, 1, 'the first tick must post exactly one ask');
      // Simulate the crash: the durable snapshot/emittedKeys never got
      // written, so state stays at its pre-tick baseline.
      adapters.state.snapshot = emptySnapshot();
      adapters.state.emittedKeys = [];

      for (let i = 0; i < crashTicks; i += 1) {
        await runConciergeTick(adapters);
        adapters.state.snapshot = emptySnapshot();
        adapters.state.emittedKeys = [];
      }

      assert.equal(sent.length, 1, `expected no duplicate across ${crashTicks} retried ticks after the crash, got ${sent.length} posts`);
      const recordedAsks = readApprovalAskMessages(root);
      assert.equal(approvalAskRecordedOnLiveTopic(id, recordedAsks, LIVE_TOPIC), true, 'the one posted ask must still read as live');
    }),
    { numRuns: 25 }
  );
});
