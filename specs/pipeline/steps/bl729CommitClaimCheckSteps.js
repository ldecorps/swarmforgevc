'use strict';

// BL-729: step handlers for "a piloted ticket lands only when each commit's
// claims match its own diff". Drives the REAL compiled landPilotedTicket
// (extension/out/tools/pilotAcceptanceGate.js) and the REAL pure
// evaluateCommitClaims (extension/out/tools/commitClaimCheck.js) in-process,
// same pattern bl727PilotAcceptanceGateSteps.js established: the acceptance
// contract itself is always a stubbed green pass here (per the Background -
// this feature is about the SECOND refusal reason BL-729 adds, not the
// first), while commit message/patch text is real input run through the
// real grammar, so these scenarios exercise actual behavior, not a stub of
// the outcome.
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_DIR = path.join(REPO_ROOT, 'extension');
const { landPilotedTicket } = require(path.join(EXT_DIR, 'out', 'tools', 'pilotAcceptanceGate'));
const { evaluateCommitClaims } = require(path.join(EXT_DIR, 'out', 'tools', 'commitClaimCheck'));

const FEATURE = "a piloted ticket lands only when each commit's claims match its own diff";

function scoped(registry, pattern, handler) {
  registry.defineScoped(pattern, handler, FEATURE);
}

function ensureCtx(ctx) {
  ctx.ticketId = ctx.ticketId || 'BL-729-FIXTURE';
  ctx.calls = ctx.calls || { move: 0, receipt: 0 };
  ctx.runCommits = ctx.runCommits || [];
  ctx.commitsResolvable = ctx.commitsResolvable === undefined ? true : ctx.commitsResolvable;
  return ctx;
}

function addRunCommit(ctx, sha, message, patchText) {
  ensureCtx(ctx);
  ctx.runCommits.push({ sha, message, patchText });
}

function baseDeps(ctx) {
  return {
    readAcceptanceDeclaration: () => 'specs/features/bl729-fixture.feature',
    resolveFeatureFilePath: () => '/repo/specs/features/bl729-fixture.feature',
    runAcceptance: async () => ({ success: true, output: 'ok' }),
    checkCommitClaims: () =>
      ctx.commitsResolvable ? { checked: true, ...evaluateCommitClaims(ctx.runCommits) } : { checked: false },
    moveTicketToDone: () => {
      ctx.calls.move += 1;
      return { moved: true, destination: `/repo/backlog/done/${ctx.ticketId}-fixture.yaml` };
    },
    writeReceipt: (ticketId, receipt) => {
      ctx.calls.receipt += 1;
      ctx.writtenReceipt = receipt;
    },
    getLandedCommit: () => 'a'.repeat(40),
    now: () => '2026-08-01T00:00:00.000Z',
  };
}

const MENTION_MESSAGE = {
  'claims to have restored': (id) => `Restore \`${id}\` in the handler.`,
  'names in passing, claiming no change to': (id) => `See \`${id}\` for context; no change made here.`,
};

const PATCH_FOR_STATE = {
  'never contains': () => 'diff --git a/src/other.ts b/src/other.ts\n+export function unrelated() {}\n',
  contains: (id) => `diff --git a/src/x.ts b/src/x.ts\n+function ${id}() {}\n`,
};

