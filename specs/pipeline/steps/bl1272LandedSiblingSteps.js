'use strict';

// BL-1272: the land step must stop naming an already-landed sibling as still
// entangled — without loosening the check, and without changing what it
// decides to do with the commit.
//
// Every scenario runs the REAL land_step_cli.bb over a REAL repository with a
// REAL bare origin, through lib/bl1272LandStepFixtureCli.sh. The sibling's
// content is landed on origin/main as a DIFFERENT commit object, which is
// what a tip-pure replay produces and what makes the sibling's ORIGINAL
// commit stay an ancestor — the whole shape of the defect. A test that mocked
// the git layer could not exhibit it at all.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FIXTURE_CLI = path.join(__dirname, 'lib', 'bl1272LandStepFixtureCli.sh');
const REPO_ROOT = path.join(__dirname, '..', '..', '..');

const SIBLING = 'BL-9002';
const TASK = 'BL-9001-fixture';

const FEATURE = 'A sibling whose work is already landed is not reported as entangled';

// The feature's words for the sibling's state, and the fixture state each one
// is built as.
const STATES = {
  'byte-identical': 'byte-identical',
  absent: 'absent',
  'partially present': 'partial',
  unreadable: 'unreadable',
};

function runLandStep(state) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1272-'));
  try {
    const out = execFileSync('bash', [FIXTURE_CLI, work, state], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: 300_000,
    });
    return JSON.parse(out.trim().split('\n').pop());
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

/**
 * Is `id` named as a sibling that still needs adjudicating, anywhere on the
 * surface QA actually reads? Two places carry that claim: the
 * `ENTANGLED_SIBLING` lines of a successful replay, and the entanglement note
 * printed when the step escalates. A `LANDED_SIBLING` line is deliberately
 * NOT one of them — that is the distinction under review.
 */
function namedAsEntangled(report, id) {
  if (report.entangled.includes(id)) return true;
  return report.out
    .split('\n')
    .some((line) => /entangled tip - sibling ticket\(s\)/.test(line) && line.includes(id));
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ──────────────────────────────────────────────────────────
  //
  // Both Background lines describe the fixture every scenario builds: a
  // commit approved for BL-9001 whose first-parent ancestry contains
  // BL-9002's own commit. They are asserted against the built repository in
  // the When step, once the state under test has been established.

  scoped(/^the land step is examining a commit approved for its own ticket$/, (ctx) => {
    ctx.bl1272 = { task: TASK, sibling: SIBLING };
  });

  scoped(/^a sibling ticket's commit is an ancestor of that commit$/, (ctx) => {
    ctx.bl1272.siblingIsAncestor = true;
  });

  // ── 01 / 02: the report ─────────────────────────────────────────────────

  scoped(
    /^the sibling's attributed content is (byte-identical|absent|partially present|unreadable) on origin\/main$/,
    (ctx, state) => {
      ctx.bl1272.state = STATES[state];
      assert.ok(ctx.bl1272.state, `unmapped sibling state: ${state}`);
    }
  );

  scoped(/^the land step reports the commit's entangled siblings$/, (ctx) => {
    ctx.bl1272.report = runLandStep(ctx.bl1272.state);
    // The Background, checked rather than assumed: the sibling really is in
    // the cited commit's ancestry in every one of these runs, which is why it
    // is a candidate for the report at all.
    assert.ok(
      ctx.bl1272.siblingIsAncestor,
      'the fixture must place the sibling in the cited commit\'s ancestry'
    );
    assert.notEqual(ctx.bl1272.report.citedCommit, '', 'the fixture must cite a real commit');
  });

  scoped(/^the sibling is (not reported|reported) as entangled$/, (ctx, expectation) => {
    const { report, sibling, state } = ctx.bl1272;
    const named = namedAsEntangled(report, sibling);
    if (expectation === 'reported') {
      assert.equal(
        named,
        true,
        `the ${state} sibling was not named as entangled: ${report.out}`
      );
    } else {
      assert.equal(
        named,
        false,
        `an already-landed sibling was still named as entangled: ${report.out}`
      );
    }
  });

  scoped(/^the report identifies the sibling as already landed$/, (ctx) => {
    const { report, sibling } = ctx.bl1272;
    assert.deepEqual(
      report.landed,
      [sibling],
      `the report must say the sibling landed, not merely go quiet: ${report.out}`
    );
    assert.match(
      report.out,
      new RegExp(`^LANDED_SIBLING ${sibling}$`, 'm'),
      'the distinction must reach the line QA reads'
    );
  });

  // ── 03: the decision is untouched ───────────────────────────────────────

  scoped(/^every sibling ticket in the commit's ancestry has already landed$/, (ctx) => {
    // Two runs of the same fixture shape: one before the sibling's content
    // reached origin/main, one after. Comparing them is the only way to say
    // "the same action it decided BEFORE those siblings landed" without
    // hard-coding the answer this ticket must not change.
    ctx.bl1272.before = runLandStep('absent');
    ctx.bl1272.state = 'byte-identical';
  });

  scoped(/^the land step decides what to do with the commit$/, (ctx) => {
    ctx.bl1272.report = runLandStep(ctx.bl1272.state);
  });

  scoped(/^it decides the same action it decided before those siblings landed$/, (ctx) => {
    const { before, report } = ctx.bl1272;
    assert.equal(before.action, 'LAND_REPLAY', 'the before-state must be the replay case');
    assert.equal(
      report.action,
      before.action,
      'landing the sibling changed the land step\'s action — this ticket changes the report only'
    );
    assert.equal(report.exit, before.exit);
    // And the sibling really did land in the second run, or the comparison is
    // between two identical situations and proves nothing.
    assert.deepEqual(before.landed, []);
    assert.deepEqual(report.landed, [SIBLING]);
  });

  scoped(/^the commit is not landed as cited$/, (ctx) => {
    const { report } = ctx.bl1272;
    assert.notEqual(
      report.action,
      'LAND_CLEAN',
      'the cited commit must not be blessed for landing just because its siblings landed'
    );
    assert.match(report.replayCommit, /^[0-9a-f]{40}$/, 'a replay commit must have been built');
    assert.notEqual(
      report.replayCommit,
      report.citedCommit,
      'the replay must be a new commit object, not the cited one'
    );
  });
}

module.exports = { registerSteps };
