'use strict';

// BL-1454: step handlers for "the coordinator activity-feed sweep fits
// inside the supervisor's budget". Drives the REAL coordinator-activity-feed-lib
// (swarmforge/scripts/coordinator_activity_feed_lib.bb) through
// bl1454ActivityFeedSweepCli.bb - never a reimplementation. The Telegram
// send seam itself is a stub inside that CLI's own JSON-driven fixture,
// never live Telegram, per the ticket's own constraint (Background).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const CLI = path.join(__dirname, 'lib', 'bl1454ActivityFeedSweepCli.bb');

const FEATURE = "BL-1454 The coordinator activity-feed sweep fits inside the supervisor's budget";

const scratchRoots = [];
process.on('exit', () => {
  for (const root of scratchRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function freshDaemonDir() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1454-daemon-'));
  scratchRoots.push(root);
  return root;
}

function ensureCtx(ctx) {
  ctx.daemonDir = ctx.daemonDir || freshDaemonDir();
  ctx.sentHandoffs = ctx.sentHandoffs || [];
  ctx.commits = ctx.commits || [];
  ctx.runs = ctx.runs || [];
  return ctx;
}

// A trace's formatted line, matching coordinator_activity_feed_lib.bb's own
// format-handoff-line exactly for the {type: note, to: coder, task} shape
// every fixture handoff in this file uses - so an assertion can check
// content, not just count, without re-deriving the lib's formatting rule.
function noteLine(task) {
  return `→ note → coder (${task})`;
}

function writeCursorFile(daemonDir, cursor) {
  fs.writeFileSync(path.join(daemonDir, 'coordinator-activity-feed-state.json'), JSON.stringify(cursor));
}

function runTick(ctx, overrides = {}) {
  const merged = { ...ctx, ...overrides };
  const input = JSON.stringify({
    'daemon-dir': ctx.daemonDir,
    'sent-handoffs': merged.sentHandoffs || [],
    commits: merged.commits || [],
    'post-cap': merged.postCap,
    'deadline-ms': merged.deadlineMs,
    'clock-advance-ms-per-post': merged.clockAdvanceMsPerPost,
    'fail-after-n-successes': merged.failAfterNSuccesses,
  });
  const result = spawnSync('bb', [CLI], { input, encoding: 'utf8', timeout: 20000, maxBuffer: 64 * 1024 * 1024 });
  assert.equal(result.status, 0, `expected the CLI to exit 0, got ${result.status}: ${result.stderr}`);
  const parsed = JSON.parse(result.stdout.trim().split('\n').pop());
  ctx.runs.push(parsed);
  return parsed;
}

// The IR-DRY-flagged pair (specifier, mint pass): "the activity-feed tick
// runs" / "runs twice" is one run-count parameter, bound by a single
// regex rather than two near-duplicate handlers.
function runTickNTimes(ctx, times) {
  for (let i = 0; i < times; i += 1) {
    runTick(ctx);
  }
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the feed's Telegram send, cursor store and clock are injected seams and no live Telegram is reached$/, (ctx) => {
    ensureCtx(ctx);
  });

  scoped(/^no cursor file exists$/, (ctx) => {
    ensureCtx(ctx);
  });

  scoped(/^the coordinator's sent mailbox holds 6463 handoffs and main holds 500 bookkeeping commits$/, (ctx) => {
    ensureCtx(ctx);
    for (let i = 0; i < 6463; i += 1) {
      const file = `00_${String(i).padStart(5, '0')}`;
      ctx.sentHandoffs.push({ file, header: { type: 'note', to: 'coder', task: file, message: null } });
    }
    for (let i = 0; i < 500; i += 1) {
      ctx.commits.push({ sha: `c${i}`, subject: `Close BL-${i}: move to done. By coordinator.` });
    }
    ctx.newestHandoffName = ctx.sentHandoffs[ctx.sentHandoffs.length - 1].file;
    ctx.newestCommitSha = ctx.commits[ctx.commits.length - 1].sha;
  });

  scoped(/^the cursor names a trace with 50 newer traces behind it$/, (ctx) => {
    ensureCtx(ctx);
    // names[0] is the trace the cursor already sits at; names[1..50] are
    // the 50 traces "newer" (behind it, in feed order). task === the bare
    // name, so a posted line's content proves WHICH trace it carried.
    const names = [];
    for (let i = 0; i <= 50; i += 1) {
      names.push(`00_${String(i).padStart(2, '0')}`);
    }
    ctx.names = names;
    ctx.sentHandoffs = names.map((file) => ({ file, header: { type: 'note', to: 'coder', task: file, message: null } }));
    writeCursorFile(ctx.daemonDir, { 'handoff-cursor': names[0], 'commit-cursor': null });
  });

  scoped(/^the per-tick post cap is (\d+)$/, (ctx, n) => {
    ensureCtx(ctx);
    ctx.postCap = Number(n);
  });

  scoped(/^the send seam succeeds three times and then interrupts the tick$/, (ctx) => {
    ensureCtx(ctx);
    ctx.failAfterNSuccesses = 3;
  });

  scoped(/^the clock advances 10 seconds per post$/, (ctx) => {
    ensureCtx(ctx);
    ctx.clockAdvanceMsPerPost = 10000;
  });

  scoped(/^the tick deadline is 30 seconds$/, (ctx) => {
    ensureCtx(ctx);
    ctx.deadlineMs = 30000;
  });

  // IR-DRY: one handler bound to both "the activity-feed tick runs" and
  // "the activity-feed tick runs twice".
  scoped(/^the activity-feed tick runs( twice)?$/, (ctx, twice) => {
    ensureCtx(ctx);
    runTickNTimes(ctx, twice ? 2 : 1);
  });

  scoped(/^no line is posted$/, (ctx) => {
    const last = ctx.runs[ctx.runs.length - 1];
    assert.deepEqual(last.posted, [], `expected nothing posted, got ${JSON.stringify(last.posted)}`);
  });

  scoped(/^the cursor file names the newest sent handoff and the newest bookkeeping commit$/, (ctx) => {
    const last = ctx.runs[ctx.runs.length - 1];
    assert.equal(last.result && last.result.seeded, true, 'expected the first tick to seed rather than post');
    assert.equal(last.cursor['handoff-cursor'], ctx.newestHandoffName, 'expected the handoff cursor to seed at the newest name');
    assert.equal(last.cursor['commit-cursor'], ctx.newestCommitSha, 'expected the commit cursor to seed at the newest sha');
  });

  scoped(/^a following tick after one new sent handoff posts exactly that one line$/, (ctx) => {
    const newFile = '01_zzzzz'; // sorts after every "00_....." name pushed above
    ctx.sentHandoffs.push({ file: newFile, header: { type: 'note', to: 'coder', task: newFile, message: null } });
    const result = runTick(ctx);
    assert.equal(result.posted.length, 1, `expected exactly one new line, got ${JSON.stringify(result.posted)}`);
    assert.equal(result.posted[0], noteLine(newFile));
  });

  scoped(/^the first tick posts exactly (\d+) lines, in trace order$/, (ctx, n) => {
    const first = ctx.runs[0];
    const expectedCount = Number(n);
    assert.equal(first.posted.length, expectedCount, `expected ${expectedCount} lines, got ${JSON.stringify(first.posted)}`);
    const expected = ctx.names.slice(1, 1 + expectedCount).map(noteLine);
    assert.deepEqual(first.posted, expected, 'expected the posted lines in ascending trace order starting right after the cursor');
  });

  // IR-DRY: one handler for both "...the Nth newer trace after the first
  // tick" (scenario 02, where a second tick already ran by the time this
  // assertion executes) and "...the Nth newer trace" alone (scenario 03,
  // where only one tick has run) - the ordinal is the run-count parameter.
  scoped(/^the cursor file names the (\d+)(?:st|nd|rd|th) newer trace( after the first tick)?$/, (ctx, n, afterFirst) => {
    const idx = Number(n);
    const run = afterFirst ? ctx.runs[0] : ctx.runs[ctx.runs.length - 1];
    assert.equal(run.cursor['handoff-cursor'], ctx.names[idx], `expected the cursor to name the ${idx}th newer trace`);
  });

  scoped(/^the second tick posts the next (\d+) traces and none is repeated$/, (ctx, n) => {
    const expectedCount = Number(n);
    const [first, second] = ctx.runs;
    assert.equal(second.posted.length, expectedCount, `expected ${expectedCount} lines in the second tick, got ${JSON.stringify(second.posted)}`);
    const overlap = second.posted.filter((line) => first.posted.includes(line));
    assert.deepEqual(overlap, [], 'expected no line repeated between the first and second tick');
    const expected = ctx.names.slice(1 + first.posted.length, 1 + first.posted.length + expectedCount).map(noteLine);
    assert.deepEqual(second.posted, expected, 'expected the second batch to continue in trace order');
  });

  scoped(/^the cursor store received a write after the first, the second and the third post$/, (ctx) => {
    const last = ctx.runs[ctx.runs.length - 1];
    assert.equal(last.writeCount, 3, `expected exactly 3 cursor writes (one per successful post), got ${last.writeCount}`);
  });

  scoped(/^a restarted tick posts the (\d+)(?:st|nd|rd|th) newer trace first$/, (ctx, n) => {
    const idx = Number(n);
    // A fresh CLI process per call is already a genuine "restart" - no
    // in-process state survives, only the persisted cursor file does.
    // fail-after-n-successes is explicitly cleared: this restarted tick's
    // send seam succeeds throughout, unlike the interrupted one before it.
    const result = runTick(ctx, { failAfterNSuccesses: undefined });
    assert.equal(result.posted[0], noteLine(ctx.names[idx]), `expected the ${idx}th newer trace to post first on restart`);
  });

  scoped(/^at most (\d+) lines are posted$/, (ctx, n) => {
    const last = ctx.runs[ctx.runs.length - 1];
    assert.ok(last.posted.length <= Number(n), `expected at most ${n} lines, got ${last.posted.length}`);
    assert.equal(last.result && last.result['deadline-reached'], true, 'expected the tick to have stopped because it hit its deadline');
  });

  scoped(/^the tick returns before the clock passes the deadline$/, (ctx) => {
    const last = ctx.runs[ctx.runs.length - 1];
    assert.ok(last.clockMs <= ctx.deadlineMs, `expected the simulated clock (${last.clockMs}ms) not to pass the deadline (${ctx.deadlineMs}ms)`);
  });

  scoped(/^the unposted traces are posted by later ticks in order$/, (ctx) => {
    const priorPostedCount = ctx.runs.reduce((sum, r) => sum + r.posted.length, 0);
    const result = runTick(ctx, { clockAdvanceMsPerPost: undefined, deadlineMs: undefined });
    assert.equal(result.posted[0], noteLine(ctx.names[1 + priorPostedCount]), 'expected the next tick to continue exactly where the deadline-stopped tick left off');
  });
}

module.exports = { registerSteps };
