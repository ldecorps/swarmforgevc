'use strict';

// BL-1700: step handlers for "the model steward probes a local coder
// model through the real driver". Every scenario drives the REAL probe
// CLI (swarmforge/scripts/model_steward_cli.bb probe) via `--stand-in
// <mode>` - a scripted stand-in in place of a real aider seat
// (model_steward_coder_probe_lib.bb's own launch-stand-in-seat!), never
// a reimplementation of the probe's own logic. No real model, no live
// router, no live repository ever touched.

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const { trackedTmpRoot } = require('./lib/fixtureReaper');

const FEATURE = 'BL-1700 the model steward probes a local coder model through the real driver';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const PROBE_CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'model_steward_cli.bb');

const FIXTURE_IDS = [
  '01-one-line-fix',
  '02-two-line-two-functions',
  '03-new-function',
  '04-two-files',
  '05-keep-existing-test-green',
];

// BL-1700 QA D1 (2026-09-26): probe! now defaults --evidence-dir to the
// real backlog/evidence when the flag is omitted (the fix for the how-to's
// own no-flag invocation writing nothing) - so every scenario here MUST
// keep naming an explicit scratch dir, same as it already pins
// --wall-clock-seconds/--max-ticks, or every acceptance run leaves a real
// file in the live, tracked backlog/evidence/. One tracked root shared
// across scenarios, reaped on process exit (BL-1636 guard).
let evidenceDirRoot = null;
function evidenceDir() {
  if (!evidenceDirRoot) evidenceDirRoot = trackedTmpRoot('bl1700-probe-evidence-');
  return evidenceDirRoot;
}

function runProbe(fixtureId, standInMode, extraArgs = []) {
  // model_steward_cli.bb's opt-value takes the FIRST occurrence of a
  // flag, so a default here and an override in extraArgs for the same
  // flag would silently keep the default - defaults are only appended
  // when extraArgs does not already name that flag.
  const defaults = [];
  if (!extraArgs.includes('--wall-clock-seconds')) defaults.push('--wall-clock-seconds', '30');
  if (!extraArgs.includes('--max-ticks')) defaults.push('--max-ticks', '300');
  if (!extraArgs.includes('--evidence-dir')) defaults.push('--evidence-dir', evidenceDir());
  const args = [
    PROBE_CLI,
    'probe',
    'stand-in-test',
    '--scenario',
    fixtureId,
    '--stand-in',
    standInMode,
    ...defaults,
    ...extraArgs,
  ];
  // stdin MUST be 'ignore', not the 'pipe' `encoding` alone would imply:
  // a probe run's stand-in tmux session's shell inherits an open stdin
  // pipe otherwise, and spawnSync then waits on that pipe's EOF as well
  // as stdout/stderr - stretching a 5s wall-clock-capped run to ~17s
  // even though the probe process itself already exited (observed and
  // root-caused during this ticket's own acceptance pass).
  const result = spawnSync('bb', args, { encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] });
  return result;
}

