'use strict';

// BL-2044: step handlers for "A seat's own commits survive a parcel-line
// move". Drives the REAL parcel_line_lib.bb parcel-intent + take-up! (the
// pair ready_for_next_task.bb runs at every claim/reclaim) against a bare
// origin and a coder worktree under mkdtemp - never a reimplementation of
// either. Fixture shape mirrors bl1887MainCommitHandoffStartsFreshSteps.js
// (BL-1390: proven by --git-common-dir before any mutating command).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkProcessTmpDir } = require('../../../extension/test/helpers/tmpDir');

const FEATURE = "BL-2044 A seat's own commits survive a parcel-line move";
const LIB = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts', 'parcel_line_lib.bb');

function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', '-C', cwd, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function tryGit(cwd, ...args) {
  try {
    return { ok: true, out: git(cwd, ...args) };
  } catch (err) {
    return { ok: false, out: (err.stdout || '') + (err.stderr || '') };
  }
}

function commitOn(cwd, file, content, subject) {
  fs.writeFileSync(path.join(cwd, file), content);
  git(cwd, 'add', file);
  git(cwd, 'commit', '-q', '-m', subject);
  return git(cwd, 'rev-parse', 'HEAD');
}

function makeFixture() {
  const work = mkProcessTmpDir('bl2044acc-');
  const origin = path.join(work, 'origin.git');
  const root = path.join(work, 'repo');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  execFileSync('git', ['init', '-q', '-b', 'main', root]);
  assert.equal(path.resolve(root, git(root, 'rev-parse', '--git-common-dir')), path.join(root, '.git'));
  // parcel_line_lib.bb's own git calls (e.g. the BL-2044 cherry-pick) carry
  // no -c user.* flags - production worktrees already have identity
  // configured globally, so this fixture needs its own LOCAL config
  // (shared via the common .git dir across every worktree below) rather
  // than passing -c on every commitOn/git call here.
  git(root, 'config', 'user.email', 't@t');
  git(root, 'config', 'user.name', 't');
  git(root, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(root, '.gitignore'), '.worktrees/\n.swarmforge/\n');
  git(root, 'add', '.gitignore');
  git(root, 'commit', '-q', '-m', 'seed');
  commitOn(root, 'shared.txt', 'base\n', 'shared base');
  git(root, 'remote', 'add', 'origin', origin);
  git(root, 'push', '-q', 'origin', 'main');
  git(root, 'fetch', '-q', 'origin');
  const coder = path.join(root, '.worktrees', 'coder');
  git(root, 'worktree', 'add', '-q', '-b', 'swarmforge-coder', coder, 'origin/main');
  const side = path.join(root, '.worktrees', 'side');
  git(root, 'worktree', 'add', '-q', '--detach', side, 'origin/main');
  return { root, coder, side };
}

function ensure(ctx) {
  if (!ctx.bl2044) ctx.bl2044 = makeFixture();
  return ctx.bl2044;
}

// Advances origin/main (via the detached `side` worktree) and fetches it
// into root, so root's own origin/main tracking ref is current - the SAME
// shape parcel_line_lib_test_runner.bb's own fixtures use.
function advanceOriginMain(fx, file, content, subject) {
  git(fx.side, 'checkout', '-q', '--detach', 'origin/main');
  commitOn(fx.side, file, content, subject);
  git(fx.side, 'push', '-q', 'origin', 'HEAD:main');
  git(fx.root, 'fetch', '-q', 'origin');
}

