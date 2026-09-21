'use strict';

// BL-1670's declared invariant (property authorship rests with the coder,
// first pass - BL-654). Runs ONLY via `npm run test:properties`
// (vitest.properties.config.mjs).
//
//   The stray loop never aborts the replay over a pure-evidence or doc
//   stray that adds no line origin/main lacks or whose conflicting lines
//   main's landed commits last wrote; it reports the stray as superseded
//   naming the reason, and every later verdict of the walk is still
//   computed.
//
// Drives the REAL swarmforge/scripts/land_step_lib.bb / land_step_cli.bb
// against real git fixtures - never a JavaScript restatement of either
// decision.
//
// GENERATOR REACH (reached by construction, never by draw). Three shapes,
// each its own: (a) content-subset - the stray's own post-image is a
// strict subset of origin/main's later, larger text (be826a2060's shape);
// (b) rewritten-by-owner - the conflicting line was last written by a
// LANDED commit of the stray's own sibling ticket (5dbfd9b6a6/8fad11b0dc's
// shape); (c) a NEGATIVE control - the conflicting line was last written
// by an UNRELATED ticket, which must still escalate exactly as before.
// Shape (c) is what proves this test is non-vacuous: an implementation
// that always reports every conflict superseded (never escalating) would
// pass shapes (a)/(b) but fail (c).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');
const { assertReachFloor, runsPerCell } = require('./helpers/reachFloors');

const REPO_ROOT = path.join(__dirname, '..', '..');
const CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'land_step_cli.bb');
const FIXTURE_PREFIX = 'bl1670-property-';
const LANDING = 'BL-9650';
const SIBLING = 'BL-9651';
const OTHER = 'BL-9652';

function git(root, ...args) {
  execFileSync('git', args, { cwd: root, stdio: 'pipe' });
}

