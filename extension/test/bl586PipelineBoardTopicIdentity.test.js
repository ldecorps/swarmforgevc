const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  validateBoardTopic,
  syncPipelineBoard,
} = require('../out/concierge/pipelineBoardSync');
const {
  PIPELINE_BOARD_SUBJECT_ID,
  PIPELINE_BOARD_TOPIC_NAME,
  decideEnsurePipelineBoardTopicAction,
} = require('../out/tools/telegramTopicDecisions');
const { ensureBoardTopicAdapter, readTopicMap } = require('../out/tools/telegram-front-desk-bot');

// BL-586. The board trusted TickState.pipelineBoard.topicId unconditionally
// and, whenever that id was cleared (BL-497's topic-gone self-heal does
// exactly that), minted a brand new topic with no reuse-lookup and no
// durable record. Both halves fired in production: on 2026-07-23 the stored
// id was 1634, which telegram-topic-map.json already knew was SUP-7; on
// 2026-08-21 it was 14647 = SUP-5. The board - including its only-pin
// enforcement - posted into the human's support thread, while every
// topic-gone failure left another untracked "Pipeline Board" zombie behind.
//
// These tests pin both declared invariants at the LIVE path, not only at the
// pure helpers: invariant 1 (validate before every post) is exercised through
// syncPipelineBoard, so a guard that exists but is never reached from
// resolveBoardTopicId's trust branch fails here - the BL-419 shape this
// ticket's required_wiring exists to catch.

const STANDING_IDS_REL = path.join('.swarmforge', 'operator', 'telegram-standing-topic-ids.json');
const TOPIC_MAP_REL = path.join('.swarmforge', 'operator', 'telegram-topic-map.json');

function mkRoot() {
  return mkTmpDir('sfvc-bl586-board-identity-');
}

function writeJson(root, relPath, value) {
  const full = path.join(root, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, JSON.stringify(value));
}

function readStandingIds(root) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, STANDING_IDS_REL), 'utf8'));
  } catch {
    return {};
  }
}

// A board data payload whose rendered signature is stable but differs from
// `undefined`, so every sync below takes the real resolve-and-post path
// rather than the skipped-unchanged short circuit. `parked` is the knob a
// test turns when it needs a SECOND tick whose content genuinely changed.
function boardData(parked = []) {
  return { rows: [], parked, collapsedEpics: [], rootIntake: [], recentlyClosed: [], links: [] };
}

function parkedEntry(id) {
  return { id, slug: `${id.toLowerCase()}-a-parked-slice`, status: 'parked' };
}

// Records every adapter interaction so a test can assert not just the end
// state but WHICH topic was written into and in what order.
function recordingAdapters({ ensureTopicId, topicMap = {} } = {}) {
  const calls = { posted: [], deleted: [], ensured: 0, alerts: [] };
  return {
    calls,
    adapters: {
      readTopicMap: async () => topicMap,
      ensureBoardTopic: async () => {
        calls.ensured += 1;
        return ensureTopicId === undefined ? { error: 'no topic' } : { topicId: ensureTopicId };
      },
      postMessage: async (topicId) => {
        calls.posted.push(topicId);
        return { messageId: 500 + calls.posted.length };
      },
      deleteMessage: async (topicId, messageId) => {
        calls.deleted.push({ topicId, messageId });
        return true;
      },
      emitCrossedTopicAlert: async (message) => {
        calls.alerts.push(message);
        return true;
      },
    },
  };
}

// ── validateBoardTopic: the pure collision verdict ───────────────────────

test('BL-586: a stored id the topic map attributes to another subject is crossed, naming both the id and that subject', () => {
  for (const [topicId, subject] of [[14647, 'SUP-5'], [1785, 'APPROVALS'], [3864, 'OPERATOR']]) {
    const verdict = validateBoardTopic({ [String(topicId)]: subject }, topicId);
    assert.deepEqual(verdict, { kind: 'crossed', topicId, subject }, `topic ${topicId} -> ${subject}`);
  }
});

test('BL-586: a stored id the topic map attributes to PIPELINE_BOARD is valid', () => {
  assert.deepEqual(validateBoardTopic({ '6795': PIPELINE_BOARD_SUBJECT_ID }, 6795), { kind: 'ok' });
});