function serveWorkNote(fx, ticket) {
  fx.before = git(fx.coder, 'rev-parse', 'HEAD');
  const program = `
(load-file ${JSON.stringify(LIB)})
(let [intent (parcel-line-lib/parcel-intent {:master? false :role "coder" :type "note" :work-ticket ${JSON.stringify(ticket)}})]
  (parcel-line-lib/take-up! {:root ${JSON.stringify(fx.coder)} :project-root ${JSON.stringify(fx.root)}
                             :role "coder" :intent intent}))`;
  fx.out = execFileSync('bb', ['-e', program], { encoding: 'utf8' });
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a coder worktree whose line is cut from origin\/main$/, (ctx) => {
    ensure(ctx);
  });

  scoped(
    /^the line carries a commit naming (BL-\d+), a commit naming done ticket (BL-\d+), and a merge of origin\/main under git's default subject$/,
    (ctx, ticket, doneTicket) => {
      const fx = ensure(ctx);
      fx.ownCommit = commitOn(fx.coder, `${ticket}.txt`, `${ticket}: own work\n`, `${ticket}: own work`);
      fs.mkdirSync(path.join(fx.root, 'backlog', 'done'), { recursive: true });
      fs.writeFileSync(path.join(fx.root, 'backlog', 'done', `${doneTicket}-fixture.yaml`), `id: ${doneTicket}\n`);
      commitOn(fx.coder, `${doneTicket}.txt`, `${doneTicket}: landed\n`, `${doneTicket}: a done ticket's commit`);
      advanceOriginMain(fx, 'main-advance.txt', 'advance\n', 'main moves on');
      git(fx.coder, 'merge', '-q', '--no-edit', 'origin/main');
    }
  );

  scoped(/^the line carries a commit naming (BL-\d+) and a commit naming unlanded ticket (BL-\d+)$/, (ctx, ticket, otherTicket) => {
    const fx = ensure(ctx);
    fx.ownCommit = commitOn(fx.coder, `${ticket}.txt`, `${ticket}: own work\n`, `${ticket}: own work`);
    fx.otherCommit = commitOn(fx.coder, `${otherTicket}.txt`, `${otherTicket}: unlanded\n`, `${otherTicket}: another ticket's unlanded work`);
  });

  scoped(
    /^the line carries a commit naming (BL-\d+) that conflicts with origin\/main and a commit naming unlanded ticket (BL-\d+)$/,
    (ctx, ticket, otherTicket) => {
      const fx = ensure(ctx);
      fx.otherCommit = commitOn(fx.coder, `${otherTicket}.txt`, `${otherTicket}: unlanded\n`, `${otherTicket}: another ticket's unlanded work`);
      fx.ownCommit = commitOn(fx.coder, 'shared.txt', 'coder-change\n', `${ticket}: own work`);
      // origin/main changes the SAME line of the SAME file differently -
      // cherry-picking the own commit above onto the new origin/main tip
      // must conflict.
      advanceOriginMain(fx, 'shared.txt', 'main-change\n', 'main advances the shared file');
    }
  );

  scoped(/^the coder is served its Work note for (BL-\d+) again$/, (ctx, ticket) => {
    const fx = ensure(ctx);
    serveWorkNote(fx, ticket);
  });

  scoped(/^the coder's worktree HEAD is unchanged$/, (ctx) => {
    const fx = ensure(ctx);
    assert.equal(git(fx.coder, 'rev-parse', 'HEAD'), fx.before, fx.out);
  });

  scoped(/^the coder's worktree HEAD descends from origin\/main$/, (ctx) => {
    const fx = ensure(ctx);
    const r = tryGit(fx.coder, 'merge-base', '--is-ancestor', 'origin/main', 'HEAD');
    assert.ok(r.ok, `expected HEAD to descend from origin/main; ${fx.out}`);
  });

  scoped(/^the commit naming (BL-\d+) is re-applied on it and the commit naming (BL-\d+) is not$/, (ctx, ticket, otherTicket) => {
    const fx = ensure(ctx);
    const subjects = git(fx.coder, 'log', '--format=%s', 'HEAD');
    assert.ok(subjects.includes(`${ticket}: own work`), `expected ${ticket}'s commit re-applied, log:\n${subjects}\noutput:\n${fx.out}`);
    assert.ok(!subjects.includes(otherTicket), `expected no trace of ${otherTicket}'s commit, log:\n${subjects}`);
    assert.ok(fs.existsSync(path.join(fx.coder, `${ticket}.txt`)), `expected ${ticket}.txt to exist after re-apply`);
    assert.ok(!fs.existsSync(path.join(fx.coder, `${otherTicket}.txt`)), `expected ${otherTicket}.txt to not exist`);
  });

  scoped(/^the head it left is kept under a parcel-backup ref$/, (ctx) => {
    const fx = ensure(ctx);
    const refs = git(fx.coder, 'for-each-ref', '--format=%(objectname)', 'refs/swarmforge/parcel-backup/coder/');
    assert.ok(refs.split('\n').includes(fx.before), `${refs} lacks ${fx.before}`);
  });

  scoped(/^the coder's worktree HEAD is unchanged and has no merge or cherry-pick in progress$/, (ctx) => {
    const fx = ensure(ctx);
    assert.equal(git(fx.coder, 'rev-parse', 'HEAD'), fx.before, fx.out);
    // CHERRY_PICK_HEAD/MERGE_HEAD are per-worktree state, kept under
    // --git-dir (e.g. <root>/.git/worktrees/coder/), never --git-common-dir
    // (<root>/.git/) - a linked worktree's common dir never holds them, so
    // checking it there would pass even with a cherry-pick left stuck.
    const gitDirRaw = git(fx.coder, 'rev-parse', '--git-dir');
    const gitDir = path.isAbsolute(gitDirRaw) ? gitDirRaw : path.join(fx.coder, gitDirRaw);
    for (const marker of ['CHERRY_PICK_HEAD', 'MERGE_HEAD']) {
      assert.ok(!fs.existsSync(path.join(gitDir, marker)), `expected no ${marker}, worktree left mid-operation`);
    }
  });

  scoped(/^the output says the parcel was not taken up and names the conflicting commit$/, (ctx) => {
    const fx = ensure(ctx);
    assert.ok(fx.out.includes('not taken up'), `expected the output to say the parcel was not taken up, got:\n${fx.out}`);
    assert.ok(
      fx.out.includes(fx.ownCommit.slice(0, 10)),
      `expected the output to name the conflicting commit ${fx.ownCommit.slice(0, 10)}, got:\n${fx.out}`
    );
  });
}

module.exports = { registerSteps };
