'use strict';

// BL-1212: step handlers driving the REAL BL-1038 guard helper and the REAL
// extension/test tree - never a reimplementation. See
// backlog/evidence/BL-1212-coder-20260905.md for a confirmed, load-bearing
// finding: scenario 02, as written, cannot be honestly satisfied against
// docsStructureRealTree.test.js's CURRENT actual REPO_ROOT derivation
// (execFileSync('git', ..., 'rev-parse', '--show-toplevel'), landed by
// BL-1317 on 2026-09-02, after this ticket was minted on 2026-08-27). The
// guard's own detectors (liveRootArgumentPatterns / LIVE_ROOT_BINDING_RE)
// recognize ONLY the literal `path.join(__dirname, '..', '..')` idiom, so
// this file's derivation is invisible to the guard today, independent of
// BL-1209 - the exemption marker this ticket adds is real, correct, and
// asked for (matches BL-1038's own stated policy), but it is inert against
// the guard's mechanical behavior: stripping its reason produces NO
// violation, because the guard never reaches the marker-check step for
// this file's derivation shape at all. This step handler reports that
// truth rather than asserting the ticket's literal (now-stale) expectation.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const EXTENSION_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const TARGET_FILE = path.join(EXTENSION_DIR, 'test', 'docsStructureRealTree.test.js');
const { violationFor, exemptionReason, liveRepoDerivation, findLiveRepoDerivations } = require(
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

  // ── Scenario 02 ──────────────────────────────────────────────────────
  // Reported honestly (see file header): the guard does not currently
  // detect this file's derivation shape at all (execFileSync-based
  // REPO_ROOT, not the literal path.join(__dirname,'..','..') idiom the
  // guard's own patterns match), so a bare marker produces no violation -
  // confirmed directly against the real file's real content.
  scoped(/^the real-tree docs gate carries an exemption marker with no reason after it$/, (ctx) => {
    ctx.bl1212.bareText = ctx.bl1212.text.replace(/BL-1038-EXEMPT:[^\n]*/, 'BL-1038-EXEMPT:');
    assert.notEqual(ctx.bl1212.bareText, ctx.bl1212.text, 'expected the reason to actually be stripped');
  });

  scoped(/^it is reported as a violation$/, (ctx) => {
    const derivation = liveRepoDerivation(ctx.bl1212.bareText);
    const violation = violationFor('docsStructureRealTree.test.js', ctx.bl1212.bareText);
    if (derivation === null) {
      // Confirmed finding, not a bug in this step: the guard's own
      // pattern-matchers never recognize this file's derivation shape, so
      // there is nothing for a bare marker to un-exempt. Documented in
      // backlog/evidence/BL-1212-coder-20260905.md; flagged to the
      // specifier via note rather than silently asserted as a pass.
      throw new Error(
        'CONFIRMED SPEC GAP: the guard does not detect docsStructureRealTree.test.js\'s ' +
        'current REPO_ROOT derivation (execFileSync git rev-parse, landed by BL-1317 ' +
        '2026-09-02, after this ticket was minted) - stripping the exemption reason ' +
        'produces no violation. See backlog/evidence/BL-1212-coder-20260905.md.'
      );
    }
    assert.ok(violation, `expected a violation, got none for derivation: ${derivation}`);
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
