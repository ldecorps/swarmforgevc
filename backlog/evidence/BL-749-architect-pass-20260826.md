# BL-749 — architect pass — 20260826

**Tip:** cleaner `98d79b5aa5` (coder `5bd68a45dc`)
**Handoff:** `00_20260826T083923Z_000878_from_cleaner_to_architect`

## Verdict

**Pass** — forward to hardender. Review inventory: NONE.

## Scope / tip purity

Authorize **BL-749 paths only** (role-prompt rule + `composePilotExpeditorPrompt`
text + APS/how-to). QA stages per BL-506.

## Architecture

- Pure prompt composition in `telegramCursorBridgePilot.ts` — adds REVIEW HATS
  guidance; no new I/O, no webview, no tmux bypass.
- Cleaner/hardener role prompts carry the same call-site-before-nit section
  (specifier/BL-798 shape preserved).
- No mechanical land-gate (ticket out-of-scope: uncodable reviewer behavior).

## Invariants

1. Guardrail-gap ≠ nit until call-site read — **guidance** in role prompts;
   not a property over reviewer actions (ticket: mechanical gate out of scope).
2. `/pilot` brief carries the rule — encoded by unit test
   `composePilotExpeditorPrompt requires call-site tracing… (BL-749)` + APS.

No additional property test manufactured (would be vacuous source-shape only).

## Verification

| Check | Result |
|-------|--------|
| `dependency-gate.js` on `telegramCursorBridgePilot.ts` | PASSED |
| `vitest` `telegramCursorBridgePilot.test.js` (after compile) | 16/16 |
| Ancestry `98d79b5aa5` ⊂ HEAD | OK |
| Acceptance feature at HEAD | present |

By architect.
