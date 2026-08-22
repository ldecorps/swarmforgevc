'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStepRegistry } = require('../../stepRegistry');
const { registerSteps } = require('../../steps/dispatchGapSteps');

// BL-222 hardening: matching the established convention (see
// daemonWorkflowSteps.test.js/launchSpawnFailureSteps.test.js/
// mailboxIntakeSteps.test.js/strykerPwaSandboxSteps.test.js) - the 3/3
// Gherkin scenario run only exercises the happy path, so a regression in an
// assertion step's own failure branch would pass the feature run and go
// unnoticed. This file closes that gap.

function freshRegistry() {
  const registry = createStepRegistry();
  registerSteps(registry);
  return registry;
}

function resolveAndRun(registry, ctx, stepText) {
  const resolved = registry.resolve(stepText);
  if (!resolved) {
    throw new Error(`no step handler matched "${stepText}"`);
  }
  return resolved.handler(ctx, ...resolved.args);
}

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aps-dispatch-gap-test-'));
}

function writeQueuedNote(targetPath, itemId, to) {
  const dir = path.join(targetPath, '.swarmforge', 'handoffs', 'coordinator', 'outbox');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, '00_test.handoff'),
    `id: test\nfrom: coordinator\nto: ${to}\npriority: 00\ntype: note\nmessage: ${itemId} is active with no dispatch on record - auto-routed by the sweep.\n\nbody\n`
  );
}

// ── the sweep runs at the existing chase interval (wiring-contract guard) ─

test('the sweep runs at the existing chase interval fails loudly if dispatch-gap-sweep! is not wired into the shared cadence', () => {
  // Can't easily break the real handoffd.bb from a unit test without
  // touching the shipped file; instead prove the guard actually inspects
  // content by asserting it currently passes against the real file (the
  // regression case - dispatch-gap-sweep! moved to its own timer or
  // removed entirely - is exactly what would make this step throw).
  const registry = freshRegistry();
  const ctx = {};
  assert.doesNotThrow(() => resolveAndRun(registry, ctx, 'the sweep runs at the existing chase interval'));
});

// ── BL-890: checkSweepWiredInCadence / locateCadenceConditional ─────────
// The two branches above's comment used to say they "can't easily" be
// exercised without touching the shipped file - checkSweepWiredInCadence
// is a pure function over an in-memory string, so now they can be.

const {
  checkSweepWiredInCadence,
  locateCadenceConditional,
  findMatchingParen,
  CADENCE_CONDITIONAL_ANCHOR,
  DISPATCH_GAP_SWEEP_NAME,
} = require('../../steps/dispatchGapSteps');

test('checkSweepWiredInCadence passes when the sweep sits far past the old 600-character window', () => {
  const padding = ';; '.padEnd(2000, 'x') + '\n';
  const src = `${CADENCE_CONDITIONAL_ANCHOR}\n  ${padding}(${DISPATCH_GAP_SWEEP_NAME} (load-roles)))\n`;
  assert.deepEqual(checkSweepWiredInCadence(src, DISPATCH_GAP_SWEEP_NAME, CADENCE_CONDITIONAL_ANCHOR), { ok: true });
});

test('checkSweepWiredInCadence reports sweep-not-wired when the conditional exists but the sweep is absent from it', () => {
  const src = `${CADENCE_CONDITIONAL_ANCHOR}\n  (some-other-sweep! (load-roles)))\n`;
  assert.deepEqual(checkSweepWiredInCadence(src, DISPATCH_GAP_SWEEP_NAME, CADENCE_CONDITIONAL_ANCHOR), {
    ok: false,
    reason: 'sweep-not-wired',
  });
});

test('checkSweepWiredInCadence reports sweep-not-wired when the sweep runs from a separate conditional entirely', () => {
  const src =
    `${CADENCE_CONDITIONAL_ANCHOR}\n  (some-other-sweep! (load-roles)))\n` +
    `(when (zero? (mod cycle its-own-separate-timer))\n  (${DISPATCH_GAP_SWEEP_NAME} (load-roles)))\n`;
  assert.deepEqual(checkSweepWiredInCadence(src, DISPATCH_GAP_SWEEP_NAME, CADENCE_CONDITIONAL_ANCHOR), {
    ok: false,
    reason: 'sweep-not-wired',
  });
});

