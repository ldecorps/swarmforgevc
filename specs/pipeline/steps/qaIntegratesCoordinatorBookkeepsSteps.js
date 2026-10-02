'use strict';

// BL-247: step handlers for "QA lands approved work on main; the
// coordinator only keeps the books". A LIVE-PROTOCOL/governance ticket
// whose only scope is prose (swarmforge/roles/QA.prompt and
// coordinator.prompt, plus the constitution/handoff-protocol docs) - there
// is no deterministic script this change touches (compare BL-243, a
// sibling governance ticket that DID rewrite real swarmforge.sh functions
// and so drove those functions directly via coordinatorProvisioningSteps.js).
// Reads the REAL, already-updated role-prompt files straight off disk and
// asserts on their literal content - the same "plain content/grep check,
// no compiled module involved" pattern docsWindowsClaimSteps.js (BL-237)
// already established for documentation-only tickets.
const path = require('node:path');
const fs = require('node:fs');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const QA_PROMPT_PATH = path.join(REPO_ROOT, 'swarmforge', 'roles', 'QA.prompt');
const COORDINATOR_PROMPT_PATH = path.join(REPO_ROOT, 'swarmforge', 'roles', 'coordinator.prompt');

// Collapses markdown line-wrapping into single spaces so a substring check
// doesn't depend on exactly where a paragraph happens to wrap.
function readNormalizedDoc(docPath) {
  return fs.readFileSync(docPath, 'utf8').replace(/\s+/g, ' ');
}

function registerSteps(registry) {
  registry.define(
    /^a pipeline ending at QA, with worktree roles merging up to QA's approved commit$/,
    (ctx) => {
      ctx.qaPrompt = readNormalizedDoc(QA_PROMPT_PATH);
      ctx.coordinatorPrompt = readNormalizedDoc(COORDINATOR_PROMPT_PATH);
    }
  );

  // qa-integrates-01 retired by BL-1872: QA queues the approval and the
  // lander sweep lands it, so its steps left with it.

  // ── coordinator-bookkeeps-02 ─────────────────────────────────────────
  registry.define(/^QA approved a parcel$/, () => {
    // Nothing further to fixture - the Background already loaded the real
    // role prompts.
  });

  registry.define(/^the coordinator processes the approval$/, () => {
    // Documents the precondition; the Then steps below inspect
    // ctx.coordinatorPrompt directly.
  });

  registry.define(/^it moves the ticket from active to done and promotes the next paused item$/, (ctx) => {
    // Today's wording (e1123e1933, BL-419, 2026-07-17): the close is a
    // `git mv` committed through commit_integrity_cli.bb.
    if (!ctx.coordinatorPrompt.includes('git mv backlog/active/<TICKET-ID>-<slug>.yaml backlog/done/')) {
      throw new Error('expected coordinator.prompt to still instruct closing the ticket active -> done');
    }
    if (!ctx.coordinatorPrompt.includes('Promote** the next eligible item from `backlog/paused/`')) {
      throw new Error('expected coordinator.prompt to still instruct promoting the next paused item');
    }
  });

  registry.define(/^it runs no git merge or push$/, (ctx) => {
    if (!ctx.coordinatorPrompt.includes('you run NO git merge and NO push')) {
      throw new Error('expected coordinator.prompt to state the coordinator runs no git merge and no push');
    }
  });

  // ── issue-close-owner-03 ─────────────────────────────────────────────
  registry.define(/^an approved parcel whose ticket id is a GitHub issue$/, () => {
    // Nothing further to fixture - the Background already loaded the real
    // role prompts; BL-114's GH-issue-id convention is unchanged by BL-247,
    // only who runs the close step moves.
  });

  registry.define(/^integration completes$/, () => {
    // Documents the precondition; the Then steps below inspect
    // ctx.qaPrompt/ctx.coordinatorPrompt directly.
  });

  registry.define(/^QA closes the issue with the merge commit$/, (ctx) => {
    if (!ctx.qaPrompt.includes('close the loop now')) {
      throw new Error('expected QA.prompt to instruct QA to close the GitHub issue itself (BL-247/BL-114)');
    }
    if (!ctx.qaPrompt.includes('issue_done.sh <source-url> <merge-commit>')) {
      throw new Error('expected QA.prompt to instruct running issue_done.sh with the source URL and merge commit');
    }
  });

  registry.define(/^the coordinator does not run the issue-close step$/, (ctx) => {
    if (!ctx.coordinatorPrompt.includes('or run the GH-issue-close step (`issue_done.sh`)')) {
      throw new Error('expected coordinator.prompt to explicitly disclaim running the GH-issue-close step');
    }
  });
}

module.exports = { registerSteps };
