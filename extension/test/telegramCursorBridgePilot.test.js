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
  assert.equal(parsePilotTicket('/pilot  BL-624'), 'BL-624'); // two spaces after command
  assert.equal(parsePilotTicket('/pilot\tBL-700'), 'BL-700');
  assert.equal(parsePilotTicket('/pilot '), 'BL-696'); // trailing space still defaults
  assert.equal(parsePilotTicket('/pilot BL-624 '), 'BL-624');
  assert.equal(parsePilotTicket('/pilot NOPE'), undefined);
  assert.equal(parsePilotTicket('/expedite BL-624'), undefined);
  // Anchors and trailing shape: reject prefix noise, suffix tokens, trailing non-space junk
  assert.equal(parsePilotTicket('x/pilot'), undefined);
  assert.equal(parsePilotTicket('/pilot BL-624 extra'), undefined);
  assert.equal(parsePilotTicket('/pilotx'), undefined);
  assert.equal(parsePilotTicket('/pilot BL-624!'), undefined);
});

test('composePilotExpeditorPrompt is the full offline-expeditor brief', () => {
  const text = composePilotExpeditorPrompt('BL-700');
  assert.equal(
    text,
    [
      'You are staffing an OFFLINE EXPEDITION for BL-700 (command: /pilot).',
      '',
      'Mode: Cursor-as-expeditor. YOU wear every pipeline hat in turn. Do NOT spawn',
      '`expedite_cli.bb`, `expedite_with_progress.sh`, or `claude -p` stage runners.',
      '',
      'Isolation (same as BL-567):',
      '- Work only in `.worktrees/expedite-BL-700` on branch `expedite/BL-700`.',
      '- Do not use handoffd, mailboxes, tmux, rotate_to_role, ready_for_next, or the coordinator.',
      '- You MAY stop/start the swarm stack and park sibling active tickets to backlog/hold/.',
      '',
      'Stages (in order, skip any already done with evidence): specifier → coder →',
      'cleaner → architect → hardener → documenter → QA. For each stage: do the work,',
      'leave a verdict under `.swarmforge/expedite/BL-700/NN-<role>/verdict.json`,',
      'and refresh `.swarmforge/expedite/BL-700/progress.json` (include',
      '`"mode":"cursor-as-expeditor"`).',
      '',
      'When QA stamps the ticket, `git mv` it to backlog/done/ and write run.json.',
      'Restart of the swarm is optional and non-blocking — ask before restarting.',
      '',
      'Begin now with BL-700. Read the ticket YAML and current expedite artifacts first.',
    ].join('\n')
  );
  // Invalid ticket still uppercases via fallback (kills ?? → && and toUpperCase → toLowerCase)
  const fallback = composePilotExpeditorPrompt('not-a-ticket');
  assert.match(fallback, /OFFLINE EXPEDITION for NOT-A-TICKET/);
  assert.doesNotMatch(fallback, /not-a-ticket/);
});

test('formatPilotStartMessage identifies Cursor-piloted mode', () => {
  const msg = formatPilotStartMessage('BL-696');
  const lines = msg.split('\n');
  assert.equal(lines.length, 3);
  assert.equal(lines[0], '🧭 Pilot BL-696 started.');
  assert.match(lines[1], /no claude -p/i);
  assert.match(lines[1], /expedite_cli/);
  assert.match(lines[2], /Progress posts and \/update/);
});

test('formatPilotBlockedByExpediteMessage names ticket and lock detail', () => {
  const msg = formatPilotBlockedByExpediteMessage('BL-700', 'BL-696 pid 42');
  const lines = msg.split('\n');
  assert.equal(lines.length, 2);
  assert.equal(
    lines[0],
    'Cannot pilot BL-700: automated expedite is already running (BL-696 pid 42).'
  );
  assert.match(lines[1], /Wait for it to finish/);
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
    assert.match(blocked.detail, new RegExp(String(process.pid)));
  }
});
