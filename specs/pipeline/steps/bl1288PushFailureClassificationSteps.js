'use strict';

// BL-1288: step handlers for "only a rejected push may authorise discarding
// local-ahead commits".
//
// Drives master_main_reconcile_lib.bb's REAL rematch-with-push-first! against
// REAL git fixtures via specs/pipeline/steps/lib/bl1288PushFailureClassificationCli.bb,
// which wires the same real :push!/:reset! adapter shape swarm_heal.bb wires.
//
// Every failure cause below is produced by git itself, not by a fixture
// stderr string: a diverged bare remote for the rejection, an unresolvable
// host for the unreachable remote, a BatchMode ssh URL for the absent
// credential. The classifier under test reads git's own words. None of the
// three touches the network - `nonexistent.invalid` cannot resolve by
// construction (RFC 6761 reserves .invalid) and 127.0.0.1:1 is refused
// locally - so the suite stays offline and deterministic.
//
// The remote URL is repointed only AFTER the fixture has pushed its seed, so
// the local `origin/main` tracking ref still exists and still points at the
// seed. That matters: it means a regression really would destroy the
// local-ahead commit here, rather than failing harmlessly on a missing ref.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkSocketFixtureRoot, releaseSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const FEATURE = 'Only a rejected push may authorise discarding local-ahead commits';

const CLI = path.join(__dirname, 'lib', 'bl1288PushFailureClassificationCli.bb');

// Scenario Outline values are validated against these, never passed through:
// an Examples row naming a cause with no arrangement, or a fate with no
// assertion, must fail loudly rather than vacuously pass.
const KNOWN_CAUSES = new Set([
  'the remote rejected it',
  'the remote was unreachable',
  'no credentials were available',
]);
const KNOWN_FATES = new Set(['kept']);

// BL-1310: with local-ahead commits present, every failure keeps them.
const NON_REJECTION_CAUSES = new Set([
  'the remote was unreachable',
  'no credentials were available',
]);

