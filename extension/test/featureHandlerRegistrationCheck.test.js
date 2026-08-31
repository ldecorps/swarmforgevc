'use strict';

const assert = require('node:assert/strict');
const {
  assessFeatureHandlerRegistration,
  formatFeatureHandlerRefusal,
  REGISTRY_PATH,
} = require('../out/tools/featureHandlerRegistrationCheck');

// BL-1303: specs/pipeline/runtime.js throws on any scenario whose steps no
// registered handler matches, so a feature file can reach `main` carrying
// scenarios that cannot run at all. These cases pin the pure assessor the
// commit guard delegates to: what counts as an offender, that ONE pass
// reports every one of them, and that an artifact it cannot read is a
// refusal naming it rather than a silent pass.
//
// The live incident (2026-08-30, BL-1253) is case 09: a bounce-revert removed
// a handler, its lib script and its index.js registration together; a later
// merge resurrected the handler and the feature but neither the registration
// nor the lib, and `main` carried 8 scenarios that all failed.

const STEPS = 'specs/pipeline/steps';

/** A tree builder: files is a map of repo-relative path -> text (null = unreadable). */
function tree(files) {
  const paths = Object.keys(files);
  return {
    featureFiles: paths.filter((p) => p.startsWith('specs/features/') && p.endsWith('.feature')),
    stepFiles: paths.filter((p) => /^specs\/pipeline\/steps\/[^/]+\.js$/.test(p)),
    libFiles: paths.filter((p) => p.startsWith(`${STEPS}/lib/`)),
    readFile: (p) => (p in files ? files[p] : null),
  };
}

function registry(...modules) {
  return `const DOMAINS = [\n${modules.map((m) => `  require('./${m}'),`).join('\n')}\n];\n`;
}

function kinds(offenders) {
  return offenders.map((o) => o.kind);
}

// ── 01: a feature whose handler is registered is allowed through ────────────
test('a feature whose handler is registered reports no offender', () => {
  const offenders = assessFeatureHandlerRegistration(
    tree({
      'specs/features/BL-1-thing.feature': 'Feature: thing',
      [`${STEPS}/index.js`]: registry('bl1ThingSteps'),
      [`${STEPS}/bl1ThingSteps.js`]: 'module.exports = {};',
    })
  );
  assert.deepEqual(offenders, []);
});

// ── 02: handler file present, registration absent ───────────────────────────
test('a handler file present but absent from the registry is an offender naming both', () => {
  const offenders = assessFeatureHandlerRegistration(
    tree({
      'specs/features/BL-1253-dead-feeder.feature': 'Feature: dead feeder',
      [`${STEPS}/index.js`]: registry('backlogSteps'),
      [`${STEPS}/backlogSteps.js`]: 'module.exports = {};',
      [`${STEPS}/bl1253DeadFeederOwnsGetUpdatesStampSteps.js`]: 'module.exports = {};',
    })
  );
  assert.deepEqual(kinds(offenders), ['unregistered-handler']);
  assert.equal(offenders[0].path, `${STEPS}/bl1253DeadFeederOwnsGetUpdatesStampSteps.js`);
  assert.equal(offenders[0].feature, 'specs/features/BL-1253-dead-feeder.feature');
});

// ── 03: registered handler reaching for an absent sibling script ────────────
test('a registered handler whose sibling script is absent is an offender naming the script', () => {
  const offenders = assessFeatureHandlerRegistration(
    tree({
      'specs/features/BL-1253-dead-feeder.feature': 'Feature: dead feeder',
      [`${STEPS}/index.js`]: registry('bl1253DeadFeederOwnsGetUpdatesStampSteps'),
      [`${STEPS}/bl1253DeadFeederOwnsGetUpdatesStampSteps.js`]:
        "const CLI = path.join(__dirname, 'lib', 'bl1253StartCursorBridgeFeederCli.sh');",
    })
  );
  assert.deepEqual(kinds(offenders), ['missing-sibling-script']);
  assert.equal(offenders[0].path, `${STEPS}/lib/bl1253StartCursorBridgeFeederCli.sh`);
  assert.equal(offenders[0].handler, `${STEPS}/bl1253DeadFeederOwnsGetUpdatesStampSteps.js`);
});

