# BL-697 architect pass — 2026-08-15

## Scope

Received from cleaner as `merge_and_process cleaner 487cd3490d` (cleaner
forwarded the coder's commit unchanged — no cleanup needed). Reviewed commit
`487cd3490d` ("BL-697: acceptance step handlers + BL-654 property tests for
hands-free listening", by coder) fresh, from scratch.

The ticket's core production logic (`extension/src/bridge/letsTalkCore.ts`,
`extension/src/bridge/letsTalkUiHtml.ts`) was already implemented and landed
in an earlier commit (`153b9a3b1`, already an ancestor of this branch); this
parcel adds only the acceptance step handlers for the previously-step-less
feature file and the coder-owned property tests for the ticket's three
declared invariants (BL-654). No production code changed in this commit.

Files reviewed (`git show --stat 487cd3490d`):
- `specs/pipeline/steps/bl697LetsTalkHandsFreeSteps.js` (new)
- `specs/pipeline/steps/index.js` (registration, 1 line)
- `extension/test/bl697LetsTalkHandsFreeInvariants.property.test.js` (new)

## Checks run (complete inventory, not first-failure-stop)

1. **Dependency-rule gate (BL-259 hard gate)** —
   `node extension/out/tools/dependency-gate.js test/bl697LetsTalkHandsFreeInvariants.property.test.js`
   (run with cwd `extension/`) → "Dependency-rule gate PASSED: no forbidden
   edges." The step-handler file (`specs/pipeline/steps/...js`) lives outside
   `extension/` entirely — depcruise's scan root is `extension/` (src+media),
   structurally scoped to the TS view/host-boundary ruleset; a Gherkin
   step-handler harness file has no applicable rule, same structural N/A as
   prior non-extension parcels (e.g. BL-891's architect pass on
   `swarmforge/scripts/*.bb`).
2. **Co-change coupling (BL-255)** — ran `co-change-report.js` against all
   three changed files. `bl697LetsTalkHandsFreeSteps.js` and the new property
   test show 1 co-change each (this commit only — expected for new files).
   `specs/pipeline/steps/index.js` shows broad "SUSPECTED COUPLING" with
   dozens of unrelated files — this is the file's known baseline as the
   central step-registry every new step-handler module touches (same
   registry-hub pattern flagged as expected noise in prior architect passes),
   not a real coupling introduced by this ticket. No cross-boundary coupling
   into unrelated production modules found.
3. **Correctness read against the two-layer boundary and secrets rules** —
   no `extension/src` or `media/` code touched in this commit, so the
   two-layer (tile/tmux), webview-storage, and secrets-in-host rules are not
   implicated by this diff. Confirmed (pre-existing code, not part of this
   commit, but re-read to verify the invariants this commit tests) that
   `letsTalkUiHtml.ts`'s hands-free preference read/write path
   (`localStorage.getItem`/`setItem(HANDS_FREE_STORAGE_KEY, ...)`, lines 441,
   1035, 1426) never round-trips through the server or any extension-host
   persistence — satisfies invariant 3 architecturally, not just at the pure
   codec level the property test checks.
4. **TypeScript compiles clean** — `npx tsc --noEmit -p extension` → no
   errors. Confirmed `extension/out/bridge/letsTalkCore.js` and
   `.../letsTalkRoutes.js` (compiled) are newer than their `.ts` sources, so
   the property test's `require('../out/bridge/...')` imports are not stale.

## Invariants Review (BL-633/654) — all three declared invariants

Ticket declares 3 invariants (`backlog/paused/BL-697-lets-talk-hands-free-listening.yaml`):

1. "With hands-free off, BL-696 tap-to-toggle behaviour is unchanged."
2. "With hands-free on, the server still receives one discrete POST
   /lets-talk/turn per user utterance; no duplex route is added."
3. "Hands-free preference persists in browser localStorage only."

- All three have coder-authored, non-vacuous property tests in
  `bl697LetsTalkHandsFreeInvariants.property.test.js` (architect verifies
  existence/non-vacuity, does not author them, per the Invariants Review
  section — authorship correctly rests with coder here).
- **Invariant 1**: `shouldScheduleHandsFreeListen`, `shouldEndHandsFreeRecording`,
  `shouldCancelHandsFreeRecordingNoSpeech` are called with
  `handsFreeEnabled: false` across `fc.constantFrom('ready','thinking',
  'speaking','error')` (confirmed exhaustive against
  `LetsTalkTurnPhase` in `letsTalkCore.ts:15`) × random recording/speech/
  timing values, asserting all three always return `false`. Non-vacuity
  demonstrated by a standalone `brokenSchedule` function shown to violate the
  property — same demonstration style as the codebase's existing
  `bl717ReplySilenceInvariants.property.test.js` non-vacuity test, not a
  novel pattern.
- **Invariant 2**: drives the real `createLetsTalkTurnHandler` against a
  random number of turns and asserts exactly one STT call per turn (no
  batching/duplex accumulation), and asserts `createLetsTalkWriteRoutes`
  returns exactly the two BL-696 routes (turn, new-session) — no third
  streaming/duplex route exists. Uses real production functions, not mocks
  of the property under test.
- **Invariant 3**: `parseHandsFreeEnabled`/`serializeHandsFreeEnabled` proven
  a pure synchronous round-trip with no I/O, plus the first-visit-absent-key
  default resolves to off. Combined with check #3 above (webview only ever
  touches `localStorage`, never a server round-trip), this covers both the
  pure-codec half (property test) and the "browser localStorage only" half
  (architectural read) of the invariant.
- No violation found on any of the three. No missing or vacuous property
  test found — nothing to record under `invariant-unencoded`.

## Property Testing pass (own section)

This commit touches no new pure production module — the property test file
itself IS the property-testing artifact for this ticket's three declared
invariants, already covered above under Invariants Review. No additional
undeclared-property gap found; nothing further to add.

## Tests re-run independently (all green)

- `npx vitest run --config extension/vitest.properties.config.mjs bl697`
  (from `extension/`) → 6/6 tests passed (3 invariant properties + 3
  non-vacuity companions), `test:properties` posture confirmed (separate
  command, excluded from unit/coverage/mutation per engineering.prompt).
- `bash specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-697-lets-talk-hands-free-listening.feature` → 6/6
  scenarios PASS (all Background + per-scenario steps resolved via the new
  `bl697LetsTalkHandsFreeSteps.js`, registered in `steps/index.js`).

## Verdict

No architecture violation, no invariant violation, no correctness defect
found. Clean pass — Article 4.4 explicit-NONE evidence, committed per the
BL-806 review-forward-evidence gate. Forwarding to hardener.

By architect.
