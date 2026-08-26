const assert = require('node:assert/strict');
const {
  extractLatestSessionUrl,
  recordSessionUrl,
  getSessionUrl,
  resetSessionUrls,
} = require('../out/notify/sessionUrlCapture');

beforeEach(() => {
  resetSessionUrls();
});

// ── extractLatestSessionUrl (pure) ──────────────────────────────────────

test('extractLatestSessionUrl returns null when no URL is present', () => {
  assert.equal(extractLatestSessionUrl('just some agent output'), null);
  assert.equal(extractLatestSessionUrl(null), null);
  assert.equal(extractLatestSessionUrl(undefined), null);
});

test('extractLatestSessionUrl finds a single URL', () => {
  const text = 'Session ready: https://claude.ai/code/session_abc123\nworking...';
  assert.equal(extractLatestSessionUrl(text), 'https://claude.ai/code/session_abc123');
});

test('extractLatestSessionUrl returns the LAST match when several appear', () => {
  const text =
    'https://claude.ai/code/session_old\n' +
    'lots of output in between\n' +
    'https://claude.ai/code/session_new';
  assert.equal(extractLatestSessionUrl(text), 'https://claude.ai/code/session_new');
});

// ── recordSessionUrl / getSessionUrl (stateful capture) ─────────────────

test('getSessionUrl returns null for a role that has never been observed', () => {
  assert.equal(getSessionUrl('coder'), null);
});

test('recordSessionUrl remembers the URL for its role', () => {
  recordSessionUrl('coder', 'https://claude.ai/code/session_xyz');
  assert.equal(getSessionUrl('coder'), 'https://claude.ai/code/session_xyz');
});

test('recordSessionUrl with no URL in the text does not clear a previously captured one', () => {
  recordSessionUrl('coder', 'https://claude.ai/code/session_first');
  recordSessionUrl('coder', 'unrelated output, no url here');
  assert.equal(getSessionUrl('coder'), 'https://claude.ai/code/session_first');
});

test('BL-073 scenario 06: the freshest URL wins as it streams in', () => {
  recordSessionUrl('coder', 'starting up\nhttps://claude.ai/code/session_old');
  recordSessionUrl('coder', 'starting up\nhttps://claude.ai/code/session_old\n...\nhttps://claude.ai/code/session_new');
  assert.equal(getSessionUrl('coder'), 'https://claude.ai/code/session_new');
});

test('recordSessionUrl tracks roles independently', () => {
  recordSessionUrl('coder', 'https://claude.ai/code/session_coder1');
  recordSessionUrl('cleaner', 'https://claude.ai/code/session_cleaner1');
  assert.equal(getSessionUrl('coder'), 'https://claude.ai/code/session_coder1');
  assert.equal(getSessionUrl('cleaner'), 'https://claude.ai/code/session_cleaner1');
});
