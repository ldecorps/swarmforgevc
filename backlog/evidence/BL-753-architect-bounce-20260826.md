# BL-753 — architect bounce — 20260826

**Commit reviewed:** cleaner `71bcff8e9a` (coder `81af7a1235`)
**Handoff:** `50_20260826T085114Z_000879_from_cleaner_to_architect`
**Verdict:** SEND BACK to **coder** (Article 4.4 complete inventory)

## Gates run

| Check | Result |
|-------|--------|
| Dependency gate (BL-753 modules) | PASSED |
| Architecture (pure check + gate deps + prompts) | clean |
| Unit `unreachableStepHandlerCheck.test.js` | 8/8 |
| Declared invariants property encoding | **FAIL** — D1 |
| Co-change / hitchhike | expected gate coupling only |

## Inventory

### D1 — declared invariant unencoded (class: `invariant-unencoded`) — **blame: coder**

**Invariant:** "A registered step pattern in a run-touched specs/pipeline/steps/*.js
file that matches no rendered step of the ticket's acceptance feature refuses
land with reasonKind unreachable-step-handler — never silently treated as
cosmetic."

**Defect:** Parcel has example unit tests and APS, but **no**
`*.property.test.js` encoding the quantified property (every registered pattern
must match ≥1 rendered step when paired; miss → refuse). Ticket declares
`invariants:`; architect must not author the missing property test (coder
owns that). No non-encodability reason is stated.

**Remediation:** Add `extension/test/unreachableStepHandlerCheck.property.test.js`
(fast-check) that fails if `assessUnreachableStepHandlers` / gate refuse path
accepts an unmatched registered pattern, and stays green for matched /
no-op cases. Show non-vacuity (deliberately break the assessor → red). Run
via `npm run test:properties` only. If BL-1124 blocks the commit on the shared
host, land the property file from an isolated worktree / expedite checkout —
do not ship without the encoding.

**Invariants 2–3:** role-prompt + `composePilotExpeditorPrompt` guidance —
encoded by prompt text + unit assertion; no further property required.

## Not bounced

Architecture of `unreachableStepHandlerCheck.ts` / gate wiring / fail-open
posture matches BL-737/747 and is otherwise ready for rematch after D1.

By architect.
