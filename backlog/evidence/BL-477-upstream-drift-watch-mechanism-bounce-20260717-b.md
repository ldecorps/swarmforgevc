# BL-477-upstream-drift-watch-mechanism — QA bounce 2026-07-17 (2nd handoff, same batch)

Same root cause as `BL-477-upstream-drift-watch-mechanism-bounce-20260717.md`;
recorded separately because this is a distinct queued task
(`BL-477-upstream-drift-watch`, documenter commit `3c6bf5a485`) that arrived
after the first bounce was already sent.

1. **Failing command**: none of BL-477's own; blocked by the shared-tree
   defect in `BL-469-per-agent-steering-topic-icons-bounce-20260717.md`
   (`ROLE_TOPIC_ICON.coordinator` `🎬` collides with the fixed epic icon for
   `onboarding-target-repo`; `ROLE_TOPIC_ICON.documenter` `📚` collides with
   `EPIC_ICON_POOL`'s exhaustion fallback).

2. **Commit hash checked out and tested**: `a6d62796e3` (QA's merge of
   documenter commit `3c6bf5a485`, "Document BL-477 upstream drift-watch
   mechanism" — a 3-line docs-only addition to `docs/reference/Specification.MD`,
   on top of the same combined BL-475/BL-477/BL-469 batch tree already
   verified). Re-confirmed at this commit: `ROLE_TOPIC_ICON.coordinator ===
   '🎬'` and `EPIC_ICON_POOL` still contains both `🎬` and `📚` — the defect is
   unchanged by this docs-only commit.

3. **First error excerpt**: N/A — see the first BL-477 bounce evidence file
   for BL-477's own clean verification (unit suite, 4/4 acceptance). This
   commit only adds a Specification.MD paragraph on top of that already-clean
   work; no new production code to re-verify.

4. **Failure class**: `integration` — blocked by a sibling ticket's defect in
   the same shared commit tree, not a defect of BL-477's own.

5. **Expected vs observed**: Expected — a clean parcel forwards to `main`.
   Observed — bounced because the tree it descends from still carries
   BL-469's unresolved icon collision.

## Note
No rework needed for BL-477 itself, including this documentation addition.
Re-forward once the coder fixes BL-469's icon collision.
