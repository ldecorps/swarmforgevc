const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const {
  parsePilotTicket,
  composePilotExpeditorPrompt,
  composePilotStagePrompt,
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
      'Mode: Cursor-as-expeditor. Do NOT spawn `expedite_cli.bb`,',
      '`expedite_with_progress.sh`, or `claude -p` stage runners.',
      '',
      'PER-HAT REINJECT (BL-758 — mandatory): at each hat change and bounce-back,',
      'resetAgent (or equivalent session boundary) then inject',
      '`composePilotStagePrompt(ticket, role)` — the thin pilot isolation wrapper',
      'PLUS the full live `swarmforge/roles/<role>.prompt` bytes (QA → QA.prompt),',
      'plus pack overlay when configured. Do NOT wear every pipeline hat from one',
      'mega-brief alone. Do NOT merely remind yourself of the role name or ask',
      'yourself to "read" the prompt file without reinjecting its contents.',
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
      'asks. EVERY poll MUST include one extra option meaning the human needs more',
      'context before they can answer — label it exactly: "Need more detail". If',
      'that option wins, post a richer brief (or fewer sharper polls) and ask again;',
      'do not treat silence as consent.',
      '',
      'STAGE-BOUNDARY CLEANUP: after each stage and at run end, check and kill',
      'leftovers from THIS expedition before declaring the stage done or going',
      'long-idle — hung acceptance runners (`node --test`, `*.generated.test.js`,',
      'cucumber under disposable roots), leftover Stryker / mutation jobs, and',
      'related fixture babysitter / bridge processes under `/tmp/tmp.*` spawned for',
      'the run. Do NOT kill the host Cursor Remote bridge, Operator, or live-window',
      'host processes. Do not rely solely on the host orphan janitor (~2h reap).',
      '',
      'REVIEW HATS (cleaner / hardener / architect during /pilot) — BL-749:',
      "A gap against the ticket's OWN explicit guardrail claim is never a",
      'non-blocking nit until you have read the CALL SITE (not only the',
      'function in isolation) and confirmed whether the guardrail is actually',
      'upheld downstream. Call-site tracing before nit-downgrade is mandatory.',
      '',
      'REVIEW HATS (cleaner / hardener / architect during /pilot) — BL-753:',
      'A registered acceptance step handler whose pattern matches no rendered',
      'feature step is an untested-behavior flag until you answer: what claim',
      'was this step meant to verify, and is that claim tested any other way?',
      'Do not dismiss it as cosmetic dead code.',
      '',
      'REVIEW HATS (hardener during /pilot) — BL-755:',
      'A multi-branch parser (cond / case / if-else with ≥3 arms) needs one',
      'distinct test per arm before pass — not only the branch the ticket',
      'narrates. Untested arms are untested-parser-branch defects.',
      '',
      'REVIEW HATS (hardener during /pilot) — BL-751:',
      'A new arm added to an existing multi-branch dispatch (cond / case /',
      'if-else) whose other arms already share a gating pattern (a timeout,',
      'grace period, or guard condition applied uniformly) must be diffed',
      'against those siblings before pass. A shared pattern silently dropped',
      'on the new arm is a defect candidate, not a style nit — flag it for an',
      'explicit decision (follow the pattern or document the deviation).',
      '',
      'Isolation (same as BL-567):',
      '- Work only in `.worktrees/expedite-BL-702` on branch `expedite/BL-702`.',
      '- Do not use handoffd, mailboxes, tmux, rotate_to_role, ready_for_next, or the coordinator.',
      '- You MAY stop/start the swarm stack and park sibling active tickets to backlog/hold/.',
      '',
      'Stages (in order, skip any already done with evidence): specifier → coder →',
      'cleaner → architect → hardener → documenter → QA. For each stage: reinject',
      "that role's live prompt via composePilotStagePrompt, do the work, leave a",
      'verdict under `.swarmforge/expedite/BL-702/NN-<role>/verdict.json`',
      '(include `role_prompt_path` + `role_prompt_sha256` of the injected bytes),',
      'and refresh `.swarmforge/expedite/BL-702/progress.json` (include',
      '`"mode":"cursor-as-expeditor"`).',
      '',
      'When QA stamps the ticket, land it by running',
      '`node extension/out/tools/pilot-acceptance-gate.js BL-702`',
      "— this is the ONLY landing path. It runs the ticket's own declared",
      'acceptance contract and moves the yaml to backlog/done/ only on a green',
      "result, refusing (and writing nothing) otherwise; never `git mv` the",
      'yaml directly. Then write run.json.',
      'Restart of the swarm is optional and non-blocking — ask before restarting.',
      '',
      'Begin now with BL-702: composePilotStagePrompt for the first required',
      'hat (usually specifier), reinject, then read the ticket YAML and expedite artifacts.',
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
  assert.match(text, /Need more detail/);
  assert.match(text, /EVERY poll MUST include one extra option/);
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

// BL-727: landing runs through the acceptance-contract gate CLI, never a
// bare git mv (required_wiring pins the literal "pilot-acceptance-gate"
// string in this file).
test('composePilotExpeditorPrompt lands through the pilot-acceptance-gate CLI, never a bare git mv (BL-727)', () => {
  const text = composePilotExpeditorPrompt('BL-727');
  assert.match(text, /node extension\/out\/tools\/pilot-acceptance-gate\.js BL-727/);
  assert.match(text, /ONLY landing path/);
  assert.match(text, /never `git mv` the/);
  assert.doesNotMatch(text, /land it by running `git mv`/);
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

test('composePilotExpeditorPrompt requires call-site tracing before nit-downgrade (BL-749)', () => {
  const text = composePilotExpeditorPrompt('BL-749');
  assert.match(text, /REVIEW HATS/);
  assert.match(text, /call-site tracing before nit-downgrade/i);
  assert.match(text, /CALL SITE/);
  assert.match(text, /not only the\s+function in isolation/);
  assert.match(text, /guardrail claim/);
  // Polarity + obligation: never→always / mandatory→optional must not survive (BL-749).
  assert.match(text, /is never a\s+non-blocking nit/);
  assert.doesNotMatch(text, /is always a\s+non-blocking nit/);
  assert.match(text, /Call-site tracing before nit-downgrade is mandatory/);
  assert.doesNotMatch(text, /Call-site tracing before nit-downgrade is optional/);
});

test('composePilotExpeditorPrompt treats unreachable step handlers as untested-behavior (BL-753)', () => {
  const text = composePilotExpeditorPrompt('BL-753');
  assert.match(text, /BL-753/);
  assert.match(text, /untested-behavior flag/);
  assert.match(text, /cosmetic dead code/);
  assert.match(text, /what claim/);
});

test('composePilotExpeditorPrompt requires per-arm tests for multi-branch parsers (BL-755)', () => {
  const text = composePilotExpeditorPrompt('BL-755');
  assert.match(text, /BL-755/);
  assert.match(text, /distinct test per arm/);
  assert.match(text, /multi-branch parser/);
  assert.match(text, /untested-parser-branch/);
});

test('composePilotExpeditorPrompt requires diffing a new dispatch branch against its siblings (BL-751)', () => {
  const text = composePilotExpeditorPrompt('BL-751');
  assert.match(text, /BL-751/);
  assert.match(text, /multi-branch dispatch/);
  assert.match(text, /gating pattern/);
  assert.match(text, /diffed\nagainst those siblings/);
  assert.match(text, /defect candidate, not a style nit/);
  assert.doesNotMatch(text, /is not a defect candidate/);
});

test('composePilotStagePrompt includes live role prompt and thin wrapper (BL-758)', () => {
  const text = composePilotStagePrompt('BL-758', 'coder', {
    readRolePrompt: () => 'CODER_ROLE_PROMPT_BODY_UNIQUE',
  });
  assert.match(text, /CODER_ROLE_PROMPT_BODY_UNIQUE/);
  assert.match(text, /PILOT STAGE WRAPPER/);
  assert.match(text, /swarmforge\/roles\/coder\.prompt/);
  assert.match(text, /reinject composePilotStagePrompt/);
});

test('composePilotExpeditorPrompt requires per-hat reinject not mega-brief-alone (BL-758)', () => {
  const text = composePilotExpeditorPrompt('BL-758');
  assert.match(text, /PER-HAT REINJECT/);
  assert.match(text, /composePilotStagePrompt/);
  assert.match(text, /mega-brief alone/);
  assert.doesNotMatch(text, /YOU wear every pipeline hat in turn/);
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
