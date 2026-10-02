'use strict';

// BL-1887: step handlers for "A git_handoff at a commit already on
// origin/main starts the ticket on a fresh line". Drives the REAL
// parcel_line_lib.bb parcel-intent + take-up! (the pair ready_for_next_task.bb
// runs at every claim) against a bare origin and a coder worktree under
// mkdtemp (BL-1390: proven by --git-common-dir before any mutating command).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkProcessTmpDir } = require('../../../extension/test/helpers/tmpDir');

const FEATURE = 'BL-1887 A git_handoff at a commit already on origin/main starts the ticket on a fresh line';
const LIB = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts', 'parcel_line_lib.bb');

function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', '-C', cwd, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function commitOn(cwd, file, subject) {
  fs.writeFileSync(path.join(cwd, file), `${subject}\n`);
  git(cwd, 'add', file);
  git(cwd, 'commit', '-q', '-m', subject);
  return git(cwd, 'rev-parse', 'HEAD');
}

function makeFixture() {
  const work = mkProcessTmpDir('bl1887acc-');
  const origin = path.join(work, 'origin.git');
  const root = path.join(work, 'repo');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  execFileSync('git', ['init', '-q', '-b', 'main', root]);
  assert.equal(path.resolve(root, git(root, 'rev-parse', '--git-common-dir')), path.join(root, '.git'));
  fs.writeFileSync(path.join(root, '.gitignore'), '.worktrees/\n.swarmforge/\n');
  git(root, 'add', '.gitignore');
  git(root, 'commit', '-q', '-m', 'seed');
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
  if (!ctx.bl1887) ctx.bl1887 = makeFixture();
  return ctx.bl1887;
}

// The claim's own pair: parcel-intent from the handoff's headers, then take-up!.
function takeUp(fx, task, commit) {
  fx.before = git(fx.coder, 'rev-parse', 'HEAD');
  const program = `
(load-file ${JSON.stringify(LIB)})
(let [intent (parcel-line-lib/parcel-intent {:master? false :role "coder" :type "git_handoff"
                                             :commit ${JSON.stringify(commit)} :task ${JSON.stringify(task)}})]
  (parcel-line-lib/take-up! {:root ${JSON.stringify(fx.coder)} :project-root ${JSON.stringify(fx.root)}
                             :role "coder" :intent intent}))`;
  fx.out = execFileSync('bb', ['-e', program], { encoding: 'utf8' });
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a fixture repository with origin, a coder worktree, and the parcel-line take-up$/, (ctx) => {
    ensure(ctx);
  });

  scoped(/^the coder's line carries (BL-\d+)'s unlanded commit on top of origin\/main$/, (ctx, ticket) => {
    const fx = ensure(ctx);
    fx.lineCommit = commitOn(fx.coder, `${ticket}.txt`, `${ticket}: unlanded work`);
  });

  scoped(/^the coder takes up a git_handoff for (BL-\d+) at a commit already on origin\/main$/, (ctx, ticket) => {
    const fx = ensure(ctx);
    takeUp(fx, `${ticket}-slug`, git(fx.root, 'rev-parse', 'origin/main'));
  });

  scoped(/^the coder takes up a git_handoff for (BL-\d+) at a \1 commit not on origin\/main$/, (ctx, ticket) => {
    const fx = ensure(ctx);
    git(fx.side, 'checkout', '-q', '--detach', 'origin/main');
    fx.build = commitOn(fx.side, `${ticket}-build.txt`, `${ticket}: the build`);
    takeUp(fx, `${ticket}-slug`, fx.build);
  });

  // Scenario 04: the send is a real git_handoff file in the coder's own
  // sent/ mailbox; origin/main then moves on, as it did live (note 002330).
  scoped(/^the coder has already sent (BL-\d+) on at that commit$/, (ctx, ticket) => {
    const fx = ensure(ctx);
    const sent = path.join(fx.coder, '.swarmforge', 'handoffs', 'sent');
    fs.mkdirSync(sent, { recursive: true });
    fs.writeFileSync(
      path.join(sent, `50_20261002T000000Z_000001_from_coder_to_hardender.handoff`),
      `type: git_handoff\nfrom: coder\nto: hardender\npriority: 50\ntask: ${ticket}\ncommit: ${fx.lineCommit.slice(0, 10)}\n\nmerge_and_process coder ${fx.lineCommit.slice(0, 10)}\n`
    );
    git(fx.side, 'checkout', '-q', '--detach', 'origin/main');
    commitOn(fx.side, 'landed-meanwhile.txt', 'BL-9100: landed meanwhile');
    git(fx.side, 'push', '-q', 'origin', 'HEAD:main');
    git(fx.root, 'fetch', '-q', 'origin');
  });

  scoped(/^the coder takes up a Work note for (BL-\d+)$/, (ctx, ticket) => {
    const fx = ensure(ctx);
    fx.before = git(fx.coder, 'rev-parse', 'HEAD');
    const program = `
(load-file ${JSON.stringify(LIB)})
(let [intent (parcel-line-lib/parcel-intent {:master? false :role "coder" :type "note" :work-ticket ${JSON.stringify(ticket)}})]
  (parcel-line-lib/take-up! {:root ${JSON.stringify(fx.coder)} :project-root ${JSON.stringify(fx.root)}
                             :role "coder" :intent intent}))`;
    fx.out = execFileSync('bb', ['-e', program], { encoding: 'utf8' });
  });

  scoped(/^the coder's branch is at origin\/main$/, (ctx) => {
    const fx = ensure(ctx);
    assert.equal(git(fx.coder, 'rev-parse', 'HEAD'), git(fx.root, 'rev-parse', 'origin/main'), fx.out);
    assert.equal(git(fx.coder, 'symbolic-ref', '--short', 'HEAD'), 'swarmforge-coder');
  });

  scoped(/^the head it left is kept under a parcel-backup ref$/, (ctx) => {
    const fx = ensure(ctx);
    const refs = git(fx.coder, 'for-each-ref', '--format=%(objectname)', 'refs/swarmforge/parcel-backup/coder/');
    assert.ok(refs.split('\n').includes(fx.before), `${refs} lacks ${fx.before}`);
  });

  scoped(/^the coder's branch is at that (BL-\d+) commit$/, (ctx) => {
    const fx = ensure(ctx);
    assert.equal(git(fx.coder, 'rev-parse', 'HEAD'), fx.build, fx.out);
  });

  scoped(/^the coder's branch is unchanged$/, (ctx) => {
    const fx = ensure(ctx);
    assert.equal(git(fx.coder, 'rev-parse', 'HEAD'), fx.before, fx.out);
    assert.equal(fx.before, fx.lineCommit);
  });
}

module.exports = { registerSteps };
