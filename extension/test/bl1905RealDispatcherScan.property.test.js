'use strict';

// BL-1905 declared invariant (coder first authorship - BL-654):
//   "No acceptance step handler starts a receive or completion dispatcher
//    from the real scripts dir; a fixture runs its own installed copy or the
//    cwd-rooted leaf."
//
// Two parts:
// 1. The real tree: scanDir over specs/pipeline/steps flags nothing. This is
//    the invariant itself, as of this commit.
// 2. The scan that part 1 relies on is exact. Each draw generates a step
//    handler source from these choices:
//    - a root: the real scripts dir through __dirname (directly, one constant
//      deep, or two), or a fixture's own copy;
//    - a script: each derived dispatcher, the cwd-rooted leaves, a
//      non-dispatcher, and a near-miss name;
//    - a binding: a constant, an inline path.join, an array alias, or a
//      for...of loop;
//    - a sink: spawnSync, execFileSync, a local wrapper that spawns, an
//      imported helper, or the safe fs.readFileSync/existsSync;
//    - optionally, the whole use inside a step callback.
//    The REAL scanSource must flag the handler exactly when a real-dir
//    dispatcher reaches a process-starting call.
//
// Collision candidates are constructed, not drawn independently:
// - every source also carries a decoy function that binds a variable of the
//   SAME name to a fixture path and spawns it, so a scan that resolves names
//   without scopes is caught;
// - the leaves differ from dispatchers only by suffix (ready_for_next_task.bb
//   against ready_for_next_task.sh);
// - the near-miss appends to a dispatcher's own name;
// - REACH_EXAMPLES pin each binding with a starting sink and a safe one.
// Reach floor: both flagged and clean draws occur, every binding occurs, and
// every sink occurs.
//
// Non-vacuity: with scanSource's judge treating every callee as a safe
// sink, the first flagged draw fails ("expected flagged"). With scope
// resolution replaced by name matching, the decoy makes a fixture draw
// flagged ("expected clean"). Both restored.
//
// Runs ONLY via `npm run test:properties`.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const { dispatcherNames, scanSource, scanDir } = require('../../specs/pipeline/steps/lib/realDispatcherScan');

const ROOTS = {
  realDirect: { decl: "const P_ROOT = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts');", real: true },
  realOneDeep: { decl: "const REPO_ROOT = path.join(__dirname, '..', '..', '..');\nconst P_ROOT = path.join(REPO_ROOT, 'swarmforge', 'scripts');", real: true },
  realTwoDeep: {
    decl: "const REPO = path.join(__dirname, '..', '..', '..');\nconst SF = path.join(REPO, 'swarmforge');\nconst P_ROOT = path.join(SF, 'scripts');",
    real: true,
  },
  fixtureCopy: { decl: "const P_ROOT = installScripts(fixtureCheckout());", real: false },
};

const SINKS = {
  spawnSync: { call: (arg) => `spawnSync('bb', ${arg}, { cwd: fixture })`, starts: true },
  execFileSync: { call: (arg) => `execFileSync('bb', ${arg}, { cwd: fixture })`, starts: true },
  localWrapper: { call: (arg) => `runIn(fixture, 'bb', ${arg})`, starts: true },
  importedHelper: { call: (arg) => `sendGitHandoffTwoCall('bb', ${arg}, {})`, starts: true },
  readFileSync: { call: (arg) => `fs.readFileSync(${arg}[0], 'utf8')`, starts: false },
  existsSync: { call: (arg) => `fs.existsSync(${arg}[0])`, starts: false },
};

// Each binding returns the statements and the array expression a sink receives.
const BINDINGS = {
  constant: (name) => ({ setup: `const SCRIPT = path.join(P_ROOT, '${name}');`, arg: '[SCRIPT]' }),
  inlineJoin: (name) => ({ setup: '', arg: `[path.join(P_ROOT, '${name}')]` }),
  arrayAlias: (name) => ({ setup: `const SCRIPT = path.join(P_ROOT, '${name}');\nconst args = [SCRIPT, '--no-op', 'x'];`, arg: 'args' }),
  forOf: (name) => ({ setup: `const SCRIPT = path.join(P_ROOT, '${name}');`, loop: true, arg: '[s]' }),
};

