# Intake: a question the Operator could not answer

Filed by the Operator (2026-10-06T10:18:59.475523295Z) - a question came in via Telegram
that the Operator judged it could not answer itself. This is a RAW
ask, not a spec: the specifier drains this like any other backlog-root
item and decides what (if anything) becomes a real ticket.

## The question

MINT A HIGH-SEVERITY DEFECT (human ruling, SUP-17, 2026-10-06T10:11Z: "Mint a high-severity defect now").

TITLE: swarmforge-coder's branch is force-moved onto main's tip repeatedly, orphaning finished seat work and keeping the "seat-stuck coder" CRIT in a permanent re-fire loop.

SYMPTOM: The branch swarmforge-coder (worktree .worktrees/coder) has been force-moved to origin/main's tip 4x in ~75 minutes, each time orphaning BL-1843 work the seat had already finished. Because no commit ever survives on the branch, the seat-stuck escalation's "no commit for N minutes" clock never resets, so the CRIT re-fires forever and the seat hand-re-derives the same work edit-by-edit.

TIMELINE (UTC, from .worktrees/coder reflog):
- 08:22:15 commit ad573ebfdc (BL-1843 work)
- 08:42:40 merge a7e716f20d
- 08:45:10 and 08:57:28 both wiped by force-moves
- 09:11:35 coordinator recovered from refs/swarmforge/salvage/BL-1843
- 09:36:00 wiped again to 7cbdd7e35d (= main's tip, the BL-2038 commit)
- 4th wipe since confirmed: reflog HEAD@{2} merge 0639b7a51b -> HEAD@{1} "branch: Reset to 7cbdd7e35d"

NOTHING IS LOST: the work survives at refs/swarmforge/salvage/BL-1843 = 0639b7a51b (verified orphaned: `git merge-base --is-ancestor 0639b7a51b HEAD` returns non-zero). Further backups under refs/swarmforge/parcel-backup/coder/*. Recover from the ref, do NOT re-derive by hand.

OPERATOR TRIAGE - what the investigation can skip:
1. The reflog signature of every wipe is "branch: Reset to <sha>", which git writes for `git branch -f` / `git checkout -B`. It is NOT "reset: moving to <sha>", which is what `git reset --hard` writes.
2. Therefore swarmforge/scripts/reset_worktrees.sh is EXCLUDED as the culprit despite being the obvious suspect: it uses `git reset --hard "$main_ref"` (line 72, wrong signature), its --align-main mode is only wired to `start-swarm.sh -clean` (a full relaunch, not something that happens 3x/hour), and test_reset_worktrees_align_main.sh case 09 already pins that the default mode must not hard-reset onto main.
3. A tree-wide grep for `checkout -B`, `branch -f` and `branch --force` across all *.sh/*.bb/*.js/*.ts (excluding .git/ and .worktrees/) returns ZERO hits. No tracked script in the repo emits this operation.
4. Consequence: the wiper is most likely a hand-run git command issued by an AGENT inside a pane (e.g. a merge-up / session-repair / "branch behind main" routine in a role prompt), not daemon or pipeline code. Note the coordinator's own 09:11:35 recovery used the SAME `git branch -f` mechanism and left an identical reflog signature - so the recovery path and the damage path are the same primitive. Suggested first look: role prompt/briefing text and any session-repair or merge-up instructions that tell a seat to re-point its branch at main when it reports "branch behind <sha>: dirty worktree - merge up". status.json currently carries exactly that unresolved role_question for coder (escalated, asked 2026-09-28).

WHY HIGH SEVERITY: it destroys completed work repeatedly, it blocks the coder seat indefinitely, and it has no auto-recovery - the coordinator has already done three manual recoveries and says a fourth is not the answer.

ACCEPTANCE SHOULD INCLUDE: a seat branch that is ahead of main is never force-moved onto main's tip without its commits first being preserved AND re-applied (not merely backed up to a ref nobody re-applies), and the seat-stuck clock reads the seat's own worktree rather than main.
