'use strict';

// BL-1541: step handlers for "Five bb property runners answer the self-audit
// challenge before asserting the queue". Drives each REAL runner via `bb` -
// no reimplementation of its property assertions here - and derives the
// git_handoff-drafting population by grepping the real test dir, the same
// two-grep census the ticket's own evidence file used
// (backlog/evidence/BL-1538-BL-1541-specifier-unowned-red-census-20260911.md
// §4): bb files under swarmforge/scripts/test mentioning swarm_handoff.bb,
// narrowed to those that also draft a git_handoff.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const TEST_DIR_REL = 'swarmforge/scripts/test';
const TEST_DIR_ABS = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test');

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

  // ── Scenario 01: each runner is green on main ───────────────────────────
  scoped(/^the standing suite runs "([^"]+)"$/, (ctx, relPath) => {
    requireKnownRunner(relPath);
    const runnerPath = path.join(REPO_ROOT, relPath);
    assert.ok(fs.existsSync(runnerPath), `runner not found on disk: ${runnerPath}`);
    ctx.runnerResult = spawnSync('bb', [runnerPath], { encoding: 'utf8', cwd: REPO_ROOT });
  });

  scoped(/^the run exits zero and reports no failed property check$/, (ctx) => {
    const out = `${ctx.runnerResult.stdout}${ctx.runnerResult.stderr}`;
    assert.equal(ctx.runnerResult.status, 0, `expected exit 0, got:\n${out}`);
    assert.ok(!/fail/i.test(out), `expected no failed property check, got:\n${out}`);
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
}

module.exports = { registerSteps };
