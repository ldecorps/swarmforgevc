'use strict';

// BL-1308: the land step's sibling DETECTOR walked `--first-parent` while its
// replay's own-path set diffs a merge against its FIRST parent — a real
// two-tree diff that draws in everything the merge's SECOND parent carried.
// So a sibling ticket's untagged commits could enter the replay tip while its
// id never reached the report.
//
// Every scenario runs the REAL land_step_cli.bb over a REAL repository with a
// REAL bare origin, through lib/bl1308SiblingDetectorFixtureCli.sh. Mocking
// the git layer could not exhibit the defect at all: it lives entirely in
// which commits two different git walks reach.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FIXTURE_CLI = path.join(__dirname, 'lib', 'bl1308SiblingDetectorFixtureCli.sh');
const REPO_ROOT = path.join(__dirname, '..', '..', '..');

const SIBLING = 'BL-9002';
const CITED_TICKET = 'BL-9001';

const FEATURE = 'An unlanded sibling reached only through a merge\'s second parent';

// The Outline's words for where the sibling's commits sit, and the fixture
// shape each one is built as. Explicit KNOWN_VALUES: an unrecognised row
// fails rather than passing through unchecked.
const POSITIONS = {
  'on the first-parent walk from origin/main': 'first-parent',
  'only through a merge\'s second parent': 'second-parent',
};

function runLandStep(position) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1308-'));
  try {
    const out = execFileSync('bash', [FIXTURE_CLI, work, position], {
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
 * Is `id` named on the surface QA actually reads? Two lines carry that claim:
 * an `ENTANGLED_SIBLING` line of a successful replay, and the entanglement
 * note printed when the step escalates.
 */
function namedInReport(report, id) {
  if (report.entangled.includes(id)) return true;
  return report.out
    .split('\n')
    .some((line) => /entangled tip - sibling ticket\(s\)/.test(line) && line.includes(id));
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ──────────────────────────────────────────────────────────

  scoped(/^a cited tip whose land step is asked for a plan$/, (ctx) => {
    ctx.bl1308 = { sibling: SIBLING, cited: CITED_TICKET };
  });

  // ── 01: the Outline over both positions ─────────────────────────────────

  scoped(/^an unlanded sibling ticket's commits reachable (.+)$/, (ctx, position) => {
    const shape = POSITIONS[position];
    assert.ok(shape, `unmapped sibling position: ${position}`);
    ctx.bl1308.shape = shape;
  });

  // ── 02: the literal forward-merge shape ─────────────────────────────────

  scoped(/^a forward-merge whose subject names the cited ticket$/, (ctx) => {
    ctx.bl1308.shape = 'second-parent';
  });

  scoped(
    /^an unlanded sibling ticket's untagged commits on that merge's second parent$/,
    (ctx) => {
      assert.equal(
        ctx.bl1308.shape,
        'second-parent',
        'this scenario must be built as the forward-merge shape'
      );
    }
  );

  // ── 03: nothing enters the replay unnamed ───────────────────────────────

  scoped(/^the replay tip adds a path that is absent from origin\/main$/, (ctx) => {
    ctx.bl1308.shape = 'second-parent';
    ctx.bl1308.requireAddedPaths = true;
  });

  // ── 04: an unreadable ancestry escalates ────────────────────────────────

  scoped(/^the ancestry walk cannot be read$/, (ctx) => {
    ctx.bl1308.shape = 'unreadable-ancestry';
  });

  // ── When ────────────────────────────────────────────────────────────────

  const run = (ctx) => {
    assert.ok(ctx.bl1308.shape, 'no fixture shape was established for this scenario');
    ctx.bl1308.report = runLandStep(ctx.bl1308.shape);
    assert.match(
      ctx.bl1308.report.citedCommit,
      /^[0-9a-f]{40}$/,
      'the fixture must cite a real commit'
    );
  };

  scoped(/^the land step reports its siblings$/, run);
  scoped(/^the land step decides$/, run);

  // ── Then ────────────────────────────────────────────────────────────────

  scoped(/^the sibling ticket is named in the report$/, (ctx) => {
    const { report, sibling, shape } = ctx.bl1308;
    assert.equal(
      namedInReport(report, sibling),
      true,
      `the ${shape} sibling was never named in the report: ${report.out}`
    );
  });

  // ── 03b (BL-1654, replaces the retired 03): BL-1389's own exclusion ─────

  scoped(/^the replay tip adds only the cited ticket's own paths$/, (ctx) => {
    const { report } = ctx.bl1308;
    assert.ok(
      report.replayAdded.length > 0,
      `expected the replay tip to add at least the cited ticket's own path(s): ${report.out}`
    );
    for (const p of report.replayAdded) {
      const owners = report.attribution[p] || [];
      assert.deepEqual(
        owners,
        [CITED_TICKET],
        `replay path ${p} is not attributed solely to the cited ticket: ${JSON.stringify(owners)}`
      );
    }
  });

  // The fixture CLI's own `attribution` map is built ONLY from replayAdded
  // paths (bl1308SiblingDetectorFixtureCli.sh line ~94-98) - an EXCLUDED
  // path never enters the replay diff, so it is never in that map by
  // construction, not because nothing was excluded. The second-parent
  // shape's sibling untagged files are the fixture's own fixed literals
  // (sibling_work(), same file), used directly the same way SIBLING and
  // CITED_TICKET above already are.
  const SIBLING_PATHS = ['sib_a.txt', 'sib_b.txt'];

  scoped(
    /^every sibling path left out of the replay is named on its own EXCLUDED_SIBLING_PATH line$/,
    (ctx) => {
      const { report } = ctx.bl1308;
      const excludedLines = report.out.split('\n').filter((l) => l.startsWith('EXCLUDED_SIBLING_PATH '));
      for (const p of SIBLING_PATHS) {
        assert.ok(
          !report.replayAdded.includes(p),
          `sibling-owned path ${p} rode the replay tip unexcluded: ${report.out}`
        );
        assert.ok(
          excludedLines.includes(`EXCLUDED_SIBLING_PATH ${p} ${SIBLING}`),
          `expected "EXCLUDED_SIBLING_PATH ${p} ${SIBLING}" in the report, got: ${report.out}`
        );
      }
    }
  );

  scoped(/^the plan escalates for adjudication$/, (ctx) => {
    const { report } = ctx.bl1308;
    assert.equal(report.action, 'LAND_ESCALATE', `expected an escalation: ${report.out}`);
    assert.notEqual(report.exit, 0, 'an escalation must not exit 0');
  });

  scoped(/^no replay tip is landed$/, (ctx) => {
    const { report } = ctx.bl1308;
    assert.equal(report.replayCommit, '', `a replay tip was built anyway: ${report.out}`);
    assert.deepEqual(report.replayAdded, []);
  });
}

module.exports = { registerSteps };
