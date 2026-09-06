'use strict';

// BL-1409: step handlers for "BL-1409 BL-570's wiring assertion follows the
// delegation". Drives the REAL BL-570 acceptance feature, the REAL
// test_property_suite_drift_guard.sh shell suite, and the REAL
// propertyGuardIsWired (specs/pipeline/steps/lib/bl1409PropertyGuardWiring.js)
// against synthetic chain seams - never a reimplementation of the check.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const FEATURE = "BL-1409 BL-570's wiring assertion follows the delegation";

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const { propertyGuardIsWired } = require(path.join(__dirname, 'lib', 'bl1409PropertyGuardWiring.js'));

const KNOWN_BROKEN_HOPS = new Map([
  [
    'the hook names the runner only in a comment',
    { seam: 'runner-in-comment-only', named: 'run_commit_guards.sh' },
  ],
  [
    "the runner's guard set omits the property guard",
    { seam: 'runner-omits-guard', named: 'check_property_suite_drift.sh' },
  ],
]);

const seamRoots = [];
process.on('exit', () => {
  for (const root of seamRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function writeFile(p, content) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

// A minimal chain seam: swarmforge/git-hooks/pre-commit and
// swarmforge/scripts/run_commit_guards.sh, built to whichever shape a case
// needs. `hookExecsRunner` / `hookNamesRunnerInComment` control the FIRST
// hop; `runnerNamesGuard` controls the SECOND. The guard script itself is
// always present when the runner names it, so deriveCommitGuardFixtureSet's
// own "guard file must exist" check never throws for a reason this feature
// is not testing.
function buildSeam({ hookExecsRunner, hookNamesRunnerInComment, runnerNamesGuard }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl1409-seam-'));
  seamRoots.push(root);

  const hookLines = ['#!/usr/bin/env bash', 'set -euo pipefail'];
  if (hookNamesRunnerInComment) {
    hookLines.push('# would exec "$REPO_ROOT/swarmforge/scripts/run_commit_guards.sh" "$REPO_ROOT"');
  }
  if (hookExecsRunner) {
    hookLines.push('REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"');
    hookLines.push('exec "$REPO_ROOT/swarmforge/scripts/run_commit_guards.sh" "$REPO_ROOT"');
  } else {
    hookLines.push('exit 0');
  }
  writeFile(path.join(root, 'swarmforge', 'git-hooks', 'pre-commit'), hookLines.join('\n') + '\n');

  const runnerLines = ['#!/usr/bin/env bash', 'set -uo pipefail'];
  if (runnerNamesGuard) {
    runnerLines.push('run_guard check_property_suite_drift.sh');
    writeFile(path.join(root, 'swarmforge', 'scripts', 'check_property_suite_drift.sh'), '#!/usr/bin/env bash\nexit 0\n');
  } else {
    runnerLines.push('run_guard check_commit_size.sh 50');
    writeFile(path.join(root, 'swarmforge', 'scripts', 'check_commit_size.sh'), '#!/usr/bin/env bash\nexit 0\n');
  }
  writeFile(path.join(root, 'swarmforge', 'scripts', 'run_commit_guards.sh'), runnerLines.join('\n') + '\n');

  return root;
}

const SEAMS = {
  wired: () => buildSeam({ hookExecsRunner: true, hookNamesRunnerInComment: false, runnerNamesGuard: true }),
  'runner-in-comment-only': () => buildSeam({ hookExecsRunner: false, hookNamesRunnerInComment: true, runnerNamesGuard: true }),
  'runner-omits-guard': () => buildSeam({ hookExecsRunner: true, hookNamesRunnerInComment: false, runnerNamesGuard: false }),
};

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Scenario 01 ──────────────────────────────────────────────────────
  scoped(/^the real pre-commit hook and runner$/, () => {
    // Framing only - both later steps (BL-570's feature, the shell suite)
    // read the real repo tree directly; nothing to build here.
  });

  scoped(/^the BL-570 feature runs$/, (ctx) => {
    const result = spawnSync(
      'bash',
      [path.join(REPO_ROOT, 'specs', 'pipeline', 'scripts', 'run_acceptance.sh'), path.join(REPO_ROOT, 'specs', 'features', 'BL-570-property-suite-drift-guard.feature')],
      { encoding: 'utf8', timeout: 120000 }
    );
    ctx.bl570Result = { rc: result.status ?? 1, out: `${result.stdout || ''}${result.stderr || ''}` };
  });

  scoped(/^every scenario run passes$/, (ctx) => {
    assert.equal(ctx.bl570Result.rc, 0, `expected BL-570's feature to pass every run, got:\n${ctx.bl570Result.out}`);
    assert.match(ctx.bl570Result.out, /# pass 7/, `expected 7 passing runs, got:\n${ctx.bl570Result.out}`);
    assert.doesNotMatch(ctx.bl570Result.out, /# fail [1-9]/, `expected zero failing runs, got:\n${ctx.bl570Result.out}`);
  });

  // ── Scenario 02 ──────────────────────────────────────────────────────
  scoped(/^a chain seam where the hook execs the runner and the runner names the property guard$/, (ctx) => {
    ctx.seamRoot = SEAMS.wired();
  });

  scoped(/^the installed check runs against the seam$/, (ctx) => {
    ctx.checkResult = propertyGuardIsWired({ repoRoot: ctx.seamRoot });
  });

  scoped(/^the check passes$/, (ctx) => {
    assert.ok(ctx.checkResult.wired, `expected the check to pass, got: ${JSON.stringify(ctx.checkResult)}`);
  });

  // ── Scenario 03 (outline) ────────────────────────────────────────────
  scoped(/^a chain seam where (.+)$/, (ctx, brokenHop) => {
    assert.ok(KNOWN_BROKEN_HOPS.has(brokenHop), `unknown <broken_hop> example value: ${brokenHop}`);
    ctx.brokenHop = KNOWN_BROKEN_HOPS.get(brokenHop);
    ctx.seamRoot = SEAMS[ctx.brokenHop.seam]();
  });

  scoped(/^the check fails naming "([^"]+)"$/, (ctx, named) => {
    assert.equal(named, ctx.brokenHop.named, `example table mismatch: <named> "${named}" vs mapped "${ctx.brokenHop.named}"`);
    assert.ok(!ctx.checkResult.wired, `expected the check to fail, got: ${JSON.stringify(ctx.checkResult)}`);
    assert.equal(ctx.checkResult.missing, named, `expected the check to name "${named}" as missing, got: ${JSON.stringify(ctx.checkResult)}`);
  });

  // ── Scenario 04 ──────────────────────────────────────────────────────
  scoped(/^the drift-guard shell suite runs$/, (ctx) => {
    const result = spawnSync('bash', [path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'test_property_suite_drift_guard.sh')], {
      encoding: 'utf8',
      timeout: 180000,
    });
    ctx.shellSuiteResult = { rc: result.status ?? 1, out: `${result.stdout || ''}${result.stderr || ''}` };
  });

  // BL-1409 spec-gap amendment (specifier, 2026-09-06): scenario 04 used to
  // assert the WHOLE suite's exit code (rc == 0), which BL-1409 does not
  // own past case 07 - case 11+ belongs to BL-1448 (the live property
  // allowlist drained to zero rows by BL-1428, hidden behind case 07's own
  // pre-existing red until this ticket fixed it). Asserting specific
  // PASS: N lines rather than rc keeps this scenario true once BL-1448
  // lands, instead of silently reading red-when-correct (BL-1006).
  scoped(/^case 07 passes$/, (ctx) => {
    assert.match(ctx.shellSuiteResult.out, /^PASS: 07:/m, `expected a "PASS: 07:" line, got:\n${ctx.shellSuiteResult.out}`);
  });

  scoped(/^every case through 10 passes$/, (ctx) => {
    for (let n = 1; n <= 10; n += 1) {
      const caseNum = String(n).padStart(2, '0');
      assert.match(
        ctx.shellSuiteResult.out,
        new RegExp(`^PASS: ${caseNum}:`, 'm'),
        `expected a "PASS: ${caseNum}:" line, got:\n${ctx.shellSuiteResult.out}`
      );
    }
  });
}

module.exports = { registerSteps };
