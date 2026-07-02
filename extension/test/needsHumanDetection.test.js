const assert = require('node:assert/strict');
const test = require('node:test');
const { detectNeedsHuman, extractQuestionSnippet } = require('../out/panel/needsHumanDetection');

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
