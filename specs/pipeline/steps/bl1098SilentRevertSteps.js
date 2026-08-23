'use strict';

// BL-1098: step handlers for "Content that no commit authored never reaches
// origin". Drives the REAL push_sweep_cli.bb (same seam BL-630 / BL-356 use —
// forced rev-counts / silent-revert gate facts, no real git process) so the
// pure decision in push_sweep_lib.bb/silent-revert-decision is exercised
// through the adapters handoffd.bb wires in production. Real-git plumbing
// (push-sweep-silent-revert-gate-facts!) is proven by unit + wiring tests,
// not re-proven per scenario here.

const { runSweep, mkDaemonDir } = require('./pushSweepSteps');

const PATH = 'specs/pipeline/steps/bl1098_fixture.js';
const NEWEST_AUTHORING = 'auth1098new1';
const DIVERGENCE_MERGE = 'merge1098div1';

function basePathFacts(overrides) {
  return Object.assign({
    path: PATH,
    'tip-matches-newest-authoring?': false,
    'tip-is-superseded-resurrection?': false,
    'tip-absent-without-delete?': false,
    'newest-authoring-sha': NEWEST_AUTHORING,
    'divergence-merge-sha': null,
  }, overrides);
}

function tipContentFacts(tipContent) {
  if (tipContent === 'the content that newest authoring commit wrote') {
    return basePathFacts({
      'tip-matches-newest-authoring?': true,
      'newest-authoring-sha': NEWEST_AUTHORING,
      'divergence-merge-sha': null,
    });
  }
  if (tipContent === 'a superseded blob an earlier commit authored') {
    return basePathFacts({
      'tip-is-superseded-resurrection?': true,
      'newest-authoring-sha': NEWEST_AUTHORING,
      'divergence-merge-sha': DIVERGENCE_MERGE,
    });
  }
  if (tipContent === 'no file at all, with no delete commit recorded') {
    return basePathFacts({
      'tip-absent-without-delete?': true,
      'newest-authoring-sha': NEWEST_AUTHORING,
      'divergence-merge-sha': DIVERGENCE_MERGE,
    });
  }
  throw new Error(`unknown tip_content example: ${JSON.stringify(tipContent)}`);
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^the push sweep is inspecting the commits on main that have not reached origin$/, (ctx) => {
    ctx.daemonDir = ctx.daemonDir || mkDaemonDir();
    ctx.now = ctx.now === undefined ? 100000 : ctx.now;
    ctx.revCounts = { ahead: 1, behind: 0 };
  });

  registry.define(/^the inspection covers the paths that merges in that range touched$/, () => {});

  // ── silent-revert-of-landed-content-01 ───────────────────────────────
  registry.define(/^a path whose newest authoring commit is a non-merge commit$/, (ctx) => {
    ctx.pathUnderTest = PATH;
  });

  registry.define(/^the tip holds (.+) for that path$/, (ctx, tipContent) => {
    ctx.silentRevertGateFacts = {
      'facts-complete?': true,
      'candidate-paths': [tipContentFacts(tipContent)],
    };
    if (tipContent === 'the content that newest authoring commit wrote') {
      ctx.pushResult = { success: true };
    }
  });

  registry.define(/^the push sweep decides whether to push$/, (ctx) => {
    ctx.result = runSweep(ctx.daemonDir, ctx.now, {
      revCounts: ctx.revCounts,
      pushResult: ctx.pushResult,
      silentRevertGateFacts: ctx.silentRevertGateFacts,
    });
  });

  registry.define(/^the push is (allowed|refused)$/, (ctx, verdict) => {
    if (verdict === 'allowed') {
      if (ctx.result.pushCalls !== 1) {
        throw new Error(`expected push allowed (1 call), got: ${JSON.stringify(ctx.result)}`);
      }
      return;
    }
    if (ctx.result.pushCalls !== 0) {
      throw new Error(`expected push refused (0 calls), got: ${JSON.stringify(ctx.result)}`);
    }
    const refused = ctx.result.logLines.some((line) => line.includes('silent-revert-refused'));
    if (!refused) {
      throw new Error(`expected silent-revert-refused log, got: ${JSON.stringify(ctx.result.logLines)}`);
    }
  });

  // ── silent-revert-of-landed-content-02 ───────────────────────────────
  registry.define(/^a path whose tip content is a superseded blob an earlier commit authored$/, (ctx) => {
    ctx.pathUnderTest = PATH;
    ctx.newestAuthoringSha = NEWEST_AUTHORING;
    ctx.divergenceMergeSha = DIVERGENCE_MERGE;
    ctx.silentRevertGateFacts = {
      'facts-complete?': true,
      'candidate-paths': [tipContentFacts('a superseded blob an earlier commit authored')],
    };
  });

  registry.define(/^the push sweep refuses to push$/, (ctx) => {
    ctx.result = runSweep(ctx.daemonDir, ctx.now, {
      revCounts: ctx.revCounts,
      silentRevertGateFacts: ctx.silentRevertGateFacts,
    });
    if (ctx.result.pushCalls !== 0) {
      throw new Error(`expected refusal with zero push calls, got: ${JSON.stringify(ctx.result)}`);
    }
  });

  registry.define(/^the refusal names the path$/, (ctx) => {
    const found = ctx.result.logLines.some((line) =>
      line.includes('silent-revert-refused') && line.includes(ctx.pathUnderTest));
    if (!found) {
      throw new Error(`expected refusal to name path ${ctx.pathUnderTest}, got: ${JSON.stringify(ctx.result.logLines)}`);
    }
  });

  registry.define(/^the refusal names the commit that authored the content the tip is missing$/, (ctx) => {
    const found = ctx.result.logLines.some((line) =>
      line.includes('silent-revert-refused') && line.includes(ctx.newestAuthoringSha));
    if (!found) {
      throw new Error(`expected refusal to name authoring commit ${ctx.newestAuthoringSha}, got: ${JSON.stringify(ctx.result.logLines)}`);
    }
  });

  registry.define(/^the refusal names the merge commit at which the path stopped matching that commit$/, (ctx) => {
    const found = ctx.result.logLines.some((line) =>
      line.includes('silent-revert-refused') && line.includes(ctx.divergenceMergeSha));
    if (!found) {
      throw new Error(`expected refusal to name divergence merge ${ctx.divergenceMergeSha}, got: ${JSON.stringify(ctx.result.logLines)}`);
    }
  });

  // ── silent-revert-of-landed-content-03 ───────────────────────────────
  registry.define(/^a merge that discarded paths its second parent had changed one-sidedly$/, (ctx) => {
    ctx.reconcilePaths = ['a.js', 'b.js'];
  });

  registry.define(/^the discarded content for every one of those paths is a superseded blob$/, () => {});

  registry.define(/^the merge result for every one of those paths matches its newest authoring commit$/, (ctx) => {
    ctx.silentRevertGateFacts = {
      'facts-complete?': true,
      'candidate-paths': ctx.reconcilePaths.map((p, i) => basePathFacts({
        path: p,
        'tip-matches-newest-authoring?': true,
        'newest-authoring-sha': `reconcile${i}`,
        'divergence-merge-sha': null,
      })),
    };
    ctx.pushResult = { success: true };
  });

  // ── silent-revert-of-landed-content-04 ───────────────────────────────
  registry.define(/^a stage merge-up in which every touched path matches its newest authoring commit$/, (ctx) => {
    ctx.silentRevertGateFacts = {
      'facts-complete?': true,
      'candidate-paths': [
        basePathFacts({
          path: 'swarmforge/scripts/x.bb',
          'tip-matches-newest-authoring?': true,
          'newest-authoring-sha': 'stage1',
        }),
        basePathFacts({
          path: 'extension/src/y.ts',
          'tip-matches-newest-authoring?': true,
          'newest-authoring-sha': 'stage2',
        }),
      ],
    };
    ctx.pushResult = { success: true };
  });

  // ── silent-revert-of-landed-content-05 ───────────────────────────────
  registry.define(/^the working tree has uncommitted changes to that same path$/, (ctx) => {
    // Decision signature has nowhere to read a dirty-tree fact — tagging it
    // on the path entry proves the stand-in cannot move the verdict.
    const paths = ctx.silentRevertGateFacts['candidate-paths'].map((p) =>
      Object.assign({}, p, { 'dirty-working-tree?': true }));
    ctx.silentRevertGateFacts = {
      'facts-complete?': true,
      'candidate-paths': paths,
    };
  });
}

module.exports = { registerSteps };
