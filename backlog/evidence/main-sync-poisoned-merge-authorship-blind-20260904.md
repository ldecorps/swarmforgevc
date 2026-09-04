# Recurring poisoned merge on shared main — authorship-blind detection

Two occurrences within ~1hr on 2026-09-04:
- 08:23:49Z — MERGE_HEAD=c142535f68, aborted by an external supervisor agent
  (not in the pipeline squad). Write-up:
  `.swarmforge/operator/NOTE-main-merge-poisoned-20260904.md` sections 5-6.
- 09:41:52Z — MERGE_HEAD=2ff63365c9, aborted by the coordinator (this
  session). Index empty (== HEAD tree), nothing staged, nothing lost.

Both times: `git merge origin/main` on the shared main checkout was left
mid-flight with no owning `git` process (`pgrep -ax git` empty), index
carrying none of the incoming side, and `master-main-reconcile-state.json`
reporting `human-merge-in-progress` even though no human was merging —
because the daemon's predicate infers "human" from git authorship
(`t <t@t>`), and every agent commits as that same identity. Same
authorship-can't-distinguish-agent-from-human family as BL-1382.

Concluding either occurrence (a bare `git commit`/`--continue`) would have
written a merge commit whose tree equals the pre-merge HEAD tree — a
silent revert of the entire origin/main side while ancestry still reads
"landed". Related memory: `interrupted-index-write-turns-a-merge-into-a-
silent-revert`, `orphaned-merge-on-main-poisoned-index-silent-revert-20260904`.

## Two fixes needed
1. The reconcile daemon's `human-merge-in-progress` predicate must stop
   inferring "human" from git author identity — it needs a real liveness
   check (owning pid, lock, or heartbeat), not authorship, since authorship
   proves nothing about whether a human or an agent is mid-merge.
2. Whatever git operation is leaving an interrupted/orphaned `MERGE_HEAD`
   with an index that never picked up the incoming side should fail loud
   or self-abort at the point of interruption, rather than sit indefinitely
   poisoning the shared checkout for whoever finds it next.

Recurring at this rate (2x/hour) on the shared master checkout, this is a
standing landing-integrity risk, not a one-off.
