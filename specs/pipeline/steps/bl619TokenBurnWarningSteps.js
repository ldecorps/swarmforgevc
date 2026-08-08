'use strict';

// BL-619: step handlers for "morning briefing warns when projected token
// burn outruns the weekly reset". Drives the REAL modules at whichever
// altitude each scenario actually tests, same layered posture as
// burnRateSteps.js/bl853...Steps.js:
//   - projection-decision-table-02, two-anchor-rate-04,
//     single-anchor-window-average-05, no-anchor-never-fabricates-06:
//     the pure decision/rate/format functions directly (burnProjection.js,
//     burnSectionText.js) - no fixture, no subprocess, an injected clock.
//   - anchor-validation-07, malformed-reset-config-08: the REAL compiled
//     CLIs (usage-anchor.js, token-burn-section.js) via subprocess against
//     a real fixture git repo, same posture as usageAnchorCli.test.js /
//     tokenBurnSectionCli.test.js.
//   - warning-leads-briefing-01, ok-path-one-line-status-03,
//     section-failure-never-blocks-send-09: the REAL briefing_email_lib.bb
//     composition via bl619_token_burn_briefing_harness.bb - the only way
//     to exercise the leading-vs-appended/subject-marker wiring for real
//     (that logic lives in Babashka, unreachable directly from Node).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_DIR = path.join(REPO_ROOT, 'extension');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const BRIEFING_HARNESS = path.join(SCRIPTS_DIR, 'test', 'bl619_token_burn_briefing_harness.bb');
const USAGE_ANCHOR_CLI = path.join(EXT_DIR, 'out', 'tools', 'usage-anchor.js');
const TOKEN_BURN_SECTION_CLI = path.join(EXT_DIR, 'out', 'tools', 'token-burn-section.js');

const {
  parseWeekResetConfig,
  composeBurnSection,
  deriveBurnRateFromAnchors,
  decideProjection,
  currentWeeklyWindowStartMs,
} = require(path.join(EXT_DIR, 'out', 'metrics', 'burnProjection'));
const { formatBurnSectionText, USAGE_ANCHOR_COMMAND } = require(path.join(EXT_DIR, 'out', 'metrics', 'burnSectionText'));
const { appendUsageAnchor } = require(path.join(EXT_DIR, 'out', 'metrics', 'usageAnchorStore'));

// 2026-07-24 is a Friday; the same fixed baseline burnProjection.test.js
// uses, so "the pinned instant" resolves deterministically regardless of
// which real day the acceptance run happens on.
function localMs(monthDay, hhmm) {
  const [hour, minute] = hhmm.split(':').map(Number);
  return new Date(2026, 6, monthDay, hour, minute, 0, 0).getTime();
}

const MS_PER_HOUR = 60 * 60 * 1000;
const THU_07_00 = { resetDay: 4, resetLocal: { hour: 7, minute: 0 } };

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
}

// A real fixture git repo (.swarmforge/roles.tsv resolves the project
// root, matching every other CLI-driving step file) with extension/out
// symlinked in so the compiled CLIs the harness/steps shell to are
// reachable without recompiling per-scenario.
function mkFixture(ctx) {
  if (ctx.fixtureRoot) {
    return ctx.fixtureRoot;
  }
  const root = mkTmp('aps-bl619-fixture-');
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 't@t']);
  git(root, ['config', 'user.name', 't']);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  fs.mkdirSync(path.join(root, '.swarmforge', 'operator'), { recursive: true });
  fs.mkdirSync(path.join(root, 'swarmforge'), { recursive: true });
  fs.mkdirSync(path.join(root, 'extension'), { recursive: true });
  fs.symlinkSync(path.join(EXT_DIR, 'out'), path.join(root, 'extension', 'out'));
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), `coder\tmaster\t${root}\tswarmforge-coder\tcoder\tclaude\ttask\n`);
  ctx.fixtureRoot = root;
  return root;
}

function writeResetConf(root, lines) {
  fs.writeFileSync(path.join(root, 'swarmforge', 'swarmforge.conf'), lines);
}

