const assert = require('node:assert/strict');
const {
  decidePipelineBoardPinAction,
  shouldUnpinAllBeforePin,
  syncPipelineBoardPin,
} = require('../out/concierge/pipelineBoardPinSync');

function fakeAdapters(overrides = {}) {
  return {
    getTopPinnedMessageId: async () => undefined,
    unpinAllMessages: async () => true,
    pinMessage: async () => true,
    ...overrides,
  };
}

// BL-467 pipeline-board-only-pin-01 (Scenario Outline)

test('decidePipelineBoardPinAction: no board message yet is skip-no-board regardless of the current pin', () => {
  assert.equal(decidePipelineBoardPinAction(undefined, undefined), 'skip-no-board');
  assert.equal(decidePipelineBoardPinAction(55, undefined), 'skip-no-board');
});

test('decidePipelineBoardPinAction: the board already being the top pin is skip-clean', () => {
  assert.equal(decidePipelineBoardPinAction(100, 100), 'skip-clean');
});

test('decidePipelineBoardPinAction: nothing pinned but a board exists is enforce', () => {
  assert.equal(decidePipelineBoardPinAction(undefined, 100), 'enforce');
});

test('decidePipelineBoardPinAction: a different message pinned than the board is enforce', () => {
  assert.equal(decidePipelineBoardPinAction(55, 100), 'enforce');
});

test('decidePipelineBoardPinAction: getChat omits the pin but this board was already pinned - skip-clean', () => {
  assert.equal(decidePipelineBoardPinAction(undefined, 100, 100), 'skip-clean');
});

test('decidePipelineBoardPinAction: a human pin still wins over a matching lastPinned record - enforce', () => {
  assert.equal(decidePipelineBoardPinAction(55, 100, 100), 'enforce');
});

test('decidePipelineBoardPinAction: a reposted board id still enforces when lastPinned is stale - enforce', () => {
  assert.equal(decidePipelineBoardPinAction(undefined, 101, 100), 'enforce');
});

test('shouldUnpinAllBeforePin: false when replacing our own previous board pin on repost', () => {
  assert.equal(shouldUnpinAllBeforePin(100, 101, 100), false);
});

test('shouldUnpinAllBeforePin: true when a human pinned a different message', () => {
  assert.equal(shouldUnpinAllBeforePin(55, 100, 100), true);
});

test('shouldUnpinAllBeforePin: false when nothing is pinned', () => {
  assert.equal(shouldUnpinAllBeforePin(undefined, 100, 100), false);
});

test('syncPipelineBoardPin: no board message yet - skip-no-board, no unpin-all, no pin call', async () => {
  const unpinCalls = [];
  const pinCalls = [];
  const result = await syncPipelineBoardPin(
    undefined,
    fakeAdapters({
      getTopPinnedMessageId: async () => undefined,
      unpinAllMessages: async () => {
        unpinCalls.push(true);
        return true;
      },
      pinMessage: async (messageId) => {
        pinCalls.push(messageId);
        return true;
      },
    })
  );

  assert.equal(result.outcome, 'skip-no-board');
  assert.deepEqual(unpinCalls, []);
  assert.deepEqual(pinCalls, []);
});

test('syncPipelineBoardPin: nothing currently pinned - pins the board without unpin-all', async () => {
  const calls = [];
  const result = await syncPipelineBoardPin(
    100,
    fakeAdapters({
      getTopPinnedMessageId: async () => undefined,
      unpinAllMessages: async () => {
        calls.push('unpinAll');
        return true;
      },
      pinMessage: async (messageId) => {
        calls.push(`pin:${messageId}`);
        return true;
      },
    })
  );

  assert.equal(result.outcome, 'enforce');
  assert.equal(result.lastPinnedBoardMessageId, 100);
  assert.deepEqual(calls, ['pin:100']);
});

test('syncPipelineBoardPin: the board is already the top pin - skip-clean, no unpin-all, no pin call', async () => {
  const unpinCalls = [];
  const pinCalls = [];
  const result = await syncPipelineBoardPin(
    100,
    fakeAdapters({
      getTopPinnedMessageId: async () => 100,
      unpinAllMessages: async () => {
        unpinCalls.push(true);
        return true;
      },
      pinMessage: async (messageId) => {
        pinCalls.push(messageId);
        return true;
      },
    })
  );

  assert.equal(result.outcome, 'skip-clean');
  assert.equal(result.lastPinnedBoardMessageId, 100);
  assert.deepEqual(unpinCalls, []);
  assert.deepEqual(pinCalls, []);
});

test('syncPipelineBoardPin: getChat omits the pin but lastPinned matches - skip-clean, no pin call', async () => {
  const calls = [];
  const result = await syncPipelineBoardPin(
    100,
    fakeAdapters({
      getTopPinnedMessageId: async () => undefined,
      unpinAllMessages: async () => {
        calls.push('unpinAll');
        return true;
      },
      pinMessage: async (messageId) => {
        calls.push(`pin:${messageId}`);
        return true;
      },
    }),
    100
  );

  assert.equal(result.outcome, 'skip-clean');
  assert.equal(result.lastPinnedBoardMessageId, 100);
  assert.deepEqual(calls, []);
});

test('syncPipelineBoardPin: a different message is pinned than the board - enforces (unpin-all then pin the board)', async () => {
  const calls = [];
  const result = await syncPipelineBoardPin(
    100,
    fakeAdapters({
      getTopPinnedMessageId: async () => 55,
      unpinAllMessages: async () => {
        calls.push('unpinAll');
        return true;
      },
      pinMessage: async (messageId) => {
        calls.push(`pin:${messageId}`);
        return true;
      },
    })
  );

  assert.equal(result.outcome, 'enforce');
  assert.deepEqual(calls, ['unpinAll', 'pin:100']);
});

test('syncPipelineBoardPin: a repost pins the new board without unpin-all when the old board is still top', async () => {
  const calls = [];
  const result = await syncPipelineBoardPin(
    101,
    fakeAdapters({
      getTopPinnedMessageId: async () => 100,
      unpinAllMessages: async () => {
        calls.push('unpinAll');
        return true;
      },
      pinMessage: async (messageId) => {
        calls.push(`pin:${messageId}`);
        return true;
      },
    }),
    100
  );

  assert.equal(result.outcome, 'enforce');
  assert.equal(result.lastPinnedBoardMessageId, 101);
  assert.deepEqual(calls, ['pin:101']);
});

// BL-467 pipeline-board-only-pin-02

test('syncPipelineBoardPin: a failed pin attempt is best-effort - completes without throwing, outcome stays enforce', async () => {
  const result = await syncPipelineBoardPin(
    100,
    fakeAdapters({
      getTopPinnedMessageId: async () => 55,
      pinMessage: async () => false,
    })
  );

  assert.equal(result.outcome, 'enforce');
});

test('syncPipelineBoardPin: only the injected adapters are ever called - no other side effects', async () => {
  let getTopCalls = 0;
  let unpinCalls = 0;
  let pinCalls = 0;
  await syncPipelineBoardPin(
    100,
    fakeAdapters({
      getTopPinnedMessageId: async () => {
        getTopCalls += 1;
        return 55;
      },
      unpinAllMessages: async () => {
        unpinCalls += 1;
        return true;
      },
      pinMessage: async () => {
        pinCalls += 1;
        return true;
      },
    })
  );
  assert.equal(getTopCalls, 1);
  assert.equal(unpinCalls, 1);
  assert.equal(pinCalls, 1);
});
