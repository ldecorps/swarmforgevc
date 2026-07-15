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

test('stripTerminalChrome removes an OSC (operating system command) sequence, e.g. a window-title escape', () => {
  const BEL = '\x07';
  assert.equal(stripTerminalChrome(`${ESC}]0;agent-pane-title${BEL}hello`), 'hello');
});

test('stripTerminalChrome removes a bare C0 control byte that is not part of any escape sequence', () => {
  assert.equal(stripTerminalChrome('a\x01b'), 'ab');
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

// ── extractQuestionSnippet: VISIBLE terminal chrome (BL-395) ────────────────
// BL-391 stripped INVISIBLE control bytes only, by design (see its own
// header comment above). The box-rule lines, permission-mode footer, and
// bare input-box prompt are printable text and survive that strip - this is
// the follow-on that excludes those specific, unambiguous chrome LINES
// before the last-3-lines heuristic picks the snippet.
const QUESTION = 'Should I deploy BL-900 to production?';

// BL-395 approval-chrome-01
test('extractQuestionSnippet excludes input-box border rule lines', () => {
  const pane = [QUESTION, '─'.repeat(60), '❯ '].join('\n');
  const snippet = extractQuestionSnippet(pane);
  assert.doesNotMatch(snippet, /─/, 'expected no box-rule characters in the snippet');
  assert.equal(snippet, QUESTION);
});

// BL-395 approval-chrome-02
test('extractQuestionSnippet excludes the permission-mode and shortcut footer', () => {
  const pane = [QUESTION, '⏵⏵ bypass permissions on (shift+tab to cycle) · ← for agents'].join('\n');
  const snippet = extractQuestionSnippet(pane);
  assert.doesNotMatch(snippet, /bypass permissions/i, 'expected no footer furniture in the snippet');
  assert.equal(snippet, QUESTION);
});

// BL-395 approval-chrome-03
test('extractQuestionSnippet keeps the real question when it sits above the input box and footer', () => {
  const pane = [
    QUESTION,
    '─'.repeat(60),
    '❯ ',
    '⏵⏵ bypass permissions on (shift+tab to cycle) · ← for agents',
  ].join('\n');
  assert.equal(extractQuestionSnippet(pane), QUESTION);
});

// BL-395 approval-chrome-04 (neighbour guard: real words are never chrome,
// even alongside a dash or a bare-glyph-looking char)
test('extractQuestionSnippet leaves a real sentence containing a dash unchanged (neighbour guard)', () => {
  const prose = 'This is a well-formed sentence - with a dash - should it proceed?';
  assert.equal(extractQuestionSnippet(prose), prose);
});

test('extractQuestionSnippet does not drop a real line just because it also contains footer-like words in prose', () => {
  const prose = 'Please accept edits for agents once you review the diff.';
  assert.equal(extractQuestionSnippet(prose), prose);
});

// Anchor-precision guards (mutation-hardening): the chrome-line patterns must
// require the WHOLE line to be chrome, not just a chrome-shaped prefix or
// suffix - a real question sharing a line with a rule/prompt fragment must
// survive.
test('extractQuestionSnippet keeps real text that ends a line with trailing box-rule characters', () => {
  const prose = 'Ready to deploy? ────';
  assert.equal(extractQuestionSnippet(prose), prose);
});

test('extractQuestionSnippet keeps real text that follows leading box-rule characters on the same line', () => {
  const prose = '── Ready to deploy this change?';
  assert.equal(extractQuestionSnippet(prose), prose);
});

test('extractQuestionSnippet keeps a real question that ends its line with a bare prompt marker', () => {
  const prose = 'Ready to deploy? ❯';
  assert.equal(extractQuestionSnippet(prose), prose);
});

test('extractQuestionSnippet keeps a real multiple-choice line that starts with the prompt marker', () => {
  const prose = '❯ 1) Deploy now';
  assert.equal(extractQuestionSnippet(prose), prose);
});

test('extractQuestionSnippet treats a bare prompt with the "type" placeholder as chrome regardless of trailing space', () => {
  const pane = [QUESTION, '❯ type'].join('\n');
  assert.equal(extractQuestionSnippet(pane), QUESTION);

  const paneWithTrailingSpace = [QUESTION, '❯ type '].join('\n');
  assert.equal(extractQuestionSnippet(paneWithTrailingSpace), QUESTION);
});

test('extractQuestionSnippet excludes the permission-mode footer even without the trailing "on"', () => {
  const pane = [QUESTION, '⏵⏵ bypass permissions (shift+tab to cycle) · ← for agents'].join('\n');
  assert.equal(extractQuestionSnippet(pane), QUESTION);
});

// Lines are trimmed before the chrome check, so trailing whitespace after the
// placeholder word never reaches BARE_PROMPT_LINE_PATTERN - the anchor that
// actually earns its keep is the one rejecting real content glued directly
// onto the placeholder word with no separating space.
test('extractQuestionSnippet keeps a prompt line where real text is glued directly onto the placeholder word', () => {
  const pane = [QUESTION, '❯ typewriter'].join('\n');
  assert.equal(extractQuestionSnippet(pane), `${QUESTION} ❯ typewriter`);
});