function registerSteps(registry) {
  // ── Background ──────────────────────────────────────────────────────
  registry.define(/^a swarm project with a pinned clock and a weekly reset configured for Thursday "07:00" local$/, (ctx) => {
    ctx.resetConfig = { config: THU_07_00, malformed: false };
    ctx.resetConfLines = 'config usage_week_reset_day thu\nconfig usage_week_reset_local 07:00\n';
  });

  // ── warning-leads-briefing-01 / ok-path-one-line-status-03 ─────────────
  // Both scenarios anchor 23% two hours before "the pinned instant" - which
  // instant differs (early-in-window projects warn; late-in-window is
  // diluted to ok, matching burnProjection.test.js's own two fixtures for
  // exactly this pair) is set by the rate-defining step below.
  registry.define(/^a usage anchor of (\d+) percent recorded 2 hours before the pinned instant$/, (ctx, pct) => {
    ctx.anchorPct = Number(pct);
  });

  registry.define(/^the calibrated burn rate projects 100 percent before the next weekly reset$/, (ctx) => {
    ctx.nowMs = localMs(24, '09:00'); // Friday, 1 day into the window that opened Thu 07:00
  });

  registry.define(/^the calibrated burn rate projects exhaustion after the next weekly reset$/, (ctx) => {
    ctx.nowMs = localMs(30, '00:00'); // Thursday, just before the 07:00 reset - a diluted late-window average
  });

  registry.define(/^the briefing email is composed$/, (ctx) => {
    const root = mkFixture(ctx);
    writeResetConf(root, ctx.resetConfLines ?? 'config usage_week_reset_day thu\nconfig usage_week_reset_local 07:00\n');
    if (ctx.anchorPct !== undefined) {
      appendUsageAnchor(root, ctx.nowMs - 2 * MS_PER_HOUR, ctx.anchorPct, 'all-models');
    }
    const briefingsDir = mkTmp('aps-bl619-briefings-');
    fs.writeFileSync(path.join(briefingsDir, '2026-07-09.md'), 'Headline: shipped a thing\n\nBody.\n');
    const mode = ctx.sectionCommandFails ? 'section-command-fails' : 'success';
    const args = [BRIEFING_HARNESS, root, briefingsDir, mode];
    if (ctx.nowMs !== undefined) {
      args.push(String(ctx.nowMs));
    }
    ctx.briefingResult = JSON.parse(execFileSync('bb', args, { encoding: 'utf8' }));
  });

  registry.define(/^a burn warning section is prepended above the briefing body$/, (ctx) => {
    if (!ctx.briefingResult.text.startsWith('TOKEN BURN WARNING')) {
      throw new Error(`expected the warning to lead the sent content, got: ${ctx.briefingResult.text}`);
    }
    if (!ctx.briefingResult.text.includes('Headline: shipped a thing')) {
      throw new Error('expected the coordinator-authored body to still follow the warning');
    }
  });

  registry.define(/^the warning names the projected run-out time$/, (ctx) => {
    if (!/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(ctx.briefingResult.text)) {
      throw new Error(`expected the warning to name a projected run-out timestamp, got: ${ctx.briefingResult.text}`);
    }
  });

  registry.define(/^the warning names the choice between pausing human usage and throttling the swarm$/, (ctx) => {
    const text = ctx.briefingResult.text;
    if (!/pauses usage/.test(text) || !/throttles/.test(text)) {
      throw new Error(`expected the warning to name both the pause-usage and throttle choices, got: ${text}`);
    }
  });

  registry.define(/^the email subject carries a token-burn warning marker$/, (ctx) => {
    if (!ctx.briefingResult.subject.startsWith('[TOKEN BURN WARNING] ')) {
      throw new Error(`expected the subject to carry the token-burn marker, got: ${ctx.briefingResult.subject}`);
    }
  });

  registry.define(/^no token-burn warning marker is added to the subject$/, (ctx) => {
    if (ctx.briefingResult.subject.includes('TOKEN BURN WARNING')) {
      throw new Error(`expected no token-burn marker in the subject, got: ${ctx.briefingResult.subject}`);
    }
  });

  registry.define(/^a one-line burn status appears among the appended sections$/, (ctx) => {
    const text = ctx.briefingResult.text;
    if (!text.startsWith('Headline: shipped a thing')) {
      throw new Error(`expected the body to lead (status appended, not prepended), got: ${text}`);
    }
    if (!/Token burn: on track/.test(text)) {
      throw new Error(`expected an appended token-burn status line, got: ${text}`);
    }
  });

  // ── section-failure-never-blocks-send-09 ────────────────────────────────
  registry.define(/^the burn section command fails$/, (ctx) => {
    ctx.sectionCommandFails = true;
  });

  registry.define(/^the briefing sends without the burn section$/, (ctx) => {
    if (ctx.briefingResult.emailsSent !== 1) {
      throw new Error(`expected the briefing to still send once, got: ${JSON.stringify(ctx.briefingResult)}`);
    }
    if (ctx.briefingResult.text.includes('TOKEN BURN') || ctx.briefingResult.text.includes('Token burn')) {
      throw new Error(`expected no burn-section text when the section command fails, got: ${ctx.briefingResult.text}`);
    }
  });

  // ── projection-decision-table-02 ────────────────────────────────────────
  registry.define(/^the pinned instant is (\d+) hours before the next weekly reset$/, (ctx, hours) => {
    ctx.nowMs = localMs(24, '10:00');
    ctx.nextResetMs = ctx.nowMs + Number(hours) * MS_PER_HOUR;
  });

  registry.define(/^a usage anchor of (\d+) percent recorded at the pinned instant$/, (ctx, pct) => {
    ctx.anchorPct = Number(pct);
  });

  registry.define(/^the calibrated burn rate is (-?\d+(?:\.\d+)?) percent per day$/, (ctx, ratePctPerDay) => {
    ctx.ratePctPerDay = Number(ratePctPerDay);
  });

  registry.define(/^the burn projection is computed$/, (ctx) => {
    ctx.decision = decideProjection(ctx.anchorPct, ctx.nowMs, ctx.ratePctPerDay, ctx.nextResetMs);
  });

  registry.define(/^the projection decision is "(warn|ok)"$/, (ctx, decision) => {
    if (ctx.decision !== decision) {
      throw new Error(`expected projection decision "${decision}", got "${ctx.decision}"`);
    }
  });

  // ── two-anchor-rate-04 / single-anchor-window-average-05 ────────────────
  registry.define(/^usage anchors of (\d+) percent and (\d+) percent recorded 24 hours apart in the current window$/, (ctx, first, second) => {
    const windowStart = localMs(1, '00:00');
    ctx.rateWindowStart = windowStart;
    ctx.rateAnchors = [
      { atMs: localMs(20, '00:00'), pct: Number(first), scope: 'all-models' },
      { atMs: localMs(21, '00:00'), pct: Number(second), scope: 'all-models' },
    ];
  });

  registry.define(/^the current weekly window began 48 hours before the pinned instant$/, (ctx) => {
    ctx.nowMs = localMs(3, '00:00');
    ctx.rateWindowStart = ctx.nowMs - 48 * MS_PER_HOUR;
  });

  registry.define(/^a single usage anchor of (\d+) percent recorded 24 hours after the window began$/, (ctx, pct) => {
    ctx.rateAnchors = [{ atMs: ctx.rateWindowStart + 24 * MS_PER_HOUR, pct: Number(pct), scope: 'all-models' }];
  });

  registry.define(/^the burn projection rate is computed$/, (ctx) => {
    ctx.derivedRate = deriveBurnRateFromAnchors(ctx.rateAnchors, ctx.rateWindowStart);
  });

  registry.define(/^the projection rate is (\d+(?:\.\d+)?) percent per day$/, (ctx, expected) => {
    if (ctx.derivedRate.ratePctPerDay !== Number(expected)) {
      throw new Error(`expected a projection rate of ${expected}%/day, got ${ctx.derivedRate.ratePctPerDay}`);
    }
  });

  // ── no-anchor-never-fabricates-06 ────────────────────────────────────────
  registry.define(/^no usage anchor exists in the current weekly window$/, (ctx) => {
    ctx.anchors = [];
    ctx.nowMs = localMs(24, '10:00');
  });

  registry.define(/^the burn section is composed$/, (ctx) => {
    const resetConfig = ctx.malformedReset
      ? parseWeekResetConfig('config usage_week_reset_day funday\n')
      : (ctx.resetConfig ?? { config: THU_07_00, malformed: false });
    const result = composeBurnSection({
      anchors: ctx.anchors ?? [],
      nowMs: ctx.nowMs,
      resetConfig,
      localBurnRateTokensPerHour: 2500,
      anchorScope: 'all-models',
    });
    ctx.burnSectionResult = result;
    ctx.burnSectionText = formatBurnSectionText(result, 'all-models');
  });

  registry.define(/^the section reports the local token burn rate from transcript telemetry$/, (ctx) => {
    if (!/tokens\/hr/.test(ctx.burnSectionText.appendedText)) {
      throw new Error(`expected the section to name a local tokens/hr rate, got: ${ctx.burnSectionText.appendedText}`);
    }
  });

  registry.define(/^the section states the account-level projection is unavailable until an anchor is recorded$/, (ctx) => {
    if (!/unavailable/.test(ctx.burnSectionText.appendedText)) {
      throw new Error(`expected the section to state the projection is unavailable, got: ${ctx.burnSectionText.appendedText}`);
    }
  });

  registry.define(/^the section names the anchor-recording command$/, (ctx) => {
    if (!ctx.burnSectionText.appendedText.includes(USAGE_ANCHOR_COMMAND)) {
      throw new Error(`expected the section to name the anchor command, got: ${ctx.burnSectionText.appendedText}`);
    }
  });

  registry.define(/^no account percentage projection is claimed$/, (ctx) => {
    if (ctx.burnSectionResult.kind !== 'no-anchor' && ctx.burnSectionResult.kind !== 'malformed') {
      throw new Error(`expected a no-anchor/malformed kind (never fabricating a percentage), got: ${ctx.burnSectionResult.kind}`);
    }
    if (/projected to exhaust/.test(ctx.burnSectionText.appendedText ?? '')) {
      throw new Error('expected no exhaustion-percentage claim in the no-anchor/malformed text');
    }
  });

  // ── malformed-reset-config-08 ─────────────────────────────────────────
  registry.define(/^the weekly reset configuration is malformed$/, (ctx) => {
    ctx.malformedReset = true;
    ctx.anchors = [];
    ctx.nowMs = localMs(24, '10:00');
  });

  registry.define(/^the section degrades to the local-burn-only form$/, (ctx) => {
    if (ctx.burnSectionResult.kind !== 'malformed') {
      throw new Error(`expected the malformed kind, got: ${ctx.burnSectionResult.kind}`);
    }
  });

  registry.define(/^a malformed reset config warning is logged loudly$/, (ctx) => {
    // The pure result carries the warning text (asserted above via
    // "the section degrades..."); the LOUD part - an actual stderr write -
    // is proven against the real compiled CLI, subprocess, capturing
    // stderr for real (never a mock), same posture as
    // applyCooldownPauseCli.test.js's malformed-config-no-pause-loud-09.
    const root = mkFixture(ctx);
    writeResetConf(root, 'config usage_week_reset_day funday\n');
    const result = spawnSync('node', [TOKEN_BURN_SECTION_CLI, '--now', String(ctx.nowMs)], { cwd: root, encoding: 'utf8' });
    if (!/malformed/i.test(result.stderr)) {
      throw new Error(`expected a loud stderr warning naming the malformed config, got stderr: ${result.stderr}`);
    }
  });

  // ── anchor-validation-07 ────────────────────────────────────────────────
  registry.define(/^the operator records a usage anchor of (-?\d+) percent$/, (ctx, pct) => {
    const root = mkFixture(ctx);
    ctx.anchorCliResult = spawnSync('node', [USAGE_ANCHOR_CLI, 'record', pct, '--now', String(localMs(24, '10:00'))], {
      cwd: root,
      encoding: 'utf8',
    });
  });

  registry.define(/^the anchor command (persists the checkpoint|rejects the value)$/, (ctx, outcome) => {
    const succeeded = ctx.anchorCliResult.status === 0;
    if (outcome === 'persists the checkpoint' && !succeeded) {
      throw new Error(`expected the anchor command to succeed, got exit ${ctx.anchorCliResult.status}, stderr: ${ctx.anchorCliResult.stderr}`);
    }
    if (outcome === 'rejects the value' && succeeded) {
      throw new Error('expected the anchor command to reject the out-of-range value, but it succeeded');
    }
  });
}

module.exports = { registerSteps };
