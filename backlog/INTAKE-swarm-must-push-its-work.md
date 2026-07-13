# INTAKE: The swarm must push its work — unpushed main makes it look dead from outside

**Raised by:** the human (ldecorps), 2026-07-13.
**Relayed via:** the Claude Code recovery session of 2026-07-13, at the
human's request ("file away"). Human-raised; the relay is transport, not
authorship.

## The defect, observed twice in one day

1. **Overnight:** the swarm worked until ~04:00 and accumulated 6 commits on
   local `main` that never reached origin. From outside (GitHub, a remote
   session, the human's phone) the swarm appeared to have died at 04:01;
   reconciling required a manual divergent-branch merge later that morning.
2. **Afternoon:** between 11:51 and at least 15:02, the swarm closed BL-336,
   specced and promoted BL-346/349–353, and kept committing — while
   `origin/main` sat frozen at 11:51. Three-plus hours of work invisible,
   again indistinguishable from a dead swarm.

Both times a human (or an external agent acting for one) had to notice, pull
and push by hand. This is the same failure family as BL-335
("shipped but invisible to the human") — BL-335's fix covered build
freshness, not push cadence.

## The ask

After bookkeeping commits land on local `main` (ticket close, promote,
handoff merges), the swarm pushes `main` to origin — promptly, with bounded
retry/backoff for transient network failures, and with a loud, visible
alarm (front desk / email, riding BL-345's delivery machinery) if pushes
keep failing rather than silently accumulating divergence. The invariant:
`origin/main` must never silently lag local `main` by more than one
bookkeeping cycle while the swarm is running.

## Notes

- Divergence is not hypothetical: this morning's manual reconciliation was
  needed precisely because outside work (human approvals via GitHub) landed
  on origin while the swarm's work stayed local.
- Out of scope: role worktree branches — this is about `main`, the branch
  outsiders watch.
