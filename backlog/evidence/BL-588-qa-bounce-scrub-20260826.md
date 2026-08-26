# BL-588 QA bounce (scrub-deleted-siblings) — 20260826

**Commit checked:** `e783d96c1` (Merge documenter `f14673d861`)
**Task:** `BL-588-isolate-batch-recovery-trees-scrub-deleted-siblings`
**Sibling check:** `VERIFY BL-588` (exit 0)
**Routing:** `cleaner`

## Gates run (Article 4.4 — complete inventory)

| Gate | Result |
|------|--------|
| BL-588 unit + acceptance | 16/16 + 7/7 PASS |
| `required_wiring` | PASS |
| Tip purity vs `origin/main` (BL-506) | **FAIL** — D1, D2 |

## Defects

### D1 — behavior: scrub parcel did not produce BL-588-only tip (class: `behavior`) — **blame: cleaner**

1. **Failing command:** `git diff origin/main...HEAD --name-only`
2. **Commit hash:** `e783d96c1`
3. **First error excerpt:** Handoff `scrub-deleted-siblings` / documenter `f14673d861` only extends `abandoned_commits` on ticket YAML. Tip still lands BL-653 operator scripts, BL-660 shift-pack code, BL-653/660 features and active tickets, raw INTAKE files, and sibling evidence — unchanged from prior bounces.
4. **Failure class:** `behavior`
5. **Expected vs observed:** Expected scrub to re-cut from `origin/main` with batch-recovery paths only. Observed bookkeeping-only forward on still-contaminated QA lineage.

**Remediation:** Reset BL-588 parcel to a tip branched from current `origin/main` containing only BL-588 deliverables; do not forward until `git diff origin/main...HEAD` excludes BL-653/660/INTAKE paths.

### D2 — behavior: BL-1153 residentSpy regression (class: `behavior`) — **blame: cleaner**

Same as prior bounces: `origin/main` has BL-1153 reload test; tip deletes it.

## Inventory

D1, D2 (cleaner). Bounce to **cleaner**.

By QA.
