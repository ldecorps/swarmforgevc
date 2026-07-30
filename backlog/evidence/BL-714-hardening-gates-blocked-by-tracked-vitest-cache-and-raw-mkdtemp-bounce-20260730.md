# BL-714 QA bounce — 2026-07-30 (at QA, riding along inside BL-630's parcel)

## D1: Documenter pass missing entirely

**Failing command**: no command — inspected the commit lineage directly:

```
git log --oneline 0c9e27af5..32d36ad4db -- extension/test/tmpDirMigrationGuard.property.test.js extension/test/rootNodeModulesCacheIgnored.property.test.js
git diff-tree --no-commit-id -r 32d36ad4db
```

**Commit hash**: `32d36ad4d` — same commit as BL-630's round-4 bounce
(`backlog/evidence/BL-630-push-sweep-refuses-non-qa-approved-main-bounce-20260730-4.md`,
D2). This ticket's own work (`0c9e27af5` mint through `80c8520a5` architect
approval, then hardening in `b92688edef`) reached QA only as ancestry inside
BL-630's parcel — **no coder, architect, or hardener `git_handoff` ever
named `BL-714` as its own `task`** (Article 2.6 requires a batch role whose
commit satisfies more than one ticket to forward each under its own stable
task name; that never happened here). QA is filing this ticket's own
evidence file now because its `required_stages` explicitly names
`documenter`, and — same defect as BL-630 — `32d36ad4d` is a content-free
merge (`git diff-tree --no-commit-id -r 32d36ad4db` is empty).

**Failure class**: `behavior`

**Expected vs observed**: `required_stages: [coder, cleaner, architect,
hardender, documenter, qa]` in
`backlog/active/BL-714-hardening-gates-blocked-by-tracked-vitest-cache-and-raw-mkdtemp.yaml`
explicitly requires a documenter pass. Observed: no documenter-authored
commit anywhere in this ticket's lineage.

## Everything else checked — PASS (this ticket's own gates)

- `specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-714-hardening-gates-blocked-by-tracked-vitest-cache-and-raw-mkdtemp.feature`:
  3/3 pass.
- Both `required_wiring` items verified directly against the tree (not
  trusted from test output alone): the tracked cache blob
  (`node_modules/.vite/vitest/.../results.json`) is absent from `32d36ad4db`
  (`git cat-file -e 32d36ad4db:...` fails as expected), and all four
  `telegramCursorBridge{Expedite,Logs,Redeploy,Update}.test.js` files now
  call the shared `mkTmpDir` helper (confirmed via diff, no raw
  `fs.mkdtempSync` remaining).
- Property tests: `rootNodeModulesCacheIgnored.property.test.js` and
  `tmpDirMigrationGuard.property.test.js` both present and green.
- Full unit suite green modulo the known, pre-existing, unrelated
  `CURSOR_API_KEY` leak flake (see BL-630's own round-4 evidence file for
  detail) — this ticket's own scope is unaffected.

## Remediation pointer

Owning role: **documenter**. Add or explicitly judge-and-record
documentation confirming the two hardening-gate blockers (tracked vitest
cache blob; raw-mkdtemp bypass) are fixed — this ticket's own
`required_stages` names `documenter` as mandatory, so an explicit "no doc
content needed, here's why" judgment is the minimum acceptable outcome, not
silence.

Separately: this ticket's own pipeline identity was never carried forward
by task name (see BL-630's round-4 evidence, D2) — flagged to
specifier/coordinator by `note`, not itself part of this bounce's
remediation.
