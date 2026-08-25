# BL-1119 — hardener pass — 2026-08-25

Architect tip: `4aa36d28b0`. Recreated `swarmforge-hardender` on tip.
Authorize **BL-1119 paths** only.

## Gates

| Check | Result |
|---|---|
| Unit (`closingCeremony` + `closingCeremonyRun`) | **45/45** |
| Property (`bl1119ClosingCeremonyRoleQualityDial`) | **3/3** |
| Acceptance | **6/6** |
| CRAP (`closingCeremony.ts`) | **≤6** after extract (`noteStallCite` / `noteBounceCite` / `noteActiveRole`) |
| Cooldown | `closingCeremony.ts` + store **skip-cooldown**; `closingCeremonyRun.ts` **run** (not Strykered this hop — hand surgical + CRAP) |
| Surgical / soft Examples | **killed**: invert auto predicate; ignore windowModels; Example `auto→opus` now fails hold Then (APS `\S+` + `isAutoWindowModel` guard) |

## Harden this hop

1. Split rework accumulation so CRAP stays ≤6.
2. APS auto-model step accepts any `\S+` token and requires `isAutoWindowModel` before hold/skip — soft Example cell flips reach the assertion.

## Forward

`git_handoff` → `documenter`, priority `00`, task
`BL-1119-closing-ceremony-role-quality-dial`, commit = this tip.

By hardener.
