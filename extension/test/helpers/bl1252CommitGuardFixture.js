'use strict';

// BL-1349: shared fixture for BL-1252's five independent commit-guard
// aggregation properties. Extracted so each property can live in its own
// file (BL-1349: the original single file's summed wall clock exceeded the
// 15s per-file budget even after its own numRuns cut, though every
// property is comfortably under budget alone) - never a second
// implementation of the fixture, one definition every split file imports.
//
// BL-1252 declared invariants (unchanged, restated for whichever property
// file quotes them):
// 1. No guard's refusal prevents another index-inspection guard from
//    running: a committer never learns of a second violation only by fixing
//    the first and re-attempting the commit.
// 2. The set of commits refused is exactly the set the current chain
//    refuses; this change alters the completeness of the report, never the
//    refusal predicate.
// 3. A guard that fails unexpectedly - crash, missing script, or any
//    non-refusal error exit - still refuses the commit; aggregating exit
//    codes never converts an error into a pass.
//
// Runs ONLY via `npm run test:properties`.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { mkTmpDir } = require('./tmpDir');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const RUNNER = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'run_commit_guards.sh');

const INDEX_GUARDS = [
  'check_commit_size.sh',
  'check_ticket_deletion.sh',
  'check_pipeline_code_on_main.sh',
  // BL-1303: a `main`-only guard that exits before doing any work on every
  // other branch, so it belongs to the cheap tier the aggregation is about.
  'check_feature_handler_registration.sh',
  // BL-1385: joined the cheap tier on 2026-09-04 (run_commit_guards.sh, "Tier
  // 1"). This list is hand-enumerated, so a guard added to the chain and not
  // added here is left unstubbed by the fixture: the runner then reports it
  // missing on every plan, and these properties fail against a chain that is
  // behaving correctly.
  'check_handler_module_graph.sh',
  // BL-1395: joined the cheap tier on 2026-09-04 (run_commit_guards.sh, "Tier
  // 1") - it loads every changed Babashka script and boots handoffd.
  'check_bb_scripts_load.sh',
  // BL-1428: joined the cheap tier 2026-09-05 - a standing-red register or
  // ledger row a commit adds or changes must name an open ticket.
  'check_standing_red_register.sh',
  // BL-1440: joined the cheap tier 2026-09-06 - a staged constitution
  // article must never cite a docs/ path that doesn't resolve.
  'check_constitution_doc_citations.sh',
  // BL-1424: joined the cheap tier 2026-09-06 - a commit that STAGES a new
  // test file under swarmforge/scripts/test/ with no row in the STAGED
  // suite-manifest.tsv is refused, the same question BL-1240 asks of a
  // git_handoff, asked here too so a hotfix straight onto main (which
  // sends no handoff) is caught.
  'check_test_file_registration.sh',
];
const SUITE_GUARD = 'check_property_suite_drift.sh';
const ALL_GUARDS = [...INDEX_GUARDS, SUITE_GUARD];

// 0 = passes, 1 = the guard's OWN refusal, 2/127 = an unexpected failure,
// 'missing' = the script is not there at all. Each is a distinct branch of
// the aggregation, and each must be REACHED - see assertReach below.
//
// Reach is engineered, not hoped for. A uniform 5-way draw per guard makes
// an ALL-PASSING plan 1-in-625, so the two states that matter most - the
// clean commit, and the one where only the expensive guard refuses - are
// effectively unreachable and the properties pass while asserting nothing
// about the tiering. So: passing is weighted heavily, and the two corner
// plans are mixed in as named constants on top of that. assertReach fails
// the property if any kind still went ungenerated.
const GUARD_STATE = () =>
  fc.oneof(
    { arbitrary: fc.constant(0), weight: 7 },
    { arbitrary: fc.constant(1), weight: 3 },
    { arbitrary: fc.constant(2), weight: 1 },
    { arbitrary: fc.constant(127), weight: 1 },
    { arbitrary: fc.constant('missing'), weight: 1 }
  );

function planOf(states) {
  return Object.fromEntries(ALL_GUARDS.map((g, i) => [g, states[i]]));
}