const UNREACHABLE_URL = 'https://nonexistent.invalid/bl1288.git';
const NO_CREDENTIAL_URL = 'ssh://git@127.0.0.1:1/bl1288.git';
const BATCH_SSH = 'ssh -o BatchMode=yes -o ConnectTimeout=1 -o StrictHostKeyChecking=no';

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function initBareRemote(root) {
  git(root, ['init', '-q', '--bare', '.']);
  git(root, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
}

function initClone(root, remoteRoot) {
  git(root, ['init', '-q', '-b', 'main', '.']);
  git(root, ['config', 'user.email', 'bl1288@example.com']);
  git(root, ['config', 'user.name', 'bl1288']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  // No interactive prompt may ever block the suite on a credential.
  git(root, ['config', 'credential.helper', '']);
  git(root, ['config', 'core.sshCommand', BATCH_SSH]);
  fs.writeFileSync(path.join(root, 'seed.txt'), 'seed\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'seed']);
  git(root, ['remote', 'add', 'origin', remoteRoot]);
  git(root, ['push', '-q', 'origin', 'main']);
}

function runRematch(root) {
  const result = spawnSync('bb', [CLI, root], {
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  assert.equal(
    result.status,
    0,
    `bl1288PushFailureClassificationCli.bb exited ${result.status}: ${result.stdout}${result.stderr}`
  );
  return JSON.parse(result.stdout.trim().split('\n').pop());
}

function divergeOrigin(st) {
  const divergentCloneRoot = fs.realpathSync(mkSocketFixtureRoot('bl1288-divergent-'));
  git(divergentCloneRoot, ['clone', '-q', st.remoteRoot, '.']);
  git(divergentCloneRoot, ['config', 'user.email', 'bl1288@example.com']);
  git(divergentCloneRoot, ['config', 'user.name', 'bl1288']);
  git(divergentCloneRoot, ['config', 'commit.gpgsign', 'false']);
  fs.writeFileSync(path.join(divergentCloneRoot, 'origin-only.txt'), 'origin-side\n');
  git(divergentCloneRoot, ['add', '-A']);
  git(divergentCloneRoot, ['commit', '-q', '-m', 'origin-side commit (unrelated file)']);
  git(divergentCloneRoot, ['push', '-q', 'origin', 'main']);
  st.divergentCloneRoot = divergentCloneRoot;
  st.originTipSha = git(divergentCloneRoot, ['rev-parse', 'HEAD']);
}

function cleanupFixtureState(ctx) {
  const st = ctx.bl1288;
  if (!st) return;
  for (const root of [st.root, st.remoteRoot, st.divergentCloneRoot]) {
    if (root) {
      fs.rmSync(root, { recursive: true, force: true });
      releaseSocketFixtureRoot(root);
    }
  }
  ctx.bl1288 = null;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the master checkout holds commits origin does not have$/, (ctx) => {
    const remoteRoot = fs.realpathSync(mkSocketFixtureRoot('bl1288-remote-'));
    const root = fs.realpathSync(mkSocketFixtureRoot('bl1288-root-'));
    initBareRemote(remoteRoot);
    initClone(root, remoteRoot);
    fs.writeFileSync(path.join(root, 'ahead.txt'), 'ahead\n');
    git(root, ['add', '-A']);
    git(root, ['commit', '-q', '-m', 'local-ahead commit (BL-1288 acceptance)']);
    ctx.bl1288 = { root, remoteRoot, aheadSha: git(root, ['rev-parse', 'HEAD']) };
  });

  scoped(/^a push is attempted first and fails because (.+)$/, (ctx, cause) => {
    const st = ctx.bl1288;
    assert.ok(
      KNOWN_CAUSES.has(cause),
      `unknown push-failure cause "${cause}" - this feature arranges only: ${[...KNOWN_CAUSES].join(', ')}`
    );
    st.cause = cause;
    if (cause === 'the remote rejected it') {
      divergeOrigin(st);
    } else if (cause === 'the remote was unreachable') {
      git(st.root, ['remote', 'set-url', 'origin', UNREACHABLE_URL]);
    } else {
      git(st.root, ['remote', 'set-url', 'origin', NO_CREDENTIAL_URL]);
    }
  });

  scoped(/^a push is attempted first and succeeds$/, (ctx) => {
    // The background already leaves origin/main at the local-ahead commit's
    // parent with no other writer, so the push is a plain fast-forward.
    ctx.bl1288.cause = 'a successful push';
  });

  scoped(/^the reconcile decides whether to reset$/, (ctx) => {
    ctx.bl1288.result = runRematch(ctx.bl1288.root);
  });

  scoped(/^the reconcile reports what happened$/, (ctx) => {
    ctx.bl1288.result = runRematch(ctx.bl1288.root);
  });

  scoped(/^the local-ahead commits are (.+)$/, (ctx, fate) => {
    const st = ctx.bl1288;
    try {
      assert.ok(
        KNOWN_FATES.has(fate),
        `unknown fate "${fate}" - this feature asserts only: ${[...KNOWN_FATES].join(', ')}`
      );
      // BL-1310: local-ahead commits are never discarded; every row keeps them.
      assert.equal(fate, 'kept', `only "kept" is a valid fate after BL-1310`);

      const headNow = git(st.root, ['rev-parse', 'HEAD']);
      assert.equal(
        st.result.resetAttempted,
        false,
        `reset! was invoked: ${JSON.stringify(st.result)}`
      );
      assert.equal(
        headNow,
        st.aheadSha,
        `the local-ahead commit was discarded: HEAD moved from ${st.aheadSha} to ${headNow}`
      );
      const expectedOutcome = NON_REJECTION_CAUSES.has(st.cause)
        ? 'push-unavailable'
        : 'local-ahead-refused';
      assert.equal(
        st.result.outcome,
        expectedOutcome,
        `unexpected outcome: ${JSON.stringify(st.result)}`
      );
    } finally {
      cleanupFixtureState(ctx);
    }
  });

  scoped(/^the report carries the push's own error text$/, (ctx) => {
    const st = ctx.bl1288;
    const error = st.result.error || '';
    assert.ok(
      error.includes('nonexistent.invalid'),
      `the push's own error text did not reach the caller's result: ${JSON.stringify(st.result)}`
    );
    assert.ok(
      /could not resolve host|unable to access/i.test(error),
      `the reported text is not git's own push failure reason: ${JSON.stringify(st.result)}`
    );
  });

  scoped(/^it is not replaced by the reset's error or by an outcome name$/, (ctx) => {
    const st = ctx.bl1288;
    try {
      const error = st.result.error || '';
      // The reset never ran, so its error cannot be what we are reading; and
      // the outcome name alone would be a label, not a reason.
      assert.equal(
        st.result.resetAttempted,
        false,
        `reset! ran, so the reported error may be the reset's: ${JSON.stringify(st.result)}`
      );
      assert.notEqual(error.trim(), st.result.outcome, 'the outcome name displaced the push error text');
      assert.notEqual(error.trim(), '', 'the push error text was dropped entirely');
    } finally {
      cleanupFixtureState(ctx);
    }
  });

  scoped(/^no reset is attempted at all$/, (ctx) => {
    const st = ctx.bl1288;
    try {
      assert.equal(st.result.pushed, true, `expected the push alone to resolve everything: ${JSON.stringify(st.result)}`);
      assert.equal(st.result.resetAttempted, false, `reset! was invoked despite a successful push: ${JSON.stringify(st.result)}`);
    } finally {
      cleanupFixtureState(ctx);
    }
  });
}

module.exports = { registerSteps };
