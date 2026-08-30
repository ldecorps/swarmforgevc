const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');

// BL-1252 declared invariants:
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

const REPO_ROOT = path.join(__dirname, '..', '..');
const RUNNER = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'run_commit_guards.sh');

const INDEX_GUARDS = [
  'check_commit_size.sh',
  'check_ticket_deletion.sh',
  'check_pipeline_code_on_main.sh',
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

const RANDOM_PLAN = () =>
  fc.tuple(GUARD_STATE(), GUARD_STATE(), GUARD_STATE(), GUARD_STATE()).map(planOf);
const CLEAN_PLAN = () => fc.constant(planOf([0, 0, 0, 0]));
const SUITE_ONLY_PLAN = () => fc.oneof(
  fc.constant(planOf([0, 0, 0, 1])),
  fc.constant(planOf([0, 0, 0, 2]))
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

test('property (invariant 1): every index-inspection guard runs, whatever the ones before it decided', () => {
  const seen = freshSeen();
  fc.assert(
    fc.property(PLAN(), (plan) => {
      tally(seen, plan);
      withRoot((root) => {
        const run = runRunner(root, plan);
        for (const guard of INDEX_GUARDS) {
          if (plan[guard] === 'missing') continue;
          assert.ok(
            run.ran(guard),
            `${guard} never ran under plan ${JSON.stringify(plan)} - an earlier guard aborted the chain`
          );
        }
      });
    }),
    { numRuns: 120 }
  );
  assertReach(seen, ['clean', 'multiIndexViolation', 'unexpected', 'missing', 'suiteOnly']);
});

test('property (invariant 1): every violating index guard is named in the ONE refusal', () => {
  const seen = freshSeen();
  fc.assert(
    fc.property(PLAN(), (plan) => {
      tally(seen, plan);
      withRoot((root) => {
        const run = runRunner(root, plan);
        for (const guard of INDEX_GUARDS) {
          const violated = plan[guard] !== 0;
          assert.equal(
            run.output.includes(guard),
            violated,
            `${guard} should ${violated ? '' : 'NOT '}appear in the refusal for ${JSON.stringify(plan)}: ${run.output}`
          );
        }
      });
    }),
    { numRuns: 120 }
  );
  assertReach(seen, ['clean', 'multiIndexViolation', 'unexpected', 'missing']);
});

test('property (invariant 2): the runner refuses exactly the commits the pre-BL-1252 chain refused', () => {
  const seen = freshSeen();
  fc.assert(
    fc.property(PLAN(), (plan) => {
      tally(seen, plan);
      withRoot((root) => {
        const run = runRunner(root, plan);
        assert.equal(
          run.status !== 0,
          legacyChainRefuses(plan),
          `refusal predicate changed for ${JSON.stringify(plan)} (status ${run.status})`
        );
      });
    }),
    { numRuns: 120 }
  );
  assertReach(seen, ['clean', 'multiIndexViolation', 'unexpected', 'missing', 'suiteOnly']);
});

test('property (invariant 2): the expensive guard runs if and only if the cheap three all pass', () => {
  const seen = freshSeen();
  fc.assert(
    fc.property(PLAN(), (plan) => {
      tally(seen, plan);
      withRoot((root) => {
        const run = runRunner(root, plan);
        const cheapAllPass = INDEX_GUARDS.every((g) => plan[g] === 0);
        const suitePresent = plan[SUITE_GUARD] !== 'missing';
        assert.equal(
          run.ran(SUITE_GUARD),
          cheapAllPass && suitePresent,
          `property suite tiering wrong for ${JSON.stringify(plan)}`
        );
      });
    }),
    { numRuns: 120 }
  );
  assertReach(seen, ['clean', 'multiIndexViolation', 'suiteOnly']);
});

test('property (invariant 3): an unexpected failure refuses the commit and is named as an error, never a pass', () => {
  const seen = freshSeen();
  fc.assert(
    fc.property(PLAN(), (plan) => {
      tally(seen, plan);
      const broken = ALL_GUARDS.filter(
        (g) => plan[g] === 2 || plan[g] === 127 || plan[g] === 'missing'
      );
      // A guard that is never reached cannot be reported; only the ones the
      // tiering actually invokes are in scope for this property.
      const reached = broken.filter(
        (g) => INDEX_GUARDS.includes(g) || INDEX_GUARDS.every((i) => plan[i] === 0)
      );
      fc.pre(reached.length > 0);
      withRoot((root) => {
        const run = runRunner(root, plan);
        assert.notEqual(run.status, 0, `an unexpected guard failure was collected as a pass: ${JSON.stringify(plan)}`);
        assert.match(run.output, /unexpected/i, `the refusal did not distinguish an error from a refusal: ${run.output}`);
        for (const guard of reached) {
          assert.ok(run.output.includes(guard), `the refusal did not name ${guard}: ${run.output}`);
        }
      });
    }),
    { numRuns: 120 }
  );
  assertReach(seen, ['unexpected', 'missing']);
});
