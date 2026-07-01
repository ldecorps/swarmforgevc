const assert = require('node:assert/strict');
const test = require('node:test');

// Detect if pane output shows agent is awaiting a human answer
// vs just idle at the normal input box
function detectNeedsHuman(paneText) {
  if (!paneText) return false;

  const lines = paneText.split('\n');
  const lastLines = lines.slice(-10).join('\n').toLowerCase();

  // Yes/no questions (higher confidence)
  if (/\(y\/n\)|yes\s*\/\s*no|yes\s*or\s*no/.test(lastLines)) {
    return true;
  }

  // Permission prompts (but exclude normal [auto] idle status)
  if (/permission\s*(required|mode|denied)|approve|allow|deny/.test(lastLines)) {
    return true;
  }

  // Exclude normal [auto] status at idle
  if (/\[auto\]\s*(idle|busy)/.test(lastLines)) {
    return false;
  }

  // Multiple choice or questions
  const lines_trimmed = lines.map(l => l.trim());
  for (let i = lines_trimmed.length - 1; i >= Math.max(0, lines_trimmed.length - 5); i--) {
    const line = lines_trimmed[i];

    // Skip empty lines and the standard input box
    if (!line || /^[❯>]\s*(type|message|\s*)$/.test(line)) {
      continue;
    }

    // Look for choice prompts with numbers, letters, or symbols
    if (/^[❯>]\s+[0-9a-z\(\)\[\]]/.test(line)) {
      return true;
    }

    // Question mark indicates a question (but be careful about exclamation marks in output)
    if (/[?!]$/.test(line) && !/^❯\s*/.test(line)) {
      return true;
    }
  }

  return false;
}

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
