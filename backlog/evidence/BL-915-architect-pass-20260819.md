# BL-915 architect pass — 2026-08-19

## Reviewed commit
`0c3883fe4a4490ecd7977d6d6860f1fbd7e65101` ("BL-915: certify the landed
Cursor-bridge gone-agent session-reset hotfix", By coder, forwarded
unchanged by cleaner). Stamp-off for hotfix `ece61cbe63`, already on `main`
— `git show --stat` confirms only 2 files in this parcel:
`specs/pipeline/steps/bl915CursorBridgeGoneAgentSessionResetSteps.js`
(new) and `specs/pipeline/steps/index.js` (append-only registration). No
production file changed, matching the ticket's own out-of-scope clause
("does not redesign the classifier").

## Checks run (complete inventory, not first-failure-stop)

1. **Dependency-rule gate**: neither changed file is under `extension/`, so
   per-parcel mode has nothing to scan. Ran full-repo mode defensively:
   same pre-existing `acyclic` cycle
   (`telegram-front-desk-bot.ts`/`telegramCursorOperatorExec.ts`/
   `telegramCursorOperatorLiveness.ts`) already tracked at
   `backlog/paused/BL-759-...yaml`, confirmed untouched by this parcel.
   Not a new violation.
2. **Co-change report**: the new step-handler file co-changes only with
   `index.js` (1, expected sibling). `index.js` itself shows dozens of
   high-frequency "SUSPECTED COUPLING" entries — expected noise from an
   append-only shared registry every acceptance-adding ticket touches, not
   a real signal specific to this parcel.
3. **Invariant 1** ("a fault is classified as session-reset only when it
   means THIS stored agent is unusable — quota/rate-limit/bad-request must
   never reach the reset path"): production code predates this parcel
   (`isCursorAgentGone`/`shouldResetCursorAgentSession`,
   `telegramCursorBridgeCore.ts:878-889`, landed by hotfix `ece61cbe63`).
   Verified coverage two ways:
   - Pre-existing unit test
     (`extension/test/telegramCursorBridgeCore.test.js:959-961`):
     `shouldResetCursorAgentSession('[resource_exhausted] Error')` asserts
     `false` — a direct, concrete encoding of the invariant's boundary.
   - New acceptance scenarios 04 (quota fails fast, zero creates) and 05
     (three unrelated "not found" messages do not reset) — traced the
     production wiring (`openAgentWithAuthRecovery` in
     `cursorBridgeAgentSession.ts:172-189`) to confirm the step handler's
     mocking shape matches the real code path exactly (resume-throws vs.
     run-fails-with-quota-detail are genuinely different real paths, and
     the step handler models both correctly).
   - **Independently reproduced the coder's claimed non-vacuity check
     myself**, not just trusted the commit message: widened
     `isCursorAgentGone` to bare `/not found/i` in a scratch edit,
     recompiled, reran the acceptance feature — scenario 05's three rows
     failed exactly as claimed (over-matching caught), the other 7 stayed
     green. Reverted, recompiled again, reran: 10/10 green. Working tree
     confirmed clean after (`git status --short`).
4. **Invariant 2** ("after a session reset the stored agentId is the new
   agent's id, never the rejected one"): pre-existing live-session unit
   test (`cursorBridgeAgentSession.test.js:345-378`) asserts
   `session.readAgentId() === 'agent-live-99'` after a gone-agent-triggered
   reset, distinct from the original stored `agent-47f26e41-...` — a
   concrete, non-vacuous encoding by construction. New acceptance scenario
   02 asserts the same directly against the real state file.
5. **Property Testing pass**: no pure JS/TS production module is touched
   by this parcel — only an acceptance step-handler file (drives real
   subprocesses/mocked SDK, outside the fast-check boundary) and an
   append-only registry line. No new property test is warranted; none
   manufactured.
6. **Invariants-review posture**: no NEW property-test file was added for
   either invariant. Consistent with the precedent this session's BL-905
   architect pass set for the same class of ticket (stamp-off certifying
   pre-existing production code, not newly authored by this parcel's
   coder): the coder actively engaged with both invariants, backed by a
   real non-vacuity demonstration in both directions (under-matching via
   removing `isCursorAgentGone` from the OR-chain, over-matching via
   widening its regex — both reverted after), not merely an assertion of
   confidence. I independently reproduced the over-matching half myself
   (item 3 above) rather than only trusting the commit message.
7. **Independently ran everything, not just read it**:
   - Recompiled (`npm run compile`) before relying on `extension/out/`.
   - `extension/test/cursorBridgeAgentSession.test.js` +
     `telegramCursorBridgeCore.test.js`: 169/169 pass, matches the
     commit's claim exactly.
   - BL-915's own acceptance feature via
     `specs/pipeline/scripts/run_acceptance.sh`: 10/10 pass, matches the
     commit's claim exactly.
   - Fixture-dir leak check: zero `sfvc-bl915-*` directories left behind
     after a full run (the step handler's `node:test` `afterEach`-based
     cleanup, same shape as the sibling `bl696...Steps.js`, works as
     claimed — no repeat of BL-905's initial fixture-leak bounce).
8. **Module boundaries / two-layer architecture**: not implicated — no
   extension host/webview code touched, no I/O ownership changed, no new
   process spawned bypassing tmux, no secrets, no webview storage. The step
   handler drives the real `createLiveCursorBridgeAgentSession` with only
   the SDK boundary mocked, never reimplementing production logic.

## Verdict
No architecture violation, no invariant violation, no correctness defect.
Both declared invariants hold, independently re-verified — including
reproducing the over-matching non-vacuity check myself rather than only
trusting the commit message. Forwarding to hardener.

By architect.
