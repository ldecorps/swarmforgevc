// BL-1032 property test (coder-authored, two DECLARED invariants) over
// specs/pipeline/steps/lib/tmuxReaperGuard.js's scoping decision.
//
//   Invariant 1: "The guard is in scope for a file exactly when that file can
//   cause a real tmux server to run - a file that only names tmux subcommands
//   as data is never in scope."
//
//   Invariant 2: "No file is made compliant by adding a reaper call it does
//   not need: every in-scope file's track()/reap() guards a server that file
//   actually starts."
//
// P2 states invariant 2 as "a reaper cannot BUY compliance", which is the only
// form that catches the failure the ticket documents. bl958's reap() carries
// the comment "Required by extension/test/tmuxReaperGuard.test.js" - adoption
// driven by the gate rather than by a hazard. The property therefore asserts
// that adding a reaper to a file with NO hazard changes nothing: it was not a
// violation before and is not compliant-because-of-the-reaper after. A guard
// where a reaper can change an out-of-scope verdict is a guard that rewards
// writing one you do not need.
//
// REACH, asserted rather than hoped for (BL-654's generator-reach clause).
// The shape that broke the old guard is DATA-ONLY: a file naming 'new-session'
// as a quoted argv element while starting nothing. A generator that only
// produced spawners and stubs would never construct it, and every property
// would pass against the shipped defect. Data-only files are therefore
// generated as their own kind with a floor, alongside the two hazard routes
// and the query-only shape (`list-sessions`, which fails rather than starting
// a server) that over-widening wrongly pulled in.
//
// Hardener-added kind (BL-1032, mutation pass): 'stubber-unreachable' writes
// the same tmux-on-disk stub as 'stubber' but never prepends it to PATH.
// Route 2 is a conjunction - WRITES_TMUX_ON_PATH && PREPENDS_TO_PATH - and
// 'stubber' always carried both halves together, so nothing isolated the
// PREPENDS_TO_PATH half; a mutant dropping it left every prior test green.
//
// Non-vacuity PROVEN at authoring time (2026-08-22), each break restored:
//   revert to the quoted-token test (the shipped defect) .. BOTH properties fail
//   drop the PATH-stub route (would exempt bl958) ......... invariant 1 fails
//
// The second break is the one the ticket warned about in advance, measured
// rather than theoretical: keying purely on a literal tmux spawn exempts
// bl958ControlPlaneLossSteps.js, which reaches tmux through a fake it writes at
// bin/tmux. bl958 is compliant today, so that hole would regress nothing
// VISIBLE - which is exactly what makes it worth closing before it is dug.

const assert = require('node:assert/strict');
const { findTmuxReaperViolation, startsTmuxServer } = require('../../specs/pipeline/steps/lib/tmuxReaperGuard');

const RUNS = Number(process.env.PROPERTY_RUNS || 300);

function makeRng(seed) {
  let s = seed;
  return (n) => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return Math.floor(s / 65536) % Math.max(1, n);
  };
}

const REAPER = ["const { track } = require('./lib/fixtureReaper');", 'track(root);'].join('\n');

// The four shapes, constructed so each is reached by design.
function fileOfKind(kind, rng) {
  switch (kind) {
    case 'data-only':
      // The shape that broke the old guard: 'new-session' as a quoted argv
      // element, in a filter/assert over command vectors, starting nothing.
      return [
        "execFileSync('bb', ['-e', expr], { encoding: 'utf8' });",
        "const creates = ctx.commands.filter((c) => has(c, 'new-session'));",
        "assert.ok(!has(cmd, 'kill-server'));",
      ].join('\n');
    case 'query-only':
      // Spawns tmux, but only to ASK. `list-sessions` fails when no server is
      // running; it never starts one.
      return [
        "cp.spawnSync('tmux', ['list-sessions']);",
        "cp.spawnSync('tmux', ['has-session', '-t', 'sess']);",
      ].join('\n');
    case 'spawner':
      return [
        `execFileSync('tmux', ['-S', sock${rng(4)}, 'new-session', '-d']);`,
        "assert.ok(fs.existsSync(sock));",
      ].join('\n');
    case 'stubber':
      return [
        "fs.writeFileSync(path.join(root, 'bin', 'tmux'), stub);",
        "fs.chmodSync(path.join(root, 'bin', 'tmux'), 0o755);",
        "env.PATH = `${path.join(root, 'bin')}:${env.PATH}`;",
        "const creates = out.filter((c) => has(c, 'new-session'));",
      ].join('\n');
    case 'stubber-unreachable':
      // Hardener-added (BL-1032): writes the SAME tmux stub as 'stubber' but
      // never prepends it to PATH, so nothing that runs next can ever find
      // it. Route 2 requires BOTH halves - "writing a file called tmux is
      // harmless until something can find it" - and 'stubber' always carried
      // both together, so this half of the conjunction had no isolated
      // fixture on either side of it.
      return [
        "fs.writeFileSync(path.join(root, 'bin', 'tmux'), stub);",
        "fs.chmodSync(path.join(root, 'bin', 'tmux'), 0o755);",
        "const creates = out.filter((c) => has(c, 'new-session'));",
      ].join('\n');
    default:
      throw new Error(`unknown kind ${kind}`);
  }
}

