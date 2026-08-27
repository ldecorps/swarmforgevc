# BL-1091 — hardener pass, 2026-08-24

## Inbound

Merged architect `d65f4dfa45` (on cleaner `b2fbc1f1a7` / coder
`3d59989362`) into `swarmforge-hardender`.

## Scope

Expedite paused→active rename pathspec-commits both ends via
`commitApprovalWrites(…, extraAbsPaths)` + cleaner `uniqueRelPaths`.

## Host / BL-149

`commitIntegrityRunner.ts`: **run** (age ~10d). `backlogWriter.ts`:
skip-cooldown. Host quiet.

## Process fixes this pass

1. **Gherkin Outline** — verb/writer cells were captured but not
   case-sensitively asserted (8/8 soft survivors on case flips). Added
   allow-lists + subject asserts in
   `bl1091ExpeditePromotionCommitSteps.js`. Hard remutation: **8 killed /
   0 survived**.
2. **Unit** — locked `uniqueRelPaths` dedupe/empty-relative behaviour and
   destination+source pathspec for Stryker survivors on the
   `rel && !includes` guard.

## Stryker (targeted)

`out/util/commitIntegrityRunner.js:81-98` via scratch vitest include
(commitIntegrityRunner + backlogWriter unit only — full-suite dry-run red
on unrelated telemetry fixture):

```
All files | 100.00 | killed 16 | survived 0
```

## CRAP (after coverage)

| Function | CRAP |
|---|---|
| `uniqueRelPaths` | 4.00 |
| `runCommitIntegrity` | 3.00 |
| `commitApprovalWrites` | 2.00 |

## Hand-authored surgical (pre-Stryker)

| Mutant | Result |
|---|---|
| Ignore `extraAbsPaths` | killed |
| Drop dedupe (`if (rel)`) | killed |

## Verification

- Acceptance 6/6; properties 2/2; unit 10/10
- Dep-gate PASSED; standing guards 125/125
- HOTFIX pack + board match `27273f2b0a`

## Findings

NONE (after Outline + uniqueRelPaths locks).

## Forward

`git_handoff` to `documenter`, priority `00`, task
`BL-1091-expedite-commits-only-half-of-the-promotion-move`.

By hardender.
