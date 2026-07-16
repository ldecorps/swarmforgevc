const assert = require('node:assert/strict');
const { syncPipelineBoard } = require('../out/concierge/pipelineBoardSync');

function fakeAdapters(overrides = {}) {
  return {
    ensureBoardTopic: async () => 900,
    postMessage: async () => 1,
    editMessage: async () => true,
    ...overrides,
  };
}

// BL-452 pipeline-board-03: the board is posted once, then edited in place
// on a stage change - never re-posted as a new message.

test('syncPipelineBoard: first call with no prior state creates the topic and posts a new message', async () => {
  const created = [];
  const posted = [];
  const result = await syncPipelineBoard(
    [{ id: 'BL-1', column: 'coder' }],
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
    })
  );

  assert.equal(result.outcome, 'posted');
  assert.deepEqual(result.state, { topicId: 900, messageId: 42, renderedText: result.state.renderedText });
  assert.equal(created.length, 1);
  assert.deepEqual(posted, [{ topicId: 900, text: result.state.renderedText }]);
});

test('syncPipelineBoard: a stage change edits the existing message in place, never posts a new one', async () => {
  const posted = [];
  const edited = [];
  const prevState = { topicId: 900, messageId: 42, renderedText: 'stale grid' };
  const result = await syncPipelineBoard(
    [{ id: 'BL-1', column: 'QA' }],
    prevState,
    fakeAdapters({
      postMessage: async (topicId, text) => {
        posted.push({ topicId, text });
        return 99;
      },
      editMessage: async (topicId, messageId, text) => {
        edited.push({ topicId, messageId, text });
        return true;
      },
    })
  );

  assert.equal(result.outcome, 'edited');
  assert.equal(posted.length, 0, 'expected no new message posted on a stage change');
  assert.equal(edited.length, 1);
  assert.equal(edited[0].topicId, 900);
  assert.equal(edited[0].messageId, 42);
  assert.equal(result.state.messageId, 42);
  assert.equal(result.state.topicId, 900);
});

// BL-452 pipeline-board-04: no ticket's stage changed -> the message is not
// edited at all.

test('syncPipelineBoard: unchanged rendered text is a no-op - no post, no edit', async () => {
  const posted = [];
  const edited = [];
  const rows = [{ id: 'BL-1', column: 'coder' }];
  const first = await syncPipelineBoard(rows, undefined, fakeAdapters({ postMessage: async () => 42 }));

  const result = await syncPipelineBoard(
    rows,
    first.state,
    fakeAdapters({
      postMessage: async (topicId, text) => {
        posted.push({ topicId, text });
        return 99;
      },
      editMessage: async (topicId, messageId, text) => {
        edited.push({ topicId, messageId, text });
        return true;
      },
    })
  );

  assert.equal(result.outcome, 'skipped-unchanged');
  assert.deepEqual(posted, []);
  assert.deepEqual(edited, []);
  assert.deepEqual(result.state, first.state);
});

test('syncPipelineBoard: a failed topic creation is a no-op, retried next tick', async () => {
  const result = await syncPipelineBoard(
    [{ id: 'BL-1', column: 'coder' }],
    undefined,
    fakeAdapters({ ensureBoardTopic: async () => undefined })
  );

  assert.equal(result.outcome, 'failed-no-topic');
  assert.deepEqual(result.state, {});
});

test('syncPipelineBoard: a failed post leaves the topic id persisted but no message id, retried next tick', async () => {
  const result = await syncPipelineBoard(
    [{ id: 'BL-1', column: 'coder' }],
    undefined,
    fakeAdapters({ postMessage: async () => undefined })
  );

  assert.equal(result.outcome, 'failed-post');
  assert.equal(result.state.topicId, 900);
  assert.equal(result.state.messageId, undefined);
});

test('syncPipelineBoard: a failed edit leaves prior state untouched, retried next tick', async () => {
  const prevState = { topicId: 900, messageId: 42, renderedText: 'stale grid' };
  const result = await syncPipelineBoard(
    [{ id: 'BL-1', column: 'QA' }],
    prevState,
    fakeAdapters({ editMessage: async () => false })
  );

  assert.equal(result.outcome, 'failed-edit');
  assert.deepEqual(result.state, prevState);
});

test('syncPipelineBoard: a topic already created (topicId persisted) is reused, never re-created', async () => {
  const created = [];
  const prevState = { topicId: 900, messageId: 42, renderedText: 'stale grid' };
  await syncPipelineBoard(
    [{ id: 'BL-1', column: 'QA' }],
    prevState,
    fakeAdapters({
      ensureBoardTopic: async () => {
        created.push(true);
        return 901;
      },
    })
  );
  assert.deepEqual(created, [], 'expected ensureBoardTopic never called once a topicId is already persisted');
});
