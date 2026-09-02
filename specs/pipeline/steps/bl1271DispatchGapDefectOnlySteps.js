'use strict';

// BL-1271: two fixtures in the dispatch-gap unit suite still built their
// winning candidate as `type: bug`, a type BL-1095 retired from the Article
// 3.2.4 expedite lane, so the suite has been red on main since that landed.
//
// Scenario 01 runs the REAL suite file as a subprocess and reads its real
// verdict - not a re-implementation of what the suite checks, which would
// go green independently of the file this ticket exists to repair.
//
// Scenarios 02 and 03 drive the REAL predicate
// (chase_sweep_lib.bb::top-expedited-paused-candidate) over generated
// candidates, so the defect-only lane and the own-priority tie-break inside
// the expedited bucket are each exercised against production code rather
// than restated here.

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE = 'The expedite picker\'s unit suite reflects the defect-only lane';

const SCRIPTS_DIR = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts');
const SUITE = path.join(SCRIPTS_DIR, 'test', 'dispatch_gap_test_runner.bb');
const CHASE_SWEEP_LIB = path.join(SCRIPTS_DIR, 'chase_sweep_lib.bb');

// Scenario Outline values are validated against these rather than passed
// through: an unknown type or severity must fail loudly, never silently
// exercise a candidate the predicate would ignore for the wrong reason.
const KNOWN_TYPES = new Set(['bug', 'defect', 'feature']);
const KNOWN_SEVERITIES = new Set(['critical', 'high', 'medium', 'low']);

function bbEnv() {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  return env;
}

function candidates(ctx) {
  if (!ctx.bl1271Candidates) ctx.bl1271Candidates = [];
  return ctx.bl1271Candidates;
}

// Asks the real predicate which candidate it names, through the 1-arity
// call (no epic-priority index) both scenarios specify.
function topExpedited(ctx) {
  const forms = candidates(ctx)
    .map((c) => `{:content "id: ${c.id}\\ntype: ${c.type}\\nseverity: ${c.severity}\\npriority: ${c.priority}\\n"}`)
    .join(' ');
  const program = `
(require '[babashka.fs :as fs])
(load-file "${CHASE_SWEEP_LIB}")
(println (pr-str (chase-sweep-lib/top-expedited-paused-candidate [${forms}])))`;
  const res = spawnSync('bb', ['-e', program], { encoding: 'utf8', timeout: 60000, env: bbEnv() });
  assert.equal(res.status, 0, `predicate call failed: ${res.stdout}${res.stderr}`);
  const out = res.stdout.trim();
  return out === 'nil' ? null : JSON.parse(out);
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── dispatch-gap-defect-only-01 ────────────────────────────────────────

  scoped(/^the dispatch-gap unit suite on main$/, (ctx) => {
    ctx.bl1271Suite = SUITE;
  });

  scoped(/^it is run$/, (ctx) => {
    ctx.bl1271Run = spawnSync('bb', [ctx.bl1271Suite], { encoding: 'utf8', timeout: 300000, env: bbEnv() });
  });

  scoped(/^every assertion in it passes$/, (ctx) => {
    const out = `${ctx.bl1271Run.stdout}${ctx.bl1271Run.stderr}`;
    // Both halves: the runner's own ALL PASS line AND a zero exit. Either
    // alone could be satisfied by a run that never reached the assertions.
    assert.equal(ctx.bl1271Run.status, 0, `the suite is still red:\n${out}`);
    assert.match(out, /ALL PASS/, `the suite did not report ALL PASS:\n${out}`);
    assert.doesNotMatch(out, /^FAIL:/m, `the suite reported a failure:\n${out}`);
  });

  // ── dispatch-gap-defect-only-02 and -03 ───────────────────────────────

  scoped(
    /^a paused candidate (\S+) of type "([^"]+)" with severity (\S+) and priority (\d+)$/,
    (ctx, id, type, severity, priority) => {
      if (!KNOWN_TYPES.has(type)) throw new Error(`unknown ticket type ${type}`);
      if (!KNOWN_SEVERITIES.has(severity)) throw new Error(`unknown severity ${severity}`);
      candidates(ctx).push({ id, type, severity, priority });
    },
  );

  scoped(/^the expedite picker is asked for the top expedited candidate with no epic priority index$/, (ctx) => {
    assert.ok(candidates(ctx).length > 0, 'no candidates were built for the picker');
    ctx.bl1271Named = topExpedited(ctx);
  });

  scoped(/^it names (\S+)$/, (ctx, id) => {
    assert.equal(ctx.bl1271Named, id);
  });

  scoped(/^(\S+) is not named$/, (ctx, id) => {
    assert.ok(
      candidates(ctx).some((c) => c.id === id),
      `${id} was never a candidate, so "not named" would hold vacuously`,
    );
    assert.notEqual(ctx.bl1271Named, id);
  });
}

module.exports = { registerSteps };