test('checkSweepWiredInCadence reports conditional-not-found when the anchor text is absent', () => {
  const src = `(defn some-other-fn []\n  (${DISPATCH_GAP_SWEEP_NAME} (load-roles)))\n`;
  assert.deepEqual(checkSweepWiredInCadence(src, DISPATCH_GAP_SWEEP_NAME, CADENCE_CONDITIONAL_ANCHOR), {
    ok: false,
    reason: 'conditional-not-found',
  });
});

test('locateCadenceConditional stops at the anchor when-form\'s own matching close paren, not the next unrelated one', () => {
  const src = `${CADENCE_CONDITIONAL_ANCHOR}\n  (sweep-a!))\n(defn unrelated [] (other-call!))\n`;
  const located = locateCadenceConditional(src, CADENCE_CONDITIONAL_ANCHOR);
  assert.ok(located);
  assert.equal(located.text.includes('unrelated'), false);
  assert.equal(located.text.includes('sweep-a!'), true);
});

test('findMatchingParen ignores parens inside comments and string literals', () => {
  const src = '(when true\n  ;; a comment with a ( paren\n  (call "a string with ) paren"))';
  const end = findMatchingParen(src, 0);
  assert.equal(src[end], ')');
  assert.equal(src.slice(0, end + 1), src);
});

// BL-890 hardening (hand-authored mutation sweep - no Scenario Outline in
// this feature, so Gherkin mutation is inapplicable per BL-638): deleting
// findMatchingParen's `if (ch === '\\') { i++; continue; }` backslash-escape
// branch survived every other test in this file plus both property tests -
// no fixture anywhere exercises an escaped quote inside a scanned string
// literal. Without that branch, an escaped `\"` wrongly ends the string,
// so a stray `)` right after it (as in a real Clojure/Babashka `log!` call
// like `(log! "...\" text) more" e)`) is counted as the conditional's own
// close paren - truncating the scan early. Constructed directly against
// the real handoffd.bb shape: with the escape branch removed,
// checkSweepWiredInCadence flips from {ok:true} to
// {ok:false, reason:'conditional-not-found'} for source that is in fact
// correctly wired - a false alarm, in the wrong direction, from prose a
// human could add without touching any wiring at all.
test('findMatchingParen treats an escaped quote inside a string as part of that string, not its end', () => {
  const src = '(when true\n  (log! "escaped \\" quote) here" (other-call!)))';
  const end = findMatchingParen(src, 0);
  assert.equal(src[end], ')');
  assert.equal(src.slice(0, end + 1), src);
});

test('checkSweepWiredInCadence still finds the sweep when a sibling string contains an escaped quote followed by a stray close-paren', () => {
  const src =
    `${CADENCE_CONDITIONAL_ANCHOR}\n` +
    '  (try (other-sweep!) (catch Exception e (log! "escaped \\" quote) here" (.getMessage e))))\n' +
    `  (${DISPATCH_GAP_SWEEP_NAME} (load-roles)))\n`;
  assert.deepEqual(checkSweepWiredInCadence(src, DISPATCH_GAP_SWEEP_NAME, CADENCE_CONDITIONAL_ANCHOR), { ok: true });
});

// ── the assignee receives a routing handoff for the item ────────────────

test('the assignee receives a routing handoff for the item fails loudly when nothing was queued', () => {
  const registry = freshRegistry();
  const ctx = { targetPath: mkTmp(), sweepOutput: 'GAPS: []' };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'the assignee receives a routing handoff for the item'),
    /expected an auto-routed note for BL-217/
  );
});

