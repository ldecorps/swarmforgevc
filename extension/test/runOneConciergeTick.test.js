const assert = require('node:assert/strict');
const { runOneConciergeTick } = require('../out/tools/telegram-front-desk-bot');

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

function fakeAdapters({ topicMap = {}, priorSnapshot = null, alreadyReconciledIds = [] } = {}) {
  const state = { snapshot: priorSnapshot, emittedKeys: [] };
  const sent = [];
  const closed = [];
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
    // In production this is the SAME durable record (BL-329's
    // appendMessage/readRecord) that both the diff path and the
    // reconciliation safety net read and write, so a completion the diff
    // path just posted is immediately visible to isAlreadyReconciled within
    // the SAME tick - the two mechanisms cannot double-post. Mirror that
    // shared state here (rather than a no-op stub) so a fixture bug can't
    // manufacture a double-post that production's shared record prevents.
    recordMessage: (backlogId) => {
      if (!alreadyReconciledIds.includes(backlogId)) {
        alreadyReconciledIds.push(backlogId);
      }
    },
    ensureOperatorTopic: async () => 700,
  };
  return {
    sent,
    closed,
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
      isAlreadyReconciled: (backlogId) => alreadyReconciledIds.includes(backlogId),
      routeAdapters,
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
  const { tickAdapters, reconcileAdapters, sent, closed, setFolders } = fakeAdapters({
    topicMap: { 'BL-9': 42 },
    priorSnapshot,
  });
  setFolders(folders({ done: [{ id: 'BL-9', title: 'a ticket completed while the bot was down' }] }));

  await runOneConciergeTick(tickAdapters, reconcileAdapters);

  assert.deepEqual(closed, [42], "expected the reconciliation safety net to close BL-9's topic even with no witnessed transition");
  assert.equal(sent.length, 1, 'expected exactly one post - the diff path emits nothing here, only reconciliation does');
  assert.match(sent[0].text, /is complete\.$/);
});

test('runOneConciergeTick: an already-reconciled done ticket is left alone by the same call that runs the diff path', async () => {
  const priorSnapshot = { backlog: { active: [], paused: [], done: ['BL-9'] }, gates: [], roleTicket: {}, ticketSummaries: {} };
  const { tickAdapters, reconcileAdapters, sent, closed, setFolders } = fakeAdapters({
    topicMap: { 'BL-9': 42 },
    priorSnapshot,
    alreadyReconciledIds: ['BL-9'],
  });
  setFolders(folders({ done: [{ id: 'BL-9', title: 'already reconciled' }] }));

  await runOneConciergeTick(tickAdapters, reconcileAdapters);

  assert.deepEqual(sent, []);
  assert.deepEqual(closed, []);
});
