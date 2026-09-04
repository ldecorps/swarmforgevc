'use strict';

// BL-1309's two DECLARED invariants (property authorship rests with the coder,
// first pass - BL-654). Runs ONLY via `npm run test:properties`
// (vitest.properties.config.mjs).
//
//   invariant 1  No tip that adds an unlanded ticket's content over
//                origin/main is advised for push, whatever route that content
//                took onto the tip - a first-parent merge, a second-parent
//                merge, or a rematch.
//
//                NARROWED by the human's second ruling (BL-1375, superseding
//                this ticket's own ruling_options option 1): "unlanded" alone
//                no longer holds a tip back, because when several APPROVED
//                tickets share one path each refuses on the others and the
//                land queue deadlocks. What is encoded here is the ruling as
//                it now stands - a sibling that is WITHHELD, awaiting
//                approval, or whose approval state cannot be READ is never
//                advised for push by any route; an APPROVED one rides. The
//                ticket's `invariants:` field still carries the pre-revision
//                wording, which the coder cannot edit; raised to the specifier
//                by priority-00 note rather than silently encoded either way.
//   invariant 2  An input the step cannot read never becomes a refusal. An
//                unrunnable detector, an unreadable range against origin/main
//                and an unknown ticket all fail OPEN (BL-806, preserved by
//                BL-1293 and BL-1307).
//
//                Distinct from a sibling whose APPROVAL cannot be read, which
//                blocks: invariant 2 is about the step failing to run its own
//                check, and absence there is silence, not permission.
//
// Drives the REAL swarmforge/scripts/land_main_publish.sh against real git
// fixtures with a REAL bare origin - never a JavaScript restatement of the
// decision, and never a self-remote (the script fetches origin/main on every
// run, so a self-remote dissolves the entanglement before it is measured).
//
// GENERATOR REACH (by construction, never by draw). Invariant 1 names three
// ROUTES the content can take onto the tip, so each route is built rather than
// hoped for: a plain commit on the branch, a merge that brings it in on the
// second parent, and a rematch (the tip rebuilt on an advanced origin/main
// while the sibling stays behind). Every route gets its own pass and the run
// asserts each was exercised - a draw could otherwise miss the merge route
// entirely, which is exactly the route BL-1308 had to widen the detector for.
//
// The narrowing adds a second dimension that is crossed with the routes rather
// than sampled beside them: every BLOCKING approval state (withheld in
// backlog/hold, awaiting approval, unreadable) is built on every route, and
// the approved state is built on every route too. Drawing the two dimensions
// independently would let a run pass while never once pairing, say, the merge
// route with a held sibling - the exact pair the 2026-08-31 incident was.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');