test('a sibling script that IS present is not an offender', () => {
  const offenders = assessFeatureHandlerRegistration(
    tree({
      [`${STEPS}/index.js`]: registry('bl1Steps'),
      [`${STEPS}/bl1Steps.js`]: "const CLI = path.join(__dirname, 'lib', 'bl1Cli.sh');",
      [`${STEPS}/lib/bl1Cli.sh`]: '#!/usr/bin/env bash',
    })
  );
  assert.deepEqual(offenders, []);
});

test("a sibling required without an extension resolves against the tree's .js file", () => {
  const present = assessFeatureHandlerRegistration(
    tree({
      [`${STEPS}/index.js`]: registry('bl1Steps'),
      [`${STEPS}/bl1Steps.js`]: "require(path.join(REPO, 'specs', 'pipeline', 'steps', 'lib', 'tempDirTrapGuard'));",
      [`${STEPS}/lib/tempDirTrapGuard.js`]: 'module.exports = {};',
    })
  );
  assert.deepEqual(present, []);

  const absent = assessFeatureHandlerRegistration(
    tree({
      [`${STEPS}/index.js`]: registry('bl1Steps'),
      [`${STEPS}/bl1Steps.js`]: "require(path.join(REPO, 'specs', 'pipeline', 'steps', 'lib', 'tempDirTrapGuard'));",
    })
  );
  assert.deepEqual(kinds(absent), ['missing-sibling-script']);
  assert.equal(absent[0].path, `${STEPS}/lib/tempDirTrapGuard.js`);
});

test('a lib path named only in prose is not read as a reference', () => {
  const offenders = assessFeatureHandlerRegistration(
    tree({
      [`${STEPS}/index.js`]: registry('bl1Steps'),
      [`${STEPS}/bl1Steps.js`]:
        '// mirrors specs/pipeline/steps/lib/bl1RetiredCli.sh, which used to exist\n',
    })
  );
  assert.deepEqual(offenders, []);
});

// ── 04: one pass reports EVERY offender ─────────────────────────────────────
test('one pass reports every offending feature, not only the first', () => {
  const offenders = assessFeatureHandlerRegistration(
    tree({
      'specs/features/BL-1-one.feature': 'Feature: one',
      'specs/features/BL-2-two.feature': 'Feature: two',
      'specs/features/BL-3-three.feature': 'Feature: three',
      [`${STEPS}/index.js`]: registry('backlogSteps'),
      [`${STEPS}/backlogSteps.js`]: 'module.exports = {};',
      [`${STEPS}/bl1OneSteps.js`]: 'module.exports = {};',
      [`${STEPS}/bl2TwoSteps.js`]: 'module.exports = {};',
      [`${STEPS}/bl3ThreeSteps.js`]: 'module.exports = {};',
    })
  );
  assert.equal(offenders.length, 3);
  assert.deepEqual(
    offenders.map((o) => o.feature).sort(),
    [
      'specs/features/BL-1-one.feature',
      'specs/features/BL-2-two.feature',
      'specs/features/BL-3-three.feature',
    ]
  );
});

test('offenders of different kinds are reported together in one pass', () => {
  const offenders = assessFeatureHandlerRegistration(
    tree({
      'specs/features/BL-1-one.feature': 'Feature: one',
      [`${STEPS}/index.js`]: registry('bl2TwoSteps', 'bl4GoneSteps'),
      [`${STEPS}/bl1OneSteps.js`]: 'module.exports = {};',
      [`${STEPS}/bl2TwoSteps.js`]: "const CLI = path.join(__dirname, 'lib', 'bl2Cli.sh');",
    })
  );
  assert.deepEqual(kinds(offenders).sort(), [
    'missing-registry-module',
    'missing-sibling-script',
    'unregistered-handler',
  ]);
});

