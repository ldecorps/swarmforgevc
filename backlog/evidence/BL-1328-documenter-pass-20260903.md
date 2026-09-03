# BL-1328 — documenter pass, 2026-09-03

Merged hardener commit `c57ae781af` — clean merge, no conflict. Picked up
BL-1296's paused→active promotion and BL-1344's active→done bookkeeping as
side effects of the shared-checkout merge, not this ticket's own content.

## Doc review

- Diff scoped to `swarmforge/scripts/swarmforge.sh` (the equals-form fix
  plus inline precedence-asymmetry comments at both call sites — the
  ticket's own directive names this as the documentation deliverable,
  not a separate doc page) and BL-1324's own test/feature files (three
  sibling assertions retired per the specifier's mid-parcel spec-gap
  amendment).
- No new extension command or setting — internal swarm-launcher shell
  logic. Since BL-1324 itself never got a Specification.MD entry (it
  followed the review-only stamp-off convention, BL-848 how-to bullet
  only), and this is a genuine follow-up defect fix with real production
  code changes rather than a second stamp-off, it gets its own
  Specification.MD entry rather than a BL-848 Related bullet.
- Updated the existing BL-1324 bullet in
  `docs/how-to/BL-848-certify-an-operator-hotfix.md` (it already named
  BL-1328 as the pending follow-up) to note the follow-up closed today
  and point to the new Specification.MD entry — closing the loop rather
  than leaving a stale "narrow follow-up minted" with no resolution.
  Committed with an untagged subject (task-scope gate, BL-1192 —
  basename names BL-848, not BL-1328).
- Diagram check: no registered diagram's change-trigger fired.
- No RETIRED/deprecated LIVING doc content involved — the retired test
  assertions inside BL-1324's own feature/property files are BL-1006's
  "successor scenario supersedes prior boundary assertion" pattern
  (executable test coverage, not human-facing docs), already handled by
  the coder/cleaner/architect passes per the ticket's own scoped
  instructions; Article 3.6's `docs/deprecated/` mechanism is for
  human-facing living reference/how-to content and isn't implicated here.

## Verdict

No documenter-domain defect found. Forwarding to QA.
