'use strict';

// BL-1857: a commit that lands no line of its own never blocks a
// shared-path rebuild.
//
// Every scenario drives the REAL production entry point,
// swarmforge/scripts/land_step_cli.bb - the CLI QA runs - over a REAL
// repository with a REAL origin/main ref, through
// lib/bl1857UntaggedCommitLandsNoLineCli.bb. Never the pure
// land_step_lib.bb functions beneath it (same posture as
// bl1830SharedOwnPathSteps.js): a driver that calls one function cannot
// see it disagree with what the CLI actually prints and commits.

const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const FIXTURE_CLI = path.join(__dirname, 'lib', 'bl1857UntaggedCommitLandsNoLineCli.bb');

const FEATURE = 'BL-1857 A commit that lands no line of its own never blocks a shared-path rebuild';

const MANIFEST = 'swarmforge/scripts/test/suite-manifest.tsv';
const SIBLING = 'BL-9302';

// Explicit KNOWN_VALUES per the ticket's own direction: the outline's
// prose maps onto exactly these three fixture shapes, no passthrough.
const KNOWN_VALUES = {
  "restores the shared path to origin/main's content": 'restore',
  'adds a line to the shared path that a later commit removes again': 'add-remove',
  'adds a line to the shared path that the landing commit keeps and origin/main lacks': 'add-keep',
};

function runFixture(shape) {
  const out = execFileSync('bb', [FIXTURE_CLI, shape], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 900_000,
  });
  return JSON.parse(out.trim().split('\n').pop());
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(
    /^a fixture repository where the landing ticket and an unlanded sibling each changed a shared path since origin\/main in their own tagged commits$/,
    (ctx) => {
      ctx.bl1857 = {};
    }
  );

  scoped(/^an untagged commit on the landing branch that (.+)$/, (ctx, untaggedChange) => {
    const shape = KNOWN_VALUES[untaggedChange];
    assert.ok(shape, `unrecognized untagged change: ${untaggedChange}`);
    ctx.bl1857.shape = shape;
  });

  scoped(/^the land step builds the landing ticket's commit$/, (ctx) => {
    ctx.bl1857.report = runFixture(ctx.bl1857.shape);
  });

  scoped(/^the land (rebuilds the path with only the landing ticket's lines|refuses, naming the path and the sibling)$/, (ctx, outcome) => {
    const { report } = ctx.bl1857;
    if (outcome === "rebuilds the path with only the landing ticket's lines") {
      assert.equal(report.exit, 0, `expected a successful land: ${JSON.stringify(report.lines)}`);
      assert.ok(
        typeof report.manifestContent === 'string' && report.manifestContent.includes('test_bl9301.sh'),
        `expected the replayed manifest to carry the landing ticket's own row: ${JSON.stringify(report.manifestContent)}`
      );
      assert.ok(
        typeof report.manifestContent === 'string' && !report.manifestContent.includes('test_bl9302.sh'),
        `expected the replayed manifest to exclude the sibling's row, but it rode: ${JSON.stringify(report.manifestContent)}`
      );
      assert.ok(
        report.rebuilt.some(([rebuiltPath, sibling]) => rebuiltPath === MANIFEST && sibling === SIBLING),
        `expected a SHARED_OWN_PATH_REBUILT line naming ${MANIFEST} and ${SIBLING}: ${JSON.stringify(report.rebuilt)}`
      );
    } else {
      assert.equal(report.exit, 1, `expected the land to refuse: ${JSON.stringify(report.lines)}`);
      assert.ok(report.lines.includes('LAND_ESCALATE'), `expected LAND_ESCALATE: ${JSON.stringify(report.lines)}`);
      assert.ok(
        typeof report.reason === 'string' && report.reason.includes(MANIFEST),
        `expected the refusal to name ${MANIFEST}: ${JSON.stringify(report.reason)}`
      );
      assert.ok(
        typeof report.reason === 'string' && report.reason.includes(SIBLING),
        `expected the refusal to name ${SIBLING}: ${JSON.stringify(report.reason)}`
      );
    }
  });
}

module.exports = { registerSteps };