test('BL-586: a stored id the topic map says nothing about is valid - an absent binding is not a crossing', () => {
  assert.deepEqual(validateBoardTopic({ '14647': 'SUP-5' }, 6795), { kind: 'ok' });
  assert.deepEqual(validateBoardTopic({}, 6795), { kind: 'ok' });
});

test('BL-586: an unreadable/absent topic map is not a crossing - a missing map never blocks the board', () => {
  assert.deepEqual(validateBoardTopic(undefined, 6795), { kind: 'ok' });
});

// ── decideEnsurePipelineBoardTopicAction: reuse-or-create ────────────────

test('BL-586: the topic map binding PIPELINE_BOARD is reused, never re-minted', () => {
  const decision = decideEnsurePipelineBoardTopicAction({ '6795': PIPELINE_BOARD_SUBJECT_ID }, undefined);
  assert.deepEqual(decision, { kind: 'reuse', topicId: 6795 });
});

test('BL-586: a standing record survives a lost map binding - rebind, never create', () => {
  const decision = decideEnsurePipelineBoardTopicAction({ '14647': 'SUP-5' }, 6795);
  assert.deepEqual(decision, { kind: 'rebind', topicId: 6795 });
});

test('BL-586: with neither a map binding nor a standing record there is nothing to reuse - create', () => {
  assert.deepEqual(decideEnsurePipelineBoardTopicAction({ '14647': 'SUP-5' }, undefined), { kind: 'create' });
  assert.deepEqual(decideEnsurePipelineBoardTopicAction({}, undefined), { kind: 'create' });
});

// ── the LIVE path: resolveBoardTopicId must reach the guard ──────────────

test('BL-586 invariant 1: a crossed stored id is refused before any post, and the support thread receives nothing', async () => {
  const { adapters, calls } = recordingAdapters({ ensureTopicId: 6795, topicMap: { '14647': 'SUP-5' } });
  const result = await syncPipelineBoard(boardData(), { topicId: 14647 }, adapters, 1000);

  assert.equal(calls.posted.includes(14647), false, 'the board must never post into the crossed topic');
  assert.deepEqual(calls.posted, [6795]);
  assert.equal(calls.ensured, 1, 'a refused identity re-ensures from the durable record');
  assert.equal(result.state.topicId, 6795);
});

test('BL-586 invariant 1: the refusal emits one operator alert naming the crossed id and the subject it is mapped to', async () => {
  const { adapters, calls } = recordingAdapters({ ensureTopicId: 6795, topicMap: { '14647': 'SUP-5' } });
  await syncPipelineBoard(boardData(), { topicId: 14647 }, adapters, 1000);

  assert.equal(calls.alerts.length, 1);
  assert.match(calls.alerts[0], /14647/);
  assert.match(calls.alerts[0], /SUP-5/);
});

test('BL-586 invariant 1: validation runs on EVERY resolve, not only at mint - a board topic that stays bound keeps posting with no re-ensure', async () => {
  const { adapters, calls } = recordingAdapters({ ensureTopicId: 9999, topicMap: { '6795': PIPELINE_BOARD_SUBJECT_ID } });
  const result = await syncPipelineBoard(boardData(), { topicId: 6795 }, adapters, 1000);

  assert.deepEqual(calls.posted, [6795]);
  assert.equal(calls.ensured, 0, 'a valid identity is trusted - no needless re-ensure');
  assert.equal(calls.alerts.length, 0);
  assert.equal(result.state.topicId, 6795);
});

test('BL-586: a refused identity carries no message state into the new topic - no delete is aimed at either topic', async () => {
  const { adapters, calls } = recordingAdapters({ ensureTopicId: 6795, topicMap: { '14647': 'SUP-5' } });
  const result = await syncPipelineBoard(
    boardData(),
    { topicId: 14647, messageId: 32923, orphanMessageIds: [32608] },
    adapters,
    1000
  );

  assert.deepEqual(calls.deleted, [], 'a message id belonging to the crossed topic is never deleted from the new one');
  assert.equal(result.state.messageId, 501);
  assert.equal(result.state.orphanMessageIds, undefined);
  assert.equal(result.outcome, 'posted', 'the rebound board is a first post in its new topic, not a repost');
});

