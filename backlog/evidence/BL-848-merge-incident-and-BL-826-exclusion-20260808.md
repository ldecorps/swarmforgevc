# Incident: BL-848's landing merge was a silent no-op; BL-826's held content had to be manually excluded (2026-08-08)

## Summary

While landing the QA-approved BL-773/BL-819/BL-822/BL-839 batch (commit
`06303f63` on the QA worktree branch) onto `main`, two problems surfaced
that a plain `git merge` could not have handled safely. Both are now
resolved on `main` at commit `4858d75c` (pushed to origin). This file
documents what happened so it can be turned into a proper ticket rather
than re-discovered from scratch next time.

## Finding 1 — BL-848's approved work never actually landed

`f28a84ad` ("Merge QA-approved BL-848 (round 2) commit 11ae7ac3 into
main", already on `origin/main` before this session) is a **no-op merge**:
its tree hash (`4b23b5ff...`) is byte-identical to its own first parent
`6af2fd5a`. Despite the commit message and (presumably) the closed ticket
saying BL-848 landed, `main`'s actual content never gained
`swarmforge/scripts/hotfix_certification_lib.bb` or any of BL-848's other
files — confirmed by `git cat-file -e f28a84ad:swarmforge/scripts/hotfix_certification_lib.bb`
failing, and by `git diff --stat 6af2fd5a f28a84ad` (via its 11ae7ac3
parent) being empty for those paths. This has the same shape BL-839
itself exists to catch (approved work silently not in effect) but is a
distinct failure mode: not disk-vs-`main` drift, but a merge commit whose
recorded message doesn't match its tree.

Likely cause: whoever ran that merge used something equivalent to
`git merge -s ours` or resolved every conflicting path in favor of
`main`'s prior state, producing a commit that records the correct
ancestry (both parents present) without applying any of the second
parent's content. Not confirmed which command was actually run.

**Consequence for later merges:** because `11ae7ac3` (which legitimately
contains BL-848 + BL-826 + the earlier state of BL-773/819/822/839) is
still a real graph ancestor of both `main` and every later QA-branch
commit, `git merge-base main <QA-branch>` kept resolving to `11ae7ac3`
for every merge attempted after this. A plain `git merge` from that base
would, for any file unchanged since `11ae7ac3` on the QA-branch side,
follow `main`'s side — which had "deleted" it relative to that base (per
the no-op above). This silently re-drops BL-848 content and, more
alarmingly, silently RE-ADDS BL-826's content for any file main never
independently touched (no conflict, so git just takes the QA-branch's
unchanged-since-base version).

## Finding 2 — BL-826 (held) was an unavoidable ancestor of the QA branch

BL-826 (Bubble hands-free self-listen-echo-loop) went all the way through
documenter and was merged into QA's branch (`07d7e71c`) before the human
put it on hold 2026-08-07 (`backlog/hold/BL-826-*.yaml` — "deprioritize
Bubble speech/voice... do not promote"). It was never QA-approved. Its
code — `HandsFreeReArmGate.kt` (new), `AudioTurnRecorder.kt` (echo
canceler/noise suppressor additions), `ReplyAudioPlayer.kt`/`TalkEngine.kt`
changes, its feature file, its step handler — remained a graph ancestor of
every subsequent QA-branch commit purely because of the shared
mono-router branch's linear history, not because it was approved.

## Resolution (this session, operator-directed)

Rather than a plain `git merge`, computed `git diff --name-status 6af2fd5a
06303f63` (main's real last-agreed content to this session's QA-approved
commit), confirmed every shared/infrastructure file in that diff was
untouched by `main`'s own independent commits since `f28a84ad` (checked:
briefings, epic reorders, BL-853/854, the BL-826 hold-folder move all live
in disjoint files), then force-applied only the paths belonging to
BL-773/819/822/839 (the approved batch) and BL-848 (restoring its
legitimate, previously-dropped landing). `specs/pipeline/steps/index.js`
was hand-edited to register only the five non-BL-826 step handlers.
Verified BL-826 absent from the entire staged diff before committing
(`git diff --cached | grep -i` for BL-826/hands-free/echo-loop: no hits),
and verified the master checkout's own pre-existing unrelated dirty state
(android hotfix WIP, `bridgeServer.ts`, backlog bookkeeping files) was
byte-identical before and after (diff-of-diffs check).

Landed as `4858d75c` (parents: `74c52d1a` main tip, `06303f63` QA-approved
commit; tree differs from first parent — confirmed not another no-op).
Pushed to origin. Recompiled and re-ran the affected test suites (vitest:
199/199 across the 7 touched files; babashka: BL-839's and BL-848's unit/
property/wiring runners) against the reconciled checkout — all green.

## Recommendation

This is worth a proper ticket (suggest `type: defect`, `severity: high`,
epic `swarm-reliability`): a `git merge -s ours`-shaped mistake during a
QA landing step can silently drop an entire approved ticket's work while
leaving every audit trail (commit message, closed ticket, evidence files)
claiming success. BL-839's drift detector does not catch this class of
failure (it compares the master checkout's disk against `main`, not a
merge commit's tree against its own message/parents). A candidate check:
after any `main`-landing merge, assert the new commit's tree differs from
its first parent's tree by at least the ticket's own known-changed paths
— the same `git diff --stat <parent1> <merge-commit>` non-emptiness check
used manually in this incident.

By QA.
