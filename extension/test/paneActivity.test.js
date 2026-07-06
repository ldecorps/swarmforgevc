const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  trackPaneActivity,
  resetPaneActivity,
  outboxNewestMtimeMs,
} = require('../out/watchdog/paneActivity');

beforeEach(() => {
  resetPaneActivity();
});

test('trackPaneActivity treats the first observation of a role as activity', () => {
  const now = 1000;
  const result = trackPaneActivity('coder', 'pane text', 0, now);
  assert.equal(result, now, 'a role never observed before must not be immediately eligible to chase');
});

test('trackPaneActivity treats changed pane content as fresh activity', () => {
  trackPaneActivity('coder', 'first', 0, 1000);
  const result = trackPaneActivity('coder', 'second', 0, 2000);
  assert.equal(result, 2000, 'changed pane content resets the activity clock');
});

test('trackPaneActivity holds the prior activity time when pane content is unchanged and outbox is older', () => {
  trackPaneActivity('coder', 'same', 0, 1000);
  const result = trackPaneActivity('coder', 'same', 0, 5000);
  assert.equal(result, 1000, 'unchanged pane content with no fresher outbox write must not look active');
});

test('trackPaneActivity uses outbox activity when it is more recent than the last pane change', () => {
  trackPaneActivity('coder', 'same', 0, 1000);
  const result = trackPaneActivity('coder', 'same', 4000, 5000);
  assert.equal(result, 4000, 'a fresh outbox write counts as activity even with static pane content');
});

test('trackPaneActivity tracks roles independently', () => {
  trackPaneActivity('coder', 'a', 0, 1000);
  trackPaneActivity('cleaner', 'b', 0, 2000);
  const coderResult = trackPaneActivity('coder', 'a', 0, 9000);
  const cleanerResult = trackPaneActivity('cleaner', 'b', 0, 9000);
  assert.equal(coderResult, 1000);
  assert.equal(cleanerResult, 2000);
});

test('resetPaneActivity clears tracked state so the next observation counts as fresh activity again', () => {
  trackPaneActivity('coder', 'same', 0, 1000);
  resetPaneActivity();
  const result = trackPaneActivity('coder', 'same', 0, 9000);
  assert.equal(result, 9000, 'after a reset, a role must be re-observed before it can be judged idle');
});

function mkTarget() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-paneactivity-'));
}

test('outboxNewestMtimeMs returns 0 when roles.tsv does not exist', () => {
  const target = mkTarget();
  assert.equal(outboxNewestMtimeMs(target, 'coder'), 0);
});

test('outboxNewestMtimeMs returns 0 when the role is not present in roles.tsv', () => {
  const target = mkTarget();
  const wt = path.join(target, '.worktrees', 'coder');
  fs.mkdirSync(path.join(target, '.swarmforge'), { recursive: true });
  fs.writeFileSync(
    path.join(target, '.swarmforge', 'roles.tsv'),
    `coder\tcoder\t${wt}\tswarmforge-coder\tCoder\tclaude\ttask\n`
  );
  assert.equal(outboxNewestMtimeMs(target, 'architect'), 0);
});

test('outboxNewestMtimeMs returns 0 when the role worktree has no outbox or sent dirs yet', () => {
  const target = mkTarget();
  const wt = path.join(target, '.worktrees', 'coder');
  fs.mkdirSync(path.join(target, '.swarmforge'), { recursive: true });
  fs.mkdirSync(wt, { recursive: true });
  fs.writeFileSync(
    path.join(target, '.swarmforge', 'roles.tsv'),
    `coder\tcoder\t${wt}\tswarmforge-coder\tCoder\tclaude\ttask\n`
  );
  assert.equal(outboxNewestMtimeMs(target, 'coder'), 0);
});

test('outboxNewestMtimeMs returns the newest mtime across outbox and sent', () => {
  const target = mkTarget();
  const wt = path.join(target, '.worktrees', 'coder');
  const handoffs = path.join(wt, '.swarmforge', 'handoffs');
  fs.mkdirSync(path.join(target, '.swarmforge'), { recursive: true });
  fs.mkdirSync(path.join(handoffs, 'outbox'), { recursive: true });
  fs.mkdirSync(path.join(handoffs, 'sent'), { recursive: true });
  fs.writeFileSync(
    path.join(target, '.swarmforge', 'roles.tsv'),
    `coder\tcoder\t${wt}\tswarmforge-coder\tCoder\tclaude\ttask\n`
  );

  const outboxDir = path.join(handoffs, 'outbox');
  const sentDir = path.join(handoffs, 'sent');
  const older = new Date(Date.now() - 60000);
  const newer = new Date();
  fs.utimesSync(outboxDir, older, older);
  fs.utimesSync(sentDir, newer, newer);

  const result = outboxNewestMtimeMs(target, 'coder');
  assert.equal(result, fs.statSync(sentDir).mtimeMs);
});

test('outboxNewestMtimeMs uses outbox mtime when only outbox exists (no sent dir yet)', () => {
  const target = mkTarget();
  const wt = path.join(target, '.worktrees', 'coder');
  const handoffs = path.join(wt, '.swarmforge', 'handoffs');
  fs.mkdirSync(path.join(target, '.swarmforge'), { recursive: true });
  fs.mkdirSync(path.join(handoffs, 'outbox'), { recursive: true });
  fs.writeFileSync(
    path.join(target, '.swarmforge', 'roles.tsv'),
    `coder\tcoder\t${wt}\tswarmforge-coder\tCoder\tclaude\ttask\n`
  );

  const outboxDir = path.join(handoffs, 'outbox');
  const result = outboxNewestMtimeMs(target, 'coder');
  assert.equal(result, fs.statSync(outboxDir).mtimeMs);
});

test('outboxNewestMtimeMs uses sent mtime when only sent exists (nothing pending in outbox)', () => {
  const target = mkTarget();
  const wt = path.join(target, '.worktrees', 'coder');
  const handoffs = path.join(wt, '.swarmforge', 'handoffs');
  fs.mkdirSync(path.join(target, '.swarmforge'), { recursive: true });
  fs.mkdirSync(path.join(handoffs, 'sent'), { recursive: true });
  fs.writeFileSync(
    path.join(target, '.swarmforge', 'roles.tsv'),
    `coder\tcoder\t${wt}\tswarmforge-coder\tCoder\tclaude\ttask\n`
  );

  const sentDir = path.join(handoffs, 'sent');
  const result = outboxNewestMtimeMs(target, 'coder');
  assert.equal(result, fs.statSync(sentDir).mtimeMs);
});
