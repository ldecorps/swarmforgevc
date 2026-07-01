const assert = require('node:assert/strict');
const test = require('node:test');
const { extractPanelFunction } = require('./helpers/extractPanelFunction');

const detectFooterLineCount = extractPanelFunction('detectFooterLineCount');
const isAtBottom = extractPanelFunction('isAtBottom');
const scrollToBottom = extractPanelFunction('scrollToBottom');
const updateTileOutput = extractPanelFunction('updateTileOutput');
const handleTileScroll = extractPanelFunction('handleTileScroll');

// Extracted bodies resolve these names from panel.js module scope; supply
// them as globals, same pattern as footerAwareScroll.test.js.
global.detectFooterLineCount = detectFooterLineCount;
global.isAtBottom = isAtBottom;
global.scrollToBottom = scrollToBottom;
global.SCROLL_THRESHOLD = 8;

// 40 content lines ending in a 3-line footer; rendered at 20px/line in an
// 800px-tall scrollable area viewed through a 300px viewport.
const FOOTER_TEXT = Array.from({ length: 37 }, (_, i) => `line ${i}`)
  .concat(['[auto] busy', 'esc to break', '❯ '])
  .join('\n');

// A tile output element as the webview sees it. Replacing textContent on a
// real element can reset/clamp scrollTop — the mock reproduces that reset so
// an implementation relying on scrollTop surviving the replacement fails.
function makeOutputEl(scrollTop, clientHeight, scrollHeight) {
  return {
    scrollTop,
    clientHeight,
    scrollHeight,
    _text: '',
    get textContent() {
      return this._text;
    },
    set textContent(v) {
      this._text = v;
      this.scrollTop = 0; // browsers may reset scroll position on replacement
    },
  };
}

function makeEntry(el, text, tailLocked) {
  return { output: el, text, tailLocked };
}

// --- BL-055 scroll-up-release-01: output while scrolled up stays put ---

test('output update while scrolled up preserves the scroll position', () => {
  const el = makeOutputEl(120, 300, 800);
  const entry = makeEntry(el, FOOTER_TEXT, false);
  updateTileOutput(entry);
  assert.equal(el.scrollTop, 120, 'a released tile must keep the reader position across an output update');
});

test('output update while scrolled up does not re-lock tail', () => {
  const el = makeOutputEl(120, 300, 800);
  const entry = makeEntry(el, FOOTER_TEXT, false);
  updateTileOutput(entry);
  // the content replacement itself fires a scroll event at the position the
  // update produced — that is not a user scroll
  handleTileScroll(entry, el);
  assert.equal(entry.tailLocked, false, 'a content-driven scroll event must not re-engage tail-lock');
});

// --- BL-055 scroll-up-release-02: full-frame repaint keeps release ---

test('full-frame repaint near the bottom band does not re-lock tail', () => {
  // the reader released tail-lock only slightly above the live bottom; the
  // repaint reset+restore lands inside the at-bottom band, but it was not the
  // user scrolling there
  const el = makeOutputEl(455, 300, 800);
  const entry = makeEntry(el, FOOTER_TEXT, false);
  updateTileOutput(entry);
  handleTileScroll(entry, el);
  assert.equal(entry.tailLocked, false, 'a repaint landing in the bottom band must not be mistaken for the user reaching the bottom');
  assert.equal(el.scrollTop, 455, 'the repaint must not move the view');
});

// --- BL-055 scroll-up-release-03: user scroll back down re-engages ---

test('a user scroll back down to the live region re-engages tail-lock', () => {
  const el = makeOutputEl(120, 300, 800);
  const entry = makeEntry(el, FOOTER_TEXT, false);
  updateTileOutput(entry);

  // the user scrolls down to the footer-aware anchor
  const anchor = makeOutputEl(0, 300, 800);
  scrollToBottom(anchor, FOOTER_TEXT);
  el.scrollTop = anchor.scrollTop;
  handleTileScroll(entry, el);

  assert.equal(entry.tailLocked, true, 'a genuine user scroll to the live region must re-engage tail-lock');
});

test('after re-engaging, output updates follow the live bottom again', () => {
  const el = makeOutputEl(0, 300, 800);
  const entry = makeEntry(el, FOOTER_TEXT, true);
  updateTileOutput(entry);
  const anchor = makeOutputEl(0, 300, 800);
  scrollToBottom(anchor, FOOTER_TEXT);
  assert.equal(el.scrollTop, anchor.scrollTop, 'a tail-locked update must land on the footer-aware anchor');
});

// --- BL-055 scroll-up-release-04: a modest scroll-up counts as released ---

test('a user scroll up from the anchor releases tail-lock', () => {
  const el = makeOutputEl(0, 300, 800);
  const entry = makeEntry(el, FOOTER_TEXT, true);
  updateTileOutput(entry); // positions at the anchor, tail-locked

  el.scrollTop -= 60; // three lines up
  handleTileScroll(entry, el);

  assert.equal(entry.tailLocked, false, 'a modest user scroll up must release tail-lock');
});

test('once released by a user scroll, later user scrolls keep re-evaluating', () => {
  const el = makeOutputEl(0, 300, 800);
  const entry = makeEntry(el, FOOTER_TEXT, true);
  updateTileOutput(entry);

  el.scrollTop = 100;
  handleTileScroll(entry, el);
  assert.equal(entry.tailLocked, false);

  el.scrollTop = 50; // still reading scrollback
  handleTileScroll(entry, el);
  assert.equal(entry.tailLocked, false, 'scrolling within scrollback must stay released');
});

// --- footer-aware band derives line height from content, not viewport ---

test('isAtBottom counts a viewport ending at the top of the footer as at-bottom', () => {
  // 40 lines over scrollHeight 800 → 20px/line, 3 footer lines → live content
  // ends at 740. A viewport bottom of 740 is exactly at the live bottom.
  // Deriving line height from clientHeight (300/40 = 7.5px) would misplace
  // the band at 777.5 and call this "not at bottom".
  const el = { scrollTop: 440, clientHeight: 300, scrollHeight: 800 };
  assert.equal(isAtBottom(el, FOOTER_TEXT), true, 'the at-bottom band must be sized from content line height (scrollHeight), not viewport height');
});

test('scrollToBottom leaves at most one live line of overlap with the footer', () => {
  const el = { scrollTop: 0, clientHeight: 300, scrollHeight: 800 };
  scrollToBottom(el, FOOTER_TEXT);
  const lineHeight = 800 / 40; // content-derived line height
  const liveContentBottom = 800 - 3 * lineHeight;
  const viewportBottom = el.scrollTop + el.clientHeight;
  assert.ok(
    viewportBottom <= liveContentBottom + lineHeight + 0.01,
    `anchor must keep the footer below the fold (viewportBottom ${viewportBottom} > live bottom ${liveContentBottom} + one line)`
  );
  assert.ok(
    viewportBottom >= liveContentBottom - 0.01,
    'anchor must still show the newest live line'
  );
});
