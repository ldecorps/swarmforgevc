# BL-747 — architect pass — 20260826

**Tip:** cleaner `30e10c927e` (coder `d577fe97b2`)
**Handoff:** `00_20260826T082830Z_000877_from_cleaner_to_architect`

## Verdict

**Pass** — forward to hardender. Review inventory: NONE.

## Scope / tip purity

Authorize **BL-747 paths only** (shell entry-point drive check + gate wiring +
APS/docs). QA stages per BL-506.

## Architecture

- Pure policy in `shellEntryPointDriveCheck.ts` (extract / invoke / assess);
  git + ticket IO in `commitClaimGitReader.checkShellEntryPointDrive`; gate
  refuses via `reasonKind: parallel-shell-reimplementation` before move.
- CLI supplies real deps through `pilot-acceptance-gate.ts`.
- No-op when no touched shell tests or no named entry-points; unreadable
  inputs fail open with warning (BL-729/737 posture).
- How-to updated under `docs/how-to/BL-727-pilot-acceptance-contract-gate.md`.

## Invariants

All three declared invariants encoded in pure helpers + property/unit tests:
1. Dual-condition no-op.
2. Invocation required (source-only fails); refuse inert at gate.
3. Unreadable → `checked: false` (open warning).

## Property coverage

Coder properties cover source-vs-invoke and no-op cases (`node:test` import;
BL-1124 may block committing removal). No additional undeclared properties
needed on the touched pure module.

## Verification

| Check | Result |
|-------|--------|
| `dependency-gate.js` on BL-747 modules | PASSED |
| `vitest` unit | 8/8 |
| `node --test` property | 3/3 |
| Ancestry `30e10c927e` ⊂ HEAD | OK |
| Acceptance feature at HEAD | present |

By architect.
