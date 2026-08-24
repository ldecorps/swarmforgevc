'use strict';

// BL-1096: step handlers for per-path QA-import provenance (not tip-anchored).
// Drives the REAL test_pipeline_code_on_main_guard.sh — never a parallel
// reimplementation. Same one-full-run-memoized pattern as bl925.
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const TEST_SCRIPT = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'test_pipeline_code_on_main_guard.sh');
const FEATURE = 'the QA-import exemption is decided per path, not by the incoming merge tip';

const PROVENANCE_TO_CHECK = {
  'last touched by a commit QA published':
    'BL-1096 per-path: last touched by a commit QA published → allowed',
  'last touched by a commit QA never published':
    'BL-1096 per-path: last touched by a commit QA never published → refused',
  'last touched by a commit QA published and then bounced':
    'BL-1096 per-path: last touched by a commit QA published and then bounced → refused',
  "absent from the incoming side's history":
    "BL-1096 per-path: absent from the incoming side's history → refused",
  'undeterminable, the approval predicate cannot answer':
    'BL-1096 per-path: undeterminable, the approval predicate cannot answer → refused',
};

const PROVENANCE_TO_OUTCOME = {
  'last touched by a commit QA published': 'allowed',
  'last touched by a commit QA never published': 'refused',
  'last touched by a commit QA published and then bounced': 'refused',
  "absent from the incoming side's history": 'refused',
  'undeterminable, the approval predicate cannot answer': 'refused',
};

const MULTI_HOP_CHECK =
  'BL-1096 multi-hop-import-completes-01: the join completes when the incoming tip is not itself a QA landing';
const FRESH_EDIT_CHECK =
  'BL-1096 fresh-edit-still-refused-03: the edited path is refused and the imported paths are not';

function runGuardTest() {
  const result = spawnSync('bash', [TEST_SCRIPT], { encoding: 'utf8', timeout: 180000 });
  return { status: result.status, stdout: (result.stdout || '') + (result.stderr || '') };
}

function ensureResult(ctx) {
  if (!ctx.bl1096.result) {
    ctx.bl1096.result = runGuardTest();
  }
  return ctx.bl1096.result;
}

function requirePass(ctx, description) {
  const { stdout } = ensureResult(ctx);
  if (!stdout.includes(`PASS: ${description}`)) {
    throw new Error(`expected check to pass: "${description}"\n${stdout}`);
  }
}

function registerSteps(registry) {
  registry.defineScoped(
    /^a master checkout on `main`, several commits behind an `origin\/main` whose tip is a bookkeeping commit made after QA's last landing$/,
    (ctx) => {
      ctx.bl1096 = {};
    },
    FEATURE
  );

  registry.defineScoped(
    /^every offending pipeline path was last touched on the incoming side by a commit QA published$/,
    (ctx) => {
      ctx.bl1096 = { ...(ctx.bl1096 || {}), scenario: 'multi-hop' };
    },
    FEATURE
  );

  registry.defineScoped(/^a non-QA writer completes the merge on `main`$/, (ctx) => {
    ensureResult(ctx);
  }, FEATURE);

  registry.defineScoped(/^the merge commit is created$/, (ctx) => {
    requirePass(ctx, MULTI_HOP_CHECK);
  }, FEATURE);

  registry.defineScoped(/^no pipeline path is named as refused$/, (ctx) => {
    requirePass(ctx, MULTI_HOP_CHECK);
  }, FEATURE);

  registry.defineScoped(/^one offending pipeline path whose incoming provenance is (.+)$/, (ctx, provenance) => {
    if (!(provenance in PROVENANCE_TO_CHECK)) {
      throw new Error(`BL-1096: unrecognized provenance "${provenance}" — not in KNOWN_VALUES`);
    }
    ctx.bl1096 = { ...(ctx.bl1096 || {}), provenance };
  }, FEATURE);

  registry.defineScoped(/^the commit-time guard runs$/, (ctx) => {
    ensureResult(ctx);
  }, FEATURE);

  registry.defineScoped(/^that path is (allowed|refused)$/, (ctx, outcome) => {
    const { provenance } = ctx.bl1096;
    if (PROVENANCE_TO_OUTCOME[provenance] !== outcome) {
      throw new Error(
        `BL-1096: provenance "${provenance}" expects "${PROVENANCE_TO_OUTCOME[provenance]}", got "${outcome}"`
      );
    }
    requirePass(ctx, PROVENANCE_TO_CHECK[provenance]);
  }, FEATURE);

  registry.defineScoped(
    /^every offending pipeline path is importable and the writer additionally stages a new edit to one pipeline file$/,
    (ctx) => {
      ctx.bl1096 = { ...(ctx.bl1096 || {}), scenario: 'fresh-edit' };
    },
    FEATURE
  );

  registry.defineScoped(/^the edited path is refused and the imported paths are not$/, (ctx) => {
    requirePass(ctx, FRESH_EDIT_CHECK);
  }, FEATURE);
}

module.exports = { registerSteps };
