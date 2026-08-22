# BL-976 hardener bounce — 2026-08-20

Reviewed commit: 37f4badd83 (architect's merge of cleaner e1d5e6a565 into
architect), merged into the hardener worktree. `bounce_history` records
`commit: 37f4badd83` — the tip received from the architect (BL-992 bounce
precedent: name the reviewed tip, not this pass's own evidence commit).

**On `record-bounce.js`'s revertCheck remedy**: it suggested reverting
whichever commit was passed to `--commit`, which is never the right target
here — reverting the reviewed tip on MY branch would just drop BL-976's own
good work along with the contamination, and reverting my own evidence
commit (its first suggestion, before this correction) would destroy the
record of the finding. Unlike the BL-994 bounce earlier today, this one is
NOT an omission — there genuinely IS content that needs reverting, but the
revert has to happen on the CLEANER's branch, scoped to BL-993's specific
paths (listed below), not to whatever tip a downstream role happens to be
reviewing. That is D1's actual remediation.

## D1 — BL-993's twice-bounced, unresolved implementation is entangled in this parcel and is ACTIVELY WIRED (class: behavior, blamed: cleaner)

BL-976's own coder commit is clean: `git show --stat cb2dee9441` (the
coder's original BL-976 commit) touches exactly 10 files, all named in the
ticket's own scope (`bl976EmailKeylessAlertSteps.js`, `daemon_alarm_lib.bb`,
`handoffd.bb`, `start_handoff_daemon.sh`, the `bl976_*` test/runner files,
`specs/pipeline/steps/index.js`). Nothing to fix there.

The parcel I received is NOT that commit alone — `git merge-base
--is-ancestor` confirms `37f4badd83` is my HEAD, and its diff against my
prior tree additionally introduces:

```
specs/pipeline/steps/bl993OperatorRuntimeWatchSteps.js
swarmforge/scripts/launch_operator_runtime_supervisor.sh
swarmforge/scripts/operator_runtime_supervisor.bb
swarmforge/scripts/operator_runtime_watch_lib.bb
swarmforge/scripts/start_ancillary_services.sh        (MODIFIED)
swarmforge/scripts/stop_ancillary_services.sh          (MODIFIED)
swarmforge/scripts/test/bl993_operator_watch_acceptance_runner.bb
swarmforge/scripts/test/bl993_operator_watch_property_runner.bb
swarmforge/scripts/test/bl993_watch_survives_runtime_death.sh
swarmforge/scripts/test/operator_runtime_watch_lib_test_runner.bb
```

Every one of these is BL-993's territory ("a dead operator runtime is
restarted without a human") — confirmed by grep: BL-976's own ticket YAML
(`backlog/active/BL-976-...yaml`) contains ZERO occurrences of
`operator_runtime_watch`, `operator_runtime_supervisor`, or
`ancillary_services`. This is not shared infrastructure BL-976 legitimately
needs; it is a different ticket's content riding along.

**This is not inert.** `swarmforge/scripts/start_ancillary_services.sh` is
modified to unconditionally call `launch_operator_runtime_supervisor.sh` on
every ancillary-services start (confirmed via `git diff main --
swarmforge/scripts/start_ancillary_services.sh`, absent on `main` entirely),
and `stop_ancillary_services.sh`'s `stop_operator_runtime` is modified to
stop the new supervisor first (also absent on `main`). If this parcel lands,
BL-993's implementation runs live in every swarm launch — under BL-976's
approval, for a ticket that has never passed review.

