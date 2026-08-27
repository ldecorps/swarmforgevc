const assert = require('node:assert/strict');
const {
  summarizeSdkProgressLine,
  createThrottledProgressReporter,
} = require('../out/bridge/cursorBridgeProgress');
const {
  playfulToolProgressLabel,
} = require('../out/bridge/cursorBridgeProgressPlayful');

test('summarizeSdkProgressLine maps tool and status events', () => {
  const prev = process.env.CURSOR_BRIDGE_PLAYFUL_PROGRESS;
  process.env.CURSOR_BRIDGE_PLAYFUL_PROGRESS = '0';
  try {
    assert.equal(
      summarizeSdkProgressLine({ type: 'tool_call', name: 'grep', status: 'running', agent_id: 'a', run_id: 'r', call_id: 'c' }),
      '🔧 grep'
    );
    assert.equal(
      summarizeSdkProgressLine({ type: 'status', status: 'CREATING', agent_id: 'a', run_id: 'r' }),
      '🔄 Starting agent run…'
    );
  } finally {
    if (prev === undefined) delete process.env.CURSOR_BRIDGE_PLAYFUL_PROGRESS;
    else process.env.CURSOR_BRIDGE_PLAYFUL_PROGRESS = prev;
  }
});

test('summarizeSdkProgressLine uses zappa-inspired labels in playful mode', () => {
  const prev = process.env.CURSOR_BRIDGE_PLAYFUL_PROGRESS;
  const { beginActiveRun, endActiveRun } = require('../out/bridge/cursorBridgeRunTracker');
  delete process.env.CURSOR_BRIDGE_PLAYFUL_PROGRESS;
  try {
    beginActiveRun('tu es là ?', 'fr');
    assert.equal(
      summarizeSdkProgressLine({ type: 'tool_call', name: 'shell', status: 'running', agent_id: 'a', run_id: 'r', call_id: 'c' }),
      '🔧 enchiladaïse le terminal…'
    );
    assert.equal(
      summarizeSdkProgressLine({ type: 'tool_call', name: 'shell', status: 'completed', agent_id: 'a', run_id: 'r', call_id: 'c' }),
      '✓ nanook a frotté le shell'
    );
    endActiveRun();
    beginActiveRun('are you there?', 'en');
    assert.equal(
      summarizeSdkProgressLine({ type: 'tool_call', name: 'shell', status: 'running', agent_id: 'a', run_id: 'r', call_id: 'c' }),
      '🔧 enchiladaizing the terminal…'
    );
    assert.equal(
      summarizeSdkProgressLine({ type: 'status', status: 'CREATING', agent_id: 'a', run_id: 'r' }),
      '🔄 peaches en regalia — agent spinning up…'
    );
    endActiveRun();
  } finally {
    endActiveRun();
    if (prev === undefined) delete process.env.CURSOR_BRIDGE_PLAYFUL_PROGRESS;
    else process.env.CURSOR_BRIDGE_PLAYFUL_PROGRESS = prev;
  }
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

test('summarizeSdkProgressLine skips short thinking fragments', () => {
  assert.equal(
    summarizeSdkProgressLine({ type: 'thinking', text: 'pas.', agent_id: 'a', run_id: 'r' }),
    undefined
  );
  const line = summarizeSdkProgressLine({
      type: 'thinking',
      text: 'Sinon il faut indiquer clairement le comportement attendu pour ce cas.',
      agent_id: 'a',
      run_id: 'r',
    });
  assert.match(line, /Sinon il faut indiquer/);
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
