'use strict';

// BL-1613: step handlers for "The branch-claim guard test's fixture is a
// complete swarm root". Scenario 01 is a static read of the REAL script's
// own source (the defect is a missing fixture line, not runtime
// behavior a reimplementation could stand in for); scenario 02 runs the
// REAL shell test end to end; scenario 03 scans the REAL swarmforge/
// scripts/test/ tree, the same "drive the real thing" convention every
// sibling handler in this directory uses.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FEATURE = "BL-1613 The branch-claim guard test's fixture is a complete swarm root";

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPT_REL_PATH = 'swarmforge/scripts/test/test_branch_claim_guard.sh';
const TEST_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test');

function ensure(ctx) {
  if (!ctx.bl1613) ctx.bl1613 = {};
  return ctx.bl1613;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── 01: the fixture's own source ─────────────────────────────────────────
  scoped(/^the source of swarmforge\/scripts\/test\/test_branch_claim_guard\.sh is read$/, (ctx) => {
    const state = ensure(ctx);
    state.source = fs.readFileSync(path.join(REPO_ROOT, SCRIPT_REL_PATH), 'utf8');
  });

  scoped(/^the fixture writes a swarm-identity carrying active_backlog_max_depth_conf_path$/, (ctx) => {
    const state = ensure(ctx);
    const m = state.source.match(/active_backlog_max_depth_conf_path\\t([\w./-]+)/);
    assert.ok(m, 'expected the swarm-identity printf to carry active_backlog_max_depth_conf_path');
    state.confRelPath = m[1];
  });

  scoped(/^the fixture creates the tracked conf that path names before any claim runs$/, (ctx) => {
    const state = ensure(ctx);
    const source = state.source;
    const confRelPath = state.confRelPath;
    const creationIdx = source.indexOf(`$ROOT/${confRelPath}`);
    assert.notEqual(creationIdx, -1, `expected the fixture to create $ROOT/${confRelPath} somewhere in its source`);
    // The first CALL to run_ready (a bare invocation on its own line), never
    // its function DEFINITION (`run_ready() {`, which appears earlier and
    // would falsely satisfy an "index of the substring run_ready" check).
    const firstCallMatch = source.match(/^run_ready$/m);
    assert.ok(firstCallMatch, 'expected at least one bare run_ready invocation');
    assert.ok(
      creationIdx < firstCallMatch.index,
      `expected the conf to be created (index ${creationIdx}) before the first claim runs (index ${firstCallMatch.index})`
    );
  });

  // ── 02: the real shell test, executed end to end ─────────────────────────
  scoped(/^the branch-claim guard shell test is executed from the repository root$/, (ctx) => {
    const state = ensure(ctx);
    try {
      const out = execFileSync('bash', [SCRIPT_REL_PATH], { cwd: REPO_ROOT, encoding: 'utf8' });
      state.result = { status: 0, output: out };
    } catch (err) {
      state.result = { status: err.status ?? 1, output: `${err.stdout || ''}${err.stderr || ''}` };
    }
  });

  scoped(/^it exits 0 with every case reported as PASS$/, (ctx) => {
    const state = ensure(ctx);
    assert.equal(state.result.status, 0, `expected exit 0, got: ${state.result.output}`);
    const lines = state.result.output.split('\n').filter((l) => l.trim().length > 0);
    const caseLines = lines.filter((l) => l.startsWith('PASS:') || l.startsWith('FAIL:'));
    assert.ok(caseLines.length > 0, `expected at least one PASS/FAIL line, got: ${state.result.output}`);
    for (const line of caseLines) {
      assert.ok(line.startsWith('PASS:'), `expected every case to PASS, found: ${line}`);
    }
  });

  // ── 03: the census over every shell test driving the claim path ─────────
  scoped(
    /^the shell tests under swarmforge\/scripts\/test that drive the task claim path are scanned for an empty-stderr assertion$/,
    (ctx) => {
      const state = ensure(ctx);
      const files = fs.readdirSync(TEST_DIR).filter((f) => f.startsWith('test_') && f.endsWith('.sh'));
      state.claimPathSilentAssertionFiles = files.filter((f) => {
        const text = fs.readFileSync(path.join(TEST_DIR, f), 'utf8');
        const drivesClaimPath = /ready_for_next_task|ready_for_next\.sh/.test(text);
        const assertsEmptyStderr = /-z "\$ERR"/.test(text);
        return drivesClaimPath && assertsEmptyStderr;
      });
    }
  );

  scoped(/^exactly 1 such test is found and it is test_branch_claim_guard\.sh$/, (ctx) => {
    const state = ensure(ctx);
    assert.deepEqual(
      state.claimPathSilentAssertionFiles,
      ['test_branch_claim_guard.sh'],
      `expected exactly test_branch_claim_guard.sh, got: ${JSON.stringify(state.claimPathSilentAssertionFiles)}`
    );
  });
}

module.exports = { registerSteps };
