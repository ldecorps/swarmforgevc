'use strict';

// BL-1212: step handlers driving the REAL BL-1038 guard helper and the REAL
// extension/test tree - never a reimplementation.
//
// Scenario 02 ("a bare marker with no reason is still refused") was
// RETIRED 2026-09-05 (RETIRE-WITH: BL-1435): it was falsified after this
// ticket's mint by BL-1317 (533da24a41, 2026-09-02), which re-derived
// docsStructureRealTree.test.js's REPO_ROOT through `git rev-parse
// --show-toplevel`, an idiom the BL-1038 guard's own pattern-matchers
// never recognized as a live-root binding - the guard was already not
// inspecting this file's marker at all, before this ticket touched
// anything, for a reason unrelated to BL-1209. BL-1435 widens the guard's
// detection and carries the bare-marker scenario forward. Retired, not
// reworded (BL-1006) - see backlog/evidence/BL-1212-coder-20260905.md for
// the original finding and specifier note
// 00_20260905T163957Z_001352_from_specifier for the retirement.
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