function registerSteps(registry) {
  // ── Background ──────────────────────────────────────────────────────
  scoped(registry, /^a piloted ticket whose declared acceptance contract has just passed$/, (ctx) => {
    ensureCtx(ctx);
  });

  // ── claim-judged-against-own-patch-01 ────────────────────────────────
  scoped(registry, /^a run commit whose message (.+) the identifier "([^"]+)"$/, (ctx, mention, identifier) => {
    ensureCtx(ctx);
    if (!(mention in MENTION_MESSAGE)) {
      throw new Error(`unknown "message mention" example value: "${mention}" (known: ${Object.keys(MENTION_MESSAGE).join(', ')})`);
    }
    ctx.pendingCommitMessage = MENTION_MESSAGE[mention](identifier);
    ctx.pendingIdentifier = identifier;
  });

  scoped(registry, /^that commit's own patch (.+) that identifier$/, (ctx, patchState) => {
    ensureCtx(ctx);
    if (!(patchState in PATCH_FOR_STATE)) {
      throw new Error(`unknown "patch state" example value: "${patchState}" (known: ${Object.keys(PATCH_FOR_STATE).join(', ')})`);
    }
    if (!ctx.pendingCommitMessage || !ctx.pendingIdentifier) {
      throw new Error('patch step ran before the message-mention step set up a pending commit');
    }
    addRunCommit(ctx, 'c1', ctx.pendingCommitMessage, PATCH_FOR_STATE[patchState](ctx.pendingIdentifier));
  });

  scoped(registry, /^the pilot runs the landing gate$/, async (ctx) => {
    ensureCtx(ctx);
    ctx.outcome = await landPilotedTicket(ctx.ticketId, baseDeps(ctx));
  });

  scoped(registry, /^the land is (refused|completed)$/, (ctx, outcome) => {
    const expected = outcome === 'completed';
    if (ctx.outcome.landed !== expected) {
      throw new Error(`expected landed=${expected}, got: ${JSON.stringify(ctx.outcome)}`);
    }
  });

  // ── every-run-commit-judged-02 ────────────────────────────────────────
  scoped(registry, /^the run authored three commits on its branch$/, (ctx) => {
    ensureCtx(ctx);
  });

  scoped(registry, /^the first of them claims a change to an identifier its own patch never contains$/, (ctx) => {
    ensureCtx(ctx);
    addRunCommit(
      ctx,
      'c1-first',
      'Restore `firstToken!` in the handler.',
      'diff --git a/src/other.ts b/src/other.ts\n+export function unrelated() {}\n'
    );
  });

  scoped(registry, /^every claim in the two later commits is supported by its own patch$/, (ctx) => {
    ensureCtx(ctx);
    addRunCommit(ctx, 'c2', 'Fix parser bug.', 'diff --git a/src/parser.ts b/src/parser.ts\n+fix parser bug\n');
    addRunCommit(ctx, 'c3', 'Document the change.', 'diff --git a/docs/notes.md b/docs/notes.md\n+docs\n');
  });

  scoped(registry, /^the refusal names the first commit$/, (ctx) => {
    if (ctx.outcome.landed !== false || ctx.outcome.claimCommit !== 'c1-first') {
      throw new Error(`expected the refusal to name commit "c1-first", got: ${JSON.stringify(ctx.outcome)}`);
    }
  });

  // ── generated-merge-message-not-judged-03 ─────────────────────────────
  scoped(registry, /^the run merged main into its branch$/, (ctx) => {
    ensureCtx(ctx);
  });

  // The merge commit is deliberately never added to ctx.runCommits: the
  // real CLI wiring's `git rev-list --no-merges` already excludes it before
  // any commit reaches the checker (proven for real git in
  // pilotAcceptanceGateCli.test.js) - modeling a claim-bearing merge
  // message that is simply never fed to the checker is what proves this
  // DECISION layer never judges it, even in principle.
  scoped(registry, /^that merge commit's message names a file the merge's own patch does not list$/, () => {});

  scoped(registry, /^every claim in the run's non-merge commits is supported by its own patch$/, (ctx) => {
    ensureCtx(ctx);
    addRunCommit(ctx, 'c1', 'Fix parser bug.', 'diff --git a/src/parser.ts b/src/parser.ts\n+fix parser bug\n');
  });

  // ── refusal-names-what-to-fix-04 ──────────────────────────────────────
  scoped(registry, /^a run commit claims a change to an identifier its own patch never contains$/, (ctx) => {
    ensureCtx(ctx);
    addRunCommit(
      ctx,
      'c-claim',
      'Restore `phantomToken!` in the handler.',
      'diff --git a/src/other.ts b/src/other.ts\n+export function unrelated() {}\n'
    );
  });

  scoped(registry, /^the refusal names that commit, that identifier, and the sentence claiming it$/, (ctx) => {
    if (ctx.outcome.landed !== false) {
      throw new Error(`expected a refusal, got: ${JSON.stringify(ctx.outcome)}`);
    }
    if (ctx.outcome.claimCommit !== 'c-claim') {
      throw new Error(`expected the refusal to name commit "c-claim", got claimCommit=${ctx.outcome.claimCommit}`);
    }
    if (ctx.outcome.claimIdentifier !== 'phantomToken!') {
      throw new Error(`expected the refusal to name identifier "phantomToken!", got claimIdentifier=${ctx.outcome.claimIdentifier}`);
    }
    if (!ctx.outcome.claimSentence || !ctx.outcome.claimSentence.includes('phantomToken!')) {
      throw new Error(`expected the refusal to name the claiming sentence, got claimSentence=${JSON.stringify(ctx.outcome.claimSentence)}`);
    }
  });

  // ── refused-land-is-inert-05 ──────────────────────────────────────────
  scoped(registry, /^the ticket yaml stays where it was$/, (ctx) => {
    if (ctx.calls.move !== 0) {
      throw new Error(`expected no move to backlog/done/, got ${ctx.calls.move} move(s)`);
    }
  });

  scoped(registry, /^no acceptance receipt is written$/, (ctx) => {
    if (ctx.calls.receipt !== 0) {
      throw new Error(`expected no acceptance receipt to be written, got ${ctx.calls.receipt}`);
    }
  });

  // ── unreadable-history-fails-open-06 ──────────────────────────────────
  scoped(registry, /^the gate cannot resolve the run's own commits$/, (ctx) => {
    ensureCtx(ctx);
    ctx.commitsResolvable = false;
  });

  scoped(registry, /^the outcome warns that no commit claim was checked$/, (ctx) => {
    if (!Array.isArray(ctx.outcome.warnings) || ctx.outcome.warnings.length === 0) {
      throw new Error(`expected the outcome to carry a warning about unchecked commit claims, got: ${JSON.stringify(ctx.outcome)}`);
    }
  });

  // ── receipt-records-the-check-07 ──────────────────────────────────────
  scoped(registry, /^the receipt records how many commits were claim-checked$/, (ctx) => {
    if (!ctx.writtenReceipt || typeof ctx.writtenReceipt.commitClaimsChecked !== 'number') {
      throw new Error(`expected the receipt to carry a numeric commitClaimsChecked, got: ${JSON.stringify(ctx.writtenReceipt)}`);
    }
    if (ctx.writtenReceipt.commitClaimsChecked !== ctx.runCommits.length) {
      throw new Error(
        `expected commitClaimsChecked=${ctx.runCommits.length}, got ${ctx.writtenReceipt.commitClaimsChecked}`
      );
    }
  });
}

module.exports = { registerSteps };
