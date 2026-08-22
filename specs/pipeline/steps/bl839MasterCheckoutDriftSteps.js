'use strict';

// BL-839: step handlers for "the swarm notices when the code it is
// executing is not the code that landed". Drives the REAL
// master_checkout_drift_cli.bb (thin wrapper over master_checkout_drift_lib.bb)
// against REAL fixture git repos - no mocked git, since the whole point of
// this ticket is comparing real working-tree/index/main state.
//
// Every registration below uses defineScoped, pinned to this exact
// Feature: title (BL-425's collision-avoidance mechanism) - generic step
// text like "the drift check runs" or "it reports no drift" is plausible
// enough that another ticket's feature could reasonably reuse the exact
// same wording (bl477UpstreamDriftWatchSteps.js already owns the unscoped
// "the drift check runs" / "the drift check exits non-zero" pair for an
// unrelated upstream-drift feature), and an unscoped registration here
// would either collide with it or silently steal it depending on
// registration order.

const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const FEATURE_NAME = 'The swarm notices when the code it is executing is not the code that landed';

const SWARMFORGE_SCRIPTS = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts');
const CLI = path.join(SWARMFORGE_SCRIPTS, 'master_checkout_drift_cli.bb');

function sh(dir, args) {
  execFileSync(args[0], args.slice(1), { cwd: dir, stdio: 'pipe' });
}

// A real git repo with `main` as the actual branch (forced via
// symbolic-ref before the first commit, so it never depends on the host's
// init.defaultBranch config) and a small daemon-executed chain,
// handoffd.bb -> a.bb, plus an in-flight backlog ticket - all committed.
function makeFixtureRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl839-acceptance-'));
  sh(dir, ['git', 'init', '-q']);
  sh(dir, ['git', 'symbolic-ref', 'HEAD', 'refs/heads/main']);
  sh(dir, ['git', 'config', 'user.email', 't@t']);
  sh(dir, ['git', 'config', 'user.name', 't']);
  fs.mkdirSync(path.join(dir, 'swarmforge', 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'backlog', 'active'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'swarmforge', 'scripts', 'handoffd.bb'),
    '(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "a.bb")))\n'
  );
  fs.writeFileSync(path.join(dir, 'swarmforge', 'scripts', 'a.bb'), '(defn foo [] :main-version)\n');
  fs.writeFileSync(path.join(dir, 'backlog', 'active', 'BL-000.yaml'), 'id: BL-000\nstatus: active\n');
  sh(dir, ['git', 'add', '.']);
  sh(dir, ['git', 'commit', '-q', '-m', 'initial']);
  return dir;
}

function runDriftCheck(repoDir) {
  const out = execFileSync('bb', [CLI, repoDir, '--entrypoint', 'handoffd.bb'], { encoding: 'utf8' });
  return JSON.parse(out.trim());
}

function repoFingerprint(dir) {
  const aBbPath = path.join(dir, 'swarmforge', 'scripts', 'a.bb');
  return {
    status: execFileSync('git', ['status', '--porcelain=v1', '-uall'], { cwd: dir, encoding: 'utf8' }),
    head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }),
    diff: execFileSync('git', ['diff'], { cwd: dir, encoding: 'utf8' }),
    diffCached: execFileSync('git', ['diff', '--cached'], { cwd: dir, encoding: 'utf8' }),
    // a.bb only exists in the default fixture (makeFixtureRepo) - scenario
    // 06's no-main fixture never creates it, so this must degrade rather
    // than throw for that fixture's before/after snapshot.
    aBbContent: fs.existsSync(aBbPath) ? fs.readFileSync(aBbPath, 'utf8') : null,
  };
}

const SCRIPT_PATH = 'swarmforge/scripts/a.bb';

function applyDifference(dir, kind) {
  if (kind === 'unstaged') {
    fs.writeFileSync(path.join(dir, 'swarmforge', 'scripts', 'a.bb'), '(defn foo [] :UNCOMMITTED-EDIT)\n');
  } else if (kind === 'staged') {
    fs.writeFileSync(path.join(dir, 'swarmforge', 'scripts', 'a.bb'), '(defn foo [] :STAGED-REVERSION)\n');
    sh(dir, ['git', 'add', '--', SCRIPT_PATH]);
  } else if (kind === 'backlog-ticket') {
    fs.writeFileSync(path.join(dir, 'backlog', 'active', 'BL-000.yaml'), 'id: BL-000\nstatus: paused\n');
  } else if (kind === 'untracked-scratch') {
    fs.writeFileSync(path.join(dir, 'scratch.txt'), 'scratch content\n');
  } else {
    throw new Error(`unknown difference kind: ${kind}`);
  }
}

