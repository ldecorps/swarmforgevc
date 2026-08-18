'use strict';

// BL-925: step handlers for "importing an already-QA-published tip is not
// a non-QA landing". Drives the REAL test_pipeline_code_on_main_guard.sh
// (real fixture git repo, real hooks installed via core.hooksPath, real
// `git merge`/`git commit` attempts) - never a parallel reimplementation of
// the guard's own content-provenance logic. Same one-full-run-memoized-per-
// scenario pattern as bl805/bl926's own step handlers, matching this
// shell file's own "PASS: <description>" / "FAIL: <description>" output.
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const TEST_SCRIPT = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'test_pipeline_code_on_main_guard.sh');
const FEATURE = 'importing an already-QA-published tip is not a non-QA landing';

const CONTENT_TO_CHECK = {
  'taken unchanged from the QA-published parent':
    "BL-925 provenance-01a: a merge that only imports an already-QA-published tip, unchanged, is allowed",
  'newly authored in this checkout':
    'BL-925 provenance-01b: newly-authored pipeline content with no merge in progress is still refused',
  'edited on top of the merge of that parent':
    'BL-925 provenance-01c: an edit staged on top of the merge (content differs from the published parent) is still refused',
};
const CONTENT_TO_OUTCOME = {
  'taken unchanged from the QA-published parent': 'allowed',
  'newly authored in this checkout': 'refused',
  'edited on top of the merge of that parent': 'refused',
};

const COMMAND_TO_CHECK = {
  'git merge --no-edit':
    "BL-925 both-hooks-agree-02: completing the merge via 'git merge --no-edit' (pre-merge-commit hook path) is allowed",
  'git commit --no-edit':
    "BL-925 both-hooks-agree-02: completing the merge via 'git commit --no-edit' (pre-commit hook path) is also allowed",
};

const REAL_CONFLICT_CHECK =
  'BL-925 real-conflict-still-aborts-03: a real conflict still fails the merge and leaves no half-finished merge after abort';
// Same underlying fact as provenance-01a (a clean ahead-and-behind merge of
// an already-published tip succeeds) narrated from the sweep's before/after
// angle - reuses that check rather than a second, redundant fixture.
const SWEEP_COMPLETES_JOIN_CHECK = CONTENT_TO_CHECK['taken unchanged from the QA-published parent'];
const UNPUBLISHED_TIP_CHECK =
  'BL-925 unpublished-tip-is-not-waved-through-05: a merge parent that is NOT an ancestor of swarmforge-QA is refused, naming the offending paths';

function runGuardTest() {
  const result = spawnSync('bash', [TEST_SCRIPT], { encoding: 'utf8', timeout: 120000 });
  return { status: result.status, stdout: (result.stdout || '') + (result.stderr || '') };
}

function ensureResult(ctx) {
  if (!ctx.bl925.result) {
    ctx.bl925.result = runGuardTest();
  }
  return ctx.bl925.result;
}

function requirePass(ctx, description) {
  const { stdout } = ensureResult(ctx);
  if (!stdout.includes(`PASS: ${description}`)) {
    throw new Error(`expected check to pass: "${description}"\n${stdout}`);
  }
}

function registerSteps(registry) {
  registry.defineScoped(
    /^a master checkout on `main`, ahead with bookkeeping commits and behind an `origin\/main` that QA published$/,
    (ctx) => {
      ctx.bl925 = {};
    },
    FEATURE
  );

  registry.defineScoped(/^a writer that is not QA staging pipeline-code content that is "?([^"]+?)"?$/, (ctx, content) => {
    if (!(content in CONTENT_TO_CHECK)) {
      throw new Error(`BL-925: unrecognized content "${content}"`);
    }
    ctx.bl925 = { ...(ctx.bl925 || {}), content };
  }, FEATURE);

  registry.defineScoped(/^the commit-time guard runs$/, (ctx) => {
    ensureResult(ctx);
  }, FEATURE);

  registry.defineScoped(/^the commit is (allowed|refused)$/, (ctx, outcome) => {
    const { content } = ctx.bl925;
    if (CONTENT_TO_OUTCOME[content] !== outcome) {
      throw new Error(`BL-925: content "${content}" expects outcome "${CONTENT_TO_OUTCOME[content]}", got "${outcome}"`);
    }
    requirePass(ctx, CONTENT_TO_CHECK[content]);
  }, FEATURE);

  registry.defineScoped(/^the merge of the QA-published tip is completed by (.+)$/, (ctx, command) => {
    if (!(command in COMMAND_TO_CHECK)) {
      throw new Error(`BL-925: unrecognized command "${command}"`);
    }
    ctx.bl925 = { ...(ctx.bl925 || {}), command };
  }, FEATURE);

  registry.defineScoped(/^the guard runs from the hook that command fires$/, (ctx) => {
    ensureResult(ctx);
  }, FEATURE);

  registry.defineScoped(/^that hook does not refuse the merge$/, (ctx) => {
    requirePass(ctx, COMMAND_TO_CHECK[ctx.bl925.command]);
  }, FEATURE);

  registry.defineScoped(/^the incoming QA-published tip genuinely conflicts with a local bookkeeping commit$/, (ctx) => {
    ctx.bl925 = { ...(ctx.bl925 || {}), scenario: 'conflict' };
  }, FEATURE);

  registry.defineScoped(/^the reconcile sweep attempts the merge$/, (ctx) => {
    ensureResult(ctx);
  }, FEATURE);

  registry.defineScoped(/^the sweep aborts the merge and reports a conflict$/, (ctx) => {
    requirePass(ctx, REAL_CONFLICT_CHECK);
  }, FEATURE);

  registry.defineScoped(/^the checkout is left on a clean `main` with no merge in progress$/, (ctx) => {
    requirePass(ctx, REAL_CONFLICT_CHECK);
  }, FEATURE);

  registry.defineScoped(/^the sweep has aborted this same clean merge on a previous tick$/, (ctx) => {
    ctx.bl925 = { ...(ctx.bl925 || {}), scenario: 'sweep-completes' };
  }, FEATURE);

  registry.defineScoped(/^the sweep runs again after the guard change$/, (ctx) => {
    ensureResult(ctx);
  }, FEATURE);

  registry.defineScoped(/^the merge commit is created and `main` contains the published tip$/, (ctx) => {
    requirePass(ctx, SWEEP_COMPLETES_JOIN_CHECK);
  }, FEATURE);

  registry.defineScoped(/^no tick reports a conflict for that merge$/, (ctx) => {
    requirePass(ctx, SWEEP_COMPLETES_JOIN_CHECK);
  }, FEATURE);

  registry.defineScoped(/^an incoming commit touching pipeline code that is not an ancestor of the QA branch$/, (ctx) => {
    ctx.bl925 = { ...(ctx.bl925 || {}), scenario: 'unpublished' };
  }, FEATURE);

  registry.defineScoped(/^a non-QA writer completes a merge of it on `main`$/, (ctx) => {
    ensureResult(ctx);
  }, FEATURE);

  registry.defineScoped(/^the commit is refused naming the offending pipeline paths$/, (ctx) => {
    requirePass(ctx, UNPUBLISHED_TIP_CHECK);
  }, FEATURE);
}

module.exports = { registerSteps };
