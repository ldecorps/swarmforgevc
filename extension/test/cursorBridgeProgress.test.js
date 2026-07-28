const assert = require('node:assert/strict');
const {
  summarizeSdkProgressLine,
  createThrottledProgressReporter,
} = require('../out/bridge/cursorBridgeProgress');

test('summarizeSdkProgressLine maps tool and status events', () => {
  assert.equal(
    summarizeSdkProgressLine({ type: 'tool_call', name: 'grep', status: 'running', agent_id: 'a', run_id: 'r', call_id: 'c' }),
    '🔧 grep'
  );
  assert.equal(
    summarizeSdkProgressLine({ type: 'status', status: 'CREATING', agent_id: 'a', run_id: 'r' }),
    '🔄 Starting agent run…'
  );
});

test('summarizeSdkProgressLine ignores assistant stream chunks (final reply is posted separately)', () => {
  assert.equal(
    summarizeSdkProgressLine({
      type: 'assistant',
      message: { content: [{ type: 'text', text: ').' }] },
      agent_id: 'a',
      run_id: 'r',
    }),
    undefined
  );
  assert.equal(
    summarizeSdkProgressLine({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Long final answer text here.' }] },
      agent_id: 'a',
      run_id: 'r',
    }),
    undefined
  );
});

test('createThrottledProgressReporter coalesces rapid updates', async () => {
  const lines = [];
  let now = 0;
  const report = createThrottledProgressReporter(
    1000,
    (line) => {
      lines.push(line);
    },
    () => now
  );
  report('one');
  report('two');
  assert.equal(lines.length, 0);
  now = 1000;
  await report('two');
  assert.deepEqual(lines, ['two']);
});
