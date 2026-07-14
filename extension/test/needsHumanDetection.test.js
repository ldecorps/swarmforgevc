const assert = require('node:assert/strict');
const { detectNeedsHuman, extractQuestionSnippet, stripTerminalChrome } = require('../out/panel/needsHumanDetection');

test('detectNeedsHuman returns false for empty text', () => {
  assert.equal(detectNeedsHuman(''), false);
  assert.equal(detectNeedsHuman(null), false);
});

test('detectNeedsHuman returns false for normal idle input box', () => {
  const text = 'normal output\n[auto] idle\nesc to break\n❯ type a message…';
  assert.equal(detectNeedsHuman(text), false);
});

test('detectNeedsHuman returns false for bare empty input box', () => {
  const text = 'normal output\n[auto] idle\nesc to break\n❯ ';
  assert.equal(detectNeedsHuman(text), false);
});

test('detectNeedsHuman detects permission prompts', () => {
  const texts = [
    'Some output\n[auto] permission mode',
    'Some output\nAllow this action? [y/n]',
    'Some output\nApprove? (yes/no)',
    'Some output\n[Permission Denied]'
  ];
  texts.forEach(text => {
    assert.equal(detectNeedsHuman(text), true, `Should detect permission in: ${text.split('\n').pop()}`);
  });
});

test('detectNeedsHuman detects yes/no questions', () => {
  const texts = [
    'output\nContinue? (y/n)',
    'output\nYes or no?',
    'output\nYes / No',
    'output\n(yes/no)'
  ];
  texts.forEach(text => {
    assert.equal(detectNeedsHuman(text), true, `Should detect y/n in: ${text.split('\n').pop()}`);
  });
});

test('detectNeedsHuman detects multiple choice with numbers', () => {
  const text = 'Options:\n❯ 1) Option A\n  2) Option B\n  3) Option C';
  assert.equal(detectNeedsHuman(text), true);
});

test('detectNeedsHuman detects questions ending with ?', () => {
  const texts = [
    'output\nIs this correct?',
    'output\nWhich option?'
  ];
  texts.forEach(text => {
    assert.equal(detectNeedsHuman(text), true, `Should detect question: ${text.split('\n').pop()}`);
  });
});

test('detectNeedsHuman returns false for normal output even with brackets', () => {
  const text = 'This is [example] text\nWith [brackets] but no permission\n[auto] idle\n❯ type a message…';
  assert.equal(detectNeedsHuman(text), false);
});

test('detectNeedsHuman distinguishes permission from normal [status]', () => {
  // [auto] is normal status at idle, should not trigger
  const idleText = 'output\n[auto] idle\n❯ ';
  assert.equal(detectNeedsHuman(idleText), false);

  // But [Permission] or permission-related text should trigger
  const permText = 'output\n[Permission required]';
  assert.equal(detectNeedsHuman(permText), true);
});

test('detectNeedsHuman skips standard input prompts with "type"', () => {
  // Input prompts with "type", "message", or empty prompt should not trigger
  const texts = [
    'output\nSome text\n❯ type',
    'output\nSome text\n❯ message',
    'output\nSome text\n❯   ',
    'output\nSome text\n> type'
  ];
  texts.forEach(text => {
    assert.equal(detectNeedsHuman(text), false, `Should skip standard input in: ${text.split('\n').pop()}`);
  });
});

test('detectNeedsHuman returns false for normal output without patterns', () => {
  // Output that doesn't match any human-interaction pattern should return false
  const texts = [
    'Some normal output\nProcessing...',
    'Line 1\nLine 2\nLine 3',
    'output\nSome command\nCompleted',
    'normal text without prompts or questions'
  ];
  texts.forEach(text => {
    assert.equal(detectNeedsHuman(text), false, `Should return false for: ${text.split('\n').pop()}`);
  });
});

test('detectNeedsHuman handles multi-line prompts with special characters', () => {
  const text = 'Processing...\n❯ [a] Accept\n  [r] Reject\n  [s] Skip';
  assert.equal(detectNeedsHuman(text), true);
});

// ── extractQuestionSnippet (BL-073) ──────────────────────────────────────

test('extractQuestionSnippet returns empty string for empty/null text', () => {
  assert.equal(extractQuestionSnippet(''), '');
  assert.equal(extractQuestionSnippet(null), '');
  assert.equal(extractQuestionSnippet(undefined), '');
});

test('extractQuestionSnippet joins the last 3 non-empty lines', () => {
  const text = 'first\nsecond\n\nthird\nfourth\nAllow this action? (y/n)';
  assert.equal(extractQuestionSnippet(text), 'third fourth Allow this action? (y/n)');
});

test('extractQuestionSnippet trims each line and skips blank lines', () => {
  const text = '  padded line  \n\n\n   Approve? [y/n]   ';
  assert.equal(extractQuestionSnippet(text), 'padded line Approve? [y/n]');
});

test('extractQuestionSnippet truncates very long snippets with an ellipsis', () => {
  const longLine = 'x'.repeat(250);
  const snippet = extractQuestionSnippet(longLine);
  assert.equal(snippet.length, 200);
  assert.ok(snippet.endsWith('…'));
});

// ── stripTerminalChrome / extractQuestionSnippet ANSI sanitisation (BL-391) ──
// The real seq-1 text of backlog/topics/BL-359.json - the human's own
// "can you make these messages more readable?" complaint, verbatim. Built
// from explicit \x1b escapes (never a raw control byte in source) so the
// fixture itself stays readable in a diff.
const ESC = '\x1b';
const REAL_ANSI_PANE_TEXT =
  `NeedsApproval: BL-359 - ${ESC}[38;5;246m❯ ${ESC}[39m ${ESC}[38;5;244m` +
  '─'.repeat(80) +
  ` ${ESC}[39m  ${ESC}[38;5;211m⏵⏵ bypass permissions on${ESC}[38;5;246m · install gh for PR status · ${ESC}[38;…`;

test('stripTerminalChrome removes ANSI SGR colour escape sequences', () => {
  assert.equal(stripTerminalChrome(`${ESC}[38;5;246mhello${ESC}[39m world`), 'hello world');
});

test('stripTerminalChrome removes CSI cursor-movement sequences', () => {
  assert.equal(stripTerminalChrome(`a${ESC}[2Kb${ESC}[1;1Hc`), 'abc');
});

test('stripTerminalChrome leaves ordinary prose completely unchanged (no escape bytes present)', () => {
  const prose = 'BL-900 needs your approval: should we deploy to production today?';
  assert.equal(stripTerminalChrome(prose), prose);
});

test('stripTerminalChrome leaves an empty string unchanged', () => {
  assert.equal(stripTerminalChrome(''), '');
});

test('BL-391 the-human-is-never-sent-terminal-chrome-01/02: extractQuestionSnippet on the REAL BL-359 pane capture carries no escape sequences and keeps the readable prefix', () => {
  const snippet = extractQuestionSnippet(REAL_ANSI_PANE_TEXT);
  assert.doesNotMatch(snippet, /\x1b/, 'expected no raw ESC byte anywhere in the snippet');
  assert.match(snippet, /^NeedsApproval: BL-359 -/, 'expected the readable prefix to survive sanitisation');
});

test('BL-391 the-human-is-never-sent-terminal-chrome-04: an ordinary multi-line prose pane capture is unaffected by chrome-stripping', () => {
  const prose = 'Ready to deploy BL-900.\nApprove this change? (y/n)';
  assert.equal(extractQuestionSnippet(prose), 'Ready to deploy BL-900. Approve this change? (y/n)');
});