test('BL-586 scenario 04: a crossed in-memory identity self-corrects on the next resolve with no operator file edit between them', async () => {
  const { adapters, calls } = recordingAdapters({ ensureTopicId: 6795, topicMap: { '14647': 'SUP-5' } });

  const first = await syncPipelineBoard(boardData(), { topicId: 14647 }, adapters, 1000);
  const second = await syncPipelineBoard(boardData([parkedEntry('BL-777')]), first.state, adapters, 2000);

  assert.equal(second.state.topicId, 6795);
  assert.equal(calls.posted.includes(14647), false, 'topic 14647 receives no board post across either tick');
  assert.equal(calls.ensured, 1, 'the second tick trusts the now-valid identity rather than re-ensuring again');
});

test('BL-586: a state reset with no stored id still re-ensures - the create branch is unchanged by the guard', async () => {
  const { adapters, calls } = recordingAdapters({ ensureTopicId: 6795, topicMap: {} });
  const result = await syncPipelineBoard(boardData(), { topicId: undefined }, adapters, 1000);

  assert.equal(calls.ensured, 1);
  assert.deepEqual(calls.posted, [6795]);
  assert.equal(result.state.topicId, 6795);
});

test('BL-586: a board with no readTopicMap adapter wired still resolves - the guard degrades open, never blocking the board', async () => {
  const { adapters, calls } = recordingAdapters({ ensureTopicId: 6795, topicMap: {} });
  delete adapters.readTopicMap;
  const result = await syncPipelineBoard(boardData(), { topicId: 6795 }, adapters, 1000);

  assert.deepEqual(calls.posted, [6795]);
  assert.equal(result.state.topicId, 6795);
});

test('BL-586: a readTopicMap adapter that THROWS still resolves - the guard degrades open on a bad read exactly as it does on a missing adapter', async () => {
  const { adapters, calls } = recordingAdapters({ ensureTopicId: 6795, topicMap: {} });
  adapters.readTopicMap = async () => {
    throw new Error('simulated unreadable topic map');
  };
  const result = await syncPipelineBoard(boardData(), { topicId: 6795 }, adapters, 1000);

  assert.deepEqual(calls.posted, [6795], 'a throwing map read must never freeze or refuse the board');
  assert.equal(calls.ensured, 0, 'degrading open trusts the stored id rather than re-ensuring');
  assert.equal(calls.alerts.length, 0);
  assert.equal(result.state.topicId, 6795);
});

test('BL-586: a refusal with no alert adapter wired still refuses - the alert is observability, not the guard', async () => {
  const { adapters, calls } = recordingAdapters({ ensureTopicId: 6795, topicMap: { '14647': 'SUP-5' } });
  delete adapters.emitCrossedTopicAlert;
  await syncPipelineBoard(boardData(), { topicId: 14647 }, adapters, 1000);

  assert.equal(calls.posted.includes(14647), false);
  assert.deepEqual(calls.posted, [6795]);
});

// ── ensureBoardTopicAdapter: reuse-or-create over the durable record ─────

test('BL-586 invariant 2: a cleared tick state reuses the recorded standing PIPELINE_BOARD id - createForumTopic is not called', async () => {
  const root = mkRoot();
  writeJson(root, STANDING_IDS_REL, { APPROVALS: 1785, OPERATOR: 3864, [PIPELINE_BOARD_SUBJECT_ID]: 6795 });
  const calls = [];
  const postFn = async (url, body) => {
    calls.push({ url, body });
    return { ok: true, status: 200, json: { ok: true, result: { message_thread_id: 7777 } } };
  };

  const result = await ensureBoardTopicAdapter(root, 'fake-token', 'fake-chat', postFn);

  assert.deepEqual(result, { topicId: 6795 });
  assert.equal(calls.length, 0, 'a durably known board topic is never re-minted');
});

