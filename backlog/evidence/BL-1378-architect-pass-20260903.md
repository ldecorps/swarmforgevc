# BL-1378 — architect review, pass (2026-09-03)

## Scope reviewed

Cleaner's tip (`72d3bde53b`), merged cleanly (no conflicts) into this
worktree. This ticket widens an approval GATE (the close guard the
coordinator runs on every ticket close), so I read the pure decision core
directly rather than trusting the green suites alone.

## Ruling verified before review (BL-1367/BL-1368 trap)

Checked `human_ruling:` and `human_approval:` on both `main` and
`origin/main` — both carry the same block (option 1: require both the
expedite QA verdict record AND the approved commit being an ancestor of
main). The coder's own evidence separately flags that the ruling text
happens to be the `(recommended)` label verbatim and explains why that is
not the BL-1296-style false-positive here: the field itself is populated and
matches across both trees, which is the discriminator, not the label text.
Agree with that reasoning; independently re-verified rather than trusted.

## Dependency gate / co-change

`cd extension && node out/tools/dependency-gate.js
../specs/pipeline/steps/bl1378ExpediteCloseGuardSteps.js` — PASSED, no
forbidden edges. Co-change: entirely in-scope.

## Direct read of the gate logic (not just the property's pass)

- **Invariant 1** (approval path, not a second definition): `close-verdict`'s
  `qa-mailbox?` branch is checked FIRST and returns `{:allowed? true
  :reason :qa-mailbox-handoff}` unconditionally — no expedite-store read can
  veto a mailbox-approved close. Read directly in source (line 183-185).
- **Invariant 2** (fail closed, absent ≠ problem ≠ approval): `:absent` and
  `:problem` are distinct `:kind`s throughout `expedite-approval`. The file
  loop (line 154-165) checks each file's `record-line-problem` BEFORE
  recording a match, and returns `{:kind :problem}` immediately on any
  problem file regardless of file order relative to a match already found —
  so a corrupt file sorted after a matching one still poisons the whole
  store (confirmed by reading the `loop`/`recur`, matching the cleaner's
  same claim). `close-verdict` never treats `nil`/`:no-match`/`:absent` as
  approval — the final `:else` clause is the only fallthrough and always
  refuses.
- **Invariant 3** (names the ticket, QA stage, approval true — all three):
  `expedite-record-approves?` is a single `and` over exactly the three
  fields (`ticket`, `stage = "QA"`, `approval = true`), line 110-113. No
  partial match approves.
- **Landing half of the ruling**: `ancestor-of-main?` consults both `main`
  and `origin/main` (BL-891 posture), returns `true` on any resolvable ref
  saying yes, `false` only when every resolvable ref says no, and `nil`
  (undeterminable) otherwise — `close-verdict`'s `:else` branch on the
  ancestor check refuses on `nil` rather than treating "could not tell" as
  landed. Read directly, matches the ruling's requirement exactly.

## Invariants (BL-633/654) — all three declared, all three covered

1. P1 — a close with no usable record decides exactly as before; only an
   approved+landed record turns a mailbox "no" into a "yes". NON-VACUOUS
   (allowed a record to close without the ancestry answer → 60 FAIL P1/P2).
2. P2 — every store problem shape refuses with a stated detail; absent
   never reported as a problem. NON-VACUOUS (read an unusable store as
   absent → 136 FAIL P2).
3. P3 — exact match approves; seven near-misses, each breaking exactly one
   field, all refuse; the same record refuses five other ticket ids.
   NON-VACUOUS (dropped the stage check → 2 FAIL P3).

Generator reach: P3's near-misses are constructed from the matching record
by breaking exactly one field (not drawn independently) — read the runner,
confirmed this is genuine rather than claimed; independent draws would
almost never collide on two of three fields, which is exactly BL-654's
collision-pair shape. All `mailbox? × store-shape` pairs and all three
ancestry answers are asserted as generated.

## Verification run directly

- `bb swarmforge/scripts/test/ticket_close_guard_lib_test_runner.bb` — ALL
  PASS.
- `bash swarmforge/scripts/test/test_bl1378_expedite_close_guard.sh` — ALL
  PASS (31 checks).
- `bb swarmforge/scripts/test/bl1378_expedite_close_guard_property_runner.bb`
  — ALL PROPERTIES HOLD (500 runs).
- `bash swarmforge/scripts/test/test_ticket_close_guard.sh` — ALL PASS, the
  pre-existing guard unchanged.
- `bash swarmforge/scripts/test/test_commit_integrity_cli.sh` — ALL PASS.
- `bash specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-1378-*.feature` — 12/12.
- `specs/pipeline/steps/index.js` — `bl1378ExpediteCloseGuardSteps`
  registered. `required_wiring` is a genuine anchor (`ticket_close_guard_lib.bb`
  had no mention of `expedite` before this parcel; its one live caller,
  `commit_integrity_cli.bb`, runs on every coordinator close) — confirmed by
  grep, not just trusted from the evidence.

## Property-testing pass (own section, BL-654 scope boundary)

All three declared invariants are the ticket's obligation and are covered
above. No other touched pure module needs new coverage.

## Correctness read

No defect found. The coder's self-audit already caught and fixed two real
fixture bugs (wrong-sha assertion timing, silent `git mv` failure) before
this reached me — read both fixes, present and correct.

## Verdict

No defect found. Forwarding to hardener.
