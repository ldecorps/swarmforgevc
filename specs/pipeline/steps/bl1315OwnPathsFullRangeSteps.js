'use strict';

// BL-1315: land_step_lib.bb's own-paths based its replay tip on the tagged
// merge's first-parent :delivered diff, which both over-includes (a
// sibling's untagged content riding the merge's second parent enters the
// tip under the forwarded ticket's name - BL-1307/BL-1300, BL-1298/BL-1303)
// and under-includes (the landed ticket's OWN content, when it reached the
// branch before its own tagged merge did, is invisible to that merge's
// first-parent diff at all - the same BL-1298/BL-1303 event, from the other
// side). own-paths now bases the tip on the FULL origin/main..tip diff and
// subtracts only paths attributable solely to a sibling this run's own
// detector reports as unlanded.
//
// Every scenario runs the REAL land_step_cli.bb over a REAL repository with
// a REAL bare origin, through lib/bl1315OwnPathsFixtureCli.sh - mocking the
// git layer could not exhibit either face of the defect, which lives
// entirely in which commits two different diffs draw content from.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FIXTURE_CLI = path.join(__dirname, 'lib', 'bl1315OwnPathsFixtureCli.sh');
const REPO_ROOT = path.join(__dirname, '..', '..', '..');

const FEATURE = 'A replay tip adds only the content of the ticket being landed';

// The scenarios' quoted words for the sibling, mapped to the fixture shape
// that builds each one. Explicit KNOWN_VALUES: an unrecognised row fails
// rather than passing through unchecked.
const SIBLING_SHAPES = {
  unlanded: 'sibling-unlanded',
  'already landed on origin/main': 'sibling-landed',
  'byte-identical to what origin/main holds': 'sibling-byte-identical',
};

function runFixture(shape) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1315-'));
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

