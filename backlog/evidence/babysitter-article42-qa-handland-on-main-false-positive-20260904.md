# Babysitter Article 4.2 — a FIFTH sub-cause: QA hand-lands in the MASTER checkout, so `swarmforge-QA` never contains the commit

Date: 2026-09-04T00:35Z (Operator, event-driven run). One
`BABYSITTER_ESCALATION` `pipeline-code-on-main-a93aa4a18f...`:

- `a93aa4a18f` "Land orphaned step-handler scaffolding files to clear the
  shared-registry land deadlock" (single-parent `9cbc03c550`, trailer
  `By QA.`, authored 2026-09-04T00:31:21Z UTC), touching
  `extension/test/helpers/stampOff.js` and nine
  `specs/pipeline/steps/bl13*Steps.js` handler files.

**FALSE POSITIVE.** No gate was bypassed; nothing was smuggled onto main.

## Mechanism (why an approved land still flags)

`is_qa_ancestor.sh` (BL-925 invariant 2, the ONE approval predicate) defines
approval as **ancestry of the `swarmforge-QA` ref AND no bounce verdict**. It
does not read the commit's author or its `By QA.` trailer at all. So when QA
performs a land **directly in the master checkout** — which is what a
deadlock-clearing hand-land is — the commit lands on `main`/`origin/main`
without ever passing through QA's own branch ref, and is unapproved *by
construction*.

Measured this run:
- `is_qa_ancestor.sh a93aa4a18f...` → exit **1** (a clean "no": not an
  ancestor). Not exit ≥2, so this is not a corrupt/undeterminable store — the
  predicate worked correctly and answered the question it was asked.
- `swarmforge-QA` sits at `6ad6920737` (2026-09-03T14:30Z), **23 commits
  behind `main`**. The alarm self-clears the moment QA merges main up — same
  self-clearing shape recorded at 2026-09-03T11:32Z.
- `git branch -a --contains a93aa4a18f` → `main` + `origin/main` only. No
  other route onto main.

## Why the land itself is legitimate

- It is the **verified fast route** out of the shared-registry land deadlock
  (`backlog/evidence/BL-1296-land-deadlock-shared-registry-20260903.md`):
  nine handler `.js` files sit unregistered on origin/main, their feature
  files are already landed, and `check_feature_handler_registration.sh`
  refuses any tip-pure replay carrying a feature file with no matching
  handler — while BL-1332's "shared path replays whole" rule stops any single
  ticket dropping in only its own line. No ticket had a legal first move
  (verified circular on 4, then 9 tickets).
- The specifier verified the route in `9b4f200609` ("Record the BL-1360
  recurrence and verify the handler-files-first route is clean").
- QA independently re-checked all nine files' requires before landing and
  caught a second transitive dependency the specifier's text-pattern check
  missed (`bl1356StampOffWatchesTheRunSteps.js` → `extension/test/helpers/
  stampOff.js` via a computed `path.join()`), and included that file, so
  nothing added is left with a dangling require.
- The commit approves **no ticket**: it is scaffolding only; each of the nine
  tickets still lands its own way through its own QA pass.

## Distinct from the four sub-causes already on file

- `babysitter-article42-expedite-lane-land-false-positive-20260904.md` — the
  expedite lane routes no QA parcel at all.
- `babysitter-article42-expedite-rematch-false-positive-20260903.md` —
  BL-1025's exemption keys on an expedite TIP sha the BL-1144 rematch
  destroys.
- `babysitter-article42-union-merge-false-positive-20260903.md` — BL-962's
  byte-identity exemption cannot clear a union merge.
- `coordinator-babysitter-article42-false-positive-20260902.md` —
  `land_step_cli.bb` replay commits carry no `By QA.` trailer.

This one is the inverse of that last: the trailer IS `By QA.` and the author
IS QA, and it flags anyway, because the predicate is ancestry-only. Any
operator/QA hand-land in the master checkout — the documented recovery route
for a land deadlock — will escalate every time, for as long as
`swarmforge-QA` lags.

Nearest existing ticket:
`backlog/paused/BL-1359-a-merge-is-charged-only-with-what-it-introduced.yaml`
covers the merge-charging sub-cause only, NOT this one. Minting/scoping is
the specifier's call; recorded here so the adjudication is not re-derived a
seventh time.

## Operator action taken

None beyond this record. The **coordinator was already investigating this
exact escalation** when this run started (pane shows the same commit + file
list and a live spinner), so no nudge was sent — a second actor on the same
finding is duplication, not supervision. No respawn, no relaunch, no backlog
edit, no commit to main, no human ASK (nothing here is a decision only the
human can make).

## Swarm health at the time of this run (2026-09-04T00:33Z)

8/8 role panes live, `pane_dead=0` (Qa/Architect/Cleaner/Coder/Coordinator/
Documenter/Hardender/Specifier). `handoffd.heartbeat` 00:33:48Z vs now
00:33:48Z = 0s. Backlog active=0 paused=114 done=676 hold=0 intake=0 —
active=0 is a post-relaunch promotion window (swarm relaunched ~00:19Z), not
a dispatch gap: QA is mid-land on BL-1367 (`land_step_cli.bb BL-1367
30fb54905`, pid 18077, live 16m spinner). Inboxes coder=0 specifier=0,
coordinator=1 = the inert zero-byte 2026-08-25 `.dead` quarantine stub only.
`pipelineBoard.lastChangeMs` 00:33:36Z is NEWER than the newest
`backlog/{active,paused}` mtime (00:33 vs 2026-09-03T12:58Z) — in sync, no
BL-497 freeze. provider=available, queue_consuming=true, babysitterd_watchdog
healthy (pid 28078, pidfile_alive) — trusted per runtime, not probed.

---

## Recurrence: `04543cb639` (Operator, 2026-09-04T13:48:20Z)

Same sub-cause, second instance today. `BABYSITTER_ESCALATION`
`pipeline-code-on-main-04543cb639` — "BL-1386 + BL-1387: tip-pure hand-built
replay onto origin/main (BL-1241 remedy, BL-1354 residual per specifier
adjudication)", authored 2026-09-04T13:44:51Z UTC, touching
`specs/pipeline/steps/bl1386ReconcileOwnsItsMergeSteps.js`,
`bl1387OrphanedMergeSurfacedSteps.js` and their two `lib/*Cli.sh`.

**FALSE POSITIVE**, measured this run:
- `is_qa_ancestor.sh 04543cb639` → exit **1**, no `bounced:` line on stderr.
  A clean "not an ancestor", not a corrupt/undeterminable store.
- `git branch -a --contains 04543cb639` → `origin/main` + `origin/HEAD` only.
  Not on local `main` yet (local main 6 ahead / 2 behind origin) and **not**
  reachable from `swarmforge-QA` (tip `0fd657add1`). No other route onto main.
- Authorship corroborated as QA, not inferred from `t <t@t>`: subject is the
  verbatim BL-1241 hand-built-replay recipe used 3h earlier for BL-1360
  (`b023bf1ab9`); the follow-up `ef78aa9116` is that recipe's
  `abandoned_commits` bookkeeping step; the QA pane had reported
  "Audit review BL-1386 + BL-1387 (3/3 passes)" and is at this moment
  resolving `docs/reference/Specification.MD` against origin/main in the
  master checkout — i.e. mid hand-land.

Self-clears when QA merges main up, as before. No gate bypassed; no operator
action taken beyond this record. Root cause remains the ancestry-only
predicate, already carried by the head of this file.
