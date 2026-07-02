const assert = require('node:assert/strict');
const test = require('node:test');

const { extractPanelFunction } = require('./helpers/extractPanelFunction');
const { detectFooterLineCount: detectFooterLineCountTs } = require('../out/panel/paneHistory');

const detectFooterLineCountJs = extractPanelFunction('detectFooterLineCount');

// BL-070's paneHistory.ts explicitly duplicates media/panel.js's
// detectFooterLineCount (the host and webview share no module system) and
// says so in its own comment: "kept behaviorally identical... keep the two
// in sync if either changes." That's a documented requirement with nothing
// enforcing it — jscpd doesn't scan media/ (only src/), and each side's own
// test file only proves it behaves sensibly in isolation, not that the two
// still agree with each other. This runs both on the same inputs so any
// future drift (a regex tweak on one side, forgotten on the other) fails
// loudly here instead of silently misclassifying content vs. footer lines
// in only one of the two paths.

const CASES = [
  ['', ''],
  ['no footer at all, just plain text\nmore plain text', 'no footer'],
  ['some output\n❯ type a message…', 'bare empty prompt'],
  ['some output\n❯ ', 'bare prompt with trailing space'],
  ['some output\n> message', 'angle-bracket prompt'],
  ['some output\n[auto] permission mode\n❯ ', 'permission line above prompt'],
  ['some output\nesc to break\n❯ ', 'interrupt-hint line above prompt'],
  [
    'some output\n[auto] idle\nesc to break\n❯ type a message…',
    'multi-line footer: status + interrupt-hint + prompt',
  ],
  ['a line that is definitely content because it is long enough to break the scan up past forty characters\n❯ ', 'long content line stops the upward scan'],
  ['❯ only a prompt, nothing else', 'prompt as the only line'],
  ['trailing blank line ignored\n❯ \n', 'trailing blank line after the prompt'],
];

for (const [text, label] of CASES) {
  test(`detectFooterLineCount parity (panel.js vs paneHistory.ts): ${label}`, () => {
    assert.equal(
      detectFooterLineCountTs(text),
      detectFooterLineCountJs(text),
      `panel.js and paneHistory.ts must agree on the footer line count for: ${JSON.stringify(text)}`
    );
  });
}
