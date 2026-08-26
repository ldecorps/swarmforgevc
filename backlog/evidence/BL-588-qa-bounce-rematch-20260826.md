# BL-588 QA bounce (rematch) — 20260826

**Commit checked:** `b02ee3255` (Merge documenter `6ffabfbef7` for BL-588 re-verify)
**Task:** `BL-588-isolate-batch-recovery-trees`
**Sibling check:** `VERIFY BL-588` (exit 0)
**Prior bounce:** `backlog/evidence/BL-588-qa-bounce-20260826.md` (3403f29b1 — D1/D2 unresolved)
**Routing:** `cleaner`

## Gates run (Article 4.4 — complete inventory)

| Gate | Result |
|------|--------|
| `npm run compile` | PASS |
| `npx vitest run test/batchRecovery*.test.js` | 16/16 PASS |
| APS `BL-588-isolate-batch-recovery-trees.feature` | 7/7 PASS |
| `required_wiring` (`bl588BatchRecoverySteps` in `index.js`) | PASS |
| `git diff origin/main...HEAD` tip purity (BL-506) | **FAIL** — D1, D2 |
| BL-653/660 re-verification | BLOCKED BY D1 — still entangled on same tip |

## Defects

### D1 — behavior: prior bounce remediation not applied (class: `behavior`) — **blame: cleaner**

1. **Failing command:** `git diff origin/main...HEAD --name-only`
2. **Commit hash:** `b02ee3255`
3. **First error excerpt:** Documenter forward `6ffabfbef7` only adds `abandoned_commits` to ticket YAML. Tip vs `origin/main` still includes BL-653 operator scripts, BL-660 `swarmShiftCore`/`apply_shift_schedule.bb`, raw INTAKE files, and BL-653/660 active tickets — same hitchhikers as bounce `3403f29b1`.
4. **Failure class:** `behavior`
5. **Expected vs observed:** Expected re-forward after QA bounce to re-cut a BL-588-only tip on current `origin/main`. Observed superseded-merge bookkeeping only; land would still ship BL-653/660/INTAKE paths under a BL-588-only handoff.

**Remediation:** Re-cut BL-588 branch from `origin/main` with only batch-recovery deliverables; forward BL-653 and BL-660 as separate parcels after tip scrub (Article 2.6).

### D2 — behavior: BL-1153 residentSpy regression persists (class: `behavior`) — **blame: cleaner**

1. **Failing command:** `git diff origin/main...HEAD -- extension/test/residentSpyUiHtml.test.js`
2. **Commit hash:** `b02ee3255`
3. **First error excerpt:** `origin/main` has BL-1153 reload test (landed `000a8c8706`); tip still deletes it.
4. **Failure class:** `behavior`
5. **Expected vs observed:** Expected `residentSpyUiHtml.test.js` restored from `origin/main` after bounce fix. Unchanged from prior bounce.

## Inventory

D1 (cleaner), D2 (cleaner). Bounce to **cleaner**.

By QA.
