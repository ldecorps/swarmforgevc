const assert = require('node:assert/strict');
const { extractPanelFunction } = require('./helpers/extractPanelFunction');

const detectFooterLineCount = extractPanelFunction('detectFooterLineCount');
const isAtBottom = extractPanelFunction('isAtBottom');
const scrollToBottom = extractPanelFunction('scrollToBottom');

// scrollToBottom/isAtBottom call detectFooterLineCount and reference
// SCROLL_THRESHOLD as free variables resolved from panel.js's module scope;
// since extractPanelFunction lifts each function out independently, those
// names must be supplied as globals for the extracted bodies to resolve.
global.detectFooterLineCount = detectFooterLineCount;
global.SCROLL_THRESHOLD = 8;

function makeEl(scrollTop, clientHeight, scrollHeight) {
  return { scrollTop, clientHeight, scrollHeight };
}

test('detectFooterLineCount returns 0 for empty text', () => {
  assert.equal(detectFooterLineCount(''), 0);
  assert.equal(detectFooterLineCount(null), 0);
  assert.equal(detectFooterLineCount(undefined), 0);
});

test('detectFooterLineCount detects single-line footer (input prompt only)', () => {
  const text = 'Some output\n❯ type a message…';
  assert.equal(detectFooterLineCount(text), 1);
});

test('detectFooterLineCount detects multi-line footer with input + status', () => {
  const text = 'Some output\n[auto] permission line\n❯ type a message…';
  assert.equal(detectFooterLineCount(text), 2);
});

test('detectFooterLineCount detects footer with esc interrupt line', () => {
  const text = 'Some output\nesc to break\n[auto]\n❯ type a message…';
  assert.equal(detectFooterLineCount(text), 3);
});

test('detectFooterLineCount ignores footer-like content in live output', () => {
  const text = 'This is > a sample line with > prompt-like text\nReal footer: [status]\n❯ type a message…';
  assert.equal(detectFooterLineCount(text), 1);
});

test('detectFooterLineCount returns 0 for text without recognizable footer', () => {
  const text = 'Just some regular output\nwith multiple lines\nno footer here';
  assert.equal(detectFooterLineCount(text), 0);
});

test('detectFooterLineCount detects a bare empty prompt with nothing typed', () => {
  // This is the real captured format for an idle Claude Code input box (see
  // agentPaneState.test.js: '────────────\n❯ ') — no placeholder text is
  // actually present. trim() strips the trailing space, so the marker must
  // match end-of-string too, not just a following whitespace character.
  const text = 'line A\nline B\n[auto] idle\nesc to break\n❯ ';
  assert.equal(detectFooterLineCount(text), 3);
});

test('detectFooterLineCount treats footer-status changes as the same footer size', () => {
  // A spinner or status word changing inside the footer must not change how
  // many lines are attributed to the footer, so the scroll anchor is stable.
  const busy = 'line A\nline B\n[auto] busy\nesc to break\n❯ ';
  const idle = 'line A\nline B\n[auto] idle\nesc to break\n❯ ';
  assert.equal(detectFooterLineCount(busy), detectFooterLineCount(idle));
});

test('isAtBottom falls back to raw scroll-bottom check when no footer is present', () => {
  const text = 'plain output\nwith no footer';
  const atBottom = makeEl(300, 100, 400);
  const scrolledUp = makeEl(0, 100, 400);
  assert.equal(isAtBottom(atBottom, text), true);
  assert.equal(isAtBottom(scrolledUp, text), false);
});

test('scrollToBottom stops short of raw scrollHeight when a footer is present', () => {
  const text = 'line 1\nline 2\n[auto]\n❯ type a message…';
  const el = makeEl(0, 100, 400);
  scrollToBottom(el, text);
  assert(el.scrollTop < el.scrollHeight, 'must not scroll to the raw pane bottom when a footer is detected');
});

test('scrollToBottom scrolls to raw scrollHeight when no footer is present', () => {
  const text = 'a\nb\nc\nd';
  const el = makeEl(0, 100, 400);
  scrollToBottom(el, text);
  assert.equal(el.scrollTop, el.scrollHeight);
});

test('isAtBottom is true immediately after scrollToBottom positions the footer-aware anchor', () => {
  const text = 'line 1\nline 2\n[auto]\n❯ type a message…';
  const el = makeEl(0, 100, 400);
  scrollToBottom(el, text);
  assert.equal(isAtBottom(el, text), true);
});

test('scrolling away from the footer-aware anchor releases tail-lock', () => {
  const text = 'line 1\nline 2\n[auto]\n❯ type a message…';
  const el = makeEl(0, 100, 400);
  scrollToBottom(el, text);
  assert.equal(isAtBottom(el, text), true);

  el.scrollTop = 0;
  assert.equal(isAtBottom(el, text), false, 'scrolling up away from the anchor must release tail-lock');
});

test('scrolling back down to the footer-aware anchor re-engages tail-lock', () => {
  const text = 'line 1\nline 2\n[auto]\n❯ type a message…';
  const el = makeEl(0, 100, 400);

  el.scrollTop = 0;
  assert.equal(isAtBottom(el, text), false);

  scrollToBottom(el, text);
  assert.equal(isAtBottom(el, text), true, 'scrolling back to the anchor must re-engage tail-lock');
});
