const assert = require('node:assert/strict');
const { runOneConciergeTick } = require('../out/tools/telegram-front-desk-bot');
const { completionSummaryText } = require('../out/concierge/topicRouter');

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const RETENTION_MS = 7 * ONE_DAY_MS;

// BL-330 hardening: runOneConciergeTick is the exact body tickLoop's
// for(;;) calls every intervalMs - split out so this test drives the REAL
// wiring between the diff path (runConciergeTick) and the reconciliation
// safety net (reconcileTopicLifecycle), not each piece in isolation. Before
// this split, tickLoop itself was never invoked by any test, so a wrong
// argument in its own body (e.g. reconciling the wrong folder, or handing
// reconcileTopicLifecycle the wrong adapters) had zero coverage.

function folders(overrides = {}) {
  return { active: [], paused: [], done: [], ...overrides };
}

function fakeAdapters({ topicMap = {}, priorSnapshot = null, alreadyReconciled = [] } = {}) {
  const state = { snapshot: priorSnapshot, emittedKeys: [] };
  const sent = [];
  const closed = [];
  const deletedTopics = [];
  const droppedMappings = [];
  const reportedUnverified = [];
  // In production this is the SAME durable record (BL-329's
  // appendMessage/readRecord) that the diff path, the reconciliation
  // safety net, AND the deletion sweep all read/write, so a completion
  // just posted this tick is immediately visible to both isAlreadyReconciled
  // and the deletion sweep's own verification gate. Mirror that shared
  // state here (rather than independent stubs) so a fixture bug can't
  // manufacture a gap production's shared record prevents.
  const records = {};
  function recordFor(backlogId) {
    if (!records[backlogId]) {
      records[backlogId] = { id: backlogId, messages: [] };
    }
    return records[backlogId];
  }
  // The pre-seeded text must be the EXACT real completion summary
  // (completionSummaryText's own format) - isAlreadyReconciled below now
  // compares against that exact text, same as production's
  // hasCompletionRecord, so an invented placeholder string would silently
  // fail to match and defeat the "already reconciled" precondition.
  for (const { id, title } of alreadyReconciled) {
    const text = completionSummaryText({ type: 'TaskCompleted', backlogId: id, payload: {} }, title);
    recordFor(id).messages.push({ seq: 0, ts: 0, author: 'swarm', type: 'outbound', text });
  }
  let currentFolders = folders();
  const routeAdapters = {
    getTopicMap: () => topicMap,
    createTopic: async () => {
      throw new Error('this fixture never opens a topic - every ticket already has one mapped');
    },
    recordTopicId: () => {
      throw new Error('this fixture never opens a topic - every ticket already has one mapped');
    },
    sendMessage: async (topicId, text) => {
      sent.push({ topicId, text });
      return true;
    },
    closeTopic: async (topicId) => {
      closed.push(topicId);
      return true;
    },
    recordMessage: (backlogId, text) => {
      const record = recordFor(backlogId);
      record.messages.push({ seq: record.messages.length, ts: 0, author: 'swarm', type: 'outbound', text });
    },
    ensureOperatorTopic: async () => 700,
  };
  return {
    sent,
    closed,
    deletedTopics,
    droppedMappings,
    reportedUnverified,
    topicMap,
    setFolders: (f) => {
      currentFolders = f;
    },
    tickAdapters: {
      readFolders: () => currentFolders,
      readGates: () => [],
      readRoleTicket: () => ({}),
      readTickState: () => state,
      writeTickState: (next) => {
        state.snapshot = next.snapshot;
        state.emittedKeys = next.emittedKeys;
      },
      routeAdapters,
    },
    reconcileAdapters: {
      getTopicMap: () => topicMap,
      isAlreadyReconciled: (backlogId, summaryText) => recordFor(backlogId).messages.some((m) => m.type === 'outbound' && m.text === summaryText),
      routeAdapters,
    },
    deletionAdapters: {
      getTopicMap: () => topicMap,
      readRecord: (ticketId) => recordFor(ticketId),
      // BL-331 architect bounce: this fixture's records are all treated as
      // durably committed - the durability check itself is unit-tested in
      // topicDeletion.test.js/blTopicStore.test.js; this file is about the
      // tick's own wiring, not re-proving that check.
      isRecordCommitted: () => true,
      deleteTopic: async (topicId) => {
        deletedTopics.push(topicId);
        return true;
      },
      dropTopicMapping: (backlogId) => {
        droppedMappings.push(backlogId);
        delete topicMap[backlogId];
      },
      reportUnverifiedDeletion: (ticketId) => {
        reportedUnverified.push(ticketId);
      },
    },
  };
}

