const assert = require('node:assert/strict');
const { syncPipelineBoard } = require('../out/concierge/pipelineBoardSync');
const { renderPipelineBoardBody } = require('../out/concierge/pipelineBoard');

function fakeAdapters(overrides = {}) {
  return {
    ensureBoardTopic: async () => 900,
    postMessage: async () => 1,
    deleteMessage: async () => true,
    ...overrides,
  };
}

function board(rows, parked = []) {
  return { rows, parked };
}

const T1 = Date.UTC(2026, 6, 16, 20, 5);
const T2 = Date.UTC(2026, 6, 16, 20, 6);

// BL-462 pipeline-board-refine-05: the board is posted once with nothing to
// delete, then a later content change reposts (delete old + post new) at
// the bottom - never edited in place.

test('syncPipelineBoard: first call with no prior state creates the topic, posts a new message, and deletes nothing', async () => {
  const created = [];
  const posted = [];
  const deleted = [];
  const result = await syncPipelineBoard(
    board([{ id: 'BL-1', column: 'coder', slug: '' }]),
    undefined,
    fakeAdapters({
      ensureBoardTopic: async () => {
        created.push(true);
        return 900;
      },
      postMessage: async (topicId, text) => {
        posted.push({ topicId, text });
        return 42;
      },
      deleteMessage: async (topicId, messageId) => {
        deleted.push({ topicId, messageId });
        return true;
      },
    }),
    T1
  );

  assert.equal(result.outcome, 'posted');
  assert.equal(created.length, 1);
  assert.equal(deleted.length, 0, 'expected no delete call - nothing was posted before');
  assert.deepEqual(posted, [{ topicId: 900, text: result.state.contentSignature + '\n\nupdated at Jul 16 20:05' }]);
  assert.equal(result.state.topicId, 900);
  assert.equal(result.state.messageId, 42);
  assert.equal(result.state.lastChangeMs, T1);
  assert.equal(result.state.contentSignature, renderPipelineBoardBody(board([{ id: 'BL-1', column: 'coder', slug: '' }])));
});

test('syncPipelineBoard: a content change posts the fresh message BEFORE deleting the previously posted one', async () => {
  const calls = [];
  const first = await syncPipelineBoard(board([{ id: 'BL-1', column: 'coder', slug: '' }]), undefined, fakeAdapters(), T1);

  const result = await syncPipelineBoard(
    board([{ id: 'BL-1', column: 'QA', slug: '' }]),
    first.state,
    fakeAdapters({
      postMessage: async (topicId, text) => {
        calls.push({ fn: 'post', topicId, text });
        return 99;
      },
      deleteMessage: async (topicId, messageId) => {
        calls.push({ fn: 'delete', topicId, messageId });
        return true;
      },
    }),
    T2
  );

  assert.equal(result.outcome, 'reposted');
  // BL-468: post-then-delete, never the reverse - there must be at least
  // one board message visible at every instant, and a post failure (see
  // the dedicated test below) must never have already deleted the old one.
  assert.deepEqual(
    calls.map((c) => c.fn),
    ['post', 'delete']
  );
  const [postCall, deleteCall] = calls;
  assert.equal(deleteCall.topicId, 900);
  assert.equal(deleteCall.messageId, first.state.messageId);
  assert.equal(postCall.topicId, 900);
  assert.equal(result.state.messageId, 99);
  assert.equal(result.state.topicId, 900);
  assert.equal(result.state.lastChangeMs, T2, 'expected the footer instant bumped to the NEW change');
});

test('BL-468: a failed repost never deletes the old message, and its messageId stays in state - the board is always visible', async () => {
  const deleted = [];
  const first = await syncPipelineBoard(board([{ id: 'BL-1', column: 'coder', slug: '' }]), undefined, fakeAdapters(), T1);

  const result = await syncPipelineBoard(
    board([{ id: 'BL-1', column: 'QA', slug: '' }]),
    first.state,
    fakeAdapters({
      postMessage: async () => undefined,
      deleteMessage: async (topicId, messageId) => {
        deleted.push({ topicId, messageId });
        return true;
      },
    }),
    T2
  );

  assert.equal(result.outcome, 'failed-post');
  assert.deepEqual(deleted, [], 'expected the old message never deleted when the fresh post fails');
  assert.equal(result.state.messageId, first.state.messageId, "expected the OLD (still-live) message's id to stay in state");
  assert.equal(result.state.topicId, 900);
  assert.equal(result.state.contentSignature, first.state.contentSignature, 'expected no signature bump until a post actually succeeds');
});

