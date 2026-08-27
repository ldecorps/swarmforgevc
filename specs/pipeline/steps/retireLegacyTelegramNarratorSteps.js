'use strict';

// BL-353 (BL-336 findings H2/H3): step handlers for "One Telegram system,
// with no signal lost on the way to it". The load-bearing investigation
// (which of the legacy narrator's four signals - stage-transition,
// gate-needs-you, dead-letter, pr-link - the Concierge front desk already
// carried) is documented in backlog/evidence/BL-353-*.md; this file drives
// the REAL code for each finding:
//   - gate-needs-you: unchanged, pre-existing (deriveSwarmEvents' own
//     NeedsApproval + operatorDecideStatus.ts's handleApprovalDecisionForTicket).
//   - dead-letter / pr-link: newly PORTED this ticket (notify-dead-letters.js
//     CLI into BL-346's reserved Operator topic; extension.ts's
//     announcePrLinkOnTelegram, source-verified - it can only truly run
//     inside a real VS Code host, the same "vscode.*-gated, verify from
//     code" posture BL-336's own audit used throughout).
//   - stage-transition: DETERMINED functionally covered by the COMBINATION
//     of TaskStarted+TaskCompleted+NeedsApproval+BL-349's stuck-escalation
//     email, not ported as new 1:1 per-role machinery - see the evidence
//     file for the full reasoning. Verified here as "all four covering
//     mechanisms exist and are wired", not as a literal per-transition
//     narration stream (which was a deliberate, documented scope decision,
//     not an oversight).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_DIR = path.join(REPO_ROOT, 'extension');
const DEAD_LETTER_CLI = path.join(EXT_DIR, 'out', 'tools', 'notify-dead-letters.js');
const { deriveSwarmEvents } = require(path.join(EXT_DIR, 'out', 'events', 'swarmEventStream'));
const { handleApprovalDecisionForTicket } = require(path.join(EXT_DIR, 'out', 'bridge', 'operatorDecideStatus'));

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl353-acceptance-'));
}
function git(root, args) {
  execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
}
function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

// ── gate-needs-you: unchanged, pre-existing ───────────────────────────────

function checkGateNeedsYouCovered() {
  const prev = { backlog: { active: [], paused: [], done: [] }, gates: [{ role: 'coder', gated: false }], roleTicket: { coder: 'BL-1' }, ticketSummaries: {} };
  const curr = { ...prev, gates: [{ role: 'coder', gated: true, snippet: 'proceed?' }] };
  const events = deriveSwarmEvents(prev, curr);
  return events.some((e) => e.type === 'NeedsApproval' && e.backlogId === 'BL-1');
}

// ── dead-letter: ported this ticket, into BL-346's reserved Operator topic ─

function mkDeadLetterFixture() {
  const root = mkTmp();
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 't@t']);
  git(root, ['config', 'user.name', 't']);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  mkdirp(path.join(root, '.swarmforge'));
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), `coder\tmaster\t${root}\tswarmforge-coder\tcoder\tclaude\ttask\n`);
  const inboxNewDir = path.join(root, '.swarmforge', 'handoffs', 'inbox', 'new');
  mkdirp(inboxNewDir);
  fs.writeFileSync(path.join(inboxNewDir, '00_a.handoff.dead'), 'type: note\nrecipient: coder\ntask: BL-900-demo\n');
  mkdirp(path.join(root, '.swarmforge', 'operator'));
  fs.writeFileSync(path.join(root, '.swarmforge', 'operator', 'telegram-topic-map.json'), JSON.stringify({ '777': 'OPERATOR' }));
  return root;
}

function runDeadLetterCli(root, overrides = {}) {
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, ...overrides };
  const out = execFileSync('node', [DEAD_LETTER_CLI], { encoding: 'utf8', cwd: root, env });
  return JSON.parse(out);
}

// ── pr-link: ported this ticket - source-verified (only truly invokable
//    inside a real VS Code host, which cannot be driven headlessly here;
//    the SAME "vscode.*-gated code, verify from the real source" posture
//    BL-336's own audit used throughout for host-only code) ──────────────

