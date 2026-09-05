# BL-1263 — architect pass (redo after bounce), 2026-09-05

Ticket: BL-1263-three-standing-assertions-contradict-deliberate-source-behaviour
Role: architect
Commit reviewed: 8eeba28873 (cleaner)

## Result: NONE — the bounced finding is resolved; no other defect found

## What changed since my bounce

My earlier bounce (`backlog/evidence/BL-1263-bounce-20260905.md`) found
the three assertion fixes correct but the two register rows this ticket
owns (`extension/test/telegramClient.test.js`,
`extension/test/telegramCursorOperatorExec.test.js`) were left in
`backlog/standing-reds.tsv` despite both tests now passing. Confirmed
fixed: `git diff` shows exactly those two rows removed
(`grep -i "telegramClient\|telegramCursorOperatorExec\|backendSwitch"
backlog/standing-reds.tsv` now returns nothing). The three assertion
fixes themselves are byte-identical to what I reviewed before the bounce
(confirmed by diff against `a91ab28e6c`, the commit before BL-1263's
original work) — no regression introduced while addressing the bounce.

## Re-verified everything from the original pass

- `npx vitest run test/backendSwitch.test.js test/telegramClient.test.js
  test/telegramCursorOperatorExec.test.js` → 3/3 files, 123/123 tests pass.
- `npm run compile` → clean; zero production diff (confirmed by `git
  diff -- extension/src/`).
- Independently drove
  `bl1263StaleAssertionsRetiredToShippedBehaviourSteps.js::registerSteps`
  against all 5 scenario runs again — all pass, including scenario 02's
  real source-mutation proof (adds an unannounced field to the live
  `telegramClient.ts`, confirms the whole-body `deepEqual` still catches
  it, restores byte-identical, recompiles clean).
- Dependency-rule gate (scoped + full-repo): `PASSED: no forbidden edges`
  in both.

## Verdict

Architecturally compliant. The bounced finding (uncleared register rows)
is resolved; no other architecture violation, invariant violation, or
correctness defect found. Forwarding to hardener.
