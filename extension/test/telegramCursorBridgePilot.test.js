const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  parsePilotTicket,
  composePilotExpeditorPrompt,
  formatPilotStartMessage,
  formatPilotBlockedByExpediteMessage,
  gatePilotAgainstExpediteLock,
} = require('../out/tools/telegramCursorBridgePilot');

function mkRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-pilot-'));
  fs.mkdirSync(path.join(root, '.swarmforge', 'operator'), { recursive: true });
  return root;
}

test('parsePilotTicket accepts /pilot with optional ticket', () => {
  assert.equal(parsePilotTicket('/pilot'), 'BL-696');
  assert.equal(parsePilotTicket('/pilot BL-624'), 'BL-624');
  assert.equal(parsePilotTicket('  /PILOT bl-100  '), 'BL-100');
  assert.equal(parsePilotTicket('/pilot NOPE'), undefined);
  assert.equal(parsePilotTicket('/expedite BL-624'), undefined);
});

test('composePilotExpeditorPrompt names the ticket and forbids automated expedite', () => {
  const text = composePilotExpeditorPrompt('BL-700');
  assert.match(text, /BL-700/);
  assert.match(text, /\/pilot/);
  assert.match(text, /Do NOT spawn/);
  assert.match(text, /expedite_cli/);
  assert.match(text, /cursor-as-expeditor/);
  assert.match(text, /\.worktrees\/expedite-BL-700/);
});

test('formatPilotStartMessage identifies Cursor-piloted mode', () => {
  assert.match(formatPilotStartMessage('BL-696'), /Pilot BL-696 started/);
  assert.match(formatPilotStartMessage('BL-696'), /no claude -p/i);
});

test('gatePilotAgainstExpediteLock refuses when automated expedite holds the lock', () => {
  const root = mkRoot();
  assert.deepEqual(gatePilotAgainstExpediteLock(root), { ok: true });
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'operator', 'expedite-bridge.lock'),
    `${JSON.stringify({ ticket: 'BL-696', pid: process.pid })}\n`,
    'utf8'
  );
  const blocked = gatePilotAgainstExpediteLock(root);
  assert.equal(blocked.ok, false);
  if (!blocked.ok) {
    assert.match(formatPilotBlockedByExpediteMessage('BL-700', blocked.detail), /Cannot pilot BL-700/);
    assert.match(blocked.detail, /BL-696/);
  }
});
