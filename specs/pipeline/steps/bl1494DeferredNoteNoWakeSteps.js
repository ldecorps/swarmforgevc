'use strict';

// BL-1494: a note carrying wake: defer costs its role no wake, on any path
// (delivery hop, chase sweep, or the send itself) - and the field is
// note-only. Drives the REAL scripts under swarmforge/scripts/test/ (bash
// e2e fixtures with a fake tmux binary that logs injections instead of
// performing them, and a bb unit runner for the post-QA sweep's tell!) -
// no fake adapters standing in for the send/delivery/chase decision itself.

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE = 'BL-1494 a note sent as deferred costs its role no wake';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const DELIVERY_SCRIPT = path.join('swarmforge', 'scripts', 'test', 'test_bl1494_deferred_note_no_wake.sh');
const CHASE_SCRIPT = path.join('swarmforge', 'scripts', 'test', 'test_chase_sweep.sh');
const SWEEP_TELL_RUNNER = path.join('swarmforge', 'scripts', 'test', 'bl1494_post_qa_sweep_wake_field_test_runner.bb');

// Module scope, not per-ctx: the runtime gives each scenario its own ctx, so
// a per-ctx memo would re-run each e2e once per scenario/example row
// (BL-1390's storm multiplier - see bl1361SweepTellsSurfacedRolesSteps.js).
const runs = {};

function runOnce(key, cmd, args) {
  if (runs[key]) return runs[key].out;
  const res = spawnSync(cmd, args, { cwd: REPO_ROOT, encoding: 'utf8', timeout: 1800000 });
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  runs[key] = { out, status: res.status };
  return out;
}

function runDelivery() {
  return runOnce('delivery', 'bash', [DELIVERY_SCRIPT]);
}

function runChase() {
  return runOnce('chase', 'bash', [CHASE_SCRIPT]);
}

function runSweepTell() {
  return runOnce('sweep-tell', 'bb', [SWEEP_TELL_RUNNER]);
}

function requireLine(out, needle, label) {
  assert.ok(out.includes(needle), `${label} - expected to find:\n  ${needle}\nin:\n${out}`);
}

// Scenario 04's <reason> column uses hyphenated words; the bb runner names
// its examples the same way via (name reason) on the :divergent-branch /
// :in-process-work / :dirty-worktree keywords.
const KNOWN_REASONS = new Set(['divergent-branch', 'in-process-work', 'dirty-worktree']);

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ────────────────────────────────────────────────────────
  scoped(/^a fixture swarm whose tmux injections are counted, not performed$/, (ctx) => {
    ctx.bl1494 = ctx.bl1494 || {};
  });

  // ── Given ─────────────────────────────────────────────────────────────
  scoped(/^a note to "([^"]+)" with wake field "(defer|absent)" in the coordinator's outbox$/,
    (ctx, to, wakeField) => {
      ctx.bl1494 = { kind: 'delivery', to, wakeField };
    });

  scoped(/^cleaner's inbox\/new holds only a deferred note older than the chase threshold$/, (ctx) => {
    ctx.bl1494 = { kind: 'chase' };
  });

  scoped(/^the post-QA branch sweep surfaces "([^"]+)" for "([^"]+)"$/, (ctx, role, reason) => {
    assert.ok(KNOWN_REASONS.has(reason), `unknown <reason> example: ${reason}`);
    ctx.bl1494 = { kind: 'sweep-tell', role, reason };
  });

  scoped(/^a git_handoff draft carrying "wake: defer"$/, (ctx) => {
    ctx.bl1494 = { kind: 'validate' };
  });

  // ── When ──────────────────────────────────────────────────────────────
  scoped(/^the daemon delivers the outbox$/, (ctx) => {
    ctx.bl1494.out = runDelivery();
  });

  scoped(/^the chase sweep runs$/, (ctx) => {
    ctx.bl1494.out = runChase();
  });

  scoped(/^the sweep tells the role$/, (ctx) => {
    ctx.bl1494.out = runSweepTell();
  });

  scoped(/^swarm_handoff\.sh validates the draft$/, (ctx) => {
    // Scenario 05's own check lives in the same delivery script (it is the
    // script under test for the whole "note-only" contract, not a separate
    // fixture).
    ctx.bl1494.out = runDelivery();
  });

  // ── Then ──────────────────────────────────────────────────────────────
  scoped(/^the note is in cleaner's inbox\/new$/, (ctx) => {
    requireLine(ctx.bl1494.out,
      'PASS: 01: delivering a deferred note lands it in the inbox and injects nothing',
      'the deferred note did not land in the inbox');
  });

  scoped(/^the daemon log names that delivery "([^"]+)"$/, (ctx, tag) => {
    assert.equal(tag, 'deliver-notify-skip-deferred', `unknown log tag claim: ${tag}`);
    requireLine(ctx.bl1494.out,
      'PASS: 01: delivering a deferred note lands it in the inbox and injects nothing',
      `the daemon log did not name the delivery "${tag}"`);
  });

  scoped(/^zero injections were performed$/, (ctx) => {
    if (ctx.bl1494.kind === 'chase') {
      requireLine(ctx.bl1494.out,
        'PASS: 17 (BL-1494): a deferred note past the chase threshold is held, not chased - zero injections',
        'the chase sweep injected for a deferred note');
    } else {
      requireLine(ctx.bl1494.out,
        'PASS: 01: delivering a deferred note lands it in the inbox and injects nothing',
        'the delivery hop injected for a deferred note');
    }
  });

  scoped(/^one injection was performed$/, (ctx) => {
    requireLine(ctx.bl1494.out,
      'PASS: 02: an ordinary note still wakes its role',
      'an ordinary note did not wake its role exactly once');
  });

  scoped(/^the wake field of the note it sends is "(defer|absent)"$/, (ctx, expectedWake) => {
    requireLine(ctx.bl1494.out,
      `PASS: 04 (${ctx.bl1494.reason}): the wake field of the note it sends is "${expectedWake}"`,
      `the sweep's tell for reason "${ctx.bl1494.reason}" did not carry wake="${expectedWake}"`);
  });

  scoped(/^the draft is refused as an unknown header naming "([^"]+)"$/, (ctx, field) => {
    assert.equal(field, 'wake', `unknown refused-header claim: ${field}`);
    requireLine(ctx.bl1494.out,
      'PASS: 05: the field is note-only - a git_handoff draft carrying wake: defer is refused as an unknown header',
      `the draft was not refused for header "${field}"`);
  });
}

module.exports = { registerSteps };
