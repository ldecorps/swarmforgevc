# BL-935 architect bounce — misrouted D1 fix, 2026-08-19

## Reviewed commit
`dfc82c1fdf` ("BL-935: fix architect-bounced D1 - replace the structurally
vacuous P1 property"), received directly `FROM: coder TO: architect`
(`50_20260819T115514Z_000320_from_coder_to_architect_for_architect.handoff`).

## Complete inventory (Article 4.4 — full pass)

1. **Substance of the D1 fix — PASS.** The commit correctly addresses my
   own prior bounce (`backlog/evidence/BL-935-architect-bounce-20260819.md`):
   P1 has been replaced by two properties over what
   `resolveVitestForkCeiling` itself controls (an absolute
   "never-exceeds-default" property and a relative
   "full-forge/darwin-never-worse-than-any-other-combination" property),
   matching the bounce's own suggested remediation direction. Non-vacuity
   is re-verified per-property with the exact break-then-fix experiments
   (`return Infinity`, inverted pack rule, floor removed), each documented
   individually rather than the prior single vague claim. No production
   file touched (test-only fix, as expected for a test-vacuity defect).

2. **Routing — VIOLATION.** This handoff came directly `coder → architect`,
   skipping `cleaner` entirely. Two independent sources both make cleaner
   mandatory for this fix:
   - `swarmforge/roles/coder.prompt`'s own Handoff section: "Send a
     `git_handoff` to `cleaner` with priority `50`" — unconditional, no
     bounce-fix exception stated anywhere in the role prompt.
   - BL-935's own ticket YAML: `required_stages: [coder, cleaner,
     architect, hardender, documenter, qa]` — cleaner is a declared
     required stage for this ticket, not an optional one.
   Checked the commit lineage (`git log --oneline dfc82c1fdf`): the only
   `... into cleaner` merge in scope (`d342d1277`) predates my original
   bounce — it cleaned the FIRST submission, not this fix. No cleaner-stage
   commit exists on top of `dfc82c1fdf`. I did not merge this commit into
   my worktree branch (nothing to revert — review was done via `git show`
   only), so this branch carries no unclean lineage from it.
   Searched `swarmforge/handoff-protocol.md` and all role prompts for a
   documented "bounce-fix returns directly to the bouncing role" exception:
   none exists.

Not bouncing the substance (item 1 is clean) — bouncing solely for the
skipped required stage.

## Blamed role and remediation
`coder` — send this same commit's `git_handoff` to `cleaner` (priority 50,
same task name), per coder.prompt's own Handoff section, so BL-935
actually completes its declared `required_stages` before architect
re-reviews it.
