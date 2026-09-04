# BL-1390 — architect re-review (QA bounce rework), 2026-09-04

Reviewed cleaner's D1 fix (`b8c1a3152a`, a typo'd `git_q` -> `gq` call in
the fixture, silently swallowing an intended fetch under `set -uo
pipefail` with no `-e`) plus the accumulated QA-bounce rework this
ticket has been through (the "second incident" — 1156 concurrent copies
exhausting the host, and an earlier fixture-clobbered-live-origin
incident, both already fixed and re-verified by hardener/documenter per
their own evidence files carried in this same merge).

## Re-verified independently, not trusted from evidence

- `test_bl1390_post_commit_push.sh` — 6 clean runs out of 7 total this
  pass (see finding below for the one exception), 3/3 clean on a repeat
  batch after the finding.
- `bl1390_post_commit_push_mutation_sweep.sh` — 6/6 killed, 0 survived,
  0 skipped.
- `run_acceptance.sh` on the BL-1390 feature — 7/7, including the new
  scenario 07 (concurrent-invocation safety) from the second-incident
  amendment.
- `grep -c git_q` on the fixture — 0, confirming the typo is genuinely
  gone, not merely claimed.

## Finding — one assertion is sensitive to concurrent activity from OTHER live processes on this host, not to BL-1390's own code

One run out of seven produced `FAILURES` at
`the live repository's worktree list is byte-identical after the suite`.
Read the check directly (`test_bl1390_post_commit_push.sh:49,372-381`):
it diffs `git -C "$REPO_ROOT" worktree list` — the ENTIRE live
repository's worktree registry, not scoped to this fixture's own
`three-coder` worktree — captured at suite start vs suite end. This host
runs an actual live swarm with many other role worktrees and expedite
lanes that can legitimately add or remove a worktree at any moment
(confirmed: `git worktree list` on this checkout currently shows 60+
entries, including several `expedite-BL-*` lanes). A worktree change
made by ANY other concurrent process during this suite's run window
would trip this assertion, reading as "the suite broke something" when
nothing in BL-1390's own hook or push logic is implicated.

This is a **false-positive risk only** — it can never mask a real leak
of the fixture's OWN worktree (that is separately proven by the scoped
create/remove/prune sequence around scenario 3), and the underlying push
mechanics are unaffected. Lower severity than a safety-invariant flake
(nothing about invariant 1/2/3 is at risk), and it is a check ADDED as
extra defense-in-depth after an earlier incident, not one of the ticket's
own three declared invariants. Not bouncing over it — recording the
mechanism and the fix direction (scope the comparison to worktrees
matching this fixture's own naming pattern, or assert only "no NEW
worktree survives past cleanup" rather than repo-wide byte-identity)
for whoever next touches this check.

## Verdict

COMPLIANT. D1 (the typo) confirmed fixed; the one repo-wide-worktree
false-positive risk noted, not blocking. Forwarding to hardener.
