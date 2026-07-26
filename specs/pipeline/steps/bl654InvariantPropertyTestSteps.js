'use strict';

// BL-654: step handlers for "declared invariants get coder-authored
// executable property tests". Scenarios 01-06 are prose-content checks
// against the real, already-amended role prompts - same "read the live
// file, assert on its literal content" pattern bl633InvariantsSectionSteps.js
// established. Scenarios 07-10 drive the real worked-example fixture
// (extension/test/fixtures/bl654PreEpochTrend.js /
// bl654PreEpochInvariant.js) in-process to demonstrate the checks the
// prompt amendments describe actually catch both failure modes: a missing/
// vacuous property test, and a generator that never reaches the state the
// invariant quantifies over.
const path = require('node:path');
const fs = require('node:fs');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CODER_PROMPT_PATH = path.join(REPO_ROOT, 'swarmforge', 'roles', 'coder.prompt');
const ARCHITECT_PROMPT_PATH = path.join(REPO_ROOT, 'swarmforge', 'roles', 'architect.prompt');

// "the architect role prompt" is also bl633InvariantsSectionSteps.js's exact
// step text (registered earlier in specs/pipeline/steps/index.js's DOMAINS
// array, for unrelated BL-633 scenarios) - a real collision, since
// registry.resolve()'s unscoped fallback returns the first match in
// registration order. Registered via defineScoped, pinned to this exact
// Feature: title, so it wins only when THIS feature is running; BL-633's own
// scenarios are unaffected (bl413StaleSandboxSweepSteps.js's identical note
// is the precedent for this fix).
const FEATURE_NAME = 'declared invariants get coder-authored executable property tests';

const { renderDailyTrend, renderDailyTrendDefective } = require(
  path.join(REPO_ROOT, 'extension', 'test', 'fixtures', 'bl654PreEpochTrend')
);
const {
  checkPreEpochInvariant,
  checkPreEpochInvariantVacuous,
  checkPreEpochInvariantShallowGenerator,
  assertNonVacuous,
  errorText,
} = require(path.join(REPO_ROOT, 'extension', 'test', 'fixtures', 'bl654PreEpochInvariant'));

// Collapses markdown/prompt line-wrapping into single spaces so a substring
// check doesn't depend on exactly where a paragraph happens to wrap (same
// convention as bl633InvariantsSectionSteps.js).
function readNormalizedDoc(docPath) {
  return fs.readFileSync(docPath, 'utf8').replace(/\s+/g, ' ');
}

function requireIncludes(text, fragment, label) {
  if (!text.includes(fragment)) {
    throw new Error(`expected ${label} to contain "${fragment}"`);
  }
}

