'use strict';

// BL-1386: the reconcile sweep never orphans a merge it started.
//
// On 2026-09-04 the daemon left its own failed merge open on the shared main
// checkout three times in eighteen minutes. `absorb-with-merge!` discarded
// `abort!`'s result, so an abort defeated by a transient `.git/index.lock`
// went unnoticed; the NEXT tick read the leftover MERGE_HEAD and, by BL-1120's
// rule, called it a human's and protected it. The daemon orphaned its own
// merge and then named someone else as the owner. Concluding any of those
// merges would have silently reverted a QA landing on push.
//
// Every scenario drives the REAL `absorb-with-merge!` ladder over a REAL
// repository with a REAL diverged origin, through lib/bl1386ReconcileOwnsItsMergeCli.sh
// and the same adapter shape handoffd.bb wires. The real merge is made to fail
// the way the ticket's qa_e2e_procedure specifies - a pre-merge-commit hook
// that exits 1 - which leaves MERGE_HEAD written and the merge unconcluded,
// the exact live shape. A stubbed git could not exhibit the defect at all.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const FIXTURE_CLI = path.join(__dirname, 'lib', 'bl1386ReconcileOwnsItsMergeCli.sh');
const FIXTURE_PREFIX = 'bl1386-acc-';

const FEATURE = 'BL-1386 The reconcile sweep never orphans a merge it started';

// The scenarios' own words for a foreign MERGE_HEAD, mapped to the fixture
// shape each is built as. Explicit KNOWN_VALUES: an unrecognised Examples row
// throws rather than passing through unchecked.
const RECORD_STATES = {
  'no ownership record': 'foreign-no-record',
  'an ownership record naming another sha': 'foreign-other-sha',
};

// The two ways a real merge fails, and the label each must be reported under.
const MERGE_FAILURE_CAUSES = {
  'a genuine content conflict': 'conflict',
  'a pre-merge-commit hook refusal': 'merge-failed',
};

const LABELS = { conflict: 'conflict', 'merge-failed': 'merge-failed' };

// A killed run traps no `finally`, so sweep by prefix BEFORE this one starts
// as well (BL-971).
function sweepFixtures() {
  for (const entry of fs.readdirSync(os.tmpdir())) {
    if (entry.startsWith(FIXTURE_PREFIX)) {
      fs.rmSync(path.join(os.tmpdir(), entry), { recursive: true, force: true });
    }
  }
}