const KINDS = ['data-only', 'query-only', 'spawner', 'stubber', 'stubber-unreachable'];
const HAZARDOUS = new Set(['spawner', 'stubber']);

test('BL-1032 invariant 1: in scope exactly when the file can cause a server to run', () => {
  const rng = makeRng(1032);
  const coverage = { 'data-only': 0, 'query-only': 0, spawner: 0, stubber: 0, 'stubber-unreachable': 0, withReaper: 0 };

  for (let r = 0; r < RUNS; r++) {
    const kind = KINDS[rng(KINDS.length)];
    const withReaper = rng(2) === 0;
    const text = fileOfKind(kind, rng) + (withReaper ? `\n${REAPER}` : '');
    coverage[kind] += 1;
    if (withReaper) coverage.withReaper += 1;

    assert.equal(startsTmuxServer(text), HAZARDOUS.has(kind),
      `${kind} was scoped wrongly: ${JSON.stringify(text)}`);

    // And the verdict follows from scope plus adoption, never from the token.
    const violation = findTmuxReaperViolation('x.js', text);
    const shouldViolate = HAZARDOUS.has(kind) && !withReaper;
    assert.equal(Boolean(violation), shouldViolate,
      `${kind} (reaper=${withReaper}) verdict was wrong`);
  }

  // Floors: the data-only shape is the one that broke the old guard, and the
  // query-only shape is the one over-widening wrongly pulled in.
  assert.ok(coverage['data-only'] >= 40, `data-only reached only ${coverage['data-only']}`);
  assert.ok(coverage['query-only'] >= 40, `query-only reached only ${coverage['query-only']}`);
  assert.ok(coverage.spawner >= 40, `spawner reached only ${coverage.spawner}`);
  assert.ok(coverage.stubber >= 40, `stubber reached only ${coverage.stubber}`);
  assert.ok(coverage['stubber-unreachable'] >= 40, `stubber-unreachable reached only ${coverage['stubber-unreachable']}`);
  assert.ok(coverage.withReaper >= 100, `reaper-adopting files reached only ${coverage.withReaper}`);
});

test('BL-1032 invariant 2: a reaper can never BUY compliance for a file with no hazard', () => {
  const rng = makeRng(2032);
  let checked = 0;

  const HAZARD_FREE = ['data-only', 'query-only', 'stubber-unreachable'];
  for (let r = 0; r < RUNS; r++) {
    const kind = HAZARD_FREE[rng(HAZARD_FREE.length)];
    const bare = fileOfKind(kind, rng);
    const withReaper = `${bare}\n${REAPER}`;

    // Adding a reaper changes NOTHING for a file that starts no server: it was
    // not a violation before, and it is not "compliant because of the reaper"
    // after. If these ever differed, writing a reaper you do not need would be
    // a way to satisfy the gate - which is precisely the coercion this ticket
    // exists to remove.
    assert.equal(findTmuxReaperViolation('x.js', bare), null);
    assert.equal(findTmuxReaperViolation('x.js', withReaper), null);
    assert.equal(startsTmuxServer(bare), false);
    assert.equal(startsTmuxServer(withReaper), false,
      'a reaper must never put a file INTO scope either');
    checked += 1;
  }
  assert.equal(checked, RUNS);
});
