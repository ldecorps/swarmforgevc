'use strict';

// BL-1041: step handlers for "A rescue never makes orphaned work less
// durable".
//
// Scenarios 01, 02 and 04 drive the REAL CLI (rescue_orphaned_work.bb) against
// a REAL throwaway git repository. The invariant is an ORDERING over real git
// state - a commit must exist and be reachable before the stash entry is
// dropped - and that cannot be established against a fake: the whole 2026-08-22
// defect was that the drop happened in the same operation as the apply.
//
// Each scenario builds its own repo under os.tmpdir() and stashes INSIDE it, so
// nothing here touches this checkout's shared stash stack - which is the very
// hazard the constitution warns about and which produced the orphaned work in
// the first place.
//
// Scenario 03's assertion is read out of the note the CLI writes, not out of a
// message bus: whether the note is DELIVERABLE is what matters, and
// swarm_handoff.sh refuses a message over 80 characters by printing usage
// rather than sending - a refusal that notifies nobody.
//
// Invariant (BL-968): module load is requires and pure constants only.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FEATURE = 'A rescue never makes orphaned work less durable';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'rescue_orphaned_work.bb');

const RESCUED_CONTENT = 'the reviewed-sound fix\n';
const STASH_LABEL = 'orphaned BL-981 fix';

function git(dir, args) {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
}

function makeOrphanedRepo(ctx) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1041acc-'));
  ctx.tempDirs.push(dir);
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 't@t.t']);
  git(dir, ['config', 'user.name', 't']);
  fs.writeFileSync(path.join(dir, 'seat.ts'), 'original\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'init']);
  // The orphaned work: real, reviewed-sound, and now outside any branch.
  fs.writeFileSync(path.join(dir, 'seat.ts'), RESCUED_CONTENT);
  git(dir, ['stash', 'push', '-q', '-m', STASH_LABEL, '--', 'seat.ts']);
  return dir;
}

function cleanup(ctx) {
  for (const d of ctx.tempDirs || []) fs.rmSync(d, { recursive: true, force: true });
  ctx.tempDirs = [];
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^orphaned work that exists outside any branch$/, (ctx) => {
    ctx.tempDirs = [];
    ctx.repo = makeOrphanedRepo(ctx);
    // Asserted, not assumed: the work really is outside any branch.
    assert.ok(git(ctx.repo, ['stash', 'list']).includes(STASH_LABEL),
      'the fixture must actually leave the work in a stash');
    assert.equal(git(ctx.repo, ['status', '--porcelain']).trim(), '',
      'and leave no worktree copy - that is what "orphaned" means here');
  });

  scoped(/^the rescue touches a role's worktree$/, (ctx) => {
    ctx.role = 'coder';
  });

  scoped(/^a role with its own uncommitted work for its own ticket$/, (ctx) => {
    fs.writeFileSync(path.join(ctx.repo, 'mine.ts'), 'my own work\n');
    ctx.ownWork = true;
  });

  scoped(/^the work is rescued$/, (ctx) => {
    ctx.out = execFileSync('bb', [CLI, ctx.repo, '--stash', 'stash@{0}',
      '--role', ctx.role || 'coder', '--reason', 'BL-981 seat-fold stash'], { encoding: 'utf8' });
  });

  scoped(/^the rescue is interrupted before the commit is made$/, (ctx) => {
    // The real boundary: the source has been applied, and nothing has been
    // committed. This is the exact moment the 2026-08-22 rescue had already
    // destroyed the stash entry.
    git(ctx.repo, ['stash', 'apply', '-q', 'stash@{0}']);
    ctx.interrupted = true;
  });

  scoped(/^that role commits it$/, (ctx) => {
    git(ctx.repo, ['add', 'mine.ts']);
    git(ctx.repo, ['commit', '-qm', 'my own ticket']);
  });

  scoped(/^a commit on a branch contains the rescued content$/, (ctx) => {
    // Read the content OUT of the commit - never trust the subject line.
    const inCommit = git(ctx.repo, ['show', 'HEAD:seat.ts']);
    assert.equal(inCommit, RESCUED_CONTENT,
      'the commit must actually carry the rescued content');
    const branches = git(ctx.repo, ['branch', '--contains', 'HEAD']).trim();
    assert.ok(branches.length > 0,
      'and be reachable from a branch - a dangling commit is as recoverable as the stash was');
  });

  scoped(/^no working tree is left carrying it as an uncommitted change$/, (ctx) => {
    assert.equal(git(ctx.repo, ['status', '--porcelain', '--', 'seat.ts']).trim(), '',
      'a rescue that ends in a dirty tree has moved the work somewhere more fragile, not less');
    cleanup(ctx);
  });

  scoped(/^the source copy is still present$/, (ctx) => {
    assert.ok(ctx.interrupted, 'this scenario is about the interrupted path');
    assert.ok(git(ctx.repo, ['stash', 'list']).includes(STASH_LABEL),
      'interrupted before the commit, the source must NOT have been released');
  });

  scoped(/^the work is still recoverable without it$/, (ctx) => {
    // Recoverable from the source alone, with no reliance on the worktree copy.
    const patch = git(ctx.repo, ['stash', 'show', '-p', 'stash@{0}']);
    assert.ok(patch.includes(RESCUED_CONTENT.trim()),
      'the stash entry must still carry the content, independently of the dirty tree');
    cleanup(ctx);
  });

  scoped(/^that role is told what landed and why$/, (ctx) => {
    assert.match(ctx.out, /NOTE draft for coder/, 'the owner of the touched tree must be told');
    assert.match(ctx.out, /BL-981/, 'the note must say WHY the work landed');
    const sha = git(ctx.repo, ['rev-parse', '--short=10', 'HEAD']).trim();
    assert.ok(ctx.out.includes(sha),
      'and name the commit, so the owner can read the content out of it themselves');
    // A draft swarm_handoff.sh would refuse is not a notification at all.
    const note = fs.readFileSync(path.join(ctx.repo, 'tmp', 'rescue-note.txt'), 'utf8');
    const message = (note.match(/^message: (.*)$/m) || [])[1] || '';
    assert.ok(message.length > 0 && message.length <= 80,
      `the note must fit the 80-char cap or it is refused and nobody is told; got ${message.length}`);
    cleanup(ctx);
  });

  scoped(/^no rescue behaviour is triggered$/, (ctx) => {
    assert.ok(git(ctx.repo, ['stash', 'list']).includes(STASH_LABEL),
      'an ordinary commit must not release anything');
    assert.ok(!fs.existsSync(path.join(ctx.repo, 'tmp', 'rescue-note.txt')),
      'and must not announce a rescue that did not happen');
    cleanup(ctx);
  });
}

module.exports = { registerSteps };
