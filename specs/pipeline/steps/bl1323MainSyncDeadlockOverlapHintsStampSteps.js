'use strict';

// BL-1323: step handlers for the BL-848 stamp-off of landed hotfix
// 9c94735f03 ("main-sync deadlock hints name overlapping paths and teach
// ./swarm heal").
//
// This is a REVIEW parcel: every scenario drives the LANDED code as it
// stands - swarmforge/scripts/babysitter_check.bb's gather, handoffd.bb's
// trip-time persistence via the same normalize helper, and
// master_main_reconcile_lib.bb's hint/alert formatters - and never
// reimplements any of it. A stamp-off that re-specified the behaviour would
// certify its own copy rather than what is in production.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const BABYSITTER = path.join(SCRIPTS, 'babysitter_check.bb');
const RECONCILE_LIB = path.join(SCRIPTS, 'master_main_reconcile_lib.bb');
const HANDOFFD = path.join(SCRIPTS, 'handoffd.bb');
const FIXTURE_PREFIX = 'bl1323-acceptance-';

// BL-971: a killed run traps nothing, so sweep by prefix before creating.
function sweepStaleFixtures() {
  for (const entry of fs.readdirSync(os.tmpdir())) {
    if (entry.startsWith(FIXTURE_PREFIX)) {
      fs.rmSync(path.join(os.tmpdir(), entry), { recursive: true, force: true });
    }
  }
}

function newRoot() {
  sweepStaleFixtures();
  return fs.mkdtempSync(path.join(os.tmpdir(), FIXTURE_PREFIX));
}

function writeMarker(root, payload) {
  const dir = path.join(root, '.swarmforge', 'daemon');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'main-sync-deadlock.json'), JSON.stringify(payload));
}

