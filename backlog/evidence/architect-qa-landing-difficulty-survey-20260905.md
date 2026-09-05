# QA landing difficulty — survey, 2026-09-05 (architect)

Compiled at the human's request: gather what makes it hard for QA to land
tickets on `main`, for the specifier to act on.

## Pattern: QA almost never gets a clean land — it hand-builds one instead

Surveying `backlog/evidence/*land-escalate*` and `*land-note*` from
2026-09-02 through today, at least 15 tickets required QA to abandon the
normal automated land path and hand-build a "tip-pure replay" instead:
BL-1317, BL-1324, BL-1338, BL-1356, BL-1359, BL-1360, BL-1364, BL-1365,
BL-1367, BL-1368, BL-1370, BL-1382, BL-1383, BL-1384, BL-1386, BL-1388,
BL-1393, BL-1395, BL-1398, BL-1399, BL-1400, BL-1401, BL-1402, BL-1413.
That is the majority of everything QA landed in the window, not an
exception case.

Two distinct root causes recur:

### 1. `land_step_cli.bb` LAND_ESCALATE on inflated sibling lists (BL-1354/BL-1389 class)

`land_step_cli.bb` returned `LAND_ESCALATE` naming ~41 "unlanded-as-
ancestor" sibling tickets on BL-1395, BL-1398, BL-1399, BL-1382, BL-1386,
BL-1388, BL-1393 — most of those siblings were already in `backlog/done/`.
BL-1354 ("a shared path hides a landed sibling") and BL-1389 ("a path an
unlanded sibling owns alone never rides another ticket's land") both
targeted this and are now `done`, but QA's own evidence keeps citing "the
known inflation" as late as 2026-09-04 (BL-1395/BL-1399 land-escalate
notes) — i.e. QA is still routing around it by hand rather than trusting
the tool, even after the fix landed. Worth specifier confirming whether
the fix actually closed the gap or only narrowed it.

### 2. Cross-ticket entanglement on a plain merge (BL-1402/BL-1413 class, ongoing)

A plain `git merge <documenter-tip>` into QA's worktree repeatedly pulls in
an unrelated SIBLING ticket's still-active, still-unlanded work because
they share a branch ancestor (BL-1413's evidence: merging BL-1413's tip
pulled in ~28 files that were actually BL-1402's bounced, not-done work).
QA's standing workaround: `git log <fork>..<tip>` grepped for the ticket's
own `^[a-f0-9]* BL-XXXX:` commit subjects, union the touched paths, apply
that diff by hand (occasionally hitting binary-fixture files `git apply`
refuses and needing `git show <commit>:<path| >` per file instead), then
verify byte-for-byte. This recipe is now so standard it is named as "same
recipe as BL-1364/BL-1365/BL-1383" in its own evidence file — it has
become the default path, not a fallback.

## Why this matters for the specifier

- Every hand-built land is real, uncompensated QA effort: grep, diff,
  reconcile, byte-verify, write an evidence file — repeated per ticket
  instead of solved once in the tooling.
- It is also risk surface: BL-1413's own evidence shows a near-miss (had
  to `git reset --hard` back out an entangled merge and redo it) — the
  memory index elsewhere confirms merges have DROPPED already-landed work
  silently more than once (`merge-reconcile-silent-drop-incidents`,
  `article42-refire-is-an-unrecorded-closeout`) in exactly this kind of
  hand-reconciliation.
- The pattern is stable enough (2026-09-02 through today) and frequent
  enough (majority of lands) that it reads as a standing defect in the
  land tooling / worktree-sharing model, not per-ticket noise — the kind
  of thing Article 3.6/4.4 would want surfaced rather than re-discovered
  ticket by ticket.

## Not claiming

- I have not diagnosed a fix — this is a survey, not a root-cause analysis
  of why worktrees entangle siblings on a plain merge, nor of whether
  BL-1354/BL-1389 actually closed the sibling-inflation gap or only
  narrowed it. Both need someone reading `land_step_cli.bb` and the
  worktree-sharing model directly.
- Recommend: the specifier check whether an open ticket already covers
  "QA's land step forces a hand-built replay on most tickets" as its own
  standing defect (grep before minting, per this project's own
  discipline) and, if not, mint one — this survey is the evidence base.
