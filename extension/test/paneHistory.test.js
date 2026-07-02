const assert = require('node:assert/strict');
const test = require('node:test');

const { detectFooterLineCount, findOverlap, accumulatePaneHistory } = require('../out/panel/paneHistory');

// ── detectFooterLineCount (TS port of media/panel.js's own detector) ────

test('detectFooterLineCount finds a bare prompt line', () => {
  const text = 'some output\nmore output\n❯ ';
  assert.equal(detectFooterLineCount(text), 1);
});

test('detectFooterLineCount returns 0 when there is no prompt', () => {
  assert.equal(detectFooterLineCount('just output\nno prompt here'), 0);
});

test('detectFooterLineCount includes a permission/status line above the prompt', () => {
  const text = 'output\n[auto] idle\n❯ ';
  assert.equal(detectFooterLineCount(text), 2);
});

// ── findOverlap ───────────────────────────────────────────────────────────

test('findOverlap detects a full shift-by-two window', () => {
  const old = ['A', 'B', 'C', 'D', 'E'];
  const fresh = ['C', 'D', 'E', 'F', 'G'];
  assert.equal(findOverlap(old, fresh), 3);
});

test('findOverlap is the full length for two identical windows', () => {
  const lines = ['A', 'B', 'C'];
  assert.equal(findOverlap(lines, lines.slice()), 3);
});

test('findOverlap is 0 for completely disjoint windows (e.g. a screen clear)', () => {
  assert.equal(findOverlap(['A', 'B', 'C'], ['X', 'Y', 'Z']), 0);
});

test('findOverlap handles empty inputs', () => {
  assert.equal(findOverlap([], []), 0);
  assert.equal(findOverlap(['A'], []), 0);
  assert.equal(findOverlap([], ['A']), 0);
});

// ── accumulatePaneHistory — BL-070 core retention logic ──────────────────

test('the first capture seeds history with its content lines, footer excluded', () => {
  const capture = 'line1\nline2\n❯ ';
  const result = accumulatePaneHistory(null, [], capture, 500);
  assert.deepEqual(result.history, ['line1', 'line2']);
  assert.equal(result.displayText, 'line1\nline2\n❯ ');
});

// BL-070 tile-memory-01: scrolling reveals earlier transcript beyond the window
test('genuinely new content that scrolls into view is appended to history', () => {
  const first = accumulatePaneHistory(null, [], 'A\nB\nC\n❯ ', 500);
  const second = accumulatePaneHistory(first.contentLines, first.history, 'B\nC\nD\n❯ ', 500);
  const third = accumulatePaneHistory(second.contentLines, second.history, 'C\nD\nE\n❯ ', 500);

  assert.deepEqual(third.history, ['A', 'B', 'C', 'D', 'E']);
  assert.match(third.displayText, /A\nB\nC\nD\nE/, 'the earliest line (A) is still reachable, off the visible window');
});

// BL-070 tile-memory-05: an unchanged screen does not multiply history
test('a static content window with only the footer changing does not grow history', () => {
  const first = accumulatePaneHistory(null, [], 'content1\ncontent2\n❯ ', 500);
  // Same content, footer alone changes (e.g. a spinner/status update) —
  // this is exactly the case a naive whole-window diff gets wrong.
  const second = accumulatePaneHistory(first.contentLines, first.history, 'content1\ncontent2\n[auto] busy\n❯ ', 500);
  const third = accumulatePaneHistory(second.contentLines, second.history, 'content1\ncontent2\n❯ ', 500);

  assert.deepEqual(second.history, ['content1', 'content2'], 'history must not grow from a footer-only change');
  assert.deepEqual(third.history, ['content1', 'content2']);
});

test('an agent that prints nothing across many capture cycles never grows history', () => {
  let state = accumulatePaneHistory(null, [], 'steady line\n❯ ', 500);
  const historySizes = [state.history.length];
  for (let i = 0; i < 20; i++) {
    state = accumulatePaneHistory(state.contentLines, state.history, 'steady line\n❯ ', 500);
    historySizes.push(state.history.length);
  }
  assert.ok(
    historySizes.every((n) => n === historySizes[0]),
    'history length must stay constant across identical repeated captures'
  );
});

// BL-070 tile-memory-02: retained history is bounded by historyLines
test('history is bounded to maxHistoryLines even after many scrolled captures', () => {
  let state = accumulatePaneHistory(null, [], 'line0\n❯ ', 10);
  for (let i = 1; i <= 50; i++) {
    state = accumulatePaneHistory(state.contentLines, state.history, `line${i}\n❯ `, 10);
  }
  assert.ok(state.history.length <= 10, `history must stay within the 10-line cap, got ${state.history.length}`);
  // the retained tail must be the MOST RECENT lines, not the oldest
  assert.deepEqual(state.history, ['line41', 'line42', 'line43', 'line44', 'line45', 'line46', 'line47', 'line48', 'line49', 'line50']);
});

test('a smaller historyLines cap retains fewer lines than a larger one, over the same input', () => {
  function run(cap) {
    let state = accumulatePaneHistory(null, [], 'line0\n❯ ', cap);
    for (let i = 1; i <= 2000; i++) {
      state = accumulatePaneHistory(state.contentLines, state.history, `line${i}\n❯ `, cap);
    }
    return state.history.length;
  }
  assert.equal(run(200), 200);
  assert.equal(run(500), 500);
});

// BL-070 tile-memory-03: short transcripts never get padded — no artificial growth
test('a short transcript that never fills the window stays exactly as long as what was printed', () => {
  const first = accumulatePaneHistory(null, [], 'hello\n❯ ', 500);
  assert.deepEqual(first.history, ['hello']);
  const second = accumulatePaneHistory(first.contentLines, first.history, 'hello\nworld\n❯ ', 500);
  assert.deepEqual(second.history, ['hello', 'world']);
});

test('a capture with no footer treats every line as content', () => {
  const result = accumulatePaneHistory(null, [], 'plain\noutput\nno prompt', 500);
  assert.deepEqual(result.history, ['plain', 'output', 'no prompt']);
});

test('a screen clear (fully disjoint new content) does not lose the old history, just appends the new screen', () => {
  const first = accumulatePaneHistory(null, [], 'old content\n❯ ', 500);
  const second = accumulatePaneHistory(first.contentLines, first.history, 'brand new screen\n❯ ', 500);
  assert.deepEqual(second.history, ['old content', 'brand new screen']);
});
