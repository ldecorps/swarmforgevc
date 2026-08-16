'use strict';

// BL-908: step handlers for "Bubble browses the backlog and the docs from
// the packages held on the device, with the network off, and says how old
// they are" (specs/features/BL-908-bubble-knowledge-screen-backlog-docs-panels.feature).
//
// Per the constitution's Testability Boundary — Bubble, every panel
// DECISION this feature describes is pure Kotlin (KnowledgeReader, no
// android.* type in its own signature), verified by the REAL
// `gradlew :app:testDebugUnitTest` task (specs/pipeline/steps/lib/androidGradle.js,
// the BL-769 seam, same posture as bl907BubbleOfflinePackageSyncSteps.js).
// The generation labels in the feature text ("aaaa1111", "cccc3333") are
// symbolic scenario vocabulary matching KnowledgeReaderTest/
// KnowledgeReaderPropertyTest's own fixture generations, not literal hashes
// BL-866 would ever produce - each Given/When step records which of those
// coder-authored tests a scenario's shape maps to; the Then/And steps run
// the suite once per scenario and assert that specific test passed.
const fs = require('node:fs');
const path = require('node:path');
const { runGradle, readJUnitResults } = require('./lib/androidGradle');

const FEATURE_NAME =
  'Bubble browses the backlog and the docs from the packages held on the device, with the network off, and says how old they are';
const TEST_REPORT_DIR = 'testDebugUnitTest';
const TEST_CLASS_PREFIX = 'KnowledgeReader';

function repoRootFromHere() {
  return path.join(__dirname, '..', '..', '..');
}

function runJvmSuite(ctx) {
  if (ctx.jvmResult) {
    return; // one gradlew run serves every step within a scenario.
  }
  ctx.repoRoot = repoRootFromHere();
  ctx.androidDir = path.join(ctx.repoRoot, 'android');
  ctx.jvmResult = runGradle(ctx.repoRoot, [':app:testDebugUnitTest', '--console=plain']);
  ctx.junitResults = readJUnitResults(ctx.androidDir, TEST_REPORT_DIR);
}

function assertKnownTestPassed(ctx, nameSubstring, describeFor) {
  if (ctx.jvmResult.status !== 0) {
    throw new Error(
      `expected gradlew :app:testDebugUnitTest to exit 0 for "${describeFor}", got ${ctx.jvmResult.status}. output:\n` +
        `${ctx.jvmResult.stdout}\n${ctx.jvmResult.stderr}`
    );
  }
  const matches = ctx.junitResults.filter(
    (r) => r.classname.includes(TEST_CLASS_PREFIX) && r.name.includes(nameSubstring)
  );
  if (matches.length === 0) {
    throw new Error(
      `expected a passed test in a ${TEST_CLASS_PREFIX}* class naming "${nameSubstring}" for "${describeFor}", ` +
        `found none among: ${JSON.stringify(ctx.junitResults)}`
    );
  }
  if (matches.some((r) => !r.passed)) {
    throw new Error(`expected the matching test(s) for "${describeFor}" to have passed: ${JSON.stringify(matches)}`);
  }
}

// Disambiguates the several identically-worded Then steps shared across
// scenarios by the state each scenario's own Given/When steps recorded —
// same ctx-state precedent as bl907BubbleOfflinePackageSyncSteps.js's
// currentExpectedTest. Order matters: a scenario's most specific state
// (folder chosen, ticket/doc opened, unreachable bridge, nothing cached)
// is checked before falling back to "which panel was last opened", since
// the generation scenario is the only one where that is all there is.
function currentExpectedTest(ctx) {
  if (ctx.folder) {
    return `the backlog panel lists the tickets held under ${ctx.folder}`;
  }
  if (ctx.ticketId) {
    return 'opening a listed ticket shows the title and description the package carries';
  }
  if (ctx.docTitle) {
    return ctx.docKind === 'mermaid'
      ? 'the docs panel lists and opens a mermaid document, labelled as a diagram'
      : 'the docs panel lists and opens a markdown document';
  }
  if (ctx.bridgeUnreachable) {
    return 'both panels are populated with the network off, from held data only';
  }
  if (ctx.nothingCached) {
    return 'the backlog panel reports nothing held rather than an empty list, when nothing is cached';
  }
  if (ctx.lastPanel) {
    return `the ${ctx.lastPanel} panel states the generation it was read at`;
  }
  throw new Error(`cannot determine expected test for scenario state: ${JSON.stringify(ctx)}`);
}

