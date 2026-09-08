'use strict';

// BL-1445: the staffing-gate wiring test decides the operator override
// (PACK_STAFFING_SKIP_GATE) itself, never inheriting it from the pane.
// Drives the REAL swarmforge/scripts/test/test_pack_staffing_gate_wiring.sh
// under a controlled child environment - never a JavaScript restatement of
// its cases. Scenario 02 greps the real shell tests under
// swarmforge/scripts/test for the structural fix (BL-1408/BL-1398 posture).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const WIRING_TEST = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'test_pack_staffing_gate_wiring.sh');
const TEST_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test');

const FEATURE = 'BL-1445 The staffing-gate wiring test decides the operator override itself';

function scoped(registry, pattern, handler) {
  registry.defineScoped(pattern, handler, FEATURE);
}

// Runs the real wiring test as a child process with PACK_STAFFING_SKIP_GATE
// either set to `value` or absent entirely from the child's env (never
// merely inherited from THIS process, which is itself run under whatever a
// role's own pane exports - the exact hazard this ticket guards against).
function runWiringTest(value) {
  const env = { ...process.env };
  if (value === undefined) {
    delete env.PACK_STAFFING_SKIP_GATE;
  } else {
    env.PACK_STAFFING_SKIP_GATE = value;
  }
  const r = spawnSync('bash', [WIRING_TEST], { encoding: 'utf8', env });
  return { status: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}

function registerSteps(registry) {
  // ── scenario 01 ─────────────────────────────────────────────────────
  scoped(registry, /^the environment exports PACK_STAFFING_SKIP_GATE as (1|0|unset)$/, (ctx, value) => {
    ctx.paneValue = value === 'unset' ? undefined : value;
  });

  scoped(registry, /^the wiring test runs$/, (ctx) => {
    ctx.result = runWiringTest(ctx.paneValue);
  });

  scoped(registry, /^it passes every case$/, (ctx) => {
    assert.equal(ctx.result.status, 0, `expected the wiring test to pass under this pane export:\n${ctx.result.out}`);
    assert.match(
      ctx.result.out,
      /ALL CHECKS PASSED/,
      `expected every case to pass regardless of the pane's own export:\n${ctx.result.out}`
    );
    // invariant 2: the source turns the override on in exactly ONE place
    // (case 03's own explicit PACK_STAFFING_SKIP_GATE=1 assignment) -
    // static, so this holds regardless of which pane value this example
    // exercises. Excludes comments and pass/fail message strings, which
    // also mention the literal for narration.
    const assignmentLines = fs
      .readFileSync(WIRING_TEST, 'utf8')
      .split('\n')
      .filter((line) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('#')) return false;
        if (/\b(fail|pass)\s*"/.test(trimmed)) return false;
        return /PACK_STAFFING_SKIP_GATE=1\b/.test(trimmed);
      });
    assert.equal(
      assignmentLines.length,
      1,
      `expected exactly one place turning the override on (case 03), got ${assignmentLines.length}: ${JSON.stringify(assignmentLines)}`
    );
  });

  // ── scenario 02 ─────────────────────────────────────────────────────
  scoped(registry, /^every shell test under swarmforge\/scripts\/test that sources swarmforge\.sh is inspected$/, (ctx) => {
    const files = fs.readdirSync(TEST_DIR).filter((f) => f.endsWith('.sh'));
    ctx.candidates = [];
    for (const f of files) {
      const abs = path.join(TEST_DIR, f);
      const content = fs.readFileSync(abs, 'utf8');
      if (!/source\s+['"]?\S*swarmforge\.sh/.test(content)) continue;
      const assertsOnGate = /staffing gate|OVERRIDE/i.test(content);
      if (!assertsOnGate) continue;
      ctx.candidates.push({ file: f, content });
    }
  });

  scoped(
    registry,
    /^each one that asserts on the staffing gate's refusal or override warning sets or unsets PACK_STAFFING_SKIP_GATE explicitly before sourcing the launcher$/,
    (ctx) => {
      assert.ok(ctx.candidates.length > 0, 'expected at least one shell test asserting on the staffing gate (this file itself)');
      for (const { file, content } of ctx.candidates) {
        const decidesExplicitly = /(^|\n)\s*unset\s+PACK_STAFFING_SKIP_GATE\b/.test(content) ||
          /PACK_STAFFING_SKIP_GATE\s*=/.test(content) ||
          /env\s+-u\s+PACK_STAFFING_SKIP_GATE\b/.test(content);
        assert.ok(
          decidesExplicitly,
          `${file} asserts on the staffing gate but never sets or unsets PACK_STAFFING_SKIP_GATE itself - it would inherit the pane's own export`
        );
      }
    }
  );
}

module.exports = { registerSteps };
