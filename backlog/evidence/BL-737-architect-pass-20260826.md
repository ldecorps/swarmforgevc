# BL-737 — architect pass — 20260826

**Tip:** cleaner `6889cfd646` (coder lineage via merge)
**Handoff:** `00_20260826T011158Z_000874_from_cleaner_to_architect`

## Verdict

**Pass** — forward to hardender. Review inventory: NONE.

## Scope / tip purity

Authorize **BL-737 paths only** (cross-file duplication gate + acceptance wiring).
QA stages per BL-506.

## Architecture

- Pure policy in `crossFileDuplicationCheck.ts` (`findCrossFileDuplication`);
  git touched-path IO in `commitClaimGitReader.ts`; gate orchestration in
  `pilotAcceptanceGate.ts` via `deps.checkCrossFileDuplication` before move.
- CLI (`pilot-acceptance-gate.ts`) supplies real git-backed deps — no policy
  in the CLI wrapper.
- Unreadable touched-file history fails open with warning (BL-729 mirror);
  refuse is inert (`reasonKind: cross-file-duplication`).
- How-to updated under `docs/how-to/BL-727-pilot-acceptance-contract-gate.md`.

## Invariants

All three declared invariants encoded:
1. Touched-file set only — property “untouched third file” + `resolveTouchedFiles`.
2. N>2 refuses; N≤2 does not — property + unit gate scenarios.
3. Refused land inert — unit tests assert no move/receipt.

## Property coverage

`crossFileDuplicationCheck.property.test.js` still imports `node:test` (vitest
lane discovery issue; same BL-1124 class). Verified 3/3 via `node --test`.
**Hardener:** land import removal off main / isolated worktree if needed.
No additional undeclared properties required — touched pure module covered.

## Verification

| Check | Result |
|-------|--------|
| `dependency-gate.js` on BL-737 modules | PASSED |
| `co-change-report.js` | expected pilot-gate coupling; no surprise edges |
| `vitest run crossFileDuplicationCheck.test.js` | 7/7 |
| `node --test …property.test.js` | 3/3 |
| Ancestry `6889cfd646` ⊂ HEAD | OK |
| Acceptance feature at cited commit | present |

By architect.
