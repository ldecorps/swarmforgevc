const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const {
  parsePilotTicket,
  composePilotExpeditorPrompt,
  formatPilotStartMessage,
  formatPilotBlockedByExpediteMessage,
  formatPilotTicketChangeStatus,
  formatPilotHatChangeStatus,
  formatPilotBounceBackStatus,
  gatePilotAgainstExpediteLock,
} = require('../out/tools/telegramCursorBridgePilot');

function mkRoot() {
  const root = mkTmpDir('sf-pilot-');
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
  const text = composePilotExpeditorPrompt('BL-702');
  assert.equal(
    text,
    [
      'You are staffing an OFFLINE EXPEDITION for BL-702 (command: /pilot).',
      '',
      'Mode: Cursor-as-expeditor. YOU wear every pipeline hat in turn. Do NOT spawn',
      '`expedite_cli.bb`, `expedite_with_progress.sh`, or `claude -p` stage runners.',
      '',
      'Quality over speed: prefer correctness, evidence, and gate discipline over',
      'finishing quickly. Output quality beats delivery speed.',
      '',
      'Bounce-backs are first-class (native-swarm spirit): if a later hat finds a',
      'defect that belongs upstream, return to that earlier pipeline role, fix it,',
      'and re-walk downstream as needed — with a clear rationale. Do not treat',
      '"already past role N" as a reason to paper over defects. Do not rush to a',
      'QA stamp over fixing upstream defects.',
      '',
      'TELEGRAM STATUS POSTS (mandatory on Cursor Remote — not only progress.json',
      'or playful SDK status):',
      '- Ticket change (start, switch, or handoff to another BL): post ticket id +',
      '  object (title / one-line purpose from YAML).',
      '- Hat / casquette change: post which role is now worn + brief stage job.',
      '- Bounce-back: post target role AND explicit reason (what failed / evidence).',
      'Optional: short posts when interesting non-vacuous scenarios appear.',
      '',
      'HUMAN QUESTIONS: if you (any hat) need a decision or answer from the human,',
      'you MUST ask with a native Telegram poll on the Cursor Remote topic. Clear',
      'question + discrete options. Wait for the vote. Do not rely on free-text-only',
      'asks.',
      '',
      'STAGE-BOUNDARY CLEANUP: after each stage and at run end, check and kill',
      'leftovers from THIS expedition before declaring the stage done or going',
      'long-idle — hung acceptance runners (`node --test`, `*.generated.test.js`,',
      'cucumber under disposable roots), leftover Stryker / mutation jobs, and',
      'related fixture babysitter / bridge processes under `/tmp/tmp.*` spawned for',
      'the run. Do NOT kill the host Cursor Remote bridge, Operator, or live-window',
      'host processes. Do not rely solely on the host orphan janitor (~2h reap).',
      '',
      'Isolation (same as BL-567):',
      '- Work only in `.worktrees/expedite-BL-702` on branch `expedite/BL-702`.',
      '- Do not use handoffd, mailboxes, tmux, rotate_to_role, ready_for_next, or the coordinator.',
      '- You MAY stop/start the swarm stack and park sibling active tickets to backlog/hold/.',
      '',
      'Stages (in order, skip any already done with evidence): specifier → coder →',
      'cleaner → architect → hardener → documenter → QA. For each stage: do the work,',
      'leave a verdict under `.swarmforge/expedite/BL-702/NN-<role>/verdict.json`,',
      'and refresh `.swarmforge/expedite/BL-702/progress.json` (include',
      '`"mode":"cursor-as-expeditor"`).',
      '',
      'When QA stamps the ticket, `git mv` it to backlog/done/ and write run.json.',
      'Restart of the swarm is optional and non-blocking — ask before restarting.',
      '',
      'Begin now with BL-702. Read the ticket YAML and current expedite artifacts first.',
    ].join('\n')
  );
  // Invalid ticket still uppercases via fallback (kills ?? → && and toUpperCase → toLowerCase)
  const fallback = composePilotExpeditorPrompt('not-a-ticket');
  assert.match(fallback, /OFFLINE EXPEDITION for NOT-A-TICKET/);
  assert.doesNotMatch(fallback, /not-a-ticket/);
});

// BL-699 pilot-quality-01..05 — contract checks against the composed prompt
test('composePilotExpeditorPrompt prefers quality over speed (BL-699)', () => {
  const text = composePilotExpeditorPrompt('BL-699');
  assert.match(text, /Output quality beats delivery speed/);
  assert.match(text, /evidence, and gate discipline/);
  assert.match(text, /finishing quickly/);
});