const REPO_ROOT = path.join(__dirname, '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const CLI = path.join(SCRIPTS, 'land_main_publish.sh');
const FIXTURE_PREFIX = 'bl1309-property-';

const ROUTES = ['plain-commit', 'second-parent-merge', 'rematch'];
const BLIND = ['no-detector', 'unreadable-range', 'unknown-ticket'];

// Every state the ruling says still blocks, and the one it says rides. The
// sibling's ticket file is written into the WORKING TREE, never committed, so
// the git entanglement is byte-identical across all four.
const BLOCKING_STATES = ['held', 'pending', 'unreadable'];
const RIDING_STATES = ['approved'];

function git(root, ...args) {
  execFileSync('git', args, { cwd: root, stdio: 'pipe' });
}

function head(root) {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
}

// A killed run traps no `finally`, so the previous run's fixtures are swept by
// prefix BEFORE this one starts as well (BL-971).
function sweepFixtures() {
  for (const entry of fs.readdirSync(os.tmpdir())) {
    if (entry.startsWith(FIXTURE_PREFIX)) {
      fs.rmSync(path.join(os.tmpdir(), entry), { recursive: true, force: true });
    }
  }
}

function commitFile(root, rel, body, message) {
  fs.writeFileSync(path.join(root, rel), body);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', message);
}

function newFixture() {
  const work = mkTmpDir(FIXTURE_PREFIX);
  const origin = path.join(work, 'origin.git');
  const root = path.join(work, 'repo');
  git(work, 'init', '-q', '--bare', '-b', 'main', origin);
  git(work, 'init', '-q', '-b', 'main', root);
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  git(root, 'config', 'user.email', 't@t');
  git(root, 'config', 'user.name', 't');
  git(root, 'config', 'commit.gpgsign', 'false');
  git(root, 'remote', 'add', 'origin', origin);
  git(root, 'commit', '-q', '--allow-empty', '-m', 'seed');
  git(root, 'push', '-q', 'origin', 'main');
  return { work, origin, root };
}

/**
 * The sibling's backlog ticket as the checkout carries it. `unreadable` writes
 * nothing at all: a sibling with no ticket file in either tree is exactly the
 * state that must NOT be read as permission.
 */
function writeSiblingTicket(root, sibling, state) {
  if (state === 'unreadable') return;
  const folder = state === 'held' ? 'hold' : 'active';
  const approval = state === 'pending' ? 'pending' : 'approved';
  const dir = path.join(root, 'backlog', folder);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${sibling}-the-sibling.yaml`), `id: ${sibling}\nhuman_approval: ${approval}\n`);
}

/** A tip carrying an unlanded sibling's content, by the named route. */
function entangledFixture(route, sibling) {
  const fx = newFixture();
  const { root, origin } = fx;
  switch (route) {
    case 'plain-commit':
      commitFile(root, 'sibling.txt', 'sibling\n', `${sibling}: its own work`);
      break;
    case 'second-parent-merge':
      git(root, 'checkout', '-q', '-b', 'side');
      commitFile(root, 'sibling.txt', 'sibling\n', `${sibling}: its own work`);
      git(root, 'checkout', '-q', 'main');
      git(root, 'merge', '-q', '--no-ff', '-m', `Merge ${sibling} into QA (held)`, 'side');
      break;
    case 'rematch': {
      // origin/main advances under the tip and the tip is rebuilt on it, the
      // way a land rematch does - the sibling still never reaches origin.
      commitFile(root, 'sibling.txt', 'sibling\n', `${sibling}: its own work`);
      const lander = path.join(fx.work, 'lander');
      git(fx.work, 'clone', '-q', origin, lander);
      git(lander, 'config', 'user.email', 't@t');
      git(lander, 'config', 'user.name', 't');
      git(lander, 'config', 'commit.gpgsign', 'false');
      commitFile(lander, 'unrelated.txt', 'unrelated\n', 'BL-9500: an unrelated land');
      git(lander, 'push', '-q', 'origin', 'main');
      git(root, 'fetch', '-q', 'origin');
      git(root, 'rebase', '-q', 'origin/main');
      break;
    }
    default:
      throw new Error(`unknown route: ${route}`);
  }
  commitFile(root, 'own.txt', 'own\n', 'BL-9001: the ticket being landed');
  return fx;
}

function decide(root, cli = CLI) {
  const r = spawnSync('bash', [cli, root, '--decide-only'], { encoding: 'utf8', timeout: 300_000 });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  return { code: r.status, out, advises: out.includes(':purity-action'), marker: out.includes('ENTANGLED_SIBLING_BLOCK') };
}

test('BL-1309/BL-654 invariant 1: a withheld or unapproved ticket on the tip is never advised for push', () => {
  sweepFixtures();
  const reach = Object.fromEntries(ROUTES.flatMap((r) => BLOCKING_STATES.map((s) => [`${r}/${s}`, 0])));

  for (const route of ROUTES) {
    for (const state of BLOCKING_STATES) {
      fc.assert(
        fc.property(fc.integer({ min: 9002, max: 9099 }), (n) => {
          const sibling = `BL-${n}`;
          const fx = entangledFixture(route, sibling);
          try {
            reach[`${route}/${state}`] += 1;
            writeSiblingTicket(fx.root, sibling, state);
            const report = decide(fx.root);
            assert.equal(report.advises, false, `${route}/${state}: a tip carrying ${sibling} was advised for push: ${report.out}`);
            assert.equal(report.code, 3, `${route}/${state}: not the documented refusal status: ${report.out}`);
            assert.ok(report.out.includes(sibling), `${route}/${state}: the refusal does not name ${sibling}: ${report.out}`);
            return true;
          } finally {
            fs.rmSync(fx.work, { recursive: true, force: true });
          }
        }),
        { numRuns: 2 }
      );
    }
  }

  for (const pair of Object.keys(reach)) assert.ok(reach[pair] > 0, `never exercised ${pair}`);
});

test('BL-1309/BL-654 invariant 1, narrowed: an APPROVED unlanded sibling rides by every route', () => {
  sweepFixtures();
  const reach = Object.fromEntries(ROUTES.flatMap((r) => RIDING_STATES.map((s) => [`${r}/${s}`, 0])));

  for (const route of ROUTES) {
    for (const state of RIDING_STATES) {
      fc.assert(
        fc.property(fc.integer({ min: 9002, max: 9099 }), (n) => {
          const sibling = `BL-${n}`;
          const fx = entangledFixture(route, sibling);
          try {
            reach[`${route}/${state}`] += 1;
            // Non-vacuity, asserted rather than assumed: with NO ticket file
            // this very tip refuses. So the only thing that can make the run
            // below proceed is the approval that was just written - not a
            // fixture that was never entangled in the first place.
            assert.equal(decide(fx.root).code, 3, `${route}/${state}: the fixture is not entangled, so this row proves nothing`);
            writeSiblingTicket(fx.root, sibling, state);
            const report = decide(fx.root);
            assert.equal(report.marker, false, `${route}/${state}: an approved sibling was refused: ${report.out}`);
            assert.equal(report.code, 0, `${route}/${state}: an approved sibling did not get the ordinary decision: ${report.out}`);
            assert.equal(report.advises, true, `${route}/${state}: no ordinary decision printed: ${report.out}`);
            return true;
          } finally {
            fs.rmSync(fx.work, { recursive: true, force: true });
          }
        }),
        { numRuns: 2 }
      );
    }
  }

  for (const pair of Object.keys(reach)) assert.ok(reach[pair] > 0, `never exercised ${pair}`);
});

test('BL-1309/BL-654 invariant 2: an input the step cannot read never becomes a refusal', () => {
  sweepFixtures();
  const reach = Object.fromEntries(BLIND.map((s) => [s, 0]));

  for (const shape of BLIND) {
    fc.assert(
      fc.property(fc.integer({ min: 9002, max: 9099 }), (n) => {
        const sibling = `BL-${n}`;
        // Entangled by construction, so ONLY the unreadable input can hold the
        // verdict back. A clean fixture would pass this vacuously.
        const fx = entangledFixture('plain-commit', sibling);
        try {
          reach[shape] += 1;
          assert.equal(decide(fx.root).code, 3, `${shape}: the fixture is not entangled, so this row proves nothing`);

          let cli = CLI;
          if (shape === 'no-detector') {
            const fake = path.join(fx.work, 'scripts');
            fs.mkdirSync(fake, { recursive: true });
            fs.copyFileSync(CLI, path.join(fake, 'land_main_publish.sh'));
            fs.copyFileSync(
              path.join(SCRIPTS, 'master_main_reconcile_lib.bb'),
              path.join(fake, 'master_main_reconcile_lib.bb')
            );
            cli = path.join(fake, 'land_main_publish.sh');
          } else if (shape === 'unreadable-range') {
            fs.rmSync(fx.origin, { recursive: true, force: true });
            const ref = path.join(fx.root, '.git', 'refs', 'remotes', 'origin');
            fs.mkdirSync(ref, { recursive: true });
            fs.writeFileSync(path.join(ref, 'main'), '0123456789abcdef0123456789abcdef01234567\n');
          } else {
            git(fx.root, 'commit', '-q', '--allow-empty', '-m', 'housekeeping, naming no ticket');
          }

          const report = decide(fx.root, cli);
          assert.equal(report.marker, false, `${shape} refused: ${report.out}`);
          assert.equal(report.code, 0, `${shape} did not fail open: ${report.out}`);
          assert.equal(report.advises, true, `${shape} printed no ordinary decision: ${report.out}`);
          return true;
        } finally {
          fs.rmSync(fx.work, { recursive: true, force: true });
        }
      }),
      { numRuns: 2 }
    );
  }

  for (const shape of BLIND) assert.ok(reach[shape] > 0, `never exercised the ${shape} shape`);
});
