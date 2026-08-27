# BL-819 — architect recheck pass, post-QA-bounce (2026-08-07)

## Received

`git_handoff` from cleaner, commit `25c24fd156` (merge_and_process), bundled
with BL-839/BL-773/BL-822. This is the coder's re-fix for QA's bounce
recorded at `backlog/evidence/BL-819-qa-bounce-20260807.md`, a 3-item
inventory:

- **D1** (coder): my own earlier architect bounce
  (`backlog/evidence/BL-819-architect-bounce-20260807.md`, `95be440a`) asked
  for wiring tests on the two `.bb` lean-ledger CLI call sites; the coder's
  fix (`6a6e69b4`) existed but was dropped from the lineage that reached QA
  — "Forwarded Commits Carry Their Lineage" violation.
- **D2** (hardener): hardener's only commit in the prior lineage (`518f73c1`)
  never actually ran against BL-819's production TypeScript — it only
  addressed BL-773 that pass.
- **D3** (documenter): documenter's only commit in the prior lineage
  (`ec25074cf6`) never produced BL-819's required documentation.

Per Article 4.4 "one bounce, many owners", the single `git_handoff` routed to
coder (earliest blamed, D1); D2 and D3 travel with the parcel for hardener
and documenter to clear on their own passes. I am not blamed on any item in
this inventory — my job here is to verify D1 (the item that could affect
whether this parcel is even sound to keep forwarding) and confirm D2/D3
still correctly await their owners rather than having been silently dropped
again.

## D1 remediation check

```
find swarmforge/scripts/test -iname '*lean_ledger*'
swarmforge/scripts/test/test_lean_ledger_bb_wiring.sh

git merge-base --is-ancestor 6a6e69b4 HEAD
# exit 0 — 6a6e69b4 (the original wiring-test fix commit) IS now an
# ancestor of my HEAD, unlike the commit QA reviewed.
```

Ran the wiring test itself, not just confirmed its presence:
```
bash swarmforge/scripts/test/test_lean_ledger_bb_wiring.sh
PASS: A1/A2/A3/B1/B2/B3
ALL PASS: lean ledger .bb wiring (done_with_current_task.bb + commit_integrity_cli.bb)
```

Covers all three branches (happy path, non-zero exit, missing CLI) for both
call sites (`done_with_current_task.bb`, `commit_integrity_cli.bb`), exactly
as my original bounce specified.

D1: **FIXED**, and this time confirmed to actually be in the lineage
reaching me — the specific failure mode QA caught (a fix that exists in git
history but never rejoins the forwarded branch) is exactly what the ancestry
check above rules out.

## D2 / D3 — confirmed still open, correctly left for their owners

- No hardener commit touching `extension/src/metrics/leanLedger*.ts` or
  `extension/src/quality/leanLedger.ts` exists in this lineage since QA's
  review (`git log --oneline --all -- extension/src/metrics/leanLedger*.ts
  extension/src/quality/leanLedger.ts` — same two commits as QA's own
  evidence found, no new ones). D2 is unresolved; hardener must clear it
  before forwarding to documenter.
- `specs/features/BL-819-ticket-lifecycle-ledger.feature` still carries no
  Gherkin-mutation manifest header, and
  `swarmforge/roles/coordinator.prompt` still has no section on the
  lean-ledger duty (`grep -n "BL-819\|lean-aware\|lifecycle ledger"
  swarmforge/roles/coordinator.prompt docs/how-to/*.md` — no output). D3 is
  unresolved; documenter must clear it before forwarding to QA.

I am not the owner of either item and do not attempt to fix them here — per
"Never Blind-Forward A Bounce You Cannot Fix", I am forwarding the inventory
onward intact (this evidence file + the original QA bounce evidence, both
already in the tree) rather than silently letting D2/D3 evaporate a second
time.

## Other checks (this ticket's own production code, unchanged since my
original pass)

- `git diff 58c42419 HEAD -- extension/src/metrics/leanLedger*.ts
  extension/src/quality/leanLedger.ts extension/src/tools/leanLedgerRecordArgs.ts`
  — empty. No production code changed; my original architectural review of
  the ledger design still stands.
- Property tests (`test/leanLedgerInvariants.property.test.js`): unaffected
  by this delta.
- Scope hygiene (BL-506): this delta's only file is the wiring test script
  QA's D1 asked for. Clean.

## Verdict

D1 fixed and confirmed in-lineage. D2 and D3 remain, correctly routed to
hardener and documenter respectively — not mine to clear, not dropped.
Forwarding to hardener, who must address D2 before its own forward.

By architect.