test('composePilotExpeditorPrompt treats bounce-backs as first-class (BL-699)', () => {
  const text = composePilotExpeditorPrompt('BL-699');
  assert.match(text, /Bounce-backs are first-class/);
  assert.match(text, /return to that earlier pipeline role/);
  assert.match(text, /with a clear rationale/);
  assert.match(text, /paper over defects/);
  assert.match(text, /Do not rush to a\nQA stamp/);
});

test('composePilotExpeditorPrompt requires Telegram poll for human questions (BL-699)', () => {
  const text = composePilotExpeditorPrompt('BL-699');
  assert.match(text, /native Telegram poll on the Cursor Remote topic/);
  assert.match(text, /Do not rely on free-text-only\nasks/);
});

test('composePilotExpeditorPrompt keeps isolation and expedite lock gate (BL-699)', () => {
  const text = composePilotExpeditorPrompt('BL-699');
  assert.match(text, /Cursor-as-expeditor/);
  assert.match(text, /expedite_cli\.bb/);
  assert.match(text, /claude -p/);
  assert.match(text, /\.worktrees\/expedite-BL-699/);
  assert.match(text, /expedite\/BL-699/);
  const root = mkRoot();
  assert.deepEqual(gatePilotAgainstExpediteLock(root), { ok: true });
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'operator', 'expedite-bridge.lock'),
    `${JSON.stringify({ ticket: 'BL-702', pid: process.pid })}\n`,
    'utf8'
  );
  const blocked = gatePilotAgainstExpediteLock(root);
  assert.equal(blocked.ok, false);
});

// BL-700 pilot-status-01..03
test('composePilotExpeditorPrompt requires Telegram status posts (BL-700)', () => {
  const text = composePilotExpeditorPrompt('BL-700');
  assert.match(text, /TELEGRAM STATUS POSTS \(mandatory on Cursor Remote/);
  assert.match(text, /not only progress\.json/);
  assert.match(text, /Ticket change/);
  assert.match(text, /Hat \/ casquette change/);
  assert.match(text, /Bounce-back: post target role AND explicit reason/);
});

test('formatPilotTicketChangeStatus includes ticket and object (BL-700)', () => {
  assert.equal(
    formatPilotTicketChangeStatus('BL-700', 'Cursor /pilot Telegram status posts'),
    '🧭 Pilot ticket: BL-700 — Cursor /pilot Telegram status posts'
  );
  assert.equal(formatPilotTicketChangeStatus('BL-700', '  '), '🧭 Pilot ticket: BL-700 — (no title)');
});

test('formatPilotHatChangeStatus includes role and stage job (BL-700)', () => {
  assert.equal(
    formatPilotHatChangeStatus('coder', 'implement status helpers'),
    '🎩 Pilot hat: coder — implement status helpers'
  );
  assert.equal(formatPilotHatChangeStatus('QA', '  '), '🎩 Pilot hat: QA — stage work');
});

test('formatPilotBounceBackStatus includes target and reason (BL-700)', () => {
  assert.equal(
    formatPilotBounceBackStatus('specifier', 'acceptance scenarios missing bounce reason'),
    '↩️ Pilot bounce-back → specifier: acceptance scenarios missing bounce reason'
  );
  assert.equal(formatPilotBounceBackStatus('coder', ''), '↩️ Pilot bounce-back → coder: (no reason given)');
});

// BL-701 pilot-cleanup-01..02
test('composePilotExpeditorPrompt requires stage-boundary orphan cleanup (BL-701)', () => {
  const text = composePilotExpeditorPrompt('BL-701');
  assert.match(text, /STAGE-BOUNDARY CLEANUP/);
  assert.match(text, /acceptance runners/);
  assert.match(text, /\*\.generated\.test\.js/);
  assert.match(text, /Stryker/);
  assert.match(text, /\/tmp\/tmp\.\*/);
  assert.match(text, /Do NOT kill the host Cursor Remote bridge/);
  assert.match(text, /Do not rely solely on the host orphan janitor/);
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
  const msg = formatPilotBlockedByExpediteMessage('BL-702', 'BL-696 pid 42');
  const lines = msg.split('\n');
  assert.equal(lines.length, 2);
  assert.equal(
    lines[0],
    'Cannot pilot BL-702: automated expedite is already running (BL-696 pid 42).'
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
    assert.match(formatPilotBlockedByExpediteMessage('BL-702', blocked.detail), /Cannot pilot BL-702/);
    assert.match(blocked.detail, /BL-696/);
    assert.match(blocked.detail, new RegExp(String(process.pid)));
  }
});