function gitOut(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function head(root) {
  return gitOut(root, 'rev-parse', 'HEAD');
}

function commitFile(root, rel, body, message) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
  git(root, 'add', '-A');
  git(root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', message);
}

function markOriginMain(root) {
  git(root, 'update-ref', 'refs/remotes/origin/main', head(root));
}

function writeDoneTicket(root, id) {
  commitFile(root, `backlog/done/M8/${id}-fixture.yaml`, `id: ${id}\nstatus: done\nhuman_approval: approved\n`, `${id}: done ticket fixture file`);
}

function initRepo(root) {
  git(root, 'init', '-q', '-b', 'main', '.');
  git(root, 'config', 'user.email', 't@t');
  git(root, 'config', 'user.name', 't');
  git(root, 'config', 'commit.gpgsign', 'false');
}

function runCli(root, taskName, commit) {
  const r = spawnSync('bb', [CLI, taskName, commit], { cwd: root, encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function commitLandingWork(root) {
  commitFile(root, `backlog/active/${LANDING}-fixture.yaml`, `id: ${LANDING}\n`, `${LANDING}: own work`);
}

// ── shape (a): content-subset ────────────────────────────────────────────

function buildContentSubsetFixture() {
  const root = mkTmpDir(FIXTURE_PREFIX);
  initRepo(root);
  commitFile(root, 'seed.txt', 'seed\n', 'seed before origin/main');
  markOriginMain(root);

  git(root, 'checkout', '-q', '-b', 'role');
  const strayPath = `backlog/evidence/${SIBLING}-partial-20260920.md`;
  const partial = Array.from({ length: 9 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
  commitFile(root, strayPath, partial, `${SIBLING}: incident evidence, committed after the ticket moved on`);
  const strayCommit = head(root);

  git(root, 'checkout', '-q', 'main');
  writeDoneTicket(root, SIBLING);
  const grown = partial + Array.from({ length: 31 }, (_, i) => `extra ${i + 1}`).join('\n') + '\n';
  commitFile(root, strayPath, grown, `${SIBLING}: a later commit grows the evidence file on main`);
  markOriginMain(root);

  git(root, 'checkout', '-q', 'role');
  commitLandingWork(root);
  return { root, strayCommit, strayPath, expectedReason: 'content-subset-of-origin-main' };
}

// ── shape (b): rewritten-by-owner ────────────────────────────────────────

function buildRewrittenByOwnerFixture({ rewriteOwner }) {
  const root = mkTmpDir(FIXTURE_PREFIX);
  initRepo(root);
  const docPath = `docs/how-to/${SIBLING}-guide.md`;
  commitFile(root, docPath, 'Header\nStep 1\nStep 2\n', 'seed doc content');
  markOriginMain(root);

  git(root, 'checkout', '-q', '-b', 'role');
  commitFile(root, docPath, 'Header\nStep 1\nStep 2 (old wording)\n', `${SIBLING}: incident evidence, committed after the ticket moved on`);
  const strayCommit = head(root);

  git(root, 'checkout', '-q', 'main');
  commitFile(root, docPath, 'Header\nStep 1\nStep 2 (rebuilt wording, fixes a bug)\n', `${rewriteOwner}: rebuild the guide's step 2 wording`);
  const rewriteCommit = head(root);
  writeDoneTicket(root, SIBLING);
  markOriginMain(root);

  git(root, 'checkout', '-q', 'role');
  commitLandingWork(root);
  return { root, strayCommit, strayPath: docPath, expectedReason: rewriteCommit.slice(0, 10) };
}

const SHAPE_BUILDERS = {
  'content-subset': () => buildContentSubsetFixture(),
  'rewritten-by-owner': () => buildRewrittenByOwnerFixture({ rewriteOwner: SIBLING }),
  'unrelated-writer-escalates': () => buildRewrittenByOwnerFixture({ rewriteOwner: OTHER }),
};

test('BL-1670/BL-654 invariant: a pure-evidence/doc stray conflict superseded on either provable ground reports LAND_STRAY_SUPERSEDED and the replay completes; an unrelated ticket having rewritten the conflicting line still escalates', () => {
  const shapes = Object.keys(SHAPE_BUILDERS);
  const reach = Object.fromEntries(shapes.map((s) => [s, 0]));
  const RUNS = runsPerCell(3 * shapes.length, shapes.length);

  for (const shape of shapes) {
    for (let i = 0; i < RUNS; i += 1) {
      const { root, strayCommit, strayPath, expectedReason } = SHAPE_BUILDERS[shape]();
      try {
        reach[shape] += 1;
        const cli = runCli(root, `${LANDING}-fixture`, head(root));

        if (shape === 'unrelated-writer-escalates') {
          assert.equal(cli.status, 1, `expected LAND_ESCALATE (exit 1) for an unrelated-ticket rewrite, got: ${JSON.stringify(cli)}`);
          assert.ok(cli.stdout.includes('LAND_ESCALATE'), `expected LAND_ESCALATE, got: ${cli.stdout}`);
          assert.ok(
            !cli.stdout.includes('LAND_STRAY_SUPERSEDED'),
            `a conflict last written by an unrelated ticket must never report superseded, got: ${cli.stdout}`,
          );
          assert.ok(cli.stdout.includes(strayCommit), `escalate reason does not name the stray commit: ${cli.stdout}`);
          continue;
        }

        assert.equal(cli.status, 0, `expected LAND_REPLAY (exit 0), got: ${JSON.stringify(cli)}`);
        assert.ok(cli.stdout.includes('LAND_REPLAY'), `expected LAND_REPLAY, got: ${cli.stdout}`);
        assert.ok(!cli.stdout.includes('LAND_ESCALATE'), `a superseded stray must never escalate, got: ${cli.stdout}`);

        const line = cli.stdout.split('\n').find((l) => l.startsWith('LAND_STRAY_SUPERSEDED'));
        assert.ok(line, `expected a LAND_STRAY_SUPERSEDED line, got: ${cli.stdout}`);
        const parts = line.split(' ');
        assert.equal(parts[1], strayCommit, `superseded line does not name the stray's own commit: ${line}`);
        assert.ok(line.includes(strayPath), `superseded line does not name path ${strayPath}: ${line}`);
        assert.equal(parts[parts.length - 1], expectedReason, `unexpected reason: ${line}`);

        // Every later verdict of the walk is still computed: the sibling
        // reports landed (never entangled), and the replay's own tip still
        // carries the landing ticket's own paths.
        assert.ok(
          cli.stdout.split('\n').some((l) => l === `LANDED_SIBLING ${SIBLING}` || l.startsWith(`LANDED_SIBLING ${SIBLING} `)),
          `expected LANDED_SIBLING ${SIBLING}, got: ${cli.stdout}`,
        );
        assert.ok(!cli.stdout.includes(`ENTANGLED_SIBLING ${SIBLING}`), `must never print ENTANGLED_SIBLING ${SIBLING}, got: ${cli.stdout}`);

        const branchLine = cli.stdout.split('\n').find((l) => l.startsWith('LAND_REPLAY'));
        const replayBranch = branchLine.split(' ')[1];
        const replayCommit = branchLine.split(' ')[2];
        const ownFile = gitOut(root, 'show', `${replayCommit}:backlog/active/${LANDING}-fixture.yaml`);
        assert.equal(ownFile.trim(), `id: ${LANDING}`, `expected the landing ticket's own path on the replay tip, got: ${ownFile}`);
        spawnSync('git', ['-C', root, 'branch', '-q', '-D', replayBranch]);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  }

  assertReachFloor(reach, shapes, RUNS, 'stray-conflict-superseded shape');
});