function registerSteps(registry) {
  // ── Scenarios 01-03: the coder role prompt ──────────────────────────────
  registry.define(/^the coder role prompt$/, (ctx) => {
    ctx.bl654Text = readNormalizedDoc(CODER_PROMPT_PATH);
    ctx.bl654CoderText = ctx.bl654Text;
  });

  // Scenario 01
  registry.define(
    /^it instructs encoding each declared ticket invariant as a coder-authored executable property test in the same parcel$/,
    (ctx) => {
      requireIncludes(ctx.bl654Text, 'a coder-authored executable property test encoding it', 'the coder prompt');
      requireIncludes(ctx.bl654Text, 'in the same parcel as the behavior change', 'the coder prompt');
    }
  );

  registry.define(
    /^it instructs recording a stated reason in the parcel when an invariant admits no executable encoding$/,
    (ctx) => {
      requireIncludes(ctx.bl654Text, 'admits no executable encoding', 'the coder prompt');
      requireIncludes(ctx.bl654Text, 'record a stated reason in the parcel', 'the coder prompt');
    }
  );

  registry.define(/^the word invariant now appears in the coder role prompt$/, () => {
    const raw = fs.readFileSync(CODER_PROMPT_PATH, 'utf8');
    const count = (raw.match(/invariant/gi) || []).length;
    if (count === 0) {
      throw new Error('expected the word "invariant" to appear in the coder role prompt, found 0 occurrences');
    }
  });

  // Scenario 02
  registry.define(/^it states the generator must demonstrably reach the states the invariant quantifies over$/, (ctx) => {
    requireIncludes(
      ctx.bl654Text,
      'the generator must demonstrably reach the states the invariant quantifies over',
      'the coder prompt'
    );
  });

  registry.define(/^it names an asserted reachability floor rather than a hoped-for one$/, (ctx) => {
    requireIncludes(ctx.bl654Text, 'an asserted reachability floor, never a hoped-for one', 'the coder prompt');
  });

  registry.define(
    /^it names weighting progress operations and constructing colliding pairs as the known failure shapes$/,
    (ctx) => {
      requireIncludes(ctx.bl654Text, 'The known failure shapes', 'the coder prompt');
      requireIncludes(ctx.bl654Text, 'weighting progress operations', 'the coder prompt');
      requireIncludes(ctx.bl654Text, 'constructing colliding pairs', 'the coder prompt');
    }
  );

  // Scenario 03
  registry.define(/^its does-not-own exclusion leaves declared-invariant property tests with the coder$/, (ctx) => {
    requireIncludes(
      ctx.bl654Text,
      "a DECLARED invariant's property test is coder-authored first",
      'the coder prompt does-not-own section'
    );
    requireIncludes(ctx.bl654Text, 'this exclusion does not bar it', 'the coder prompt does-not-own section');
  });

  registry.define(/^it leaves the broader property-coverage pass with the architect$/, (ctx) => {
    requireIncludes(
      ctx.bl654Text,
      'The broader property-coverage pass over touched modules for UNDECLARED properties stays with the architect',
      'the coder prompt does-not-own section'
    );
  });

  // ── Scenarios 04-05: the architect role prompt ──────────────────────────
  registry.defineScoped(
    /^the architect role prompt$/,
    (ctx) => {
      ctx.bl654Text = readNormalizedDoc(ARCHITECT_PROMPT_PATH);
      ctx.bl654ArchitectText = ctx.bl654Text;
    },
    FEATURE_NAME
  );

  // Scenario 04
  registry.define(
    /^it instructs first checking each declared invariant for an executable property test or a stated non-encodability reason$/,
    (ctx) => {
      requireIncludes(ctx.bl654Text, 'FIRST check, for each declared invariant', 'the architect prompt');
      requireIncludes(ctx.bl654Text, 'executable property test encoding it', 'the architect prompt');
      requireIncludes(ctx.bl654Text, 'a stated non-encodability reason', 'the architect prompt');
    }
  );

  registry.define(
    /^it states a missing or vacuous property test is a send-back naming the missing test before any hand-verification of the property$/,
    (ctx) => {
      requireIncludes(ctx.bl654Text, 'before any hand-verification of the property itself', 'the architect prompt');
      requireIncludes(ctx.bl654Text, 'A missing or vacuous property test', 'the architect prompt');
      requireIncludes(ctx.bl654Text, 'is itself a send-back, naming the missing or vacuous test', 'the architect prompt');
    }
  );

  registry.define(/^it states the architect is never the first author of a declared invariant's property test$/, (ctx) => {
    requireIncludes(
      ctx.bl654Text,
      "You are never the first author of a declared invariant's property test",
      'the architect prompt'
    );
  });

  // Scenario 05
  registry.define(/^it instructs recording a missing-property-test send-back like any other send-back$/, (ctx) => {
    requireIncludes(ctx.bl654Text, 'Record a missing-property-test send-back like any other send-back', 'the architect prompt');
  });

  registry.define(
    /^it names the failure class invariant-unencoded to distinguish property never encoded from property violated$/,
    (ctx) => {
      requireIncludes(ctx.bl654Text, 'invariant-unencoded', 'the architect prompt');
      requireIncludes(ctx.bl654Text, 'distinguish property never encoded from property violated', 'the architect prompt');
    }
  );

  // ── Scenario 06: both prompts, no-invariants no-op ──────────────────────
  registry.define(/^both state that a ticket with no declared invariants creates no property-test obligation$/, (ctx) => {
    requireIncludes(ctx.bl654CoderText, 'creates no property-test obligation', 'the coder prompt');
    requireIncludes(ctx.bl654ArchitectText, 'creates no property-test obligation', 'the architect prompt');
  });

  // ── Scenarios 07-10: the worked-example fixture, driven in-process ──────
  registry.define(/^the pre-epoch worked example fixture and its coder-authored property test$/, (ctx) => {
    ctx.bl654Check = checkPreEpochInvariant;
    ctx.bl654RenderCorrect = renderDailyTrend;
    ctx.bl654RenderDefective = renderDailyTrendDefective;
  });

  registry.define(/^a vacuous variant of the worked example property test with its assertion removed$/, (ctx) => {
    ctx.bl654Check = checkPreEpochInvariantVacuous;
    ctx.bl654RenderDefective = renderDailyTrendDefective;
  });

  registry.define(/^a shallow variant of the worked example property test whose generator never reaches a pre-epoch window$/, (ctx) => {
    ctx.bl654Check = checkPreEpochInvariantShallowGenerator;
    ctx.bl654RenderCorrect = renderDailyTrend;
  });

  function runCheck(ctx, renderFn) {
    ctx.bl654Result = null;
    ctx.bl654Error = null;
    try {
      ctx.bl654Result = ctx.bl654Check(renderFn);
    } catch (err) {
      ctx.bl654Error = err;
    }
  }

  registry.define(/^the property test runs against the correct implementation$/, (ctx) => {
    runCheck(ctx, ctx.bl654RenderCorrect);
  });

  registry.define(/^the property test runs against the defective variant that fabricates zero for a pre-epoch period$/, (ctx) => {
    runCheck(ctx, ctx.bl654RenderDefective);
  });

  registry.define(/^the vacuous variant runs against the defective variant$/, (ctx) => {
    runCheck(ctx, ctx.bl654RenderDefective);
  });

  registry.define(/^the shallow variant runs against the correct implementation$/, (ctx) => {
    runCheck(ctx, ctx.bl654RenderCorrect);
  });

  registry.define(/^the property test passes$/, (ctx) => {
    if (ctx.bl654Error) {
      throw new Error(`expected the property test to pass, but it threw: ${ctx.bl654Error.message}`);
    }
  });

  registry.define(/^it asserts the generated runs reached a pre-epoch window at least its declared floor of times$/, (ctx) => {
    if (!ctx.bl654Result || !(ctx.bl654Result.preEpochRuns > 0)) {
      throw new Error('expected the property test result to report at least one run that reached a pre-epoch window');
    }
  });

  registry.define(/^the property test fails naming the pre-epoch invariant$/, (ctx) => {
    if (!ctx.bl654Error) {
      throw new Error('expected the property test to fail against the defective variant, but it passed');
    }
    const text = errorText(ctx.bl654Error);
    // The reachability-floor message also contains "pre-epoch" (see
    // bl654PreEpochInvariant.js), so this must rule that failure mode out
    // explicitly to prove the INVARIANT fired - not merely that some
    // assertion in the property threw. Scenario 10 exercises the
    // reachability-floor failure on its own.
    if (/reachability floor/i.test(text)) {
      throw new Error(`expected an invariant failure, not a reachability-floor failure, got: ${text}`);
    }
    if (!/pre-epoch/i.test(text)) {
      throw new Error(`expected the failure to name the pre-epoch invariant, got: ${text}`);
    }
  });

  registry.define(/^the vacuous variant stays green$/, (ctx) => {
    if (ctx.bl654Error) {
      throw new Error(`expected the vacuous variant to stay green, but it threw: ${ctx.bl654Error.message}`);
    }
  });

  registry.define(/^the non-vacuity check flags it because the expected failure did not occur$/, (ctx) => {
    const verdict = assertNonVacuous(ctx.bl654Check, ctx.bl654RenderDefective);
    if (!verdict.vacuous) {
      throw new Error('expected the non-vacuity check to flag the vacuous variant as vacuous, but it reported a failure occurred');
    }
  });

  registry.define(/^its reachability assertion fails even though the invariant assertion never fired$/, (ctx) => {
    if (!ctx.bl654Error) {
      throw new Error('expected the shallow variant to fail its reachability floor, but it passed');
    }
    const text = errorText(ctx.bl654Error);
    if (!/reachability floor/i.test(text)) {
      throw new Error(`expected a reachability-floor failure, got: ${text}`);
    }
  });
}

module.exports = { registerSteps };