function runFixture(shape) {
  sweepFixtures();
  const work = fs.mkdtempSync(path.join(os.tmpdir(), FIXTURE_PREFIX));
  try {
    const out = execFileSync('bash', [FIXTURE_CLI, work, shape], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: 300_000,
    });
    return JSON.parse(out.trim().split('\n').pop());
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

const labelsOf = (report) => report.logs.map(([label]) => label);
const textFor = (report, label) => (report.logs.find(([l]) => l === label) || [])[1] || '';

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ──────────────────────────────────────────────────────────
  // Both lines describe the fixture every scenario builds; they are asserted
  // against the built repository in the When step, once the shape is chosen.
  scoped(/^a fixture checkout whose local main and origin\/main have diverged without conflict$/, (ctx) => {
    ctx.bl1386 = { diverged: true };
  });

  scoped(/^the reconcile sweep's real merge is refused after MERGE_HEAD is written$/, (ctx) => {
    // The default shape: a hook refusal, whose abort then succeeds.
    ctx.bl1386.shape = 'clean-abort';
  });

  // ── Given ───────────────────────────────────────────────────────────────
  scoped(/^another process holds the index lock while the abort runs$/, (ctx) => {
    ctx.bl1386.shape = 'abort-locked';
  });

  scoped(/^the previous tick left an owned MERGE_HEAD because its abort failed$/, (ctx) => {
    ctx.bl1386.shape = 'next-tick';
  });

  scoped(/^the index lock has been released$/, (ctx) => {
    // The `next-tick` shape runs both ticks: tick 1 with the lock held, tick 2
    // without it. Asserted rather than narrated - the run must show tick 1
    // actually failed its abort, or the handover under test never happened.
    assert.equal(ctx.bl1386.shape, 'next-tick', 'the lock-release step belongs to the next-tick scenario');
  });

  scoped(/^a MERGE_HEAD created outside the sweep with (.+)$/, (ctx, state) => {
    const shape = RECORD_STATES[state.trim()];
    assert.ok(shape, `unknown record state: ${state}`);
    ctx.bl1386.shape = shape;
  });

  scoped(/^the real merge fails because of (.+)$/, (ctx, cause) => {
    const label = MERGE_FAILURE_CAUSES[cause.trim()];
    assert.ok(label, `unknown merge-failure cause: ${cause}`);
    ctx.bl1386.expectedLabel = label;
    ctx.bl1386.shape = label === 'conflict' ? 'conflict' : 'clean-abort';
  });

  // ── When ────────────────────────────────────────────────────────────────
  scoped(/^one sweep tick runs$/, (ctx) => {
    assert.equal(ctx.bl1386.diverged, true);
    assert.ok(ctx.bl1386.shape, 'no fixture shape was chosen');
    ctx.bl1386.report = runFixture(ctx.bl1386.shape);
  });

  // ── Then: ownership ─────────────────────────────────────────────────────
  scoped(/^the ownership record named the merged sha before the merge ran$/, (ctx) => {
    assert.equal(
      ctx.bl1386.report.recordedBeforeMerge,
      true,
      `ownership was not recorded before the merge ran: ${JSON.stringify(ctx.bl1386.report)}`
    );
  });

  scoped(/^after the tick MERGE_HEAD is absent$/, (ctx) => {
    assert.equal(
      ctx.bl1386.report.mergeHeadPresent,
      false,
      `a MERGE_HEAD was left open: ${JSON.stringify(ctx.bl1386.report)}`
    );
  });

  scoped(/^after the tick MERGE_HEAD is present$/, (ctx) => {
    assert.equal(
      ctx.bl1386.report.mergeHeadPresent,
      true,
      `expected the merge to still be open: ${JSON.stringify(ctx.bl1386.report)}`
    );
  });

  scoped(/^the ownership record is cleared$/, (ctx) => {
    assert.equal(
      ctx.bl1386.report.recordSha,
      '',
      `the ownership record was left behind: ${JSON.stringify(ctx.bl1386.report)}`
    );
  });

  scoped(/^the ownership record names the MERGE_HEAD sha$/, (ctx) => {
    const { report } = ctx.bl1386;
    assert.notEqual(report.recordSha, '', `no ownership record was kept: ${JSON.stringify(report)}`);
    assert.equal(
      report.ownedByRecord,
      true,
      `the record does not name the open MERGE_HEAD, so the next tick cannot finish it: ${JSON.stringify(report)}`
    );
  });

  // ── Then: the log ───────────────────────────────────────────────────────
  scoped(/^the log carries merge-abort-failed with the lock error text$/, (ctx) => {
    const { report } = ctx.bl1386;
    assert.ok(
      labelsOf(report).includes('merge-abort-failed'),
      `the failed abort was not reported: ${JSON.stringify(labelsOf(report))}`
    );
    // git's OWN words, not a fixed string - the whole of invariant 3.
    assert.match(
      textFor(report, 'merge-abort-failed'),
      /index\.lock/,
      `the log does not quote git's lock error: ${textFor(report, 'merge-abort-failed')}`
    );
  });

  scoped(/^the log does not carry real-merge-attempted-and-aborted for that tick$/, (ctx) => {
    // That line is the daemon's fallback! marker. Reaching it with the merge
    // still open would mean rematching on top of an open merge - the second
    // hazard the ticket names.
    assert.ok(
      !labelsOf(ctx.bl1386.report).includes('fallback'),
      `fell through to the rematch fallback with the merge still open: ${JSON.stringify(ctx.bl1386.report.logs)}`
    );
  });

  scoped(/^the log carries (conflict|merge-failed) with git's error text$/, (ctx, label) => {
    const expected = LABELS[label];
    assert.ok(expected, `unknown label: ${label}`);
    const { report } = ctx.bl1386;
    assert.ok(
      labelsOf(report).includes(expected),
      `expected label ${expected}, got ${JSON.stringify(labelsOf(report))}`
    );
    assert.ok(
      textFor(report, expected).trim().length > 0,
      `the ${expected} line carries no error text from git`
    );
    // And the distinction is real in both directions: a hook refusal must not
    // be called a conflict, which is exactly what the old fixed label did.
    if (expected === 'merge-failed') {
      assert.ok(
        !labelsOf(report).includes('conflict'),
        `a hook refusal was reported as a conflict: ${JSON.stringify(report.logs)}`
      );
    }
  });

  // ── Then: ownership handover and foreign merges ─────────────────────────
  scoped(/^human-merge-in-progress was never surfaced for that MERGE_HEAD$/, (ctx) => {
    const { report } = ctx.bl1386;
    const labels = labelsOf(report);
    assert.ok(
      !labels.includes('skip-human-merge-in-progress'),
      `the daemon called its own merge a human's: ${JSON.stringify(labels)}`
    );
    // ARCHITECT BOUNCE D1b: pin the PRODUCTION decision, not just the
    // outcome the fixture reached. `tick2-branch` is what
    // automated-absorb-plan returned - the same call handoffd.bb's dispatch
    // makes - so a regression that routes :own back to
    // :skip-human-merge-in-progress fails HERE. Verified by construction:
    // with the pre-bounce mapping restored this reads
    // ":skip-human-merge-in-progress" and the scenario fails.
    assert.equal(
      textFor(report, 'tick2-branch'),
      ':abort-owned-merge',
      `production dispatch did not route the owned merge to an abort: ${JSON.stringify(report.logs)}`
    );
    assert.equal(
      report.outcome,
      'aborted-by-ownership',
      `the next tick did not abort by ownership: ${JSON.stringify(report)}`
    );
  });

  scoped(/^the sweep surfaces it exactly as it does today$/, (ctx) => {
    const { report } = ctx.bl1386;
    // BL-1120 in full: not owned, not aborted, surfaced as before.
    assert.equal(
      report.ownedByRecord,
      false,
      `a foreign MERGE_HEAD was claimed as the daemon's own: ${JSON.stringify(report)}`
    );
    assert.equal(
      report.outcome,
      'skip-human-merge-in-progress',
      `a foreign MERGE_HEAD was not surfaced as before: ${JSON.stringify(report)}`
    );
  });
}

module.exports = { registerSteps };
