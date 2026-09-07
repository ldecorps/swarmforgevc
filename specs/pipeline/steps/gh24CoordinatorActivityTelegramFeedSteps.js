'use strict';

// GH-24: step handlers for "coordinator activity is surfaced as compact
// lines on its Telegram topic". Drives the REAL coordinator-activity-feed-lib
// (swarmforge/scripts/coordinator_activity_feed_lib.bb) through
// gh24CoordinatorActivityFeedCli.bb - never a reimplementation. The Telegram
// send seam itself is a stub inside that CLI's own JSON-driven fixture
// (fail-first-n), never live Telegram, per the ticket's own constraint.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const CLI = path.join(__dirname, 'lib', 'gh24CoordinatorActivityFeedCli.bb');

const FEATURE = 'coordinator activity is surfaced as compact lines on its Telegram topic';

// BL-1454: a first tick with NO persisted cursor now seeds (posts nothing
// historical) rather than treating an absent cursor as "everything is
// new" - that was the unbounded-walk defect this ticket fixed. GH-24's own
// Background wants the OPPOSITE fixture shape ("every scenario's traces
// are new"), so it now persists an EXPLICIT cursor positioned before every
// trace either kind of step can push, rather than leaving the cursor file
// absent. SEED_HANDOFF_CURSOR's sort-key (handoff-sort-key drops the fixed
// 3-char priority prefix) is the empty string, which sorts before every
// "00_..." name any step in this file pushes. SEED_COMMIT_SHA is injected
// as ctx.commits[0] itself (new-commits walks the commits array by exact
// sha match, not lexical order), so it must be a real, listed entry.
const SEED_HANDOFF_CURSOR = '000';
const SEED_COMMIT_SHA = 'seed0';

function writeCursorFile(daemonDir, cursor) {
  fs.writeFileSync(path.join(daemonDir, 'coordinator-activity-feed-state.json'), JSON.stringify(cursor));
}

