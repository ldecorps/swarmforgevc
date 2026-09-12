# BL-1544 QA pass — unowned red found via the coder's own evidence, 2026-09-12

While verifying BL-1544 (merged documenter commit `2f6080d39e`, QA tip
`95b52d1163`), the coder's own evidence file
(`backlog/evidence/BL-1544-coder-20260912.md`, "Acceptance features named
in `qa_e2e_procedure` item 4") reported that re-running the BL-1544
regression list turned up one failure unrelated to BL-1544's own change,
and that the coder had already filed an `unowned-red` note for it. This
is QA's own independent confirmation of that same red, required before
approval per Article 4.2.

## Failing command

```
bash swarmforge/scripts/test/test_bl1374_sync_merge_passengers.sh
```

## Reproduced twice, against two different trees

1. Against this parcel's own QA tip (`95b52d1163`): 2 failures.
2. Against `swarmforge/scripts/land_step_lib.bb` read directly from
   `origin/main` (`dbcab2ffb2`, BL-1544's own changes entirely absent —
   copied the file from `origin/main`, ran the test, restored the worktree
   file byte-for-byte, confirmed `git status --short` clean): the same 2
   failures, identical text.

## First error excerpt (identical in both runs)

```
01/02/04: a clean auto-merge's passengers
  FAIL 01: the passenger file is not this ticket's own path (unexpectedly found 'shared.txt')
05: the live tip that produced the report
  FAIL 05: the passenger's own ticket still owns its file (missing 'BL-1296')
test_bl1374_sync_merge_passengers: 2 FAILURE(S)
```

## Failure class

`acceptance` (a shell-driven regression check over real git fixtures,
BL-1374's own `qa_e2e_procedure`-named lane) — a clean auto-merge's
passenger-path misattribution, per the coder's own diagnosis: "sync-merge
passenger misattribution, a different code path" from BL-1544's
subject-ambiguity fix.

## Expected vs observed

Expected: both BL-1374 fixture cases (01 and 05) pass, per
`backlog/done/BL-1374-...yaml`'s own closed acceptance.
Observed: both still fail today, on `origin/main` directly, with BL-1544's
own diff entirely removed from the file under test — proving BL-1544 did
not cause this and could not fix it (`task_scope_gate_lib.bb` is untouched
by BL-1544 per its own constraint, and this red is in a sibling lane).

## Search for an existing owner

- `backlog/standing-reds.tsv`: grepped for `1374`, `sync.merge`,
  `passenger` — no row.
- `backlog/active/`, `backlog/paused/`, `backlog/hold/`, `backlog/done/`:
  grepped for `test_bl1374_sync_merge_passengers`, `sync-merge passenger
  misattribution`, `passenger's own ticket still owns`, `passenger file is
  not this ticket` — nothing open or closed owns this specific red (only
  BL-1374 itself, already `done`, whose own fixtures these are regressing
  against).
- The coder's evidence says they already filed an `unowned-red` note to
  the specifier and coordinator for this same red during their own pass
  (2026-09-12, same parcel) — no ticket or register row has appeared yet
  as of this QA pass.

## Disposition

Filing this as QA's own confirming `unowned-red` `note` (priority 00) to
specifier and coordinator per the standing-red rule (2026-09-05, Article
4.2) — not a fresh report, a second-role confirmation of the coder's
already-filed one, since no ticket exists yet to name. BL-1544's own
gates are otherwise all green (unit suite 615/615 files, property suite
clean except the two already-registered reds BL-1502/BL-1503 — unrelated
domains, confirmed owned — acceptance 4/4, required_wiring confirmed by
the acceptance run itself, docs/Specification.MD/how-to current, no
`Until BL-1544 lands` interim left once landed). Per Article 4.2, QA
withholds approval of BL-1544 until this red carries an owning ticket;
this is not a bounce (BL-1544 did not cause it) and the parcel WAITS in
place.

By QA.
