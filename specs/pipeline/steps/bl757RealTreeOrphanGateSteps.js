'use strict';

// BL-757: real-tree docs orphan gate — suite + /pilot land check.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_DIR = path.join(REPO_ROOT, 'extension');
const REAL_TREE_TEST = path.join(EXT_DIR, 'test', 'docsStructureRealTree.test.js');
const {
  landPilotedTicket,
  resolveFeatureFilePath,
  assessOrphanDocsLandCheck,
  ORPHANED_AUTHORED_DOC_REFUSAL,
} = require(path.join(EXT_DIR, 'out', 'tools', 'pilotAcceptanceGate'));
const { computeDocsStructure } = require(path.join(EXT_DIR, 'out', 'docs', 'docsStructure'));
const {
  filterNonAllowlistedOrphans,
  loadKnownOrphanAllowlist,
  orphanDocKey,
} = require(path.join(EXT_DIR, 'out', 'docs', 'docsOrphanAllowlist'));

const FEATURE = 'real docs tree orphan check is a mechanical land and suite gate';

const BL756_CLEARED = [
  'how-to/BL-623-routing-skip-trail-records-actual-hop.md',
  'how-to/BL-637-lifecycle-script-scope.md',
  'how-to/BL-641-pages-deploy-timeout-and-action-majors.md',
  'how-to/BL-642-gate-snippet-question-not-chrome.md',
  'how-to/BL-661-stage-skip-reasons-flow-style.md',
  'how-to/BL-662-paused-pager-shows-server-failure-reason.md',
  'how-to/BL-671-operator-runtime-fixture-sandbox.md',
  'how-to/BL-694-residual-word-allowlist-survives-stage-moves.md',
  'how-to/BL-718-bubble-talk-mirror-chunks-and-fails-loudly.md',
  'reference/specs/BL-627-pricing-table-correctness-and-coverage-invariant.md',
];

function scoped(registry, pattern, handler) {
  registry.defineScoped(pattern, handler, FEATURE);
}

function mkFixtureRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aps-bl757-'));
}

function ensureCtx(ctx) {
  ctx.ticketId = ctx.ticketId || 'BL-757-FIXTURE';
  ctx.calls = ctx.calls || { move: 0, receipt: 0 };
  ctx.repoRootFixture = ctx.repoRootFixture || mkFixtureRoot();
  ctx.acceptanceDeclaration =
    ctx.acceptanceDeclaration || 'specs/features/bl757-fixture.feature';
  ctx.acceptanceRunResult = ctx.acceptanceRunResult || { success: true, output: 'ok' };
  ctx.touchedPaths = ctx.touchedPaths || [];
  ctx.orphans = ctx.orphans || [];
  ctx.allowlist = ctx.allowlist || new Set();
  return ctx;
}

function orphanOutcome(ctx) {
  ensureCtx(ctx);
  return assessOrphanDocsLandCheck({
    touchedRelativePaths: ctx.touchedPaths,
    orphans: ctx.orphans,
    allowlist: ctx.allowlist,
  });
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
    runAcceptance: async () => ctx.acceptanceRunResult,
    recordAcceptanceExecution: (featureFilePath) => {
      executedFeaturePath = featureFilePath;
    },
    readAcceptanceExecution: () => executedFeaturePath,
    checkCommitClaims: () => ({ checked: true, commitsChecked: 0 }),
    checkCrossFileDuplication: () => ({ checked: true, filesScanned: 0 }),
    checkScopedCrap: () => ({ checked: true, tsFilesScanned: 0, violations: [] }),
    checkMkdtempConvention: () => ({ checked: true, testFilesScanned: 0, violations: [], scannedPaths: [] }),
    checkPropertyGeneratorReach: () => ({ checked: true, propertyFilesScanned: 0, scannedPaths: [] }),
    checkShellEntryPointDrive: () => ({ checked: true, shellTestsScanned: 0, entryPointsNamed: 0 }),
    checkOrphanedAuthoredDocs: () => orphanOutcome(ctx),
    checkUnreachableStepHandlers: () => ({ checked: true, stepFilesScanned: 0, patternsChecked: 0 }),
    checkMultiBranchParserCoverage: () => ({ checked: true, parsersScanned: 0 }),
    checkMultiBranchSiblingGating: () => ({ checked: true, dispatchesScanned: 0 }),
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
    path.join(ctx.repoRootFixture, 'specs', 'features', 'bl757-fixture.feature'),
    'Feature: fixture\n',
    'utf8'
  );
  ctx.outcome = await landPilotedTicket(ctx.ticketId, baseDeps(ctx));
}