// ── 06: fail closed on what cannot be read ──────────────────────────────────
test('an unreadable step registry is a refusal naming it, never a silent pass', () => {
  const offenders = assessFeatureHandlerRegistration(
    tree({
      'specs/features/BL-1-one.feature': 'Feature: one',
      [`${STEPS}/bl1OneSteps.js`]: 'module.exports = {};',
    })
  );
  assert.ok(kinds(offenders).includes('unreadable-step-registry'));
  assert.equal(
    offenders.find((o) => o.kind === 'unreadable-step-registry').path,
    REGISTRY_PATH
  );
});

test('an unreadable registry still lets the sibling-script offenders through in the same pass', () => {
  const offenders = assessFeatureHandlerRegistration(
    tree({
      [`${STEPS}/bl1OneSteps.js`]: "const CLI = path.join(__dirname, 'lib', 'gone.sh');",
    })
  );
  assert.deepEqual(kinds(offenders).sort(), ['missing-sibling-script', 'unreadable-step-registry']);
});

test('a registered handler that cannot be read is a refusal naming it', () => {
  // Absent and unreadable are the same offender: either way the registry
  // cannot be followed to that handler, and neither is a pass.
  const files = {
    [`${STEPS}/index.js`]: registry('bl1OneSteps'),
    [`${STEPS}/bl1OneSteps.js`]: null,
  };
  const offenders = assessFeatureHandlerRegistration(tree(files));
  assert.deepEqual(kinds(offenders), ['missing-registry-module']);
  assert.equal(offenders[0].path, `${STEPS}/bl1OneSteps.js`);
});

test('a handler kept in a subdirectory of steps/ resolves like any other', () => {
  const offenders = assessFeatureHandlerRegistration({
    featureFiles: [],
    stepFiles: [`${STEPS}/index.js`],
    libFiles: [],
    readFile: (p) =>
      ({
        [`${STEPS}/index.js`]: "const DOMAINS = [require('./helpers/tmpDir')];",
        [`${STEPS}/helpers/tmpDir.js`]: 'module.exports = {};',
      })[p] ?? null,
  });
  assert.deepEqual(offenders, []);
});

test("a require inside steps/lib/ resolves against lib/, not against steps/", () => {
  const offenders = assessFeatureHandlerRegistration({
    featureFiles: [],
    stepFiles: [`${STEPS}/index.js`],
    libFiles: [`${STEPS}/lib/androidJvmDecisionSteps.js`, `${STEPS}/lib/androidGradle.js`],
    readFile: (p) =>
      ({
        [`${STEPS}/index.js`]: "const DOMAINS = [require('./lib/androidJvmDecisionSteps')];",
        [`${STEPS}/lib/androidJvmDecisionSteps.js`]: "require('./androidGradle');",
        [`${STEPS}/lib/androidGradle.js`]: 'module.exports = {};',
      })[p] ?? null,
  });
  assert.deepEqual(offenders, []);
});

test('a focused entry module beside a registered handler is not an offender', () => {
  // steps/bl623Only.js exists purely to require steps/bl623RoutingSkipTrailSteps.js;
  // only the latter is ever named in index.js, and BL-623 runs fine.
  const offenders = assessFeatureHandlerRegistration(
    tree({
      'specs/features/BL-623-routing.feature': 'Feature: routing',
      [`${STEPS}/index.js`]: registry('bl623RoutingSkipTrailSteps'),
      [`${STEPS}/bl623RoutingSkipTrailSteps.js`]: 'module.exports = {};',
      [`${STEPS}/bl623Only.js`]: "require('./bl623RoutingSkipTrailSteps');",
    })
  );
  assert.deepEqual(offenders, []);
});

test('a lib path rooted somewhere other than this steps directory is not a sibling reference', () => {
  const offenders = assessFeatureHandlerRegistration(
    tree({
      [`${STEPS}/index.js`]: registry('bl1058PortableMktempSteps'),
      [`${STEPS}/bl1058PortableMktempSteps.js`]:
        "const HELPER = path.join(TEST_DIR, 'lib', 'tmp_cleanup.sh');",
    })
  );
  assert.deepEqual(offenders, []);
});