const scratchRoots = [];
process.on('exit', () => {
  for (const root of scratchRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function freshDaemonDir() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gh24-daemon-'));
  scratchRoots.push(root);
  return root;
}

function runTick(daemonDir, { sentHandoffs = [], commits = [], failFirstN = 0 } = {}) {
  const input = JSON.stringify({
    'daemon-dir': daemonDir,
    'sent-handoffs': sentHandoffs,
    commits,
    'fail-first-n': failFirstN,
  });
  const result = spawnSync('bb', [CLI], { input, encoding: 'utf8', timeout: 20000 });
  assert.equal(result.status, 0, `expected the CLI to exit 0, got ${result.status}: ${result.stderr}`);
  return JSON.parse(result.stdout.trim().split('\n').pop());
}

function ensureCtx(ctx) {
  ctx.daemonDir = ctx.daemonDir || freshDaemonDir();
  ctx.sentHandoffs = ctx.sentHandoffs || [];
  ctx.commits = ctx.commits || [];
  return ctx;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the Telegram send seam is a stub capturing posted messages$/, (ctx) => {
    ensureCtx(ctx);
  });

  scoped(/^the surfacer's durable cursor starts at the beginning of the traces$/, (ctx) => {
    ensureCtx(ctx);
    ctx.commits.push({ sha: SEED_COMMIT_SHA, subject: 'seed' });
    writeCursorFile(ctx.daemonDir, { 'handoff-cursor': SEED_HANDOFF_CURSOR, 'commit-cursor': SEED_COMMIT_SHA });
  });

  scoped(/^the coordinator outbox holds a note to "([^"]+)" for task "([^"]+)" newer than the cursor$/, (ctx, to, task) => {
    ensureCtx(ctx);
    ctx.sentHandoffs.push({ file: '00_a', header: { type: 'note', to, task, message: null } });
  });

  scoped(/^main holds a coordinator bookkeeping commit closing "([^"]+)" newer than the cursor$/, (ctx, ticket) => {
    ensureCtx(ctx);
    ctx.commits.push({ sha: 'c1', subject: `Close ${ticket}: move to done. By coordinator.` });
  });

  scoped(/^no coordinator trace is newer than the cursor$/, (ctx) => {
    ensureCtx(ctx);
  });

  scoped(/^a trace was surfaced on a previous tick and the cursor was persisted$/, (ctx) => {
    ensureCtx(ctx);
    ctx.sentHandoffs.push({ file: '00_a', header: { type: 'note', to: 'coder', task: 'BL-1', message: null } });
    ctx.firstTick = runTick(ctx.daemonDir, { sentHandoffs: ctx.sentHandoffs, commits: ctx.commits });
    assert.equal(ctx.firstTick.posted.length, 1, 'expected the setup tick to post the trace once');
  });

  scoped(/^the Telegram send seam fails on the first attempt for a new trace$/, (ctx) => {
    ensureCtx(ctx);
    ctx.sentHandoffs.push({ file: '00_a', header: { type: 'note', to: 'coder', task: 'BL-1', message: null } });
  });

  scoped(/^the surfacer tick runs$/, (ctx) => {
    ctx.tickResult = runTick(ctx.daemonDir, { sentHandoffs: ctx.sentHandoffs, commits: ctx.commits });
  });

  scoped(/^the surfacer restarts and the next tick runs$/, (ctx) => {
    // A fresh bb process per invocation is already a genuine "restart" -
    // no in-process state survives between runTick calls, only the cursor
    // file on disk does.
    ctx.tickResult = runTick(ctx.daemonDir, { sentHandoffs: ctx.sentHandoffs, commits: ctx.commits });
  });

  scoped(/^the surfacer tick runs twice$/, (ctx) => {
    ctx.firstRun = runTick(ctx.daemonDir, { sentHandoffs: ctx.sentHandoffs, commits: ctx.commits, failFirstN: 1 });
    ctx.secondRun = runTick(ctx.daemonDir, { sentHandoffs: ctx.sentHandoffs, commits: ctx.commits, failFirstN: 0 });
  });

  scoped(/^exactly one line is posted to the coordinator topic naming the type, recipient, and task$/, (ctx) => {
    assert.equal(ctx.tickResult.posted.length, 1, `expected exactly one line, got ${JSON.stringify(ctx.tickResult.posted)}`);
    const [line] = ctx.tickResult.posted;
    assert.match(line, /note/);
    assert.match(line, /coder/);
    assert.match(line, /BL-563/);
  });

  scoped(/^exactly one line is posted to the coordinator topic naming the bookkeeping action and ticket$/, (ctx) => {
    assert.equal(ctx.tickResult.posted.length, 1, `expected exactly one line, got ${JSON.stringify(ctx.tickResult.posted)}`);
    const [line] = ctx.tickResult.posted;
    assert.match(line, /closed/);
    assert.match(line, /BL-608/);
  });

  scoped(/^nothing is posted to the coordinator topic$/, (ctx) => {
    assert.deepEqual(ctx.tickResult.posted, []);
  });

  scoped(/^that trace is not posted again$/, (ctx) => {
    assert.deepEqual(ctx.tickResult.posted, [], `expected nothing re-posted, got ${JSON.stringify(ctx.tickResult.posted)}`);
  });

  scoped(/^the trace is posted exactly once$/, (ctx) => {
    const totalPosted = ctx.firstRun.posted.length + ctx.secondRun.posted.length;
    assert.equal(totalPosted, 1, `expected exactly one post across both ticks, got ${totalPosted}`);
    assert.deepEqual(ctx.firstRun.posted, [], 'expected the first (failing) tick to post nothing');
    assert.equal(ctx.secondRun.posted.length, 1, 'expected the second (retried) tick to post the trace');
  });

  scoped(/^the cursor only advances past the trace after the successful send$/, (ctx) => {
    // BL-1454: the Background now seeds an explicit starting cursor (rather
    // than leaving the cursor file absent), so "did not advance" means
    // "unchanged from that starting cursor" - not null.
    assert.equal(ctx.firstRun.cursor['handoff-cursor'], SEED_HANDOFF_CURSOR, 'expected the cursor NOT to advance after the failed send');
    assert.equal(ctx.secondRun.cursor['handoff-cursor'], '00_a', 'expected the cursor to advance after the successful retry');
  });
}

module.exports = { registerSteps };
