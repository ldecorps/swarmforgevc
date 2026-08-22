# BL-864 — architect SEND BACK: displayed selection leaks the tapped engine before the bridge answers

**Parcel:** cleaner-forwarded commit `39af946c10` ("BL-864: dedupe engine-shape
check between preference store and route"), sitting on coder commit
`1adc748a3` ("BL-864: Bubble Settings Local/OpenAI voice-engine selector").
Merged for architect review at `39af946c10` on `swarmforge-architect`
(fast-forward, no conflicts).

**Checklist run:** dependency-gate (`node extension/out/tools/dependency-gate.js`
on the four changed `extension/src/bridge/*.ts` files) — PASSED, no forbidden
edges. co-change report on the same files — no coupling beyond the module's
own tests and BL-863's preference store, which is expected and pre-existing.
Two-layer boundary (extension host owns I/O, bridge routes are host-side) —
compliant. Secrets-stay-on-host — compliant (see D-clear items below).
`required_wiring` (`TalkPanelActivity.kt::showSettingsDialog`) — present.
Both declared invariants reviewed as a distinct pass from architecture rules.

## Invariant 1 — "the phone sends an engine NAME only" — CLEAR

`BridgeClient.audioEnginePreferenceBody` (`BridgeClient.kt:63-64`) builds the
write body as a single-key `JSONObject().put("engine", engine)` — no string
concatenation, no second field possible. Covered by a non-vacuous property
test (`BridgeClientAudioEnginePreferenceBodyPropertyTest`,
`BridgeClientTest.kt:87-119`) that drives 500 random strings plus explicit
JSON-injection-shaped payloads (e.g. `"openai\",\"openaiApiKey\":\"sk-injected"`)
through the real body-builder and asserts exactly one key survives. The bridge
route's own shape check (`letsTalkAudioEngineRoutes.ts:96-98`) now reuses the
store's `isPlainRecord`/`isEngineOnlyRecord` (this parcel's own cleaner
commit), so the two can't drift. No further sites touch the write body. This
invariant is intact everywhere in the slice.

## Invariant 2 — "the selector never shows an engine as selected that the bridge has not accepted" — VIOLATED

**D1 (site: `TalkPanelActivity.kt`, `showSettingsDialog`, lines ~183-206,
class: behavior).** The pure reducer (`VoiceEngineSelector.stateAfterChoice`)
correctly enforces this invariant in isolation, and its property test
(`VoiceEngineSelectorPropertyTest.kt`) is non-vacuous — it demonstrates a
naive "optimistic" reducer would fail the same property. That test is the
only site the diff highlights. But the property is quantified over the whole
slice, and the device-wiring layer around the reducer does not honor it:

`voiceEngineGroup.setOnCheckedChangeListener { _, checkedId -> ... }`
(`TalkPanelActivity.kt:183`) is a listener, not an interception point.
Standard Android `RadioGroup`/`CompoundButton` behavior toggles the tapped
`RadioButton`'s own `isChecked` — and therefore its rendered appearance —
synchronously as part of handling the tap, *before* this listener runs. The
listener only fires afterward, as a notification. Nothing in the parcel
disables the group, defers the visual check, or otherwise prevents the tap
from rendering immediately: `voiceEngineLocal.isEnabled`/
`voiceEngineOpenAi.isEnabled` are only ever driven by bridge-reported
*serviceability* (line 164-165), never by a pending-write state.

`eng.chooseVoiceEngine` (`TalkEngine.kt:358-367`) is genuinely asynchronous —
it dispatches to an IO executor and posts the result back via `mainHandler`
only once `BridgeClient.writeAudioEnginePreference` returns, with a
30-second `connectTimeout` / 120-second `readTimeout`
(`BridgeClient.kt:262-263`) on the underlying connection. So the window
between "widget already shows the tapped engine checked" and "app code
finally reconciles it via `renderVoiceEngineState`" is not a one-frame
flicker — on a slow or dead bridge it is visibly the *wrong engine shown as
selected* for up to tens of seconds.

**Repro (reading, not device-run — matches the ticket's own scenario 05):**
Local is selected and serviceable; OpenAI is serviceable but the bridge is
unreachable. Human taps OpenAI. Synchronously: `voiceEngineOpenAi.isChecked`
becomes `true` (Android's own `RadioGroup` mechanics), rendered on the next
frame — OpenAI now visibly selected. Only after the connection attempt times
out does `chooseVoiceEngine`'s callback fire with `connectionFailure = true`,
producing `ChoiceOutcome.Unreachable`, and `renderVoiceEngineState` finally
flips the widget back to Local. Scenario 05's *end state* ("the selector
still showing Local") is eventually reached, but the ticket's invariant says
"never shows... that the bridge has not accepted" — not "eventually
corrects itself" — and for the live duration of the connection attempt the
selector shows an engine the bridge never accepted.

**Remediation:** the tap must not be allowed to visually register until the
bridge answers. Two established shapes for this: (a) intercept the tap
before it reaches `RadioGroup`'s automatic check-toggle — e.g. individual
`RadioButton.setOnClickListener` returning the widget to `previous.selected`
synchronously (via `suppressVoiceEngineCallback`-style guard) before firing
the async request, only advancing the visual check on `Accepted`; or (b)
disable `voiceEngineGroup` for the duration of the pending call and drive
the *visible* checked state entirely from `renderVoiceEngineState`/
`voiceEngineState`, never from the widget's own default toggle. Whichever
shape is chosen, this is the one site in the parcel — no other UI reads or
sets voice-engine selection state.

## D2 (LOW, not a send-back item — noted for the coder's awareness only)

None. No other defect found in this pass.

---

**Verdict: SEND BACK to coder.** D1 is the sole item; nothing else in the
checklist (dependency gate, co-change, secrets, wiring, invariant 1) failed.
