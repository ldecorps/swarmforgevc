'use strict';

// BL-276: step handlers for "Operator thread lifecycle - status, no
// self-close, human-confirm close, optional idle nudge". Drives the REAL
// support_lib.bb (via idle_nudge_acceptance_runner.bb, real fs, mirroring
// telegram_reply_context_acceptance_runner.bb's own pattern) and the REAL
// support_thread.bb CLI (resolve/followup) - no real network, no real
// timers (now-ms is always computed as a delta from a fixture's own
// persisted timestamp, never an independent real-clock read).
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SUPPORT_THREAD_CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'support_thread.bb');
const IDLE_NUDGE_RUNNER = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'idle_nudge_acceptance_runner.bb');

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const FIXED_OPEN_TIMESTAMP = '2026-07-10T09:00:00Z';
const FIXED_OPEN_MS = Date.parse(FIXED_OPEN_TIMESTAMP);

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aps-operator-lifecycle-'));
}

function openThread(root, text, timestamp) {
  const dir = path.join(root, '.swarmforge', 'support', 'threads');
  fs.mkdirSync(dir, { recursive: true });
  const thread = { id: 'SUP-1', status: 'open', messages: [{ channel: 'telegram', timestamp, text }] };
  fs.writeFileSync(path.join(dir, 'SUP-1.json'), JSON.stringify(thread));
  return thread;
}

function readThread(root) {
  return JSON.parse(fs.readFileSync(path.join(root, '.swarmforge', 'support', 'threads', 'SUP-1.json'), 'utf8'));
}

function idleNudgeDecision(root, threadId, nowMs) {
  const out = execFileSync('bb', [IDLE_NUDGE_RUNNER, root, threadId, String(nowMs)], { encoding: 'utf8' });
  return JSON.parse(out).decision;
}

function followup(root, threadId, channel, text) {
  execFileSync('bb', [SUPPORT_THREAD_CLI, root, 'followup', '--thread', threadId, '--channel', channel, '--text', text], {
    encoding: 'utf8',
  });
}

function resolve(root, threadId) {
  const out = execFileSync('bb', [SUPPORT_THREAD_CLI, root, 'resolve', '--thread', threadId], { encoding: 'utf8' });
  return JSON.parse(out);
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^an open Operator subject thread and its idle clock evaluated at a fixed injected time$/, (ctx) => {
    ctx.root = mkTmp();
    ctx.thread = openThread(ctx.root, 'my PR is stuck', FIXED_OPEN_TIMESTAMP);
  });

  // ── thread-lifecycle-01 ──────────────────────────────────────────────
  registry.define(/^the human has not asked to close the thread and has been silent for many days$/, (ctx) => {
    ctx.nowMs = FIXED_OPEN_MS + 90 * ONE_DAY_MS;
  });

  registry.define(/^the idle clock ticks$/, (ctx) => {
    ctx.decision = idleNudgeDecision(ctx.root, ctx.thread.id, ctx.nowMs);
  });

  registry.define(/^the Operator does not close the thread$/, (ctx) => {
    if (ctx.decision === 'close' || ctx.decision === 'closed' || ctx.decision === 'resolved') {
      throw new Error(`expected the idle decision to never close the thread, got: ${ctx.decision}`);
    }
    const thread = readThread(ctx.root);
    if (thread.status !== 'open') {
      throw new Error(`expected the thread to remain open, got status: ${thread.status}`);
    }
  });

  // ── thread-lifecycle-02 ──────────────────────────────────────────────
  registry.define(/^the human confirms the subject is resolved$/, () => {
    // The Background already opened the thread; nothing extra to stage -
    // "confirms" is the When step's own action below.
  });

  registry.define(/^the Operator handles the confirmation$/, (ctx) => {
    ctx.resolvedThread = resolve(ctx.root, ctx.thread.id);
  });

  registry.define(/^the thread is closed as resolved$/, (ctx) => {
    if (ctx.resolvedThread.status !== 'resolved') {
      throw new Error(`expected the thread status to be "resolved", got: ${ctx.resolvedThread.status}`);
    }
    const onDisk = readThread(ctx.root);
    if (onDisk.status !== 'resolved') {
      throw new Error(`expected the persisted thread to be resolved too, got: ${onDisk.status}`);
    }
  });

  // ── thread-lifecycle-03 ──────────────────────────────────────────────
  registry.define(/^the human has not participated for a day$/, (ctx) => {
    ctx.nowMs = FIXED_OPEN_MS + ONE_DAY_MS;
  });

  registry.define(/^a nudge is posted into the thread's topic$/, (ctx) => {
    if (ctx.decision !== 'post-nudge') {
      throw new Error(`expected the idle decision to be post-nudge, got: ${ctx.decision}`);
    }
  });

  // ── thread-lifecycle-04 ──────────────────────────────────────────────
  registry.define(/^a nudge has already been posted$/, (ctx) => {
    // Records it with the SAME channel ("operator") the real idle-nudge
    // sweep persists (support-lib/operator-channel) - proving the
    // decision logic reads that field, not the caller's intent.
    followup(ctx.root, ctx.thread.id, 'operator', 'Just checking in - still here whenever you\'re ready to continue.');
    const thread = readThread(ctx.root);
    ctx.nudgeMs = Date.parse(thread.messages[thread.messages.length - 1].timestamp);
  });

  registry.define(/^the human replies in the topic$/, (ctx) => {
    followup(ctx.root, ctx.thread.id, 'telegram', 'still there, thanks for checking');
    const thread = readThread(ctx.root);
    ctx.replyMs = Date.parse(thread.messages[thread.messages.length - 1].timestamp);
  });

  registry.define(/^the idle clock resets from that reply$/, (ctx) => {
    const tooSoon = idleNudgeDecision(ctx.root, ctx.thread.id, ctx.replyMs + 1000);
    if (tooSoon !== 'none') {
      throw new Error(`expected no immediate second nudge right after the reply, got: ${tooSoon}`);
    }
    const aDayAfterTheReply = idleNudgeDecision(ctx.root, ctx.thread.id, ctx.replyMs + ONE_DAY_MS);
    if (aDayAfterTheReply !== 'post-nudge') {
      throw new Error(`expected the idle clock to count from the REPLY (due again a day after it), got: ${aDayAfterTheReply}`);
    }
  });
}

module.exports = { registerSteps };