// Calls the REAL gather in babysitter_check.bb against a fixture project
// root. The script takes its root from argv, so nothing here reaches the
// live checkout.
function gather(root) {
  const program = `
(require '[cheshire.core :as json])
(binding [*command-line-args* ["${root}"]]
  (load-file "${BABYSITTER}"))
(println (json/generate-string (babysitter-check/gather-main-sync-deadlock)))`;
  const r = spawnSync('bb', ['-e', program], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`bb gather failed: ${r.stderr}`);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

function reconcileLib(expression) {
  const program = `
(require '[cheshire.core :as json])
(load-file "${RECONCILE_LIB}")
(println (json/generate-string ${expression}))`;
  const r = spawnSync('bb', ['-e', program], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`bb failed: ${r.stderr}`);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

function git(root, ...args) {
  execFileSync('git', args, { cwd: root, stdio: 'pipe' });
}

function state(ctx) {
  if (!ctx.bl1323) ctx.bl1323 = {};
  return ctx.bl1323;
}

const FEATURE = 'main-sync deadlock hints name overlapping paths and teach ./swarm heal';
const MARKED_PATHS = ['docs/how-to/BL-891-master-main-reconcile-sweep.md', 'swarmforge/scripts/handoffd.bb'];

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a main-sync deadlock is active with reason "dirty"$/, (ctx) => {
    const st = state(ctx);
    st.reason = 'dirty';
  });

  scoped(/^the main-sync deadlock marker was tripped with overlapping paths already recorded on it$/, (ctx) => {
    const st = state(ctx);
    // Deliberately NOT a git repository: if the gather were still
    // recomputing rather than preferring the marker, there is nothing here
    // for it to recompute FROM, so the marker-preference is proved by
    // behaviour rather than by reading the source.
    st.root = newRoot();
    writeMarker(st.root, {
      active: true,
      reason: 'dirty',
      ahead: 2,
      behind: 3,
      overlapping_paths: MARKED_PATHS,
      tripped_at: '2026-09-02T00:00:00Z',
      alerted: true,
    });
  });

  scoped(/^the main-sync deadlock marker was tripped with reason "dirty" and no overlapping paths recorded$/, (ctx) => {
    const st = state(ctx);
    st.root = newRoot();
    git(st.root, 'init', '-q', '-b', 'main', '.');
    git(st.root, 'config', 'user.email', 't@t');
    git(st.root, 'config', 'user.name', 't');
    git(st.root, 'config', 'commit.gpgsign', 'false');
    fs.writeFileSync(path.join(st.root, 'shared.txt'), 'base\n');
    fs.writeFileSync(path.join(st.root, 'untouched.txt'), 'base\n');
    git(st.root, 'add', '-A');
    git(st.root, 'commit', '-q', '-m', 'base');
    const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: st.root, encoding: 'utf8' }).trim();
    // origin/main moves ahead on shared.txt - the merge-changed half.
    fs.writeFileSync(path.join(st.root, 'shared.txt'), 'incoming\n');
    git(st.root, 'add', '-A');
    git(st.root, 'commit', '-q', '-m', 'incoming work');
    git(st.root, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
    git(st.root, 'reset', '-q', '--hard', base);
    // and the working tree is dirty on the SAME path - the overlap.
    fs.writeFileSync(path.join(st.root, 'shared.txt'), 'local edit\n');
    fs.writeFileSync(path.join(st.root, 'untouched.txt'), 'dirty but not overlapping\n');
    writeMarker(st.root, { active: true, reason: 'dirty', ahead: 1, behind: 1, alerted: true });
  });

  scoped(/^babysitterd gathers the main-sync-deadlock finding$/, (ctx) => {
    const st = state(ctx);
    st.finding = gather(st.root);
  });

  scoped(/^the finding's overlapping paths are exactly the ones recorded on the marker$/, (ctx) => {
    const st = state(ctx);
    assert.deepEqual([...(st.finding['overlapping-paths'] || [])].sort(), [...MARKED_PATHS].sort());
  });

  scoped(/^no git status is shelled out to recompute them$/, (ctx) => {
    const st = state(ctx);
    // The fixture root is not a git repository at all, so any recompute
    // would have produced the unknown-dirty sentinel or an empty list. Its
    // absence, with the marker's exact paths present, is the proof.
    const paths = st.finding['overlapping-paths'] || [];
    assert.ok(!paths.some((p) => String(p).includes('?')), `a recompute sentinel leaked in: ${JSON.stringify(paths)}`);
    assert.equal(paths.length, MARKED_PATHS.length);
    fs.rmSync(st.root, { recursive: true, force: true });
  });

  scoped(/^babysitterd runs git status against the master checkout using the -C flag$/, (ctx) => {
    // The landed call shape is what makes the recompute work at all: the
    // pre-hotfix `sh! {:dir ...}` spawned a literal "{:dir" argument, threw,
    // and was swallowed into an empty hint. A finding that carries real
    // paths could not exist under that shape.
    const st = state(ctx);
    assert.ok(
      (st.finding['overlapping-paths'] || []).length > 0,
      `the recompute produced nothing, which is the pre-hotfix failure: ${JSON.stringify(st.finding)}`,
    );
    const source = fs.readFileSync(BABYSITTER, 'utf8');
    assert.ok(
      /sh! "git" "-C" \(str project-root\) "status" "--porcelain"/.test(source),
      'the recompute no longer uses the git -C call shape this hotfix landed',
    );
  });

  scoped(/^the finding's overlapping paths reflect the real dirty and merge-changed overlap$/, (ctx) => {
    const st = state(ctx);
    const paths = st.finding['overlapping-paths'] || [];
    assert.deepEqual([...paths].sort(), ['shared.txt'], `expected only the overlapping path, got ${JSON.stringify(paths)}`);
    fs.rmSync(st.root, { recursive: true, force: true });
  });

  scoped(/^a main-sync deadlock trips for the first time in this incident$/, (ctx) => {
    state(ctx).trip = true;
  });

  scoped(/^handoffd writes the deadlock marker$/, (ctx) => {
    state(ctx).handoffdSource = fs.readFileSync(HANDOFFD, 'utf8');
  });

  scoped(/^the marker's overlapping_paths field holds the dirty and merge-changed overlap computed at trip time$/, (ctx) => {
    const src = state(ctx).handoffdSource;
    // The trip path is inside handoffd's poll loop and cannot be called
    // directly without standing a daemon up, so this asserts the wiring the
    // ticket's required_wiring names: the same normalize helper the gather
    // reads back, persisted onto the marker payload by write-deadlock!.
    const tripBlock = src.slice(src.indexOf(':overlapping_paths') - 2000, src.indexOf(':overlapping_paths') + 800);
    assert.ok(
      /normalize-overlapping-paths/.test(tripBlock),
      'the trip path no longer normalizes the overlap with the shared helper',
    );
    assert.ok(/:overlapping_paths overlap/.test(tripBlock), 'the trip payload no longer carries overlapping_paths');
    assert.ok(/write-deadlock!/.test(tripBlock), 'the trip path no longer persists the marker via write-deadlock!');
    // And the round trip is real: what the trip writes, the gather reads.
    const root = newRoot();
    try {
      writeMarker(root, { active: true, reason: 'dirty', ahead: 1, behind: 1, overlapping_paths: ['a.txt'], alerted: true });
      assert.deepEqual(gather(root)['overlapping-paths'], ['a.txt']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  scoped(/^"?(\d+)"? overlapping paths$/, (ctx, count) => {
    const n = Number(count);
    state(ctx).hintPaths = Array.from({ length: n }, (_, i) => `path/to/file-${String(i).padStart(2, '0')}.txt`);
  });

  scoped(/^the operator-facing deadlock hint is built$/, (ctx) => {
    const st = state(ctx);
    const list = JSON.stringify(st.hintPaths);
    st.hint = reconcileLib(
      `(master-main-reconcile-lib/operator-deadlock-hint {:ahead 1 :behind 1 :reason "dirty" :overlapping-paths ${list}})`,
    );
  });

  scoped(/^the hint (.+)$/, (ctx, shows) => {
    const st = state(ctx);
    const hint = String(st.hint);
    if (/ends with a "\.\/swarm heal" instruction/.test(shows)) {
      assert.ok(hint.includes('./swarm heal'), `the hint does not teach ./swarm heal: ${hint}`);
      return;
    }
    if (shows.includes('fallback instruction to inspect git status')) {
      assert.match(hint, /git status/i);
      return;
    }
    const allByName = shows.match(/^all (\d+) paths by name$/);
    if (allByName) {
      for (const p of st.hintPaths) {
        assert.ok(hint.includes(p), `the hint omits ${p}: ${hint}`);
      }
      return;
    }
    if (shows.includes('first 8 paths by name')) {
      for (const p of st.hintPaths.slice(0, 8)) {
        assert.ok(hint.includes(p), `the hint omits ${p}: ${hint}`);
      }
      assert.ok(hint.includes('(+4 more)'), `the hint lacks the remainder note: ${hint}`);
      for (const p of st.hintPaths.slice(8)) {
        assert.ok(!hint.includes(p), `the hint names ${p} past the cap: ${hint}`);
      }
      return;
    }
    throw new Error(`unknown shows cell: ${shows}`);
  });

  scoped(/^a main-sync deadlock trips with overlapping paths recorded$/, (ctx) => {
    state(ctx).alertPaths = MARKED_PATHS;
  });

  scoped(/^the deadlock alert is sent to the operator$/, (ctx) => {
    const st = state(ctx);
    const list = JSON.stringify(st.alertPaths);
    st.alert = reconcileLib(
      `(master-main-reconcile-lib/deadlock-alert-text {:ahead 1 :behind 1 :reason "dirty" :overlapping-paths ${list}})`,
    );
  });

  scoped(/^the alert body names the overlapping paths and includes "\.\/swarm heal"$/, (ctx) => {
    const st = state(ctx);
    for (const p of st.alertPaths) {
      assert.ok(String(st.alert).includes(p), `the alert omits ${p}: ${st.alert}`);
    }
    assert.ok(String(st.alert).includes('./swarm heal'), `the alert does not teach ./swarm heal: ${st.alert}`);
  });

  scoped(/^the alert body is no longer the generic "wait for BL-891 reconcile" message alone$/, (ctx) => {
    assert.ok(
      !/wait for BL-891 reconcile/.test(String(state(ctx).alert)),
      'the alert still carries the pre-hotfix generic text',
    );
  });
}

module.exports = { registerSteps };
