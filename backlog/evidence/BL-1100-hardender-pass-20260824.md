# BL-1100 — hardener pass, 2026-08-24

## Inbound

Merged architect `3a0ee36b6f` (on cleaner `fc91b3954b` / coder
`7aaf51f70f`) into `swarmforge-hardender`.

## Scope

Delete prose `is_do_not_promote` from `promote_and_route_next.sh`; candidacy
uses structured epic/blocked + `promotion_gates_cli`; skips announce
`skip <id> gate=…`. Shell-only — Stryker/CRAP/DRY N/A.

## Process fix this pass

`bl1100PromotionProseNeverBlocks.property.test.js` used raw `mkdtemp` —
`tmpDirMigrationGuard` RED. Migrated to `mkTmpDir`. Guards 125/125.

## BL-113 Gherkin (soft)

```
total=6 completed=6 killed=3 survived=3 errors=0
```

Ticket Outline (BL-553/556/828): **3/3 killed**.

Prose-sentence Outline (3 mutants): **survived as BL-234 equivalents** —
`promote_and_route_next.sh` never greps free prose (`is_do_not_promote`
deleted); any planted sentence is treated identically, so case/typo flips
of the example phrases cannot change candidacy. Code-level reason:
auto-pick path only consults `is_epic_type` / `is_blocked_status` /
`is_buildable` / `announce_skip` (grep 2026-08-24).

Manifest omits the equivalent Outline scenarios (BL-502/BL-234).

## Hand-authored surgical

| Mutant | Result |
|---|---|
| Silent `continue` on `do not promote` grep | killed |
| Mute `announce_skip … blocked` | killed |
| `is_blocked_status` always false | killed |
| Comment-only "restore" of deleted helper | weak / not a behaviour mutant |

Survivors (behaviour): 0.

## Verification

- Acceptance 8/8; properties 2/2
- Dep-gate PASSED; standing guards 125/125
- HOTFIX pack + board match `27273f2b0a`
- Live prose grep absent from promote script

## Findings

NONE (after mkTmpDir + equivalent sentence mutants documented).

## Forward

`git_handoff` to `documenter`, priority `00`, task
`BL-1100-promotion-candidacy-is-decided-by-structured-fields-never-prose`.

By hardender.