test('the assignee receives a routing handoff for the item fails loudly when queued but misaddressed', () => {
  const registry = freshRegistry();
  const ctx = { targetPath: mkTmp() };
  writeQueuedNote(ctx.targetPath, 'BL-217', 'cleaner');
  assert.throws(
    () => resolveAndRun(registry, ctx, 'the assignee receives a routing handoff for the item'),
    /expected the queued note addressed to the assignee/
  );
});

test('the assignee receives a routing handoff for the item passes once correctly queued', () => {
  const registry = freshRegistry();
  const ctx = { targetPath: mkTmp() };
  writeQueuedNote(ctx.targetPath, 'BL-217', 'coder');
  assert.doesNotThrow(() => resolveAndRun(registry, ctx, 'the assignee receives a routing handoff for the item'));
});

// ── the sweep sends no further routing handoff for the item ─────────────

test('the sweep sends no further routing handoff for the item fails loudly when one was queued anyway', () => {
  const registry = freshRegistry();
  const ctx = { targetPath: mkTmp() };
  writeQueuedNote(ctx.targetPath, 'BL-217', 'coder');
  assert.throws(
    () => resolveAndRun(registry, ctx, 'the sweep sends no further routing handoff for the item'),
    /expected no auto-routed note for BL-217/
  );
});

test('the sweep sends no further routing handoff for the item passes when the outbox is empty', () => {
  const registry = freshRegistry();
  const ctx = { targetPath: mkTmp() };
  assert.doesNotThrow(() => resolveAndRun(registry, ctx, 'the sweep sends no further routing handoff for the item'));
});

// ── BL-890 feature scenario steps (specs/features/BL-890-...feature) ────

test('BL-890 scenario 01: sweep wired, then padded with a 1200-char comment, still passes', () => {
  const registry = freshRegistry();
  const ctx = {};
  resolveAndRun(registry, ctx, 'a cadence conditional in handoffd.bb that invokes "dispatch-gap-sweep!"');
  resolveAndRun(registry, ctx, 'a comment block of 1200 characters precedes that invocation inside the conditional');
  resolveAndRun(registry, ctx, 'the cadence-wiring check runs');
  assert.doesNotThrow(() => resolveAndRun(registry, ctx, 'the check passes'));
});

test('BL-890 scenario 02: sweep moved to its own separate timer fails, naming the sweep and the conditional', () => {
  const registry = freshRegistry();
  const ctx = {};
  resolveAndRun(registry, ctx, 'a cadence conditional in handoffd.bb that does not invoke "dispatch-gap-sweep!"');
  resolveAndRun(registry, ctx, '"dispatch-gap-sweep!" is invoked from its own separate timer instead');
  resolveAndRun(registry, ctx, 'the cadence-wiring check runs');
  assert.doesNotThrow(() => resolveAndRun(registry, ctx, 'the check fails'));
  assert.doesNotThrow(() => resolveAndRun(registry, ctx, 'its failure message names "dispatch-gap-sweep!" and the cadence conditional'));
});

test('BL-890 scenario 03: an unlocatable conditional fails with a distinct not-found reason', () => {
  const registry = freshRegistry();
  const ctx = {};
  resolveAndRun(registry, ctx, 'a handoffd.bb in which the cadence conditional cannot be located');
  resolveAndRun(registry, ctx, 'the cadence-wiring check runs');
  assert.doesNotThrow(() => resolveAndRun(registry, ctx, 'the check fails'));
  assert.doesNotThrow(() =>
    resolveAndRun(registry, ctx, 'its failure message distinguishes a missing cadence conditional from an unwired sweep')
  );
});

test('BL-890: "its failure message names..." rejects a not-found verdict masquerading as not-wired', () => {
  const registry = freshRegistry();
  const ctx = {};
  resolveAndRun(registry, ctx, 'a handoffd.bb in which the cadence conditional cannot be located');
  resolveAndRun(registry, ctx, 'the cadence-wiring check runs');
  assert.throws(
    () => resolveAndRun(registry, ctx, 'its failure message names "dispatch-gap-sweep!" and the cadence conditional'),
    /expected the "sweep not wired" failure mode/
  );
});
