'use strict';

// BL-1212: step handlers driving the REAL BL-1038 guard helper and the REAL
// extension/test tree - never a reimplementation.
//
// Scenario 02 ("a bare marker with no reason is still refused") was RETIRED
// by the specifier on 2026-09-05 (985b0df0b6, RETIRE-WITH: BL-1435), not
// reworded (BL-1006): it was falsified after mint by BL-1317
// (533da24a41, 2026-09-02), which re-derived
// docsStructureRealTree.test.js's REPO_ROOT through
// execFileSync('git', ..., 'rev-parse', '--show-toplevel') - an idiom the
// BL-1038 guard's detectors (liveRootArgumentPatterns / LIVE_ROOT_BINDING_RE)
// do not recognize as a live read at all, so the guard never reaches the
// marker-check step for this file. BL-1435 widens the guard to recognize the
// rev-parse idiom and carries the bare-marker scenario going forward. Its
// steps are dropped here per the retirement (see
// backlog/evidence/BL-1212-coder-20260905.md and
// backlog/evidence/BL-1212-architect-pass-20260905.md for the independently
// reproduced finding that led to it).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const EXTENSION_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const TARGET_FILE = path.join(EXTENSION_DIR, 'test', 'docsStructureRealTree.test.js');
const { exemptionReason, findLiveRepoDerivations } = require(
  path.join(EXTENSION_DIR, 'test', 'helpers', 'liveRepoDerivationGuard.js')
);

const FEATURE = 'BL-1212 the real-tree docs gate records why it reads the live repository, and the guard goes green again';

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the BL-1038 live-repository derivation guard scanning the extension test tree$/, (ctx) => {
    ctx.bl1212 = { text: fs.readFileSync(TARGET_FILE, 'utf8') };
  });

  // ── Scenario 01 ──────────────────────────────────────────────────────
  scoped(/^the real-tree docs gate reads the live repository by design$/, () => {
    // Given is descriptive - the file's own content (read in Background)
    // is the real subject.
  });

  scoped(/^the guard inspects it$/, (ctx) => {
    ctx.bl1212.reason = exemptionReason(ctx.bl1212.text);
  });

  scoped(/^it is treated as exempt$/, (ctx) => {
    assert.ok(ctx.bl1212.reason, 'expected an exemption marker with a recorded reason');
  });

  scoped(/^the exemption states why the live read is the assertion$/, (ctx) => {
    assert.match(ctx.bl1212.reason, /live read is the assertion/i);
  });

  // Scenario 02 retired (985b0df0b6, RETIRE-WITH: BL-1435) - see file header.

  // ── Scenario 03 ──────────────────────────────────────────────────────
  scoped(/^every live-repository read in the test tree is either a fixture read or a recorded exemption$/, () => {
    // Given is descriptive - the real tree (scanned below) is the subject.
  });

  scoped(/^the guard runs over the whole test tree$/, (ctx) => {
    ctx.bl1212.violations = findLiveRepoDerivations(path.join(EXTENSION_DIR, 'test'));
  });

  scoped(/^it reports no violations$/, (ctx) => {
    assert.deepEqual(
      ctx.bl1212.violations,
      [],
      `expected zero violations, found: ${JSON.stringify(ctx.bl1212.violations)}`
    );
  });
}

module.exports = { registerSteps };