// "The tip", independent of which action the CLI took: a LAND_REPLAY tip is
// what the replay branch adds over origin/main; a LAND_CLEAN tip is the
// cited commit itself, unmodified, whose own diff IS the full delivered
// set by construction.
function tipPaths(report) {
  if (report.action === 'LAND_CLEAN') return report.fullDeliveredPaths;
  return report.addedPaths;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ────────────────────────────────────────────────────────

  scoped(/^a QA tip whose ticket-tagged merge imports a role branch$/, (ctx) => {
    ctx.bl1315 = {};
  });

  scoped(/^the sibling detector reports every ticket that branch carries$/, (ctx) => {
    assert.ok(ctx.bl1315, 'the Background must run before the sibling detector is asked anything');
  });

  // ── 01 and 02: the imported branch's sibling, by shape ──────────────────

  scoped(/^the imported branch carries, besides the landed ticket, a sibling that is "([^"]+)"$/, (ctx, sibling) => {
    const shape = SIBLING_SHAPES[sibling];
    assert.ok(shape, `unmapped sibling shape: ${sibling}`);
    ctx.bl1315.shape = shape;
  });

  // ── 03: every role's contribution survives an untagged own subject ──────

  scoped(/^the landed ticket chain delivered content authored by "coder" and by "hardender"$/, (ctx) => {
    ctx.bl1315.shape = 'multi-role';
  });

  scoped(/^only the documenter's forward-merge names the ticket in its subject$/, (ctx) => {
    assert.equal(ctx.bl1315.shape, 'multi-role', 'this scenario must be built as the multi-role shape');
  });

  // ── 04: an undeterminable attribution refuses ────────────────────────────

  scoped(/^a path on the tip whose attributing ticket cannot be read$/, (ctx) => {
    ctx.bl1315.shape = 'unreadable-attribution';
  });

  // ── 05: no entangled sibling at all ──────────────────────────────────────

  scoped(/^the imported branch carries content of no other ticket$/, (ctx) => {
    ctx.bl1315.shape = 'no-sibling';
  });

  // ── 06: own content that reached the branch on an earlier merge ─────────

  scoped(/^the landed ticket's content reached the branch on an earlier sibling's merge$/, (ctx) => {
    ctx.bl1315.shape = 'earlier-merge';
  });

  scoped(/^the ticket's own ticket-tagged merge therefore adds none of it$/, (ctx) => {
    assert.equal(ctx.bl1315.shape, 'earlier-merge', 'this scenario must be built as the earlier-merge shape');
  });

  // ── When ──────────────────────────────────────────────────────────────

  scoped(/^the replay builds its tip$/, (ctx) => {
    assert.ok(ctx.bl1315.shape, 'no fixture shape was established for this scenario');
    ctx.bl1315.report = runFixture(ctx.bl1315.shape);
    assert.match(
      ctx.bl1315.report.citedCommit,
      /^[0-9a-f]{40}$/,
      'the fixture must cite a real commit'
    );
    // Scenario 06's own premise, checked rather than assumed: the ticket's
    // own tagged commit really does add nothing over its first parent, or
    // the Then below would prove nothing about the under-inclusion fix.
    // citedFirstParentDiff is computed by the fixture itself (the only
    // place the repository still exists once this step returns).
    if (ctx.bl1315.shape === 'earlier-merge') {
      assert.deepEqual(
        ctx.bl1315.report.citedFirstParentDiff,
        [],
        `the fixture's own ticket-tagged commit was not empty over its first parent: ${JSON.stringify(ctx.bl1315.report.citedFirstParentDiff)}`
      );
    }
  });

  // ── Then ──────────────────────────────────────────────────────────────

  scoped(/^the tip adds no path attributable only to the sibling$/, (ctx) => {
    const { report } = ctx.bl1315;
    const tip = tipPaths(report);
    const siblingOnly = report.fullDeliveredPaths.filter((p) => !tip.includes(p));
    assert.ok(siblingOnly.length > 0, `this run never had a sibling-only path to prove excluded: ${JSON.stringify(report)}`);
    assert.ok(!tip.includes('sib_a.txt'), `the sibling's own path entered the tip: ${JSON.stringify(report)}`);
  });

  scoped(/^the tip still adds every path the landed ticket's own chain delivered$/, (ctx) => {
    const { report } = ctx.bl1315;
    const tip = tipPaths(report);
    assert.ok(tip.includes('own.txt'), `the landed ticket's own path was dropped: ${JSON.stringify(report)}`);
  });

  scoped(/^the tip is unchanged from the full delivered set$/, (ctx) => {
    const { report } = ctx.bl1315;
    assert.deepEqual(
      [...tipPaths(report)].sort(),
      [...report.fullDeliveredPaths].sort(),
      `the tip narrowed the full delivered set: ${JSON.stringify(report)}`
    );
  });

  scoped(/^the tip adds the paths delivered by "coder"$/, (ctx) => {
    const { report } = ctx.bl1315;
    assert.ok(tipPaths(report).includes('coder.txt'), `coder's path was dropped: ${JSON.stringify(report)}`);
  });

  scoped(/^the tip adds the paths delivered by "hardender"$/, (ctx) => {
    const { report } = ctx.bl1315;
    assert.ok(tipPaths(report).includes('hardener.txt'), `hardener's path was dropped: ${JSON.stringify(report)}`);
  });

  scoped(/^the replay refuses$/, (ctx) => {
    const { report } = ctx.bl1315;
    assert.equal(report.action, 'LAND_ESCALATE', `expected a refusal: ${JSON.stringify(report)}`);
    assert.notEqual(report.exit, 0, 'a refusal must not exit 0');
  });

  scoped(/^the refusal names that path$/, (ctx) => {
    const { report } = ctx.bl1315;
    assert.match(report.reason, /sib_a\.txt/, `the refusal never named the unreadable path: ${report.reason}`);
  });

  scoped(/^no tip is advised for push$/, (ctx) => {
    const { report } = ctx.bl1315;
    assert.equal(report.replayCommit, '', `a tip was advised anyway: ${JSON.stringify(report)}`);
  });

  scoped(/^the tip is not limited to what the ticket-tagged merge added over its first parent$/, (ctx) => {
    const { report } = ctx.bl1315;
    // The premise verified in the When: the tagged commit's own first-parent
    // diff is empty. The tip must still be non-empty - the whole point of
    // the under-inclusion fix.
    assert.ok(tipPaths(report).length > 0, `the tip was limited to the (empty) first-parent diff: ${JSON.stringify(report)}`);
  });
}

module.exports = { registerSteps };
