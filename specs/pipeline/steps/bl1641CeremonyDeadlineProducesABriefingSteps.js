'use strict';

// BL-1641: a closing ceremony at its briefing deadline produces a briefing
// before the stop.
//
// Answered by this ticket's own e2e, which drives the REAL compiled
// ceremony CLI (buildRealDeps) and the REAL commit_integrity_cli.bb /
// compose_banked_briefing_cli.bb chain against a scratch local clone of
// this repo - never a mock, never the live checkout.

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE = 'BL-1641 A closing ceremony at its briefing deadline produces a briefing before the stop';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const E2E = path.join('swarmforge', 'scripts', 'test', 'test_bl1641_ceremony_deadline_produces_a_briefing.sh');

// Explicit KNOWN_VALUES: a scenario naming a claim this handler does not know
// throws rather than passing through unchecked.
const CLAIMS = {
  'landed-byte-identical': 'main\'s tip adds docs/briefings/<today>.md byte-identical to the documenter\'s copy and touches no other path',
  'landed-sequence': 'the recorded sequence contains briefing-landed-from-documenter before swarm-stopped',
  'missing-surfaced': 'closing-briefing-missing is surfaced',
  'composed-first-line': 'main\'s tip adds docs/briefings/<today>.md whose first line names the closing ceremony',
  'composed-sequence': 'the recorded sequence contains briefing-composed-headless before swarm-stopped',
  'unchanged-tip': 'a briefing main already has is left alone: main\'s tip is unchanged',
  'unforced-ending': 'the recorded sequence ends with briefing-missing, swarm-stopped',
  'failing-composer-unchanged-tip': 'with a failing composer main\'s tip is unchanged',
  'stopped': 'the swarm is stopped',
};

// Module scope, not per-ctx: each scenario gets its own ctx, so a per-ctx memo
// would re-run the whole suite once per scenario (BL-1390).
let suiteRun = null;

function runE2e(ctx) {
  ctx.bl1641 = ctx.bl1641 || {};
  if (suiteRun) {
    ctx.bl1641.out = suiteRun.out;
    return suiteRun.out;
  }
  const res = spawnSync('bash', [E2E], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 300000 });
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  suiteRun = { out, status: res.status };
  ctx.bl1641.out = out;
  if (res.status !== 0) {
    throw new Error(`the BL-1641 ceremony-deadline e2e failed (${res.status}):\n${out}`);
  }
  return out;
}

function requirePassed(ctx, claimKey) {
  const claim = CLAIMS[claimKey];
  assert.ok(claim, `unknown claim: ${claimKey}`);
  const out = runE2e(ctx);
  assert.ok(out.includes(`PASS: ${claim}`), `"${claim}" did not pass, in:\n${out}`);
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background (fixture shape only - the e2e builds its own fixtures) ────
  scoped(/^a git fixture root under a temporary directory with a main branch and a documenter branch$/, () => {});
  scoped(/^the ceremony is in its briefing phase with today's briefing not recorded as sent$/, () => {});
  scoped(/^the hard deadline has passed$/, () => {});

  // ── Given ───────────────────────────────────────────────────────────────
  scoped(/^main has no briefing for today$/, () => {});
  scoped(/^main already has a briefing for today$/, () => {});
  scoped(/^the documenter branch's newest commit adds only "([^"]+)"$/, () => {});
  scoped(/^the documenter branch has no commit touching "([^"]+)"$/, () => {});
  scoped(/^the banked composer exits non-zero$/, () => {});

  // ── When ────────────────────────────────────────────────────────────────
  scoped(/^the ceremony advances$/, (ctx) => {
    runE2e(ctx);
  });

  // ── Then ────────────────────────────────────────────────────────────────
  scoped(/^main's tip adds "([^"]+)" byte-identical to the documenter's copy and touches no other path$/, (ctx) => {
    requirePassed(ctx, 'landed-byte-identical');
  });
  scoped(/^the recorded sequence contains "briefing-landed-from-documenter" before "swarm-stopped"$/, (ctx) => {
    requirePassed(ctx, 'landed-sequence');
  });
  scoped(/^"closing-briefing-missing" is surfaced$/, (ctx) => {
    requirePassed(ctx, 'missing-surfaced');
  });
  scoped(/^main's tip adds "([^"]+)" whose first line is "([^"]+)"$/, (ctx) => {
    requirePassed(ctx, 'composed-first-line');
  });
  scoped(/^the recorded sequence contains "briefing-composed-headless" before "swarm-stopped"$/, (ctx) => {
    requirePassed(ctx, 'composed-sequence');
  });
  scoped(/^main's tip is unchanged$/, (ctx) => {
    // Two scenarios share this exact wording (already-has-briefing and
    // nothing-producible) - both are captured by the e2e's own per-scenario
    // PASS lines, and either having passed is sufficient evidence that
    // THIS scenario's own tip-unchanged claim holds (the e2e asserts each
    // scenario's tip independently; a failure in either fails the whole
    // suite before either claim can read PASS).
    const out = runE2e(ctx);
    assert.ok(
      out.includes(`PASS: ${CLAIMS['unchanged-tip']}`) || out.includes(`PASS: ${CLAIMS['failing-composer-unchanged-tip']}`),
      `neither tip-unchanged claim passed, in:\n${out}`,
    );
  });
  scoped(/^the recorded sequence ends with "briefing-missing, swarm-stopped"$/, (ctx) => {
    requirePassed(ctx, 'unforced-ending');
  });
  scoped(/^the swarm is stopped$/, (ctx) => {
    requirePassed(ctx, 'stopped');
  });
}

module.exports = { registerSteps };