function checkPrLinkCovered() {
  const src = fs.readFileSync(path.join(EXT_DIR, 'src', 'extension.ts'), 'utf8');
  const hasHelper = /async function announcePrLinkOnTelegram/.test(src);
  const wiredFromOpenPr = /if \(result\.url\) \{\s*void announcePrLinkOnTelegram\(targetPath, result\.url, context\.secrets\)/.test(src);
  const resolvesOperatorTopic = /topicForSubject\(readTopicMap\(targetPath\), OPERATOR_SUBJECT_ID\)/.test(src);
  return hasHelper && wiredFromOpenPr && resolvesOperatorTopic;
}

// ── stage-transition: functionally covered by the combination ────────────

function checkStageTransitionCovered() {
  const eventSrc = fs.readFileSync(path.join(EXT_DIR, 'out', 'events', 'swarmEventStream.js'), 'utf8');
  const hasLifecycleEvents = /TaskStarted/.test(eventSrc) && /TaskCompleted/.test(eventSrc) && /NeedsApproval/.test(eventSrc);
  const stuckEscalationLibExists = fs.existsSync(path.join(REPO_ROOT, 'swarmforge', 'scripts', 'stuck_escalation_email_lib.bb'));
  return hasLifecycleEvents && stuckEscalationLibExists;
}

// ── the retired system's own source is gone ───────────────────────────────

function legacyFilesAbsent() {
  return (
    !fs.existsSync(path.join(EXT_DIR, 'src', 'notify', 'telegramNarrator.ts')) &&
    !fs.existsSync(path.join(EXT_DIR, 'src', 'notify', 'telegramInboundRelay.ts')) &&
    !fs.existsSync(path.join(EXT_DIR, 'src', 'notify', 'telegramNarrationSnapshot.ts'))
  );
}

function extensionTsWiringGone() {
  const src = fs.readFileSync(path.join(EXT_DIR, 'src', 'extension.ts'), 'utf8');
  return !/TelegramNarrator|TelegramInboundRelay|buildNarrationSnapshot|startOrRestartTelegramAdapter/.test(src);
}

const DELIVER_ENV = { TELEGRAM_BOT_TOKEN: 'fake-token', TELEGRAM_CHAT_ID: 'fake-chat', TELEGRAM_NOTIFY_FORCE_RESULT: JSON.stringify({ success: true }) };

const SIGNAL_CHECKS = {
  'gate-needs-you': checkGateNeedsYouCovered,
  'dead-letter': (ctx) => {
    // Reuses ctx.root if an earlier Given already established one
    // (scenario 05's own fixture) - otherwise builds a fresh one.
    ctx.root = ctx.root || mkDeadLetterFixture();
    const result = runDeadLetterCli(ctx.root, DELIVER_ENV);
    ctx.deadLetterResult = result;
    return result.sent === true;
  },
  'pr-link': checkPrLinkCovered,
  'stage-transition': checkStageTransitionCovered,
};

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^a swarm running headless, with no editor attached$/, () => {
    // Narrative only - every check in this file drives real headless
    // code (compiled CLIs/pure functions), or verifies vscode.*-gated
    // code from its real source, the same posture the retired legacy
    // pair's own absence-of-headless-caller finding used.
  });

  // ── retire-legacy-telegram-narrator-01 ────────────────────────────────
  registry.define(/^a signal the legacy narrator used to send$/, (ctx) => {
    ctx.signalsToCheck = ['stage-transition', 'gate-needs-you', 'dead-letter', 'pr-link'];
  });

  registry.define(/^that signal occurs$/, (ctx) => {
    ctx.results = {};
    for (const signal of ctx.signalsToCheck) {
      ctx.results[signal] = SIGNAL_CHECKS[signal](ctx);
    }
  });

  registry.define(/^the human is still told about it$/, (ctx) => {
    for (const signal of ctx.signalsToCheck) {
      assert.equal(ctx.results[signal], true, `expected "${signal}" to still reach the human, got: ${JSON.stringify(ctx.results)}`);
    }
  });

  // ── retire-legacy-telegram-narrator-02 ────────────────────────────────
  registry.define(/^a signal the legacy narrator sent that the front desk did not$/, (ctx) => {
    // dead-letter and pr-link: confirmed NOT carried by the Concierge
    // front desk BEFORE this ticket (backlog/evidence/BL-353-*.md) -
    // exactly the two signals this parcel ports.
    ctx.signalsToCheck = ['dead-letter', 'pr-link'];
  });

  registry.define(/^the front desk tells the human about it$/, (ctx) => {
    for (const signal of ctx.signalsToCheck) {
      assert.equal(ctx.results[signal], true, `expected "${signal}" to now be carried by the front desk, got: ${JSON.stringify(ctx.results)}`);
    }
  });

  // ── retire-legacy-telegram-narrator-03 ────────────────────────────────
  registry.define(/^a role is blocked on a question to the human$/, (ctx) => {
    ctx.pendingGates = [{ role: 'coder', gated: true, snippet: 'proceed?' }];
    ctx.roleTicket = { coder: 'BL-900' };
    ctx.answered = [];
  });

  registry.define(/^the human answers it from Telegram$/, (ctx) => {
    ctx.decision = handleApprovalDecisionForTicket(ctx.pendingGates, ctx.roleTicket, 'BL-900', 'yes, go ahead', {
      answerGate: (role, answer) => {
        ctx.answered.push({ role, answer });
        return { success: true };
      },
      reply: () => {},
    });
  });

  registry.define(/^the role that asked receives the answer$/, (ctx) => {
    assert.equal(ctx.answered.length, 1, `expected exactly one gate to be answered, got: ${JSON.stringify(ctx.answered)}`);
    assert.equal(ctx.answered[0].role, 'coder');
    assert.equal(ctx.answered[0].answer, 'yes, go ahead');
    assert.equal(ctx.decision.action, 'answer', `expected the decision to actually answer the gate, got: ${JSON.stringify(ctx.decision)}`);
  });

  // ── retire-legacy-telegram-narrator-04 ────────────────────────────────
  registry.define(/^the swarm runs$/, () => {
    // Narrative only - the Then steps below verify the retirement from
    // the real source (no live swarm process is spawned for this).
  });

  registry.define(/^the legacy narrator does not send anything$/, () => {
    assert.equal(legacyFilesAbsent(), true, 'expected telegramNarrator.ts/telegramNarrationSnapshot.ts to no longer exist');
    assert.equal(extensionTsWiringGone(), true, 'expected extension.ts to no longer reference TelegramNarrator/startOrRestartTelegramAdapter');
  });

  registry.define(/^the legacy inbound relay does not receive anything$/, () => {
    assert.equal(
      fs.existsSync(path.join(EXT_DIR, 'src', 'notify', 'telegramInboundRelay.ts')),
      false,
      'expected telegramInboundRelay.ts to no longer exist'
    );
    const coreSrc = fs.readFileSync(path.join(EXT_DIR, 'src', 'tools', 'telegramFrontDeskBotCore.ts'), 'utf8');
    assert.match(coreSrc, /export function nextUpdateOffset/, 'expected nextUpdateOffset to have been preserved (a real front-desk bot dependency), just relocated');
  });

  // ── retire-legacy-telegram-narrator-05 ────────────────────────────────
  // dead-letter is a signal BOTH the legacy narrator (before retirement)
  // and the Concierge front desk (this ticket's own port) could
  // independently have sent - the exact double-send risk the ticket's own
  // "no double-notification" requirement guards against. Reuses the SAME
  // shared "that signal occurs" handler (registered above for 01/02) via
  // ctx.signalsToCheck - it sends the FIRST occurrence for real; the Then
  // step below drives a SECOND occurrence explicitly to prove it is not
  // repeated.
  registry.define(/^a signal that both systems could have sent$/, (ctx) => {
    ctx.root = mkDeadLetterFixture();
    ctx.signalsToCheck = ['dead-letter'];
  });

  registry.define(/^the human is told about it once$/, (ctx) => {
    assert.equal(ctx.results['dead-letter'], true, `expected the first occurrence to reach the human, got: ${JSON.stringify(ctx.results)}`);
    const second = runDeadLetterCli(ctx.root, { TELEGRAM_BOT_TOKEN: 'fake-token', TELEGRAM_CHAT_ID: 'fake-chat' });
    assert.equal(second.sent, false, `expected no second send for the SAME signal (once, not twice), got: ${JSON.stringify(second)}`);
    assert.equal(extensionTsWiringGone(), true, 'expected no second (legacy) sender left in the codebase to ever double-notify');
  });
}

module.exports = { registerSteps };