**BL-993 is still unresolved**, confirmed against its own ticket record
(`backlog/active/BL-993-a-dead-operator-runtime-is-restarted-without-a-human.yaml`):
`status: todo`, `bounce_count: 2`. Full archaeology (git log, not the
ticket's own words):

1. `ce7cb1fb71` — coder's original BL-993 implementation.
2. `e0fcbe880d` — cleaner merges it (worktree: cleaner).
3. `24e2184da` — architect merges cleaner's work.
4. `ef9f4a190` — **architect bounces** (D1: "watch's cmdline-aware liveness
   check diverges from operator-healthy?/swarm status").
5. `8f3a561c1` — architect reverts the bounced merge **from the architect's
   own branch only** ("BL-993 bounce revert: strip the coder's
   implementation out of the architect branch"). This never touched the
   cleaner's or coder's branches.
6. `66919c67c` — coder's re-fix, built on top of the coder's own branch
   (which still carried the original, never-reverted implementation from
   step 1 — only the architect's copy was reverted in step 5).
7. `f3bd6e745` — cleaner merges the re-fix.
8. Cleaner reviews and **bounces again** (`backlog/evidence/BL-993-bounce-
   20260820-cleaner.md`, D1: `test_swarm_ensure.sh` scenario 05a flaky race
   in the post-repair liveness recheck). Evidence explicitly ends "Sent back
   to coder. Do not forward to architect." — a correct call on its own.
9. `0aeda81bf` — cleaner reverts `f3bd6e745`, but a revert of a merge only
   cancels that merge's diff **relative to its own first parent**. The base
   content BL-993 introduced back in step 2 (`e0fcbe880d`) was never
   reverted from the cleaner's branch — confirmed directly:
   `git merge-base --is-ancestor e0fcbe880 70fe2ba31b` (70fe2ba31b being the
   cleaner branch tip immediately before the re-fix merge) returns true, and
   `git show 0aeda81bf:swarmforge/scripts/operator_runtime_watch_lib.bb`
   still resolves (the file is PRESENT at the revert commit, not absent).

So the cleaner's branch has carried BL-993's implementation, unbroken, since
step 2 — through the architect's bounce (which only cleaned the architect's
own copy), through the re-fix bounce-and-revert cycle (which only cleaned
the LATEST increment), and now into this unrelated BL-976 parcel via the
cleaner's merge (`e1d5e6a565`) into architect and from there into me. This
is the constitution's own named failure shape: "Entangled batch merge: if
`-m 1` would revert OTHER tickets' work, revert the bounced ticket's own
commits/paths instead — never the batch merge, never nothing. If you cannot,
the branch is QUARANTINED: forward nothing from it until the content is gone
(BL-956)."

**Not mine to fix.** Separating BL-993's content out of the cleaner's branch
lineage cleanly (so it stops leaking into every future parcel the cleaner
forwards, not just this one) is git-history surgery on a branch I do not
own, and it is squarely the same class of "revert what you forwarded that
got bounced" discipline Article 2/workflow rules already assign to whoever
carries the stale content — here, the cleaner. Routing there rather than to
architect (my immediate sender): the defect predates the architect's merge
and would recur on the NEXT parcel the cleaner forwards until fixed at the
source, so architect re-reverting their own copy again would not close it.

**Confirmed harmless, left alone**: `backlog/active/BL-993-...yaml`'s small
diff (bounce_history append) and the new
`backlog/evidence/BL-993-bounce-20260820-cleaner.md` are legitimate
bookkeeping for BL-993's own second bounce, not executable contamination —
no action needed on those two.

## D2 — bl976EmailKeylessAlertSteps.js's cleanup discipline contradicts proven precedent from this same session (class: behavior, blamed: coder, advisory)

The file's own header comment (line ~222) states: "Cleanup discipline (no
scenario-end hook exists in this runtime): the TERMINAL Then of each
scenario cleans up in a finally." This is factually incorrect for this
acceptance runtime: `node:test`'s `afterEach` is proven working here by
sibling step files this same session —
`specs/pipeline/steps/bl951StageSkipsRecordedSteps.js` uses it, and the
architect's own BL-992 D1 bounce evidence explicitly confirmed "cleaner's
afterEach fix verified working" for another step file using the identical
pattern.

Instead, the file hand-derives which of several "Then" steps is terminal
per scenario and cleans up there, with a per-step try/catch. This is the
manual "finally-only" cleanup shape the standing hardener rule already
covers (a fixture-creating step that throws before the terminal step's own
finally runs leaks its mkdtemp root with no cleanup) — any throw in a
non-terminal step (the Background steps `ensureProjectRoot`/
`ensureBriefingsDir`, or an intermediate Given/When before the scenario's
discriminated terminal Then) leaks `ctx.briefingsDir`/`ctx.projectRoot`/
`ctx.stubDir` with no cleanup path.

Not a blocking finding on its own (no Scenario Outline in this ticket's
feature file, so BL-113 mutation is inapplicable here and the leak risk is
from a genuine bug rather than a mutant) — bundled into this bounce per
Article 4.4 rather than filed separately, since the parcel is already
going back to coder for D1's ticket-entanglement fix and both belong in one
pass. Recommend adopting the proven `afterEach` + `trackedRoots` module-level
pattern (`bl951StageSkipsRecordedSteps.js` is the reference) in place of the
per-terminal-step discrimination table.

## Verdict

Sent back to cleaner (D1's owner). Do not forward to documenter.
