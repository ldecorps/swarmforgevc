'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStepRegistry } = require('../../stepRegistry');
const { registerSteps } = require('../../steps/remoteWakeupSteps');

// BL-092 hardening: matching the established convention (see
// daemonWorkflowSteps.test.js/launchSpawnFailureSteps.test.js/
// mailboxIntakeSteps.test.js/strykerPwaSandboxSteps.test.js/
// dispatchGapSteps.test.js/backlogDepthSteps.test.js) - the 4/4 Gherkin
// scenario run only exercises the happy path, so a regression in an
// assertion step's own failure branch would pass the feature run and go
// unnoticed.

function freshRegistry() {
  const registry = createStepRegistry();
  registerSteps(registry);
  return registry;
}

function resolveAndRun(registry, ctx, stepText) {
  const resolved = registry.resolve(stepText);
  if (!resolved) {
    throw new Error(`no step handler matched "${stepText}"`);
  }
  return resolved.handler(ctx, ...resolved.args);
}

function mkGitRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-remote-wakeup-guard-'));
  const { execFileSync } = require('node:child_process');
  execFileSync('git', ['-C', root, 'init', '-q']);
  execFileSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init']);
  return root;
}

// ── the second swarm runs under WSL2... (wiring-contract guard) ─────────

test('the WSL2/self-hosted-runner background step passes against the real workflow YAML', () => {
  const registry = freshRegistry();
  assert.doesNotThrow(() => resolveAndRun(registry, {}, 'the second swarm runs under WSL2 with a registered self-hosted runner (BL-091 merged)'));
});

// ── the remote checkout contains the assignment commit ──────────────────

test('the remote checkout contains the assignment commit fails loudly when the checkout is stale', () => {
  const registry = freshRegistry();
  const upstream = mkGitRepo();
  const { execFileSync } = require('node:child_process');
  const remoteCheckout = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-remote-wakeup-guard-clone-'));
  execFileSync('git', ['clone', '-q', upstream, remoteCheckout]);
  execFileSync('git', ['-C', upstream, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'a new commit never synced']);
  const ctx = { upstream, remoteCheckout };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'the remote checkout contains the assignment commit'),
    /expected the remote checkout to be synced/
  );
});

// ── the remote specifier pane received a wake-up nudge ──────────────────

test('the remote specifier pane received a wake-up nudge fails loudly when tmux was never called', () => {
  const registry = freshRegistry();
  const ctx = { tmuxCallLog: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aps-remote-wakeup-guard-')), 'tmux-calls.log') };
  fs.writeFileSync(ctx.tmuxCallLog, '');
  assert.throws(
    () => resolveAndRun(registry, ctx, 'the remote specifier pane received a wake-up nudge'),
    /expected a tmux call targeting the specifier's session/
  );
});

// ── no wake-up is delivered to the remote specifier ──────────────────────

test('no wake-up is delivered to the remote specifier fails loudly when tmux was called anyway', () => {
  const registry = freshRegistry();
  const ctx = { tmuxCallLog: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aps-remote-wakeup-guard-')), 'tmux-calls.log') };
  fs.writeFileSync(ctx.tmuxCallLog, '-S /tmp/fake.sock send-keys -t swarmforge-second-specifier\n');
  assert.throws(
    () => resolveAndRun(registry, ctx, 'no wake-up is delivered to the remote specifier'),
    /expected no tmux wake-up call at all/
  );
});

// ── ready_for_next.sh reports no new work and nothing is disturbed ──────

test('ready_for_next.sh reports no new work fails loudly when the duplicate nudge did not complete', () => {
  const registry = freshRegistry();
  const ctx = { remoteCheckout: mkGitRepo(), nudgeOutput: 'NO_NUDGE: no changed backlog item assigned to swarm "second"' };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'ready_for_next.sh reports no new work and nothing is disturbed'),
    /expected the duplicate nudge to still complete harmlessly/
  );
});

test('ready_for_next.sh reports no new work fails loudly when the nudge itself queued new mail', () => {
  const registry = freshRegistry();
  const remoteCheckout = mkGitRepo();
  const newDir = path.join(remoteCheckout, '.swarmforge', 'handoffs', 'inbox', 'new');
  fs.mkdirSync(newDir, { recursive: true });
  fs.writeFileSync(path.join(newDir, '00_unexpected.handoff'), 'type: note\n\nbody\n');
  const ctx = { remoteCheckout, nudgeOutput: 'NUDGED: specifier woken for swarm "second"' };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'ready_for_next.sh reports no new work and nothing is disturbed'),
    /expected no new queued mail from the nudge itself/
  );
});

// ── the fallback periodic pull picks it up within its timer interval ───

test('the fallback periodic pull step fails loudly when the bridge-unavailable precondition was skipped', () => {
  const registry = freshRegistry();
  const ctx = { upstream: mkGitRepo() };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'the fallback periodic pull picks it up within its timer interval'),
    /expected the bridge-unavailable precondition/
  );
});