function source({ root, name, binding, sink, inCallback }) {
  const b = BINDINGS[binding](name);
  const use = SINKS[sink].call(b.arg);
  const body = b.loop ? `${b.setup}\nfor (const s of [SCRIPT]) {\n  ${use};\n}` : `${b.setup}\n${use};`;
  const wrapped = inCallback ? `scoped(/^a step$/, (ctx) => {\n${body}\n});` : body;
  return `'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const { sendGitHandoffTwoCall } = require('./lib/sendGitHandoffTwoCall');
const { installScripts } = require('./lib/fixtureScriptsInstall');
${ROOTS[root].decl}
function runIn(cwd, cmd, args) {
  return spawnSync(cmd, args, { cwd });
}
// Decoy: the same variable name, bound to a fixture copy, spawned.
function decoy(ctx) {
  const SCRIPT = path.join(ctx.fixtureScripts, 'done_with_current_task.bb');
  return spawnSync('bb', [SCRIPT], { cwd: ctx.fixture });
}
function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, 'x');
  const fixture = '/tmp/fixture';
${wrapped}
}
module.exports = { registerSteps, decoy };
`;
}

test('BL-1905/BL-654 invariant, part 1: no handler in specs/pipeline/steps starts a real receive or completion dispatcher', () => {
  const flagged = scanDir().filter((r) => r.flagged.length);
  assert.deepEqual(flagged.map((r) => `${r.file}: ${JSON.stringify(r.flagged)}`), []);
}, 60000);

test('BL-1905/BL-654 invariant, part 2: the scan flags a handler exactly when a real-dir dispatcher reaches a process-starting call', () => {
  const names = dispatcherNames();
  const leaves = ['ready_for_next_task.bb', 'ready_for_next_batch.bb'];
  const others = ['swarm_handoff.bb', 'done_with_current_task.bb.bak'];
  const script = fc.oneof(
    { weight: 3, arbitrary: fc.constantFrom(...names) },
    { weight: 1, arbitrary: fc.constantFrom(...leaves, ...others) }
  );
  const draw = fc.record({
    root: fc.constantFrom(...Object.keys(ROOTS)),
    name: script,
    binding: fc.constantFrom(...Object.keys(BINDINGS)),
    sink: fc.constantFrom(...Object.keys(SINKS)),
    inCallback: fc.boolean(),
  });
  const examples = Object.keys(BINDINGS).flatMap((binding) => [
    [{ root: 'realOneDeep', name: 'done_with_current_task.bb', binding, sink: 'spawnSync', inCallback: true }],
    [{ root: 'realOneDeep', name: 'done_with_current_task.bb', binding, sink: 'readFileSync', inCallback: true }],
    [{ root: 'fixtureCopy', name: 'done_with_current_task.bb', binding, sink: 'localWrapper', inCallback: false }],
    [{ root: 'realTwoDeep', name: 'ready_for_next_task.bb', binding, sink: 'spawnSync', inCallback: false }],
  ]);
  const reach = { flagged: 0, clean: 0, bindings: new Set(), sinks: new Set() };
  fc.assert(
    fc.property(draw, (d) => {
      const expected = ROOTS[d.root].real && names.includes(d.name) && SINKS[d.sink].starts;
      const src = source(d);
      const { flagged } = scanSource(src, names, 'generated.js');
      if (expected) assert.ok(flagged.length >= 1, `expected flagged: ${JSON.stringify(d)}\n${src}`);
      else assert.deepEqual(flagged, [], `expected clean: ${JSON.stringify(d)}\n${src}`);
      reach[expected ? 'flagged' : 'clean'] += 1;
      reach.bindings.add(d.binding);
      reach.sinks.add(d.sink);
    }),
    { numRuns: 300, examples }
  );
  assert.ok(reach.flagged >= 1 && reach.clean >= 1, JSON.stringify({ ...reach, bindings: [...reach.bindings], sinks: [...reach.sinks] }));
  assert.equal(reach.bindings.size, Object.keys(BINDINGS).length);
  assert.equal(reach.sinks.size, Object.keys(SINKS).length);
}, 120000);
