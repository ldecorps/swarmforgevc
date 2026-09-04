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

---

## Specifier correction and disposition (2026-09-04, minted as BL-1386 + BL-1387)

**The predicate does not read authorship.** `master_main_reconcile_lib.bb`'s
`merge-attempt-plan` / `automated-absorb-plan` / `absorb-dispatch-plan` map
`merge-head-present?` straight to `:skip-human-merge-in-progress`, and
`handoffd.bb`'s `master-main-merge-head-present?` is `git rev-parse --verify
MERGE_HEAD`. No `%an`, no `t <t@t>` is consulted anywhere in either file
(grep this pass). The rule is BL-1120's: any MERGE_HEAD this tick did not
create is a foreign merge, never abort. That is presence-only, which is
blinder than authorship - it cannot tell a human, an agent, or the daemon's
own previous tick apart. The BL-1368 family resemblance is real (a decision
assigned to "a human" on evidence that cannot distinguish one).

**Every orphan on 2026-09-04 was the daemon's own.** `absorb-with-merge!`
runs a real `git merge --no-edit origin/main` on the shared checkout each
tick when the divergence is clean, and on failure does `(do (abort!)
(fallback!))` - the abort's exit is discarded and never logged (the daemon
log has never carried an abort failure). Timestamps: MERGE_HEAD mtime
08:23:49Z and `human-merge-in-progress` surfaced 08:23:50Z; again 08:40:31Z;
again 08:41:53Z - each one second after a sweep tick whose real merge ran.
An abort that lost `.git/index.lock` to another writer (the concierge's
topic store, which failed its own commit of `backlog/topics/BL-1385.json`
in that same window and left it staged - the stray file section 2 of the
Operator's note found) left MERGE_HEAD behind, and the next tick protected
it as a human's. The `merge!` adapter also captures git's error text and
discards it, so why the real merge fails every tick on this checkout
(verdict clean, both incoming commits QA-ancestor rc 0, pre-merge-commit
hook runs `check_pipeline_code_on_main.sh` and
`check_feature_handler_registration.sh`) is not readable from any log.

- **BL-1386** (creator side, `backlog/paused/`, high): abort result checked,
  retried and logged; the daemon records which MERGE_HEAD is its own and
  aborts it by ownership next tick; the real reason a merge failed is logged
  instead of the fixed word `conflict`.
- **BL-1387** (detector side, `backlog/paused/`, high): a foreign MERGE_HEAD
  is classified by ownership and liveness; an orphan is surfaced as
  `orphaned-merge` with whether its index carries the incoming side, and
  escalates on the first tick. Aborts nothing.

By specifier.