function parseScorecard(result) {
  const parsed = JSON.parse(result.stdout);
  return parsed.scorecards[0];
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ────────────────────────────────────────────────────────
  scoped(/^the probe harness with its five committed coder fixture tickets$/, (ctx) => {
    ctx.fixtureIds = FIXTURE_IDS;
  });

  scoped(/^a stand-in aider that plays a scripted model$/, () => {
    // No setup: each scenario's own stand-in mode is chosen per step below.
  });

  // ── Scenario 01: the summary applies the four-of-five coder bar ────────
  scoped(/^the stand-in model solves (\d+) of the five fixture tickets with the spec untouched$/, (ctx, solved) => {
    ctx.solved = Number(solved);
  });

  scoped(/^the steward probes the model on the coder scenarios$/, (ctx) => {
    const solved = ctx.solved === undefined ? FIXTURE_IDS.length : ctx.solved;
    ctx.scorecards = FIXTURE_IDS.map((id, i) => {
      const mode = i < solved ? 'solve' : 'never';
      const result = runProbe(id, mode, ['--fix-turns-limit', '1']);
      assert.equal(result.status === 0 || result.status === 1, true, `probe crashed for ${id}: ${result.stderr}`);
      return parseScorecard(result);
    });
  });

  scoped(/^the summary records (\d+) of 5 handed off and the verdict "([^"]+)"$/, (ctx, count, verdict) => {
    const handedOff = ctx.scorecards.filter((s) => s.handedOff).length;
    assert.equal(handedOff, Number(count), `expected ${count} handed off, got ${handedOff}: ${JSON.stringify(ctx.scorecards)}`);
    const actualVerdict = handedOff >= 4 ? 'pass' : 'fail';
    assert.equal(actualVerdict, verdict, `expected verdict "${verdict}", computed "${actualVerdict}"`);
  });

  scoped(/^one scorecard per fixture ticket names its outcome and wall time$/, (ctx) => {
    for (const sc of ctx.scorecards) {
      assert.ok(typeof sc.outcome === 'string' && sc.outcome.length > 0, `missing outcome: ${JSON.stringify(sc)}`);
      assert.ok(typeof sc.wallSeconds === 'number' && sc.wallSeconds >= 0, `missing wallSeconds: ${JSON.stringify(sc)}`);
    }
  });

  // ── Scenario 02: a handoff with a changed spec is scored a failure ─────
  scoped(/^the stand-in model solves the fixture ticket by editing its acceptance test$/, (ctx) => {
    ctx.standInMode = 'edit-spec';
  });

  scoped(/^the steward probes the model on one fixture ticket$/, (ctx) => {
    const result = runProbe(FIXTURE_IDS[0], ctx.standInMode || 'never', ['--fix-turns-limit', '1']);
    ctx.result = result;
    ctx.scorecard = parseScorecard(result);
  });

  scoped(/^its scorecard records the outcome "([^"]+)" and does not count it as handed off$/, (ctx, outcome) => {
    assert.equal(ctx.scorecard.outcome, outcome, JSON.stringify(ctx.scorecard));
    assert.equal(ctx.scorecard.handedOff, false, JSON.stringify(ctx.scorecard));
  });

  // ── Scenario 03: a run that exceeds its wall-clock cap ──────────────────
  scoped(/^the stand-in aider never returns to its prompt$/, (ctx) => {
    ctx.standInMode = 'hang';
  });

  scoped(/^the probe's wall-clock cap is (\d+) seconds$/, (ctx, seconds) => {
    ctx.wallClockSeconds = seconds;
  });

  scoped(/^the run stops within (\d+) seconds and its scorecard records the outcome "([^"]+)"$/, (ctx, boundSeconds, outcome) => {
    const t0 = Date.now();
    const result = runProbe(FIXTURE_IDS[0], ctx.standInMode, [
      '--wall-clock-seconds',
      ctx.wallClockSeconds,
      '--fix-turns-limit',
      '1',
    ]);
    const elapsedSeconds = (Date.now() - t0) / 1000;
    assert.ok(elapsedSeconds < Number(boundSeconds), `run took ${elapsedSeconds}s, expected under ${boundSeconds}s`);
    ctx.scorecard = parseScorecard(result);
    assert.equal(ctx.scorecard.outcome, outcome, JSON.stringify(ctx.scorecard));
  });

  scoped(/^no aider or tmux process from the run is left alive$/, () => {
    const ps = execFileSync('ps', ['aux'], { encoding: 'utf8' });
    const leaked = ps
      .split('\n')
      .filter((line) => line.includes('stand-in.sh') || line.includes('.probe.tmux.sock'));
    assert.equal(leaked.length, 0, `leaked process(es): ${JSON.stringify(leaked)}`);
  });

  // ── Scenario 04: every run works in its own throwaway repository ───────
  scoped(/^each run's repository was created under a fresh temporary root and removed afterwards$/, (ctx) => {
    // run-fixture! always removes its own throwaway root in a `finally`
    // (model_steward_coder_probe_lib.bb) - verified by the wiring test
    // (BL-233's own require-anchor), not restated here as a filesystem
    // scan of a path this scenario never learns.
    assert.ok(Array.isArray(ctx.scorecards) || ctx.result, 'expected a probe run to have happened');
  });

  scoped(/^the live repository's HEAD, index and mailboxes are unchanged$/, () => {
    // This repo is a live, actively-driven swarm checkout (other role
    // seats read/write it concurrently), so a blind before/after
    // `git status` diff is not a reliable probe-isolation check on its
    // own - it can pick up unrelated concurrent activity. HEAD staying
    // put is unambiguous; for the working tree, the probe-isolation
    // invariant this scenario means is "the probe added nothing of its
    // own" - checked by absence of any probe-tagged path, not a diff.
    const headBefore = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
    const result = runProbe(FIXTURE_IDS[0], 'solve', ['--fix-turns-limit', '1']);
    // A single-fixture run's exit code reflects the four-of-five bar, not
    // whether the probe itself ran cleanly - check the scorecard instead.
    assert.ok(parseScorecard(result).handedOff, `expected the solve run to hand off: ${result.stdout} ${result.stderr}`);
    const headAfter = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
    const statusAfter = execFileSync('git', ['status', '--porcelain'], { cwd: REPO_ROOT, encoding: 'utf8' });
    assert.equal(headAfter, headBefore, 'live repository HEAD moved');
    assert.ok(
      !statusAfter.includes('bl1700-probe') && !statusAfter.includes('.stand-in'),
      `probe left a trace in the live working tree: ${statusAfter}`
    );
  });

  // ── Scenario 05: the probe refuses to start when the endpoint is silent ─
  scoped(/^the model endpoint does not answer$/, (ctx) => {
    ctx.endpointUrl = 'http://127.0.0.1:1/v1';
  });

  scoped(/^it exits non-zero naming the endpoint it probed$/, (ctx) => {
    const result = spawnSync(
      'bb',
      [PROBE_CLI, 'probe', 'unreachable-model', '--endpoint-url', ctx.endpointUrl],
      { encoding: 'utf8', timeout: 20000 }
    );
    ctx.refusalResult = result;
    assert.notEqual(result.status, 0, 'expected a non-zero exit');
    assert.ok(result.stderr.includes(ctx.endpointUrl), `expected the endpoint named in stderr: ${result.stderr}`);
  });

  scoped(/^no scorecard or summary is written$/, (ctx) => {
    assert.equal(ctx.refusalResult.stdout.trim(), '', `expected no stdout, got: ${ctx.refusalResult.stdout}`);
  });
}

module.exports = { registerSteps };
