'use strict';

// BL-1541: step handlers for "Five bb property runners answer the self-audit
// challenge before asserting the queue". Scenario 02 derives the
// git_handoff-drafting population by grepping the real test dir, the same
// two-grep census the ticket's own evidence file used
// (backlog/evidence/BL-1538-BL-1541-specifier-unowned-red-census-20260911.md
// §4): bb files under swarmforge/scripts/test mentioning swarm_handoff.bb,
// narrowed to those that also draft a git_handoff. Scenario 03 drives the
// REAL send-through-audit! via a harness (bl1541_send_through_audit_contract_harness.bb)
// against a fake two-call thunk, no reimplementation of the helper's own
// logic here. Amended 2026-09-14: the former scenario 01 (each real runner
// green on main, shelled per mutant) is retired - it could not fit the
// BL-1358 per-mutant ceiling; its claim moved to QA's e2e procedure and the
// standing-red register discharge, never reworded into this file.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const TEST_DIR_REL = 'swarmforge/scripts/test';
const TEST_DIR_ABS = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test');
const HARNESS_ABS = path.join(TEST_DIR_ABS, 'bl1541_send_through_audit_contract_harness.bb');

const FEATURE = 'BL-1541 Five bb property runners answer the self-audit challenge before asserting the queue';

// Scenario Outline values are validated against an explicit whitelist - never
// a passthrough.
const KNOWN_RUNNERS = [
  'swarmforge/scripts/test/bl983_stage_queue_property_runner.bb',
  'swarmforge/scripts/test/bl982_multi_seat_identity_property_runner.bb',
  'swarmforge/scripts/test/bl992_declaration_ref_lookup_property_runner.bb',
  'swarmforge/scripts/test/bl991_binding_stages_property_runner.bb',
  'swarmforge/scripts/test/bl951_stage_skip_recording_property_runner.bb',
];

// Scenario 03: the second call's report and the parcel count it implies -
// the whole population this shared helper's contract is exercised over.
const KNOWN_SECOND_REPORTS = {
  'queued one parcel': 1,
  HANDOFF_NOT_QUEUED: 0,
};

function requireKnownRunner(relPath) {
  if (!KNOWN_RUNNERS.includes(relPath)) {
    throw new Error(`unknown <runner>: "${relPath}" - known: ${KNOWN_RUNNERS.join(' | ')}`);
  }
  return relPath;
}

function deriveGitHandoffRunners(testDirAbs) {
  return fs
    .readdirSync(testDirAbs)
    .filter((f) => f.endsWith('.bb'))
    .filter((f) => {
      const content = fs.readFileSync(path.join(testDirAbs, f), 'utf8');
      return content.includes('swarm_handoff.bb') && content.includes('git_handoff');
    })
    .sort();
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background: the shared helper exists ────────────────────────────────
  scoped(/^the shared test helper "([^"]+)"$/, (ctx, relPath) => {
    assert.equal(
      relPath,
      'swarmforge/scripts/test/lib/send_through_audit.bb',
      `unknown shared helper path: "${relPath}"`
    );
    assert.ok(fs.existsSync(path.join(REPO_ROOT, relPath)), `shared helper not found on disk: ${relPath}`);
  });

  // ── Scenario 02: the population is pinned, absence cannot pass ─────────
  scoped(
    /^the bb runners under "([^"]+)" that draft a git_handoff and invoke swarm_handoff\.bb are derived$/,
    (ctx, dirRel) => {
      assert.equal(dirRel, TEST_DIR_REL, `unknown <dir>: "${dirRel}" - known: ${TEST_DIR_REL}`);
      ctx.derived = deriveGitHandoffRunners(TEST_DIR_ABS).map((f) => `${dirRel}/${f}`);
    }
  );

  scoped(/^the derived set contains "([^"]+)"$/, (ctx, relPath) => {
    requireKnownRunner(relPath);
    assert.ok(
      ctx.derived.includes(relPath),
      `expected "${relPath}" in the derived set (${ctx.derived.length} entries), got:\n${ctx.derived.join('\n')}`
    );
  });

  // ── Scenario 03: the helper's own contract, isolated from a real send ──
  scoped(/^a send thunk whose first call answers "AUDIT_REQUIRED" and queues nothing$/, () => {
    // Fixed shape of the harness's own fake thunk; nothing to arrange here -
    // asserted below once the harness has actually run (CALLS=/QUEUED=).
  });

  scoped(/^the identical second call reports "([^"]+)"$/, (ctx, second) => {
    if (!Object.prototype.hasOwnProperty.call(KNOWN_SECOND_REPORTS, second)) {
      throw new Error(`unknown <second>: "${second}" - known: ${Object.keys(KNOWN_SECOND_REPORTS).join(' | ')}`);
    }
    ctx.secondReport = second;
  });

  scoped(/^a runner sends through the helper$/, (ctx) => {
    const queuedCount = KNOWN_SECOND_REPORTS[ctx.secondReport];
    ctx.harnessResult = spawnSync('bb', [HARNESS_ABS, ctx.secondReport, String(queuedCount)], {
      encoding: 'utf8',
      cwd: REPO_ROOT,
    });
    const out = `${ctx.harnessResult.stdout}${ctx.harnessResult.stderr}`;
    assert.equal(ctx.harnessResult.status, 0, `harness exited non-zero:\n${out}`);
  });

  scoped(/^the helper returns "([^"]+)"$/, (ctx, expected) => {
    if (!Object.prototype.hasOwnProperty.call(KNOWN_SECOND_REPORTS, expected)) {
      throw new Error(`unknown <second>: "${expected}" - known: ${Object.keys(KNOWN_SECOND_REPORTS).join(' | ')}`);
    }
    const m = ctx.harnessResult.stdout.match(/^RESULT=(.*)$/m);
    assert.ok(m, `no RESULT= line in harness output:\n${ctx.harnessResult.stdout}`);
    assert.equal(m[1], expected, `expected the helper to return only the second call's result "${expected}", got "${m[1]}"`);
  });

  scoped(/^the thunk was called exactly twice$/, (ctx) => {
    const m = ctx.harnessResult.stdout.match(/^CALLS=(\d+)$/m);
    assert.ok(m, `no CALLS= line in harness output:\n${ctx.harnessResult.stdout}`);
    assert.equal(Number(m[1]), 2, `expected the thunk to be called exactly twice, got ${m[1]}`);
  });

  scoped(/^the queue holds (\d+) parcels$/, (ctx, queuedStr) => {
    const queued = Number(queuedStr);
    const expected = KNOWN_SECOND_REPORTS[ctx.secondReport];
    assert.equal(
      queued,
      expected,
      `<queued> (${queued}) disagrees with the known parcel count for "${ctx.secondReport}" (${expected})`
    );
    const m = ctx.harnessResult.stdout.match(/^QUEUED=(\d+)$/m);
    assert.ok(m, `no QUEUED= line in harness output:\n${ctx.harnessResult.stdout}`);
    assert.equal(Number(m[1]), queued, `expected the queue to hold ${queued} parcels, got ${m[1]}`);
  });
}

module.exports = { registerSteps };
