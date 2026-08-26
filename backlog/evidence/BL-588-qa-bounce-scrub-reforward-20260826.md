# BL-588 QA bounce (scrub re-forward) — 20260826

**Commit checked:** `65fcd6e10` (Merge documenter `dd4e76d26e`)
**Task:** `BL-588-isolate-batch-recovery-trees-scrub-deleted-siblings`
**Routing:** `cleaner`

## Gates on polluted QA HEAD

| Gate | Result |
|------|--------|
| BL-588 unit + acceptance on QA HEAD | 16/16 + 7/7 PASS |
| Tip purity vs `origin/main` | **FAIL** — BL-653/660/INTAKE still present |
| BL-1153 residentSpy on QA HEAD | **FAIL** — reload test deleted |

## Clean tip EXISTS but was not forwarded

Cleaner re-cut at **`2bdb4c902`** (`fix(BL-588): add batch-recovery src and property tests`):

- `git merge-base --is-ancestor origin/main 2bdb4c902` — PASS
- `git diff origin/main...2bdb4c902 --name-only` — **26 paths, all BL-588** (batchRecovery*, feature, steps, docs)
- No BL-653/660/INTAKE/operator/swarmShift paths
- `residentSpyUiHtml.test.js` — BL-1153 test **present** (matches `origin/main`)
- Unit tests on that commit — 16/16 PASS

Documenter `dd4e76d26e` only appended `abandoned_commits` on the **103-commit polluted QA lineage**; it did not `merge_and_process` the clean cleaner tip.

## Defect

**D1 — behavior (blame: cleaner/documenter chain):** QA must receive `merge_and_process` of commit **`2bdb4c902`** (or its documenter successor that contains the same tree), not yaml bookkeeping on abandoned QA branch history.

**Remediation:** Forward `git_handoff` to QA with `commit: 2bdb4c902` (or rebase documenter docs onto it). Reset QA integration to that tip before re-forwarding.

## Inventory

D1 (cleaner). Bounce to **cleaner**.

By QA.
