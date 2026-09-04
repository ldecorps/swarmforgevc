# BL-1392 — documenter finding: origin/main's handoffd.bb currently cannot load (2026-09-04)

## What happened
While processing QA's merge-up note for BL-1392 (`13d59ed2b1`), the merge
conflicted in `swarmforge/scripts/handoffd.bb` between my worktree's
already-fixed cron-heartbeat block and QA's incoming block — which turned
out to be the PRE-FIX version.

## Root cause
The hardener found and fixed a load crash in `handoffd.bb` (commit
`631a5b4552`, `backlog/evidence/BL-1392-hardener-critical-fix-handoffd-load-crash-20260904.md`):
`cron-heartbeat-state` called `(read-json ...)`, a function that does not
exist anywhere in this codebase, and `cron-heartbeat-sweep!`
forward-referenced `send-push-alarm-email!` (defined ~650 lines later) —
babashka/SCI does not tolerate forward references and crashes at analysis
time. The fix relocated the whole cron-heartbeat block and replaced the
bad call with the established `(try (json/parse-string (slurp ...) true)
(catch Exception _ nil))` pattern used at 15+ other sites in the file.

A priority-00 note reached documenter (the ticket's holder at the time)
naming the fix to merge before landing. Documenter merged it
(`a57337518a`), re-verified BL-1390's rework on top of it
(`b9cf76e60d`), and re-sent BL-1392 — but that self-queued send was
abandoned by the pipeline before it reached QA (superseded by an
incoming BL-1390 rework task; see `.swarmforge/handoffs/inbox/abandoned/`
in the documenter worktree for the abandoned record). **QA never received
the fix.**

## Verified directly
- `git merge-base --is-ancestor 631a5b4552 13d59ed2b1` — **false**. QA's
  approved/broadcast commit for BL-1392 does not have the crash fix.
- `git merge-base --is-ancestor 13d59ed2b1 origin/main` — **true**. That
  commit is already landed.
- Current `origin/main`'s `swarmforge/scripts/handoffd.bb` still calls
  `(read-json ...)` in `cron-heartbeat-state` and still has the
  forward-reference shape — `bb swarmforge/scripts/handoffd.bb
  <project-root>` on that tree will crash at daemon startup, exactly as
  the original incident described.

## What this documenter worktree did
Resolved its own merge of `13d59ed2b1` by keeping the already-correct,
relocated cron-heartbeat block (verified: exactly one definition of each
of `cron-heartbeat-sweep!`/`cron-heartbeat-state`/`cron-heartbeat-state-file`,
no `read-json` call anywhere in the file, `bb -e '(load-file
"swarmforge/scripts/handoffd.bb")'` loads without crashing) rather than
merging in the reintroduced bug. This fixes documenter's OWN worktree
only — it does nothing for `origin/main`, which only QA can land to
(Article 1.8).

## What still needs to happen
`origin/main`'s `handoffd.bb` needs `631a5b4552`'s fix landed — a fresh
QA land carrying that commit (or a hotfix, per the constitution's own
hotfix procedure) is required. Until then, any host that pulls
`origin/main` and restarts `handoffd.bb` will crash at startup. Alerted
via priority-00 note to QA and the coordinator alongside this evidence
file.
