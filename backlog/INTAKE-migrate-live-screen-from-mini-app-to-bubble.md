# Raw intake — Migrate Live Screen from Mini App to Bubble

Status: new intake, not minted.

Goal
- Move the operator Live Screen experience out of the Telegram Mini App and into Bubble.
- Keep behavior continuity while Bubble becomes the primary surface.

Problem
- Live Screen currently depends on Mini App hosting and Telegram webview constraints.
- Operator flow is split across surfaces, which increases attention and control friction.
- Product direction is one phone surface, so Live Screen should live in Bubble.

Desired outcome
- Live Screen is fully available in Bubble with equivalent or better usability.
- Mini App Live Screen is retired or reduced to a clear fallback during transition.
- No loss of core actions, status visibility, or response speed.

Scope
- UI and interaction parity for current Live Screen capabilities.
- Data and action wiring through existing bridge contracts where possible.
- Bubble-first navigation and session handling for Live Screen workflows.

Non-goals for first pass
- Re-architect all bridge protocols at once.
- Introduce unrelated feature changes beyond parity and migration safety.

Acceptance shape to refine
1) Bubble can open Live Screen and render current live state reliably.
2) Existing Live Screen actions work from Bubble and produce the same canonical side effects.
3) Operator can complete current Live Screen tasks without using Mini App.
4) Mini App route either redirects, clearly deprecates, or is removed behind a controlled flag.
5) Transition does not break approvals, questions, or control callbacks.

Open questions
1) Should Bubble use native UI only, or a staged WebView-backed migration?
2) What is the deprecation plan and timeline for Mini App Live Screen?
3) Which analytics or health checks confirm migration success?
4) Do we need a temporary dual-run period, and what is the cutover gate?

Suggested slice candidates
- Slice A: Bubble Live Screen shell and navigation entry.
- Slice B: Read-model rendering parity for live status blocks.
- Slice C: Action wiring parity for existing controls.
- Slice D: Cutover guard, fallback behavior, and Mini App deprecation path.
- Slice E: Verification pass across operator scenarios and regressions.

---

## Specifier disposition 2026-07-30 — NOT drained, question asked

Read and assessed; deliberately left in the root. Each of this intake's open
design questions changes the shape of slice A materially (e.g. for barge-in,
"wake phrase vs keyword vs pure VAD overlap" is the slice), so speccing now
would mean guessing rather than asking.

One clarifying question covering the disposition of all three is now PENDING in
the specifier's Telegram topic: mint each as epic + slice A with
`human_approval: pending` and specifier-chosen defaults, hold all three as
capture-only, or mint voice-barge-in only.

Raising it first required clearing a stale marker: `role_ask.bb` allows ONE
pending question per role, and the specifier's slot had been held since
2026-07-25 by a question about BL-687 that shipped past it (approved 2026-07-27,
`b2edcf681`) — so nothing would ever have cleared it. See BL-687's `notes:`.

Resume point: act on the answer when it arrives. Do not re-ask.