test('BL-586 invariant 2: a topic map binding is reused even with no standing record, and the standing record is repaired', async () => {
  const root = mkRoot();
  writeJson(root, TOPIC_MAP_REL, { '6795': PIPELINE_BOARD_SUBJECT_ID });
  const calls = [];
  const postFn = async () => {
    calls.push('create');
    return { ok: true, status: 200, json: { ok: true, result: { message_thread_id: 7777 } } };
  };

  const result = await ensureBoardTopicAdapter(root, 'fake-token', 'fake-chat', postFn);

  assert.deepEqual(result, { topicId: 6795 });
  assert.equal(calls.length, 0);
  assert.equal(readStandingIds(root)[PIPELINE_BOARD_SUBJECT_ID], 6795);
});

test('BL-586 invariant 2: a lost map binding rebinds the standing id rather than minting a second Pipeline Board', async () => {
  const root = mkRoot();
  writeJson(root, TOPIC_MAP_REL, { '14647': 'SUP-5' });
  writeJson(root, STANDING_IDS_REL, { [PIPELINE_BOARD_SUBJECT_ID]: 6795 });
  const calls = [];
  const postFn = async () => {
    calls.push('create');
    return { ok: true, status: 200, json: { ok: true, result: { message_thread_id: 7777 } } };
  };

  const result = await ensureBoardTopicAdapter(root, 'fake-token', 'fake-chat', postFn);

  assert.deepEqual(result, { topicId: 6795 });
  assert.equal(calls.length, 0);
  assert.equal(readTopicMap(root)['6795'], PIPELINE_BOARD_SUBJECT_ID);
  assert.equal(readTopicMap(root)['14647'], 'SUP-5', 'rebinding the board never disturbs another subject');
});

test('BL-586 invariant 2: with nothing durable to reuse a topic is minted, and both the standing record and the map bind it', async () => {
  const root = mkRoot();
  const calls = [];
  const postFn = async (url, body) => {
    calls.push({ url, body });
    return { ok: true, status: 200, json: { ok: true, result: { message_thread_id: 6795 } } };
  };

  const result = await ensureBoardTopicAdapter(root, 'fake-token', 'fake-chat', postFn);

  assert.deepEqual(result, { topicId: 6795 });
  assert.equal(calls.length, 1);
  assert.match(calls[0].body, new RegExp(`"name":"${PIPELINE_BOARD_TOPIC_NAME}"`));
  assert.equal(readStandingIds(root)[PIPELINE_BOARD_SUBJECT_ID], 6795);
  assert.equal(readTopicMap(root)['6795'], PIPELINE_BOARD_SUBJECT_ID);
});

test('BL-586 invariant 2: a failed create surfaces the Telegram error and records no identity at all', async () => {
  const root = mkRoot();
  const postFn = async () => ({ ok: false, status: 400, json: { ok: false, description: 'Bad Request: message thread not found' } });

  const result = await ensureBoardTopicAdapter(root, 'fake-token', 'fake-chat', postFn);

  assert.equal(result.topicId, undefined);
  assert.match(result.error, /message thread not found/);
  assert.deepEqual(readStandingIds(root), {}, 'a failed mint must never leave a phantom standing record');
});

// The crash window this ticket names: the end state is identical whether the
// id is recorded before or after the first post, so assert the ORDERING. The
// board's own post adapter snapshots the standing record at the instant it is
// called - if the record is written afterwards, the snapshot is empty.
test('BL-586 invariant 2: a newly minted id is in the standing record BEFORE the board posts into it', async () => {
  const root = mkRoot();
  const seenAtPostTime = [];
  const postFn = async () => ({ ok: true, status: 200, json: { ok: true, result: { message_thread_id: 6795 } } });

  const adapters = {
    readTopicMap: async () => readTopicMap(root),
    ensureBoardTopic: () => ensureBoardTopicAdapter(root, 'fake-token', 'fake-chat', postFn),
    postMessage: async (topicId) => {
      seenAtPostTime.push({ topicId, standing: readStandingIds(root)[PIPELINE_BOARD_SUBJECT_ID] });
      return { messageId: 1 };
    },
    deleteMessage: async () => true,
  };

  await syncPipelineBoard(boardData(), undefined, adapters, 1000);

  assert.deepEqual(seenAtPostTime, [{ topicId: 6795, standing: 6795 }]);
});
