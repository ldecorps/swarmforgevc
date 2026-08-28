# BL-1204 cleaner pass — 2026-08-28

Merged coder handoff `c9edf9f01e` for BL-1204 (wires `/redeploy frontdesk`
and `/redeploy all` to their existing, previously-unwired modules). Clean
merge, no conflicts.

## Review
`executeOperatorVerb`'s new dispatch branches mirror the existing `mini`
branch's shape (parse → start → format ok/fail) exactly — consistent,
no duplication worth collapsing for three cases; a loop would reduce
readability for this little gain. Help-text additions are minimal and
match the ticket's own parity-invariant test. No structural or
module-boundary issues.

`mutation-site-count.js` flags both touched files well over the 100
threshold (telegramCursorOperatorExec.ts: 1033, telegramCursorBridgeCore.ts:
1104) — pre-existing debt (BL-428's standing high-CRAP tracker), not
introduced by this ~20-line wiring fix. Splitting either file is out of
scope for this ticket per BL-428's own "opportunistically, never a
big-bang sweep" posture; left as pre-existing debt.

## Verification
- `tsc --noEmit` / `npm run compile`: clean.
- `vitest run telegramCursorBridgeCore telegramCursorOperatorExec`: 148/149
  pass. The one failure (BL-698 ambulance engage/release) is pre-existing
  and unrelated — a fixture seeds the ticket in `backlog/paused/` against
  `telegramOperatorAmbulance.ts`'s guard, which now requires `active/`;
  that file is untouched by BL-1204's diff. Coder's own commit message
  confirms this same failure on the pre-change baseline.

By cleaner.
