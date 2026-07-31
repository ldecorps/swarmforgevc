# BL-727 — architect bounce, 2026-07-31

## Commit reviewed

`f0820a5457ab322e86f3f71a39b4ca6d4f413041` ("BL-727: make the pilot's land the
acceptance-contract gate", By coder), merged into architect at `2870359e5`.

## Review inventory (Article 4.4 — complete pass)

- Dependency-rule gate (`node out/tools/dependency-gate.js` on the three
  changed `extension/src/tools/*` files): **PASSED**, no forbidden edges.
- Co-change report on the same files: no new concerning coupling; the only
  "SUSPECTED COUPLING" flags are pre-existing `telegramCursorBridgePilot.ts`
  family coupling (Core/Live/test), untouched by this parcel.
- Two-layer boundary / extension-host I/O ownership / secrets / webview
  storage: N/A — this parcel touches no webview or VS Code API surface; the
  gate CLI runs fs/git in the extension-host-equivalent Node context, which
  is correct.
- Reuse discipline: `markDone` / `findBacklogFilePath` (`backlogWriter.ts`,
  pre-existing, confirmed via `git log`) are reused, not reimplemented.
  `runAcceptance` dynamically requires `specs/pipeline/runnerAdapter.js` —
  no second Gherkin/step-matching implementation (invariant 2 upheld).
- Declared invariants (ticket YAML `invariants:`):
  1. Property-tested in `pilotAcceptanceGate.property.test.js` via fast-check
     over `landPilotedTicket`, discriminating on declaration kind x contract
     result — non-vacuous (accompanying tests show the assertion has teeth).
  2. Stated non-encodability reason given and accepted: this invariant
     constrains implementation strategy (which module parses/matches steps),
     not input/output behavior — no input space to quantify over. Verified
     by code reading instead (see reuse discipline above).
  3. Property-tested alongside invariant 1, same file — non-vacuous.
  All three invariants: **PASS**, no send-back needed here.
- `required_wiring` (`composePilotExpeditorPrompt` routes through the gate
  CLI, not a bare `git mv`): present in `telegramCursorBridgePilot.ts`, and
  correctly verified by a REAL behavioral test in
  `extension/test/telegramCursorBridgePilot.test.js` (`composePilotExpeditorPrompt
  lands through the pilot-acceptance-gate CLI, never a bare git mv (BL-727)`),
  which calls the real function and asserts on its actual returned string.
  **This part is fine.**

## D1 — Background step in the acceptance feature file re-introduces a
prompt-text/source-text assertion the ticket explicitly forbade

- **Class**: behavior (spec-instruction violation / weak-verification defect)
- **Blamed role**: coder
- **File**: `specs/pipeline/steps/bl727PilotAcceptanceGateSteps.js`, the
  Background step handler for `"the acceptance-contract gate is the pilot's
  only landing path"` (around line 80).
- **What it does**: `fs.readFileSync(PILOT_SOURCE_PATH, 'utf8')` — reads the
  raw `.ts` SOURCE TEXT of `telegramCursorBridgePilot.ts` — then asserts
  `source.includes('pilot-acceptance-gate')` and that source does NOT match
  a regex for the old `git mv` instruction text.
- **Why this is a defect, not style**: the ticket's own description says,
  verbatim: *"Do not write acceptance scenarios that assert on prompt text —
  prompt-text assertions are not acceptance; the scenarios here test the
  gate's behavior."* This step does exactly what that sentence forbids — and
  it does it in the Background, so it runs for every scenario in this
  feature's own acceptance contract. It is the same anti-pattern flagged
  fresh (2026-07-27) in BL-654/BL-688: `requireIncludes`-style text assertion
  over a prompt/source file stays green while the actual wired behavior can
  drift or break, because a source-text grep is trivially satisfiable by
  content the check never actually exercises.
- **Concretely**: the `includes('pilot-acceptance-gate')` check is already
  satisfied by this parcel's own top-of-file comment
  (`// BL-727: landing runs through the acceptance-contract gate CLI\n//
  (pilot-acceptance-gate.ts) instead of a bare \`git mv\`...`) — independent
  of whether `composePilotExpeditorPrompt`'s actual OUTPUT for a given ticket
  ever mentions the gate. A future edit that changes the function's real
  behavior while leaving that comment in place would keep this Background
  step green while the wiring it claims to prove is broken — the exact BL-688
  shape (green suite, dead/broken instruction).
- **Remediation**: this file already has the correct pattern next to it —
  `extension/test/telegramCursorBridgePilot.test.js`'s
  `composePilotExpeditorPrompt lands through the pilot-acceptance-gate CLI...`
  test calls the real function and asserts on its returned string. Replace
  the Background step's source-file grep with the equivalent behavioral
  check: `require` the compiled `telegramCursorBridgePilot.js` from `out/`
  (matching how this same steps file already requires
  `out/tools/pilotAcceptanceGate`), call `composePilotExpeditorPrompt(<a
  fixture ticket id>)`, and assert the RETURNED prompt string names the gate
  CLI invocation and does not instruct a bare `git mv` landing. That proves
  the wiring behaviorally rather than by grepping source text.

## Verdict

One item, D1. Not blocked by anything else — full checklist above ran clean.
Sending back to **coder** to fix D1; the rest of the parcel (gate module,
CLI, property tests, other 3 scenarios' step handlers, `steps/index.js`
wiring) stands as reviewed and does not need to be redone.

## Divergence incident (discovered while closing out this bounce)

This ticket's commit `f0820a5457` reached architect via two separate
inbox parcels (same commit, two different `git_handoff` task-name
strings — `BL-727-bl727-make-the-pilots-land-the-acceptance-contract-gate`
vs the ticket's own `BL-727-bl718-pilot-missed-unwired-acceptance`). The
first delivery was processed and forwarded to hardener as `2870359e5f`
(sent handoff `00_20260731T064917Z_000593_from_architect_to_hardender`)
*without* this D1 finding surfacing — an earlier, incomplete review pass.
Hardener and documenter both completed their stages on that copy without
catching D1 (unsurprising: D1 is a spec-instruction / architecture defect,
not something coverage/mutation/CRAP or docs review would flag), and
documenter forwarded `065cf1750b` to QA
(`00_20260731T074326Z_000451_from_documenter_to_QA`) — currently sitting
in QA's `inbox/new/` as of this writing.

This second, complete review pass (this file) is what actually found D1.
Since the coder-fix path this bounce starts will not reach QA until it
re-clears cleaner → architect → hardener → documenter, it will not
overtake the already-in-flight `065cf1750b` copy in QA's queue. Sent
direct `note`s (priority 00) to **QA** (naming the defect and this file)
and to **coordinator** (naming the fork) so QA can hold/bounce
`065cf1750b` on its own review rather than approving it unaware. Not
recorded as a second bounce — same D1, same evidence, no new
`record-bounce.js` entry.
