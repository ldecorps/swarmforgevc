'use strict';

// BL-1409: the ONE check for "is the property-suite drift guard installed",
// used by BL-570's own acceptance Background (bl570PropertySuiteDriftGuardSteps.js)
// and by test_property_suite_drift_guard.sh's case 07 (via `node -e`, the
// same bash-reaches-JS idiom test_bl1398_guard_fixture_derives_set.sh's own
// derive() uses).
//
// BL-1252 made the pre-commit hook a thin wrapper that execs
// run_commit_guards.sh, and THAT file is now the one that names the guard
// (`run_guard check_property_suite_drift.sh`). "Installed" is therefore a
// TWO-HOP question - the hook reaches the runner, and the runner's own
// guard set names the guard - never a literal grep of one file in
// isolation (declared invariant 1).
//
// Invariant 2: the runner hop reuses BL-1398's own
// deriveCommitGuardFixtureSet for the SECOND hop (never a second `run_guard`
// line parser) - passed `hookRels: []` so only the runner's OWN run_guard
// lines are read, not pre-merge-commit's separate, unrelated chain.

const fs = require('node:fs');
const path = require('node:path');

const { deriveCommitGuardFixtureSet } = require(
  path.join(__dirname, '..', '..', '..', '..', 'extension', 'test', 'helpers', 'commitGuardFixtureSet.js')
);

const DEFAULT_HOOK_REL = 'swarmforge/git-hooks/pre-commit';
const DEFAULT_RUNNER_REL = 'swarmforge/scripts/run_commit_guards.sh';
const GUARD_NAME = 'check_property_suite_drift.sh';

function nonCommentLines(text) {
  return text
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
}

// Fixed result shape: {wired: true} or {wired: false, missing, reason} -
// never nil, never a thrown error for an ordinary broken-hop case (BL-654
// non-vacuity target: every broken hop reports which one, by name).
function propertyGuardIsWired({
  repoRoot,
  hookRel = DEFAULT_HOOK_REL,
  runnerRel = DEFAULT_RUNNER_REL,
  readFile = (p) => fs.readFileSync(p, 'utf8'),
  exists = (p) => fs.existsSync(p),
} = {}) {
  const hookPath = path.join(repoRoot, hookRel);
  if (!exists(hookPath)) {
    return { wired: false, missing: runnerRel, reason: `${hookRel} does not exist` };
  }
  const runnerBasename = path.basename(runnerRel);
  const runnerNameRe = new RegExp(runnerBasename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!runnerNameRe.test(nonCommentLines(readFile(hookPath)))) {
    return {
      wired: false,
      missing: runnerBasename,
      reason: `${hookRel} does not invoke ${runnerBasename} in a non-comment line`,
    };
  }

  let derived;
  try {
    derived = deriveCommitGuardFixtureSet({ repoRoot, runnerRel, hookRels: [], readFile, exists });
  } catch (e) {
    return { wired: false, missing: GUARD_NAME, reason: String((e && e.message) || e) };
  }

  if (!derived.guards.includes(GUARD_NAME)) {
    return {
      wired: false,
      missing: GUARD_NAME,
      reason: `${runnerRel}'s own derived guard set does not name ${GUARD_NAME}`,
    };
  }

  return { wired: true };
}

module.exports = { propertyGuardIsWired, GUARD_NAME, DEFAULT_HOOK_REL, DEFAULT_RUNNER_REL };