function writeMinimalDocsTree(root, { orphanFile, indexLinks = [] }) {
  const docs = path.join(root, 'docs');
  fs.mkdirSync(path.join(docs, 'how-to'), { recursive: true });
  if (orphanFile) {
    fs.writeFileSync(path.join(docs, 'how-to', orphanFile), '# orphan\n', 'utf8');
  }
  const lines = ['## How-to guides', '*Task-oriented: recipes.*', ...indexLinks];
  for (const mode of ['tutorials', 'reference', 'explanation']) {
    fs.mkdirSync(path.join(docs, mode), { recursive: true });
    fs.writeFileSync(path.join(docs, mode, 'a.md'), '# a\n', 'utf8');
    lines.push(`## ${mode}`, `*${mode}-oriented.*`, `- [a](${mode}/a.md)`);
  }
  fs.writeFileSync(path.join(docs, 'index.md'), lines.join('\n'), 'utf8');
}

function registerSteps(registry) {
  scoped(registry, /^computeDocsStructure can report orphanedDocs for a docs tree root$/, () => {});

  scoped(
    registry,
    /^BL-756 has cleared the ten named pilot-batch paths from orphanedDocs$/,
    () => {
      const report = computeDocsStructure(REPO_ROOT);
      const keys = new Set(report.orphanedDocs.map(orphanDocKey));
      for (const cleared of BL756_CLEARED) {
        if (keys.has(cleared)) {
          throw new Error(`BL-756 path still orphaned: ${cleared}`);
        }
      }
    }
  );

  scoped(registry, /^the docs-structure real-tree suite runs$/, (ctx) => {
    const root = ctx.fixtureRoot || REPO_ROOT;
    const allowlist =
      ctx.fixtureAllowlist !== undefined
        ? ctx.fixtureAllowlist
        : loadKnownOrphanAllowlist(REPO_ROOT);
    ctx.suiteReport = computeDocsStructure(root);
    ctx.suiteAllowlist = allowlist;
    ctx.suiteViolations = filterNonAllowlistedOrphans(ctx.suiteReport.orphanedDocs, allowlist);
    ctx.realTreeReport = ctx.suiteReport;
    ctx.realTreeAllowlist = allowlist;
    ctx.realTreeViolations = ctx.suiteViolations;
  });

  scoped(
    registry,
    /^it invokes computeDocsStructure against this repository's docs root$/,
    () => {
      const text = fs.readFileSync(REAL_TREE_TEST, 'utf8');
      if (!/computeDocsStructure\s*\(\s*REPO_ROOT\s*\)/.test(text)) {
        throw new Error('real-tree suite must call computeDocsStructure(REPO_ROOT)');
      }
    }
  );

  scoped(
    registry,
    /^it does not use only a throwaway fixture tree for that assertion$/,
    () => {
      const text = fs.readFileSync(REAL_TREE_TEST, 'utf8');
      if (!/computeDocsStructure\s*\(\s*REPO_ROOT\s*\)/.test(text)) {
        throw new Error('real-tree suite missing REPO_ROOT assertion');
      }
    }
  );

  scoped(
    registry,
    /^the real docs tree has an authored Divio-mode doc not linked from docs\/index\.md$/,
    (ctx) => {
      ctx.fixtureRoot = mkFixtureRoot();
      writeMinimalDocsTree(ctx.fixtureRoot, { orphanFile: 'fresh-orphan.md' });
      ctx.fixtureReport = computeDocsStructure(ctx.fixtureRoot);
    }
  );

  scoped(registry, /^that path is not on the dated known-orphan allowlist$/, (ctx) => {
    ctx.fixtureAllowlist = new Set();
  });

  scoped(registry, /^the suite fails$/, (ctx) => {
    const violations = ctx.suiteViolations || [];
    if (violations.length === 0) {
      throw new Error('expected suite failure on non-allowlisted orphan');
    }
    ctx.fixtureViolations = violations;
  });

  scoped(registry, /^the failure names the orphaned path$/, (ctx) => {
    const named = (ctx.fixtureViolations || [])
      .map((d) => `${d.mode}/${d.file}`)
      .join(' ');
    if (!/fresh-orphan\.md/.test(named)) {
      throw new Error(`failure did not name orphan path: ${named}`);
    }
  });

  scoped(
    registry,
    /^the real docs tree reports an orphaned path that is on the dated known-orphan allowlist$/,
    (ctx) => {
      ctx.fixtureRoot = mkFixtureRoot();
      writeMinimalDocsTree(ctx.fixtureRoot, { orphanFile: 'known-debt.md' });
      ctx.fixtureReport = computeDocsStructure(ctx.fixtureRoot);
      ctx.fixtureAllowlist = new Set(['how-to/known-debt.md']);
    }
  );

  scoped(
    registry,
    /^every non-allowlisted authored Divio-mode doc is linked from docs\/index\.md$/,
    (ctx) => {
      const violations = filterNonAllowlistedOrphans(
        ctx.fixtureReport.orphanedDocs,
        ctx.fixtureAllowlist
      );
      if (violations.length > 0) {
        throw new Error(`unexpected non-allowlisted orphans: ${JSON.stringify(violations)}`);
      }
    }
  );

  scoped(registry, /^the suite passes the orphan assertion$/, (ctx) => {
    const violations = ctx.suiteViolations || [];
    if (violations.length > 0) {
      throw new Error(`expected pass, got violations: ${JSON.stringify(violations)}`);
    }
  });

  scoped(
    registry,
    /^the allowlist entry carries a date so known debt is not permanent-silent$/,
    () => {
      const allowlistPath = path.join(REPO_ROOT, 'extension', 'test', 'docs_orphan_known_debt.tsv');
      const text = fs.readFileSync(allowlistPath, 'utf8');
      const dataLine = text.split('\n').find((l) => l.trim() && !l.trim().startsWith('#'));
      if (!dataLine || !/\t20\d{2}-\d{2}-\d{2}\t/.test(dataLine)) {
        throw new Error('allowlist TSV missing dated entries');
      }
    }
  );

  scoped(
    registry,
    /^the run's commits add or change an authored doc under a Divio mode directory$/,
    (ctx) => {
      ensureCtx(ctx);
      ctx.touchedPaths = ['docs/how-to/new-orphan.md'];
      ctx.orphans = [{ mode: 'how-to', file: 'new-orphan.md' }];
      ctx.allowlist = new Set();
    }
  );

  scoped(registry, /^that doc is not linked from docs\/index\.md$/, () => {});
  scoped(registry, /^the path is not on the known-orphan allowlist$/, () => {});

  scoped(
    registry,
    /^the run's commits add an authored doc under a Divio mode directory$/,
    (ctx) => {
      ensureCtx(ctx);
      ctx.touchedPaths = ['docs/how-to/indexed-doc.md'];
      ctx.orphans = [];
      ctx.allowlist = new Set();
    }
  );

  scoped(
    registry,
    /^docs\/index\.md links that path in the matching section$/,
    () => {}
  );

  scoped(
    registry,
    /^the run's commits touched no authored Divio-mode doc under docs\/$/,
    (ctx) => {
      ensureCtx(ctx);
      ctx.touchedPaths = ['extension/src/tools/example.ts'];
      ctx.orphans = [{ mode: 'how-to', file: 'stale-orphan.md' }];
      ctx.allowlist = new Set();
    }
  );

  scoped(
    registry,
    /^the run's commits add an authored doc that is orphaned and not allowlisted$/,
    (ctx) => {
      ensureCtx(ctx);
      ctx.touchedPaths = ['docs/reference/orphan-ref.md'];
      ctx.orphans = [{ mode: 'reference', file: 'orphan-ref.md' }];
      ctx.allowlist = new Set();
    }
  );

  scoped(registry, /^the pilot runs the landing gate$/, async (ctx) => {
    await runGate(ctx);
  });

  scoped(registry, /^the land is refused for an orphaned authored doc$/, (ctx) => {
    if (!ctx.outcome || ctx.outcome.landed !== false) {
      throw new Error(`expected refusal, got ${JSON.stringify(ctx.outcome)}`);
    }
    if (ctx.outcome.reasonKind !== 'orphaned-authored-doc') {
      throw new Error(`expected orphaned-authored-doc, got ${ctx.outcome.reasonKind}`);
    }
    if (!ctx.outcome.reason.includes(ORPHANED_AUTHORED_DOC_REFUSAL)) {
      throw new Error(`refusal missing orphan message: ${ctx.outcome.reason}`);
    }
  });

  scoped(registry, /^the refusal names the path$/, (ctx) => {
    const reason = (ctx.outcome && ctx.outcome.reason) || '';
    if (!/docs\//.test(reason)) {
      throw new Error(`refusal did not name doc path: ${reason}`);
    }
  });

  scoped(
    registry,
    /^the orphan-docs land check completes without refusal for that path$/,
    (ctx) => {
      const outcome = orphanOutcome(ctx);
      if (outcome.checked && outcome.docsTouched && outcome.miss) {
        throw new Error(`unexpected orphan miss: ${JSON.stringify(outcome.miss)}`);
      }
    }
  );

  scoped(
    registry,
    /^other landing gates may still refuse or complete independently$/,
    () => {}
  );

  scoped(
    registry,
    /^missing orphan-docs evidence does not by itself refuse the land$/,
    async (ctx) => {
      await runGate(ctx);
      if (!ctx.outcome || ctx.outcome.landed !== true) {
        throw new Error(`expected land when docs untouched, got ${JSON.stringify(ctx.outcome)}`);
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
