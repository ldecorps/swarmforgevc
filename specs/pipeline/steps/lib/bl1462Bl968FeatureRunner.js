'use strict';

// BL-1462: runs BL-968's own feature end-to-end via run_acceptance.sh and
// asserts all four of its scenarios report ok - pulled out of
// bl1462Bl968HandlerReadsItsFixtureSteps.js so the step file holds only
// step wiring, same split as lib/ticketYamlLookup.js and
// lib/roleWorktrees.js in this same parcel.

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const BL968_FEATURE_REL = path.join('specs', 'features', 'BL-968-step-registry-loadable-from-materialized-tree.feature');

function runBl968Feature(cwd) {
  return spawnSync(path.join('specs', 'pipeline', 'scripts', 'run_acceptance.sh'), [BL968_FEATURE_REL], {
    cwd,
    encoding: 'utf8',
    timeout: 300000,
  });
}

// The generated entry point registers one Node-test-runner `test()` per
// BL-968 scenario (4, no outlines) - "ok 1..4" with no "not ok" line is
// what "all four of its scenarios pass" means for that TAP output.
function assertAllFourScenariosPass(result, whereLabel) {
  assert.ok(result, `BL-968's feature never ran from ${whereLabel}`);
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  const notOkLines = output.match(/^not ok .*$/gm) || [];
  assert.deepEqual(notOkLines, [], `BL-968's feature reported failing scenarios from ${whereLabel}:\n${output}`);
  const okLines = output.match(/^ok \d+ .*$/gm) || [];
  assert.equal(
    okLines.length,
    4,
    `expected all 4 of BL-968's scenarios to report ok from ${whereLabel}, got ${okLines.length}:\n${output}`
  );
  assert.equal(result.status, 0, `run_acceptance.sh exited ${result.status} from ${whereLabel}:\n${output}`);
}

module.exports = { runBl968Feature, assertAllFourScenariosPass };
