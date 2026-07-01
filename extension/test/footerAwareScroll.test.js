const assert = require('node:assert/strict');
const test = require('node:test');

// Function to detect the Claude footer in captured pane output
function detectFooterLineCount(text) {
  if (!text) return 0;

  const lines = text.split('\n');
  let footerStart = -1;

  // Scan from the bottom up to find the pinned footer
  // Strategy: locate the input prompt at the very end, then work up to find
  // status/permission lines that are part of the footer

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i] || '';
    const trimmed = line.trim();

    // Empty lines at the very end don't count as part of the footer
    if (i === lines.length - 1 && trimmed === '') {
      continue;
    }

    // Input prompt line: starts with ❯ or >
    // "❯ type a message…" or "> message" or just "❯ " with anything after
    if (/^[❯>]\s/.test(trimmed)) {
      footerStart = i;
      break;
    }
  }

  if (footerStart === -1) {
    return 0;
  }

  // Now scan up from the prompt to find other footer lines
  let footerEnd = footerStart;
  for (let i = footerStart - 1; i >= Math.max(0, footerStart - 5); i--) {
    const line = lines[i] || '';
    const trimmed = line.trim();

    // Skip empty lines
    if (trimmed === '') {
      continue;
    }

    // Permission/status line: contains [brackets] or single-word status
    if (/^\[.+\]|\[auto\]|\[.*permission/.test(trimmed)) {
      footerEnd = i;
      continue;
    }

    // Interrupt/help line: "esc to break" or similar
    if (/^esc\s+to|^.*interrupt|^.*break/i.test(trimmed)) {
      footerEnd = i;
      continue;
    }

    // If we hit a line that's clearly content (long, not status-like),
    // we've reached the end of the footer
    if (trimmed.length > 40 || !/^[[\-*@]/.test(trimmed)) {
      break;
    }
  }

  return lines.length - footerEnd;
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
  const count = detectFooterLineCount(text);
  assert(count >= 2, 'Should detect at least 2 footer lines');
});

test('detectFooterLineCount ignores footer-like content in live output', () => {
  const text = 'This is > a sample line with > prompt-like text\nReal footer: [status]\n❯ type a message…';
  const count = detectFooterLineCount(text);
  assert(count <= 2, 'Should only count actual footer, not content above it');
});

test('detectFooterLineCount returns 0 for text without recognizable footer', () => {
  const text = 'Just some regular output\nwith multiple lines\nno footer here';
  assert.equal(detectFooterLineCount(text), 0);
});

test('detectFooterLineCount handles trailing empty lines', () => {
  const text = 'Output\n[auto]\n❯ message\n\n';
  const count = detectFooterLineCount(text);
  assert(count >= 2, 'Should count footer despite trailing empty lines');
});

function getFooterPixelHeight(text, lineHeight) {
  if (!text || !lineHeight) return 0;
  const footerLines = detectFooterLineCount(text);
  return footerLines * lineHeight;
}

test('getFooterPixelHeight returns 0 for text without footer', () => {
  const text = 'Just content\nno footer';
  assert.equal(getFooterPixelHeight(text, 20), 0);
});

test('getFooterPixelHeight calculates pixel height based on line count and line height', () => {
  const text = '[status]\n❯ prompt';
  assert.equal(getFooterPixelHeight(text, 20), 40);
});

test('getFooterPixelHeight multiplies footer lines by line height', () => {
  const text = 'Line\nesc to break\n[status]\n❯ prompt';
  const height1 = getFooterPixelHeight(text, 20);
  const height2 = getFooterPixelHeight(text, 30);
  assert(height2 > height1, 'Larger line height should give larger pixel height');
});