function registerSteps(registry) {
  // ── Background ──────────────────────────────────────────────────────
  registry.defineScoped(
    /^the device holds a "([^"]+)" package at generation "([^"]+)"$/,
    (ctx, pkgName, generation) => {
      ctx.repoRoot = repoRootFromHere();
      ctx.androidDir = path.join(ctx.repoRoot, 'android');
      const readerFile = path.join(
        ctx.androidDir, 'app', 'src', 'main', 'java', 'com', 'swarmforge', 'floatcompanion', 'KnowledgeReader.kt'
      );
      if (!fs.existsSync(readerFile)) {
        throw new Error(`expected ${readerFile}`);
      }
      ctx.generations = ctx.generations || {};
      ctx.generations[pkgName] = generation;
    },
    FEATURE_NAME
  );

  // ── Given ───────────────────────────────────────────────────────────
  registry.defineScoped(
    /^the "([^"]+)" package holds a ticket "([^"]+)" under "([^"]+)"$/,
    (ctx, _pkgName, ticketId, ticketFolder) => {
      ctx.ticketId = ticketId;
      ctx.ticketFolder = ticketFolder;
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the "([^"]+)" package holds a "([^"]+)" document "([^"]+)"$/,
    (ctx, _pkgName, kind, title) => {
      ctx.docKind = kind;
      ctx.docTitle = title;
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the bridge is unreachable$/,
    (ctx) => {
      ctx.bridgeUnreachable = true;
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^nothing has been cached on the device$/,
    (ctx) => {
      ctx.nothingCached = true;
    },
    FEATURE_NAME
  );

  // ── When ────────────────────────────────────────────────────────────
  registry.defineScoped(
    /^the "([^"]+)" panel is opened$/,
    (ctx, panel) => {
      ctx.lastPanel = panel;
      runJvmSuite(ctx);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the "([^"]+)" folder is chosen$/,
    (ctx, folder) => {
      ctx.folder = folder;
    },
    FEATURE_NAME
  );

  // Scenario-02/03 only: which item id/title was tapped is already recorded
  // by the Given step above (ctx.ticketId / ctx.docTitle) — this step needs
  // no state of its own to disambiguate the Then that follows it.
  registry.defineScoped(
    /^"([^"]+)" is opened$/,
    () => {},
    FEATURE_NAME
  );

  // ── Then/And ────────────────────────────────────────────────────────
  registry.defineScoped(
    /^the tickets the package holds under "([^"]+)" are listed$/,
    (ctx, folder) => {
      assertKnownTestPassed(ctx, currentExpectedTest(ctx), `tickets listed under ${folder}`);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^"([^"]+)" is listed$/,
    (ctx, title) => {
      assertKnownTestPassed(ctx, currentExpectedTest(ctx), `${title} listed`);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the "([^"]+)" the package holds for "([^"]+)" is shown$/,
    (ctx, field, forWhat) => {
      assertKnownTestPassed(ctx, currentExpectedTest(ctx), `${field} shown for ${forWhat}`);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^both panels show the content the packages hold$/,
    (ctx) => {
      assertKnownTestPassed(ctx, currentExpectedTest(ctx), 'both panels show held content');
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^no request is made to the bridge$/,
    (ctx) => {
      assertKnownTestPassed(ctx, currentExpectedTest(ctx), 'no request made to the bridge');
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the view states it is as of generation "([^"]+)"$/,
    (ctx, generation) => {
      assertKnownTestPassed(ctx, currentExpectedTest(ctx), `states generation ${generation}`);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the panel reports that no copy is held$/,
    (ctx) => {
      assertKnownTestPassed(ctx, currentExpectedTest(ctx), 'panel reports no copy held');
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^no empty ticket list is shown$/,
    (ctx) => {
      assertKnownTestPassed(ctx, currentExpectedTest(ctx), 'no empty ticket list shown');
    },
    FEATURE_NAME
  );
}

module.exports = { registerSteps };