// BL-462 pipeline-board-refine-04/06: no content change -> complete no-op,
// including the footer time, however far the clock has moved.

test('syncPipelineBoard: unchanged content is a no-op - no post, no delete, state (including footer instant) untouched', async () => {
  const posted = [];
  const deleted = [];
  const data = board([{ id: 'BL-1', column: 'coder', slug: '' }]);
  const first = await syncPipelineBoard(data, undefined, fakeAdapters({ postMessage: async () => 42 }), T1);

  const result = await syncPipelineBoard(
    data,
    first.state,
    fakeAdapters({
      postMessage: async (topicId, text) => {
        posted.push({ topicId, text });
        return 99;
      },
      deleteMessage: async (topicId, messageId) => {
        deleted.push({ topicId, messageId });
        return true;
      },
    }),
    T2
  );

  assert.equal(result.outcome, 'skipped-unchanged');
  assert.deepEqual(posted, []);
  assert.deepEqual(deleted, []);
  assert.deepEqual(result.state, first.state);
  assert.equal(result.state.lastChangeMs, T1, 'expected the footer instant to stay at the last REAL change, not bump to T2');
});

test('syncPipelineBoard: a failed topic creation is a no-op, retried next tick', async () => {
  const result = await syncPipelineBoard(
    board([{ id: 'BL-1', column: 'coder', slug: '' }]),
    undefined,
    fakeAdapters({ ensureBoardTopic: async () => undefined }),
    T1
  );

  assert.equal(result.outcome, 'failed-no-topic');
  assert.deepEqual(result.state, {});
});

test('syncPipelineBoard: a failed post leaves the topic id persisted but no message id/signature bump, retried next tick', async () => {
  const result = await syncPipelineBoard(board([{ id: 'BL-1', column: 'coder', slug: '' }]), undefined, fakeAdapters({ postMessage: async () => undefined }), T1);

  assert.equal(result.outcome, 'failed-post');
  assert.equal(result.state.topicId, 900);
  assert.equal(result.state.messageId, undefined);
  assert.equal(result.state.contentSignature, undefined, 'expected no signature bump until a post actually succeeds');
});

test('syncPipelineBoard: a failed delete of the old message still lets the fresh message post (best-effort, never blocking)', async () => {
  const posted = [];
  const first = await syncPipelineBoard(board([{ id: 'BL-1', column: 'coder', slug: '' }]), undefined, fakeAdapters(), T1);

  const result = await syncPipelineBoard(
    board([{ id: 'BL-1', column: 'QA', slug: '' }]),
    first.state,
    fakeAdapters({
      deleteMessage: async () => false,
      postMessage: async (topicId, text) => {
        posted.push({ topicId, text });
        return 55;
      },
    }),
    T2
  );

  assert.equal(result.outcome, 'reposted');
  assert.equal(posted.length, 1, 'expected the fresh message posted despite the delete failure');
  assert.equal(result.state.messageId, 55);
});

test('syncPipelineBoard: a topic already created (topicId persisted) is reused, never re-created', async () => {
  const created = [];
  const first = await syncPipelineBoard(board([{ id: 'BL-1', column: 'coder', slug: '' }]), undefined, fakeAdapters(), T1);

  await syncPipelineBoard(
    board([{ id: 'BL-1', column: 'QA', slug: '' }]),
    first.state,
    fakeAdapters({
      ensureBoardTopic: async () => {
        created.push(true);
        return 901;
      },
    }),
    T2
  );
  assert.deepEqual(created, [], 'expected ensureBoardTopic never called once a topicId is already persisted');
});

// BL-462 pipeline-board-refine-07: rendering/syncing the board touches no
// swarm state - the sync module itself performs no I/O beyond the injected
// adapters.

test('syncPipelineBoard: only the injected adapters are ever called - no other side effects', async () => {
  let ensureCalls = 0;
  let postCalls = 0;
  let deleteCalls = 0;
  await syncPipelineBoard(
    board([{ id: 'BL-1', column: 'coder', slug: '' }]),
    undefined,
    fakeAdapters({
      ensureBoardTopic: async () => {
        ensureCalls += 1;
        return 900;
      },
      postMessage: async () => {
        postCalls += 1;
        return 42;
      },
      deleteMessage: async () => {
        deleteCalls += 1;
        return true;
      },
    }),
    T1
  );
  assert.equal(ensureCalls, 1);
  assert.equal(postCalls, 1);
  assert.equal(deleteCalls, 0);
});
