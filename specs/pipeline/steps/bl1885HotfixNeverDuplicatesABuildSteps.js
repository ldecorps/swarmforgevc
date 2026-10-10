'use strict';

// BL-1885: step handlers for "a hotfix never duplicates a build already
// in flight" - drives the REAL check_hotfix_duplicate_build.sh (and its
// real hotfix_duplicate_build_cli.bb/lib call chain) against a fixture git
// repo under mkdtemp, same posture as bl760DuplicateChainGuardSteps.js:
// every role's "worktree" is a plain subdirectory of one shared repo, and
// role branches are real git branches in that same repo (never a real
// `git worktree add` - roles.tsv resolution only needs each worktree-path
// to exist as a directory).

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { trackedTmpRoot } = require('./lib/fixtureReaper');

const FEATURE = 'BL-1885 A hotfix never duplicates a build already in flight';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const GUARD = path.join(SCRIPTS_DIR, 'check_hotfix_duplicate_build.sh');
const TICKET_ID = 'BL-9001';

function mkTmp(prefix) {
  return trackedTmpRoot(prefix);
}

function mkdirp(p) {
  fs.mkdirSync(p, { recursive: true });
}

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
}

function gitOut(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function commit(cwd, filename, subject) {
  fs.writeFileSync(path.join(cwd, filename), 'x\n');
  git(cwd, ['add', '-A']);
  git(cwd, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', subject]);
  return gitOut(cwd, ['rev-parse', 'HEAD']);
}

function ensure(ctx) {
  if (!ctx.bl1885) {
    ctx.bl1885 = { root: null, blockerCommit: null, result: null };
  }
  return ctx.bl1885;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a fixture repository with the commit-msg guard chain and an active ticket BL-9001$/, (ctx) => {
    const st = ensure(ctx);
    st.root = mkTmp('bl1885-hotfix-dup-');
    ctx.__disposables = ctx.__disposables || [];
    ctx.__disposables.push(() => {
      try {
        fs.rmSync(st.root, { recursive: true, force: true });
      } catch {
        // best effort
      }
    });
    git(st.root, ['init', '-q', '-b', 'main']);
    git(st.root, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init']);
    mkdirp(path.join(st.root, '.swarmforge'));
    mkdirp(path.join(st.root, 'coder-wt'));
    mkdirp(path.join(st.root, 'qa-wt'));
    const rows = [
      `coder\tcoder-wt\t${path.join(st.root, 'coder-wt')}\tswarmforge-coder\tCoder\tclaude\ttask`,
      `QA\tQA-wt\t${path.join(st.root, 'qa-wt')}\tswarmforge-QA\tQa\tclaude\ttask`,
    ];
    fs.writeFileSync(path.join(st.root, '.swarmforge', 'roles.tsv'), `${rows.join('\n')}\n`);
    mkdirp(path.join(st.root, 'backlog', 'active'));
    fs.writeFileSync(path.join(st.root, 'backlog', 'active', `${TICKET_ID}-fixture.yaml`), `id: ${TICKET_ID}\n`);
    git(st.root, ['add', '-A']);
    git(st.root, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', `seed ${TICKET_ID}`]);
  });

  scoped(/^a role's mailbox holds a git_handoff parcel for BL-9001 at a commit not on main$/, (ctx) => {
    const st = ensure(ctx);
    git(st.root, ['checkout', '-q', '-b', 'orphan-work']);
    const sha = commit(st.root, 'scratch.txt', `${TICKET_ID}: unlanded build`);
    git(st.root, ['checkout', '-q', 'main']);
    st.blockerCommit = sha;
    st.blockerRole = 'QA';
    const dir = path.join(st.root, 'qa-wt', '.swarmforge', 'handoffs', 'inbox', 'new');
    mkdirp(dir);
    fs.writeFileSync(
      path.join(dir, '10_blocker.handoff'),
      [
        'id: x',
        'from: coder',
        'to: QA',
        'priority: 50',
        'type: git_handoff',
        `task: ${TICKET_ID}`,
        `commit: ${sha}`,
        'created_at: 2026-07-31T00:00:00Z',
        '',
        'body',
        '',
      ].join('\n')
    );
  });

  scoped(/^a role branch holds a commit whose subject names BL-9001 and that is not on main$/, (ctx) => {
    const st = ensure(ctx);
    git(st.root, ['checkout', '-q', '-b', 'swarmforge-coder']);
    const sha = commit(st.root, 'scratch2.txt', `${TICKET_ID}: a role-branch build`);
    git(st.root, ['checkout', '-q', 'main']);
    st.blockerCommit = sha;
  });

  scoped(/^no mailbox holds a parcel for BL-9001 and no role branch holds an unlanded BL-9001 commit$/, () => {
    // No-op: the fixture starts with nothing seeded for this ticket.
  });

  function writeMsg(st, lines) {
    const msgPath = path.join(st.root, `msg-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
    fs.writeFileSync(msgPath, `${lines.join('\n')}\n`);
    return msgPath;
  }

  function runGuard(st, msgPath) {
    const res = spawnSync('bash', [GUARD, msgPath], { cwd: st.root, encoding: 'utf8' });
    st.result = { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
  }

  scoped(/^a hotfix commit names BL-9001 as its stamp-off$/, (ctx) => {
    const st = ensure(ctx);
    const msgPath = writeMsg(st, [
      'Hotfix: fix something',
      '',
      'By specifier.',
      '',
      'Hotfix-Certification: pending',
      `Stamp-off: ${TICKET_ID}`,
    ]);
    runGuard(st, msgPath);
  });

  scoped(/^a hotfix commit names BL-9001 as its stamp-off and that commit as superseded$/, (ctx) => {
    const st = ensure(ctx);
    const msgPath = writeMsg(st, [
      'Hotfix: fix something',
      '',
      'By specifier.',
      '',
      'Hotfix-Certification: pending',
      `Stamp-off: ${TICKET_ID}`,
      `Supersedes-Build: ${st.blockerCommit}`,
    ]);
    runGuard(st, msgPath);
  });

  function combined(result) {
    return `${result.stdout}\n${result.stderr}`;
  }

  scoped(/^the commit is refused naming the parcel and its commit$/, (ctx) => {
    const st = ensure(ctx);
    if (st.result.status === 0) {
      throw new Error(`expected refusal, but the commit was accepted: ${combined(st.result)}`);
    }
    const out = combined(st.result);
    if (!out.includes(TICKET_ID)) {
      throw new Error(`expected the refusal to name ${TICKET_ID}, got: ${out}`);
    }
    if (!out.includes(st.blockerRole)) {
      throw new Error(`expected the refusal to name ${st.blockerRole}, got: ${out}`);
    }
    if (!out.includes(st.blockerCommit.slice(0, 10))) {
      throw new Error(`expected the refusal to name the blocking commit, got: ${out}`);
    }
  });

  scoped(/^the commit is refused naming that commit$/, (ctx) => {
    const st = ensure(ctx);
    if (st.result.status === 0) {
      throw new Error(`expected refusal, but the commit was accepted: ${combined(st.result)}`);
    }
    const out = combined(st.result);
    if (!out.includes(st.blockerCommit.slice(0, 10))) {
      throw new Error(`expected the refusal to name the blocking commit, got: ${out}`);
    }
  });

  scoped(/^the commit is accepted$/, (ctx) => {
    const st = ensure(ctx);
    if (st.result.status !== 0) {
      throw new Error(`expected the commit to be accepted, got exit ${st.result.status}: ${combined(st.result)}`);
    }
  });
}

module.exports = { registerSteps };