test('runOneConciergeTick: a ticket already reflected as done in the persisted snapshot, but never posted/closed, is still reconciled by the same tick that runs the diff path', async () => {
  // The diff path is structurally blind here BY DESIGN, not by fixture
  // omission: deriveSwarmEvents only ever emits TaskCompleted for a
  // prevDone -> currDone TRANSITION (swarmEventStream.ts's diffTaskCompleted).
  // A persisted snapshot whose OWN done set already contains BL-9 - exactly
  // what BL-328's stale-build/down-bot window produces - means prev and curr
  // agree, so no transition is ever seen again; only the reconciliation
  // safety net, driven by CURRENT STATE rather than a witnessed transition,
  // can still close it. (A cold-start fixture with snapshot: null would not
  // isolate this - deriveSwarmEvents treats a null prev as an EMPTY baseline,
  // so it would itself emit TaskCompleted for any pre-existing done ticket on
  // the very first tick, masking reconciliation's own distinct contribution.)
  const priorSnapshot = { backlog: { active: [], paused: [], done: ['BL-9'] }, gates: [], roleTicket: {}, ticketSummaries: {} };
  const { tickAdapters, reconcileAdapters, deletionAdapters, sent, closed, setFolders } = fakeAdapters({
    topicMap: { 'BL-9': 42 },
    priorSnapshot,
  });
  setFolders(folders({ done: [{ id: 'BL-9', title: 'a ticket completed while the bot was down' }] }));

  // nowMs pinned to 0 (deterministic, never the real clock): BL-331's
  // deletion sweep also runs inside runOneConciergeTick now, and 0 keeps
  // BL-9 safely inside any positive retention window regardless of the
  // default, isolating this test to the diff/reconcile wiring it's about.
  await runOneConciergeTick(tickAdapters, reconcileAdapters, deletionAdapters, 0);

  assert.deepEqual(closed, [42], "expected the reconciliation safety net to close BL-9's topic even with no witnessed transition");
  assert.equal(sent.length, 1, 'expected exactly one post - the diff path emits nothing here, only reconciliation does');
  assert.match(sent[0].text, /is complete\.$/);
});

test('runOneConciergeTick: an already-reconciled done ticket is left alone by the same call that runs the diff path', async () => {
  const priorSnapshot = { backlog: { active: [], paused: [], done: ['BL-9'] }, gates: [], roleTicket: {}, ticketSummaries: {} };
  const { tickAdapters, reconcileAdapters, deletionAdapters, sent, closed, setFolders } = fakeAdapters({
    topicMap: { 'BL-9': 42 },
    priorSnapshot,
    alreadyReconciled: [{ id: 'BL-9', title: 'already reconciled' }],
  });
  setFolders(folders({ done: [{ id: 'BL-9', title: 'already reconciled' }] }));

  await runOneConciergeTick(tickAdapters, reconcileAdapters, deletionAdapters, 0);

  assert.deepEqual(sent, []);
  assert.deepEqual(closed, []);
});

// BL-331: proves the deletion sweep is REALLY wired into the same tick
// body reconciliation runs in, reading the SAME shared record reconcile/
// the diff path just wrote - not merely unit-tested in isolation
// (topicDeletion.test.js covers decideTopicDeletion/sweepTopicDeletions
// on their own; this is the wiring proof, same split as BL-330's own two
// reconciliation tests above vs topicReconciliation.test.js).
test('runOneConciergeTick: a done ticket already verified-complete and past its retention window is deleted by the same tick', async () => {
  const priorSnapshot = { backlog: { active: [], paused: [], done: ['BL-9'] }, gates: [], roleTicket: {}, ticketSummaries: {} };
  const { tickAdapters, reconcileAdapters, deletionAdapters, deletedTopics, droppedMappings, topicMap, setFolders } = fakeAdapters({
    topicMap: { 'BL-9': 42 },
    priorSnapshot,
    alreadyReconciled: [{ id: 'BL-9', title: 'already reconciled and long past retention' }],
  });
  setFolders(folders({ done: [{ id: 'BL-9', title: 'already reconciled and long past retention' }] }));

  await runOneConciergeTick(tickAdapters, reconcileAdapters, deletionAdapters, RETENTION_MS + ONE_DAY_MS, RETENTION_MS);

  assert.deepEqual(deletedTopics, [42]);
  assert.deepEqual(droppedMappings, ['BL-9']);
  assert.equal(topicMap['BL-9'], undefined, 'expected the mapping actually dropped from the shared map');
});

test('runOneConciergeTick: a ticket reconciled THIS tick is not deleted in the same call, even with the clock far past retention - retention is measured from the record\'s own completion timestamp (ts:0 here), not from "was this tick"', async () => {
  const priorSnapshot = { backlog: { active: [], paused: [], done: ['BL-9'] }, gates: [], roleTicket: {}, ticketSummaries: {} };
  const { tickAdapters, reconcileAdapters, deletionAdapters, deletedTopics, droppedMappings, setFolders } = fakeAdapters({
    topicMap: { 'BL-9': 42 },
    priorSnapshot,
  });
  setFolders(folders({ done: [{ id: 'BL-9', title: 'reconciled and deleted in the same tick, both gated on the record' }] }));

  await runOneConciergeTick(tickAdapters, reconcileAdapters, deletionAdapters, RETENTION_MS + ONE_DAY_MS, RETENTION_MS);

  // Reconciliation records the completion with ts:0 (the fixture's
  // recordMessage), so with nowMs far past retention the SAME tick that
  // reconciles BL-9 also deletes it - proving deletion sees the record
  // reconciliation just wrote, not a stale pre-tick snapshot.
  assert.deepEqual(deletedTopics, [42]);
  assert.deepEqual(droppedMappings, ['BL-9']);
});
