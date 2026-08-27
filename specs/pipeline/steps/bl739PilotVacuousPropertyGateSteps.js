'use strict';

// BL-739: vacuous property generator gate on /pilot land for touched *.property.test.js.
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_DIR = path.join(REPO_ROOT, 'extension');
const {
  landPilotedTicket,
  resolveFeatureFilePath,
  assessPropertyGeneratorReach,
  PILOT_VACUOUS_PROPERTY_GENERATOR_REFUSAL,
} = require(path.join(EXT_DIR, 'out', 'tools', 'pilotAcceptanceGate'));

const ARCHITECT = path.join(REPO_ROOT, 'swarmforge', 'roles', 'architect.prompt');

const FEATURE = 'pilot land gate refuses vacuous declared-invariant property tests';

function scoped(registry, pattern, handler) {
  registry.defineScoped(pattern, handler, FEATURE);
}

function mkFixtureRoot() {
  return fs.mkdtempSync(path.join(require('os').tmpdir(), 'aps-bl739-'));
}

function writeTelegramCore(repoRoot, boundary = 4096) {
  const rel = 'extension/src/tools/telegramCursorBridgeCore.ts';
  const abs = path.join(repoRoot, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(
    abs,
    `export const TELEGRAM_MESSAGE_MAX_LENGTH = ${boundary};\n` +
      'export function splitTelegramChunks(text: string, maxLen: number = TELEGRAM_MESSAGE_MAX_LENGTH): string[] {\n' +
      '  if (text.length <= maxLen) return [text];\n' +
      '  return [text.slice(0, maxLen), text.slice(maxLen)];\n' +
      '}\n',
    'utf8'
  );
}

function writeChunkingProbe(repoRoot) {
  const rel = 'extension/test/helpers/chunkingPropertyProbe.js';
  const abs = path.join(repoRoot, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(
    abs,
    "'use strict';\n" +
      'const CHUNKING_PROPERTY_MAX_LEN = 50;\n' +
      'const fc = require("fast-check");\n' +
      'function runChunkingProperty(splitFn) {\n' +
      '  fc.assert(fc.property(fc.string({ minLength: 51, maxLength: 200 }), (text) => {\n' +
      '    splitFn(text, CHUNKING_PROPERTY_MAX_LEN);\n' +
      '  }));\n' +
      '  return { passed: true, sawMultiChunk: true };\n' +
      '}\n' +
      'module.exports = { runChunkingProperty, CHUNKING_PROPERTY_MAX_LEN };\n',
    'utf8'
  );
}

function writeVacuousProperty(repoRoot, rel, maxLength) {
  const abs = path.join(repoRoot, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(
    abs,
    "const fc = require('fast-check');\n" +
      "const { splitTelegramChunks } = require('../out/tools/telegramCursorBridgeCore');\n" +
      "test('property: splitTelegramChunks', () => {\n" +
      `  fc.assert(fc.property(fc.string({ maxLength: ${maxLength} }), (text) => {\n` +
      '    splitTelegramChunks(text);\n' +
      '  }));\n' +
      '});\n',
    'utf8'
  );
}

function writeReachingProperty(repoRoot, rel) {
  const abs = path.join(repoRoot, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(
    abs,
    "const { splitTelegramChunks } = require('../out/tools/telegramCursorBridgeCore');\n" +
      "const { runChunkingProperty } = require('./helpers/chunkingPropertyProbe');\n" +
      "test('property: splitTelegramChunks reassembles', () => {\n" +
      '  runChunkingProperty(splitTelegramChunks);\n' +
      '});\n',
    'utf8'
  );
}

function ensureCtx(ctx) {
  ctx.ticketId = ctx.ticketId || 'BL-739-FIXTURE';
  ctx.calls = ctx.calls || { move: 0, receipt: 0 };
  ctx.repoRootFixture = ctx.repoRootFixture || mkFixtureRoot();
  writeTelegramCore(ctx.repoRootFixture, ctx.functionBoundary || 4096);
  ctx.acceptanceDeclaration =
    ctx.acceptanceDeclaration || 'specs/features/bl739-fixture.feature';
  ctx.acceptanceRunResult = ctx.acceptanceRunResult || { success: true, output: 'ok' };
  ctx.touchedPropertyPaths = ctx.touchedPropertyPaths || [];
  ctx.historyResolvable = ctx.historyResolvable !== false;
  return ctx;
}

function reachOutcome(ctx) {
  ensureCtx(ctx);
  if (!ctx.historyResolvable) {
    return { checked: false };
  }
  if (ctx.forcedReachOutcome) {
    return ctx.forcedReachOutcome;
  }
  if (ctx.touchedPropertyPaths.length === 0) {
    return { checked: true, propertyFilesScanned: 0, scannedPaths: [] };
  }
  return assessPropertyGeneratorReach(ctx.repoRootFixture, ctx.touchedPropertyPaths);
}

function baseDeps(ctx) {
  ensureCtx(ctx);
  let executedFeaturePath;
  return {
    readAcceptanceDeclaration: () => ctx.acceptanceDeclaration,
    resolveFeatureFilePath: (declaration) => resolveFeatureFilePath(ctx.repoRootFixture, declaration),
    isLifecycleTeardownTicket: () => false,
    assessMultiworktreeFixture: () => ({
      satisfied: true,
      metadata: { worktreeCount: 1, siblingHandoffdRoots: [], pilotRoot: ctx.repoRootFixture },
    }),
    runAcceptance: async () => {
      ctx.acceptanceRunCalled = true;
      return ctx.acceptanceRunResult;
    },
    recordAcceptanceExecution: (featureFilePath) => {
      executedFeaturePath = featureFilePath;
    },
    readAcceptanceExecution: () => executedFeaturePath,
    checkCommitClaims: () => ({ checked: true, commitsChecked: 0 }),
    checkCrossFileDuplication: () => ({ checked: true, filesScanned: 0 }),
    checkScopedCrap: () => ({ checked: true, tsFilesScanned: 0, violations: [], scannedPaths: [] }),
    checkMkdtempConvention: () => ({ checked: true, testFilesScanned: 0, violations: [], scannedPaths: [] }),
    checkPropertyGeneratorReach: () => {
      ctx.reachCheckCalled = true;
      const outcome = reachOutcome(ctx);
      ctx.lastReachOutcome = outcome;
      return outcome;
    },
    checkShellEntryPointDrive: () => ({ checked: true, shellTestsScanned: 0, entryPointsNamed: 0 }),
    checkUnreachableStepHandlers: () => ({ checked: true, stepFilesScanned: 0, patternsChecked: 0 }),
    checkMultiBranchParserCoverage: () => ({ checked: true, parsersScanned: 0 }),
    checkPerHatRolePromptEvidence: () => ({ checked: true, verdictsScanned: 0 }),
    moveTicketToDone: () => {
      ctx.calls.move += 1;
      ctx.yamlMoved = true;
      return {
        moved: true,
        destination: path.join(ctx.repoRootFixture, 'backlog', 'done', `${ctx.ticketId}-fixture.yaml`),
      };
    },
    writeReceipt: (_ticketId, receipt) => {
      ctx.calls.receipt += 1;
      ctx.writtenReceipt = receipt;
    },
    getLandedCommit: () => 'e'.repeat(40),
    now: () => '2026-08-27T00:00:00.000Z',
  };
}

async function runGate(ctx) {
  ensureCtx(ctx);
  fs.mkdirSync(path.join(ctx.repoRootFixture, 'specs', 'features'), { recursive: true });
  fs.writeFileSync(
    path.join(ctx.repoRootFixture, 'specs', 'features', 'bl739-fixture.feature'),
    'Feature: fixture\n',
    'utf8'
  );
  ctx.outcome = await landPilotedTicket(ctx.ticketId, baseDeps(ctx));
}

function registerSteps(registry) {
  scoped(registry, /^a piloted ticket whose declared acceptance contract has just passed$/, (ctx) => {
    ensureCtx(ctx);
    ctx.acceptanceRunResult = { success: true, output: 'ok' };
  });

  scoped(registry, /^the run's commits added or changed a property test file$/, (ctx) => {
    ensureCtx(ctx);
    const rel = 'extension/test/bl739Touched.property.test.js';
    writeReachingProperty(ctx.repoRootFixture, rel);
    writeChunkingProbe(ctx.repoRootFixture);
    ctx.touchedPropertyPaths = [rel];
  });

  scoped(
    registry,
    /^the run's commits touched a property test for splitTelegramChunks$/,
    (ctx) => {
      ensureCtx(ctx);
      const rel = 'extension/test/bl739Split.property.test.js';
      ctx.propertyRel = rel;
      ctx.touchedPropertyPaths = [rel];
    }
  );

  scoped(registry, /^the property generator caps string length at two hundred$/, (ctx) => {
    ensureCtx(ctx);
    writeVacuousProperty(ctx.repoRootFixture, ctx.propertyRel, 200);
  });

  scoped(
    registry,
    /^splitTelegramChunks's default boundary is four thousand ninety-six$/,
    (ctx) => {
      ensureCtx(ctx);
      ctx.functionBoundary = 4096;
      writeTelegramCore(ctx.repoRootFixture, 4096);
      if (ctx.propertyRel) {
        writeVacuousProperty(ctx.repoRootFixture, ctx.propertyRel, ctx.generatorMaxLength || 200);
      }
    }
  );

  scoped(
    registry,
    /^the run's commits touched a property test whose generator crosses the targeted split boundary$/,
    (ctx) => {
      ensureCtx(ctx);
      const rel = 'extension/test/bl739Reaching.property.test.js';
      writeReachingProperty(ctx.repoRootFixture, rel);
      writeChunkingProbe(ctx.repoRootFixture);
      ctx.touchedPropertyPaths = [rel];
    }
  );

  scoped(
    registry,
    /^the run's commits touched a property test with a vacuous generator$/,
    (ctx) => {
      ensureCtx(ctx);
      const rel = 'extension/test/bl739Vacuous.property.test.js';
      writeVacuousProperty(ctx.repoRootFixture, rel, 200);
      ctx.touchedPropertyPaths = [rel];
    }
  );

  scoped(registry, /^the pilot runs the landing gate$/, async (ctx) => {
    await runGate(ctx);
  });

  scoped(
    registry,
    /^the gate compares that property test's generator bounds to the targeted function's boundary constants$/,
    (ctx) => {
      if (!ctx.reachCheckCalled) {
        throw new Error('property generator reach check was not invoked');
      }
      const outcome = ctx.lastReachOutcome || reachOutcome(ctx);
      if (!outcome.checked || outcome.propertyFilesScanned < 1) {
        throw new Error(`expected reach check on property file, got ${JSON.stringify(outcome)}`);
      }
    }
  );

  scoped(registry, /^the land is refused for a vacuous property generator$/, (ctx) => {
    if (!ctx.outcome || ctx.outcome.landed !== false) {
      throw new Error(`expected refusal, got ${JSON.stringify(ctx.outcome)}`);
    }
    if (ctx.outcome.reasonKind !== 'vacuous-property-generator') {
      throw new Error(`expected vacuous-property-generator, got ${ctx.outcome.reasonKind}`);
    }
    if (!String(ctx.outcome.reason || '').includes(PILOT_VACUOUS_PROPERTY_GENERATOR_REFUSAL)) {
      throw new Error(`refusal missing vacuous message: ${ctx.outcome.reason}`);
    }
  });

  scoped(
    registry,
    /^the refusal names the generator bound and the function boundary$/,
    (ctx) => {
      const reason = ctx.outcome?.reason || '';
      const gen = ctx.outcome?.vacuousGeneratorBound;
      const boundary = ctx.outcome?.vacuousFunctionBoundary;
      if (gen === undefined || boundary === undefined) {
        throw new Error(`missing bound fields on refusal: ${JSON.stringify(ctx.outcome)}`);
      }
      if (!reason.includes(String(gen)) || !reason.includes(String(boundary))) {
        throw new Error(`refusal did not name bounds: ${reason}`);
      }
    }
  );

  scoped(
    registry,
    /^the pilot architect-equivalent step reviews a new property test$/,
    (ctx) => {
      ctx.architectPrompt = fs.readFileSync(ARCHITECT, 'utf8');
    }
  );

  scoped(
    registry,
    /^the property generator provably never reaches the non-trivial branch it claims to protect$/,
    (ctx) => {
      ctx.vacuousReview = { generatorBound: 200, functionBoundary: 4096 };
    }
  );

  scoped(registry, /^the invariants review completes$/, (ctx) => {
    if (!ctx.architectPrompt) {
      throw new Error('architect prompt was not read');
    }
    ctx.invariantsReviewComplete = true;
  });

  scoped(registry, /^the review records a vacuous-property finding$/, (ctx) => {
    const text = ctx.architectPrompt || '';
    if (!/vacuous generator/i.test(text) || !/vacuous property/i.test(text)) {
      throw new Error('architect.prompt missing vacuous-property finding guidance');
    }
    if (!ctx.invariantsReviewComplete) {
      throw new Error('invariants review did not complete');
    }
  });

  scoped(
    registry,
    /^the finding names the generator bound mismatch before any land attempt$/,
    (ctx) => {
      const text = ctx.architectPrompt || '';
      if (!/generator bound/i.test(text) || !/function boundary/i.test(text)) {
        throw new Error('architect.prompt missing generator-vs-boundary mismatch guidance');
      }
      const review = ctx.vacuousReview || {};
      if (review.generatorBound >= review.functionBoundary) {
        throw new Error('fixture review should model a bound mismatch');
      }
    }
  );

  scoped(registry, /^the generator-reach gate completes without refusal$/, (ctx) => {
    if (!ctx.reachCheckCalled) {
      throw new Error('generator reach gate did not run');
    }
    if (ctx.outcome && ctx.outcome.reasonKind === 'vacuous-property-generator') {
      throw new Error('generator reach gate refused the land');
    }
  });

  scoped(
    registry,
    /^other landing gates may still refuse or complete independently$/,
    (ctx) => {
      if (!ctx.outcome) {
        throw new Error('landing gate did not run');
      }
      if (ctx.outcome.reasonKind === 'vacuous-property-generator') {
        throw new Error('vacuous-property refusal blocks independent other-gate outcome');
      }
    }
  );

  scoped(registry, /^the ticket yaml stays where it was$/, (ctx) => {
    if (ctx.yamlMoved || (ctx.calls && ctx.calls.move > 0)) {
      throw new Error('yaml moved on refused land');
    }
  });

  scoped(registry, /^no acceptance receipt is written$/, (ctx) => {
    if (ctx.writtenReceipt || (ctx.calls && ctx.calls.receipt > 0)) {
      throw new Error('receipt written on refused land');
    }
  });
}

module.exports = { registerSteps };
