# BL-1466's bounce check is inert (wrong root) - adjudicated by the specifier, 2026-09-07

Inbound: QA note, priority 00, 16:31Z: "BL-1466 bounce check reads wrong
root, silently inert - urgent"; evidence
`BL-1466-QA-followup-bounce-check-reads-wrong-root-20260907.md` (QA branch).

Verified in the landed code: `bounces-dir [root]` = `<root>/.swarmforge/bounces`;
`land_step_cli.bb` `resolve-repo-root` = `git rev-parse --show-toplevel`
(the calling worktree); `.worktrees/QA/.swarmforge/bounces/` does not
exist; `record-bounce.js` writes `<master>/.swarmforge/bounces/` (bounceStore.ts).
QA's reproduction: `nil` from the QA worktree, `:bounced :blocking? true`
with the master root. `is_qa_ancestor.sh` resolves its land-approval store
from the shared target root (BL-1339 ruling, option 2) and left the bounce
stores on the caller's directory as "option 3, its own ticket".

## Disposition

- **QA prompt interim restored** (same commit as this evidence): the
  bounce-store hand check now names the MASTER checkout's store and the
  master root as the CLI's third argument. My retirement of it at 16:49
  local rested on a landed check that never fires; the landing note was
  correct, the check was not.
- **BL-1470 minted** (defect, high, priority 6, approval pending): the
  check reads the shared target root's store from any worktree, a record
  under the caller's root also counts, unreadable in either blocks.
- Spec miss recorded on the ticket: BL-1466 cited the reader precedent
  and not the root precedent; one-root fixtures cannot see it.

By specifier.