test('a module the registry requires but the tree does not carry is a refusal naming it', () => {
  const offenders = assessFeatureHandlerRegistration(
    tree({ [`${STEPS}/index.js`]: registry('bl9VanishedSteps') })
  );
  assert.deepEqual(kinds(offenders), ['missing-registry-module']);
  assert.equal(offenders[0].path, `${STEPS}/bl9VanishedSteps.js`);
});

// ── reachability is transitive, not one hop ─────────────────────────────────
test('a handler registered through another step file counts as registered', () => {
  const offenders = assessFeatureHandlerRegistration(
    tree({
      'specs/features/BL-1-one.feature': 'Feature: one',
      [`${STEPS}/index.js`]: registry('aggregateSteps'),
      [`${STEPS}/aggregateSteps.js`]: "require('./bl1OneSteps');",
      [`${STEPS}/bl1OneSteps.js`]: 'module.exports = {};',
    })
  );
  assert.deepEqual(offenders, []);
});

// ── a feature served by generic handlers is not an offender ─────────────────
test('a feature with no ticket-named handler file of its own is not an offender', () => {
  const offenders = assessFeatureHandlerRegistration(
    tree({
      'specs/features/BL-77-served-generically.feature': 'Feature: generic',
      [`${STEPS}/index.js`]: registry('backlogSteps'),
      [`${STEPS}/backlogSteps.js`]: 'module.exports = {};',
    })
  );
  assert.deepEqual(offenders, []);
});

test('a ticket-named handler is not confused with a longer ticket number', () => {
  const offenders = assessFeatureHandlerRegistration(
    tree({
      'specs/features/BL-130-short.feature': 'Feature: short',
      [`${STEPS}/index.js`]: registry('backlogSteps'),
      [`${STEPS}/backlogSteps.js`]: 'module.exports = {};',
      [`${STEPS}/bl1303SomethingElseSteps.js`]: 'module.exports = {};',
    })
  );
  // bl1303... belongs to BL-1303, never to BL-130.
  assert.deepEqual(
    offenders.filter((o) => o.feature === 'specs/features/BL-130-short.feature'),
    []
  );
});

// ── the refusal text ────────────────────────────────────────────────────────
test('the refusal names every offender and says the report is complete', () => {
  const offenders = assessFeatureHandlerRegistration(
    tree({
      'specs/features/BL-1-one.feature': 'Feature: one',
      'specs/features/BL-2-two.feature': 'Feature: two',
      [`${STEPS}/index.js`]: registry('backlogSteps'),
      [`${STEPS}/backlogSteps.js`]: 'module.exports = {};',
      [`${STEPS}/bl1OneSteps.js`]: 'module.exports = {};',
      [`${STEPS}/bl2TwoSteps.js`]: 'module.exports = {};',
    })
  );
  const text = formatFeatureHandlerRefusal(offenders);
  assert.match(text, /specs\/features\/BL-1-one\.feature/);
  assert.match(text, /specs\/features\/BL-2-two\.feature/);
  assert.match(text, /unregistered handler/);
  assert.match(text, /2 offending/);
});

test('an empty offender list formats as an empty refusal', () => {
  assert.equal(formatFeatureHandlerRefusal([]), '');
});

// ── fixture source a step file CARRIES is not code this tree runs ───────────
test('a require embedded in a double-quoted fixture string is not a registry hop', () => {
  const offenders = assessFeatureHandlerRegistration(
    tree({
      [`${STEPS}/index.js`]: registry('bl1209DetectorSteps'),
      [`${STEPS}/bl1209DetectorSteps.js`]:
        'const FIXTURE = "const { mkTmpDir } = require(\'./helpers/tmpDir\');";\n',
    })
  );
  assert.deepEqual(offenders, []);
});

test('a lib path embedded in a template literal is not a sibling reference', () => {
  const offenders = assessFeatureHandlerRegistration(
    tree({
      [`${STEPS}/index.js`]: registry('bl1Steps'),
      [`${STEPS}/bl1Steps.js`]:
        'const FIXTURE = `const CLI = path.join(__dirname, \'lib\', \'gone.sh\');`;\n',
    })
  );
  assert.deepEqual(offenders, []);
});