// One draw per guard in ALL_GUARDS - derived from the list rather than a
// hand-counted tuple, so adding a guard to the chain (BL-1303 added the
// fourth cheap one) widens the plan instead of leaving the new guard
// undefined in every generated plan, which no state would ever satisfy.
const RANDOM_PLAN = () => fc.tuple(...ALL_GUARDS.map(() => GUARD_STATE())).map(planOf);
const cheapAllPassing = INDEX_GUARDS.map(() => 0);
const CLEAN_PLAN = () => fc.constant(planOf([...cheapAllPassing, 0]));
const SUITE_ONLY_PLAN = () => fc.oneof(
  fc.constant(planOf([...cheapAllPassing, 1])),
  fc.constant(planOf([...cheapAllPassing, 2]))
);

const PLAN = () =>
  fc.oneof(
    { arbitrary: RANDOM_PLAN(), weight: 8 },
    { arbitrary: CLEAN_PLAN(), weight: 1 },
    { arbitrary: SUITE_ONLY_PLAN(), weight: 1 }
  );

function writeFixture(root, plan) {
  const guards = path.join(root, 'guards');
  const ran = path.join(root, 'ran');
  fs.mkdirSync(guards, { recursive: true });
  fs.mkdirSync(ran, { recursive: true });
  for (const guard of ALL_GUARDS) {
    if (plan[guard] === 'missing') continue;
    fs.writeFileSync(
      path.join(guards, guard),
      `#!/usr/bin/env bash\nset -euo pipefail\ntouch ${JSON.stringify(path.join(ran, guard))}\nexit ${plan[guard]}\n`,
      { mode: 0o755 }
    );
  }
  return { guards, ran };
}

function runRunner(root, plan) {
  const { guards, ran } = writeFixture(root, plan);
  const result = spawnSync('bash', [RUNNER, root], {
    encoding: 'utf8',
    env: { ...process.env, SWARMFORGE_COMMIT_GUARD_DIR: guards },
  });
  return {
    status: result.status,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
    ran: (guard) => fs.existsSync(path.join(ran, guard)),
  };
}

// The refusal predicate of the PRE-BL-1252 chain, modelled independently of
// the runner: four sequential commands under `set -e`, so the commit is
// refused exactly when the first guard to fail, in order, fails. Tier 2 was
// reached only when the three index guards all passed - which is also what
// the tiered runner does, so the predicate is unchanged by construction and
// this function is the thing that PROVES it rather than assuming it.
function legacyChainRefuses(plan) {
  for (const guard of ALL_GUARDS) {
    if (plan[guard] !== 0) return true;
  }
  return false;
}

function planKinds(plan) {
  const failing = ALL_GUARDS.filter((g) => plan[g] !== 0);
  const indexFailing = INDEX_GUARDS.filter((g) => plan[g] !== 0);
  return {
    clean: failing.length === 0,
    multiIndexViolation: indexFailing.length >= 2,
    unexpected: ALL_GUARDS.some((g) => plan[g] === 2 || plan[g] === 127),
    missing: ALL_GUARDS.some((g) => plan[g] === 'missing'),
    suiteOnly: indexFailing.length === 0 && plan[SUITE_GUARD] !== 0,
  };
}

function assertReach(seen, kinds) {
  for (const kind of kinds) {
    assert.ok(seen[kind] > 0, `generator never reached a ${kind} plan: ${JSON.stringify(seen)}`);
  }
}

function freshSeen() {
  return { clean: 0, multiIndexViolation: 0, unexpected: 0, missing: 0, suiteOnly: 0 };
}

function tally(seen, plan) {
  for (const [kind, hit] of Object.entries(planKinds(plan))) {
    if (hit) seen[kind] += 1;
  }
}

function withRoot(fn) {
  const root = mkTmpDir('sfvc-bl1252-prop-');
  try {
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

module.exports = {
  ALL_GUARDS,
  INDEX_GUARDS,
  SUITE_GUARD,
  PLAN,
  runRunner,
  legacyChainRefuses,
  assertReach,
  freshSeen,
  tally,
  withRoot,
};
