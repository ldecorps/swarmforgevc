'use strict';

// BL-1291: step handlers for "a test that derives from the live repository
// reads a pinned fixture or records why it cannot".
//
// Every scenario drives the REAL guard (liveRepoDerivationGuard.js) - never
// a reimplementation - the same module extension/test/liveRepoDerivationGuard.test.js
// itself calls. Scenario 01's three examples pass file TEXT, since the
// guard's decision is a pure function of a file's contents; scenario 02
// scans the REAL extension/test tree, which is this ticket's actual fix
// (converting bl1243PaneActivitySignal.test.js to a pinned list and
// recording an exemption on deprecateRetiredReferents.test.js); scenario 03
// reads the REAL exemption this ticket recorded.

const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const FEATURE = 'A test that derives from the live repository reads a pinned fixture or records why it cannot';

const EXT = path.join(__dirname, '..', '..', '..', 'extension');
const { violationFor, exemptionReason, findLiveRepoDerivations } = require(
  path.join(EXT, 'test', 'helpers', 'liveRepoDerivationGuard')
);

// A file that walks the live repository - the growth term every example
// below either avoids, exempts, or leaves bare.
const LIVE_DERIVING_BODY = [
  "const REPO_ROOT = path.join(__dirname, '..', '..');",
  "fs.readdirSync(path.join(REPO_ROOT, 'swarmforge', 'scripts'));",
].join('\n');

const PINNED_BODY = [
  "const FIXTURE_FILES = ['a.txt', 'b.txt'];",
  "for (const name of FIXTURE_FILES) { fs.readFileSync(path.join(FIXTURES, name)); }",
].join('\n');

// Explicit known values per the Scenario Outline handler rule: the closed
// set of provisions and verdicts this feature's Examples table names.
const KNOWN_PROVISIONS = new Map([
  ['reads a pinned fixture', () => PINNED_BODY],
  ['records why it cannot be pinned', () => `// BL-1038-EXEMPT: fixture stands in for a live derivation in this test\n${LIVE_DERIVING_BODY}`],
  ['does neither', () => LIVE_DERIVING_BODY],
]);
const KNOWN_VERDICTS = new Set(['not reported as', 'reported as']);

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the live-repository-derivation scan over extension\/test$/, (ctx) => {
    ctx.bl1291 = {};
  });

  // ── 01 (Scenario Outline) ──────────────────────────────────────────────
  scoped(/^a test that derives from the live repository and (.+)$/, (ctx, provision) => {
    assert.ok(KNOWN_PROVISIONS.has(provision), `unknown provision "${provision}" - known: ${[...KNOWN_PROVISIONS.keys()]}`);
    ctx.bl1291.body = KNOWN_PROVISIONS.get(provision)();
  });

  scoped(/^the guard scans it$/, (ctx) => {
    ctx.bl1291.violation = violationFor('bl1291-fixture.test.js', ctx.bl1291.body);
  });

  scoped(/^the test is (.+) a violation$/, (ctx, verdict) => {
    assert.ok(KNOWN_VERDICTS.has(verdict), `unknown verdict "${verdict}" - known: ${[...KNOWN_VERDICTS]}`);
    if (verdict === 'not reported as') {
      assert.equal(ctx.bl1291.violation, null, `expected no violation, got: ${JSON.stringify(ctx.bl1291.violation)}`);
    } else {
      assert.ok(ctx.bl1291.violation, 'expected a reported violation, got none');
    }
  });

  // ── 02 ──────────────────────────────────────────────────────────────
  scoped(/^every test under extension\/test$/, (ctx) => {
    ctx.bl1291.scanDir = path.join(EXT, 'test');
  });

  scoped(/^the guard scans the tree$/, (ctx) => {
    ctx.bl1291.violations = findLiveRepoDerivations(ctx.bl1291.scanDir);
  });

  scoped(/^it reports no live-repository-derivation violations at all$/, (ctx) => {
    assert.deepEqual(
      ctx.bl1291.violations,
      [],
      `expected zero violations, got: ${JSON.stringify(ctx.bl1291.violations)}`
    );
  });

  // ── 03 ──────────────────────────────────────────────────────────────
  scoped(/^a test whose live-repository read is exempted$/, (ctx) => {
    ctx.bl1291.exemptedFile = path.join(EXT, 'test', 'deprecateRetiredReferents.test.js');
  });

  scoped(/^the exemption is read$/, (ctx) => {
    const text = fs.readFileSync(ctx.bl1291.exemptedFile, 'utf8');
    ctx.bl1291.reason = exemptionReason(text);
  });

  scoped(/^it names why the read cannot use a pinned fixture$/, (ctx) => {
    assert.ok(ctx.bl1291.reason, 'expected a recorded exemption reason, got none');
    assert.match(
      ctx.bl1291.reason,
      /live docs tree/,
      `expected the reason to explain why this test needs the real tree, got: ${ctx.bl1291.reason}`
    );
  });
}

module.exports = { registerSteps };