function registerSteps(registry) {
  // ── Background ─────────────────────────────────────────────────────
  registry.defineScoped(
    /^the daemons execute scripts from the master checkout's working tree$/,
    (ctx) => {
      ctx.repo = makeFixtureRepo();
    },
    FEATURE_NAME
  );

  // ── master-checkout-drift-01 ─────────────────────────────────────────
  registry.defineScoped(
    /^every daemon-executed script in the master checkout matches main$/,
    (ctx) => {
      // The fixture repo is committed clean by makeFixtureRepo() - nothing to do.
      assert.equal(repoFingerprint(ctx.repo).status, '', 'expected the fixture repo to start clean');
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the drift check runs$/,
    (ctx) => {
      ctx.before = fs.existsSync(ctx.repo) ? repoFingerprint(ctx.repo) : null;
      ctx.result = runDriftCheck(ctx.repo);
      ctx.after = fs.existsSync(ctx.repo) ? repoFingerprint(ctx.repo) : null;
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^it reports no drift$/,
    (ctx) => {
      assert.equal(ctx.result.overall, 'no-drift', `expected no-drift, got: ${JSON.stringify(ctx.result)}`);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^it raises no alarm$/,
    (ctx) => {
      assert.equal(ctx.result.alarmText, null, `expected no alarm text, got: ${JSON.stringify(ctx.result)}`);
    },
    FEATURE_NAME
  );

  // ── master-checkout-drift-02 ─────────────────────────────────────────
  registry.defineScoped(
    /^a daemon-executed script in the master checkout (has uncommitted edits against|is staged for reversion out of) main$/,
    (ctx, difference) => {
      ctx.differenceKind = difference === 'has uncommitted edits against' ? 'unstaged' : 'staged';
      applyDifference(ctx.repo, ctx.differenceKind);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^it reports drift naming that script$/,
    (ctx) => {
      assert.equal(ctx.result.overall, 'drift', `expected drift, got: ${JSON.stringify(ctx.result)}`);
      assert.equal(
        ctx.result.perFile[SCRIPT_PATH] !== 'no-drift' && ctx.result.perFile[SCRIPT_PATH] !== undefined,
        true,
        `expected ${SCRIPT_PATH} to be named as drifted, got: ${JSON.stringify(ctx.result.perFile)}`
      );
      assert.ok(
        ctx.result.alarmText && ctx.result.alarmText.includes(SCRIPT_PATH),
        `expected the alarm text to name ${SCRIPT_PATH}, got: ${ctx.result.alarmText}`
      );
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^it says which side is which$/,
    (ctx) => {
      const expectedMarker = ctx.differenceKind === 'staged' ? 'STAGED' : 'uncommitted';
      assert.ok(
        ctx.result.alarmText.includes(expectedMarker),
        `expected the alarm text to say "${expectedMarker}" for a ${ctx.differenceKind} difference, got: ${ctx.result.alarmText}`
      );
    },
    FEATURE_NAME
  );

  // ── master-checkout-drift-03/04/05 shared Given ──────────────────────
  registry.defineScoped(
    /^(a daemon-executed script|an in-flight backlog ticket|an untracked scratch file) in the master checkout differs from main$/,
    (ctx, subject) => {
      const kind =
        subject === 'a daemon-executed script'
          ? 'unstaged'
          : subject === 'an in-flight backlog ticket'
            ? 'backlog-ticket'
            : 'untracked-scratch';
      ctx.differenceKind = kind;
      applyDifference(ctx.repo, kind);
    },
    FEATURE_NAME
  );

  // ── master-checkout-drift-03 ─────────────────────────────────────────
  registry.defineScoped(
    /^the alarm states that the running code is not the landed code$/,
    (ctx) => {
      assert.ok(
        ctx.result.alarmText && ctx.result.alarmText.includes('not the code'),
        `expected the alarm to state the running code is not the landed code, got: ${ctx.result.alarmText}`
      );
    },
    FEATURE_NAME
  );

  // ── master-checkout-drift-04 ─────────────────────────────────────────
  registry.defineScoped(
    /^it reports (drift|no drift)$/,
    (ctx, verdict) => {
      const expected = verdict === 'drift' ? 'drift' : 'no-drift';
      assert.equal(ctx.result.overall, expected, `expected ${expected}, got: ${JSON.stringify(ctx.result)}`);
    },
    FEATURE_NAME
  );

  // ── master-checkout-drift-05 ─────────────────────────────────────────
  registry.defineScoped(
    /^the master checkout's working tree is left exactly as it was$/,
    (ctx) => {
      assert.ok(ctx.before, 'expected a before-snapshot to have been captured');
      assert.ok(ctx.after, 'expected an after-snapshot to have been captured');
      assert.equal(ctx.after.status, ctx.before.status, 'expected git status to be unchanged by the check');
      assert.equal(ctx.after.head, ctx.before.head, 'expected HEAD to be unchanged by the check');
      assert.equal(ctx.after.diff, ctx.before.diff, 'expected the unstaged diff to be unchanged by the check');
      assert.equal(
        ctx.after.diffCached,
        ctx.before.diffCached,
        'expected the staged diff to be unchanged by the check'
      );
      assert.equal(
        ctx.after.aBbContent,
        ctx.before.aBbContent,
        "expected the drifted file's own content to be untouched (still drifted, not reverted or discarded) by the check"
      );
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^nothing is staged, reverted, committed or discarded$/,
    (ctx) => {
      // The drift the Given step introduced must still be present after the
      // check ran - a "the check silently repaired it" defect would make this
      // fail even though the working-tree-is-left-exactly-as-it-was step above
      // (which only compares snapshots) could not distinguish "untouched" from
      // "touched and then put back".
      const stillDrifted = execFileSync('git', ['diff', '--', SCRIPT_PATH], { cwd: ctx.repo, encoding: 'utf8' });
      const stillDriftedCached = execFileSync('git', ['diff', '--cached', '--', SCRIPT_PATH], {
        cwd: ctx.repo,
        encoding: 'utf8',
      });
      if (ctx.differenceKind === 'unstaged') {
        assert.notEqual(stillDrifted, '', 'expected the unstaged edit to still be present (uncommitted, unreverted)');
      } else if (ctx.differenceKind === 'staged') {
        assert.notEqual(
          stillDriftedCached,
          '',
          'expected the staged reversion to still be staged (not reverted or committed)'
        );
      }
    },
    FEATURE_NAME
  );

  // ── master-checkout-drift-06 ─────────────────────────────────────────
  registry.defineScoped(
    /^the drift check cannot resolve main$/,
    (ctx) => {
      // A fresh repo with no `main` branch at all - the real "cannot resolve
      // main" case, replacing the Background's default main-based fixture.
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl839-nomain-'));
      sh(dir, ['git', 'init', '-q']);
      sh(dir, ['git', 'symbolic-ref', 'HEAD', 'refs/heads/not-main']);
      sh(dir, ['git', 'config', 'user.email', 't@t']);
      sh(dir, ['git', 'config', 'user.name', 't']);
      fs.mkdirSync(path.join(dir, 'swarmforge', 'scripts'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'swarmforge', 'scripts', 'handoffd.bb'), '(defn foo [])\n');
      sh(dir, ['git', 'add', '.']);
      sh(dir, ['git', 'commit', '-q', '-m', 'initial on a non-main branch']);
      ctx.repo = dir;
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^it reports that it could not determine drift$/,
    (ctx) => {
      assert.equal(ctx.result.overall, 'unknown', `expected unknown, got: ${JSON.stringify(ctx.result)}`);
      assert.ok(
        ctx.result.alarmText && ctx.result.alarmText.toLowerCase().includes('could not'),
        `expected the alarm to say it could not determine drift, got: ${ctx.result.alarmText}`
      );
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^it does not report no drift$/,
    (ctx) => {
      assert.notEqual(
        ctx.result.overall,
        'no-drift',
        `expected the verdict to never be no-drift, got: ${JSON.stringify(ctx.result)}`
      );
    },
    FEATURE_NAME
  );
}

module.exports = { registerSteps };
