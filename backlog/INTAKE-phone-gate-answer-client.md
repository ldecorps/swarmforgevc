# INTAKE: phone client to ANSWER to:human gates (gap #10 — the M6 capstone)

Source: operator direction 2026-07-10 (via coordinator, spec-vs-implementation
gap pass): gap #10 — M6's headline "answer to:human gates from your phone" has no
phone CLIENT. Operator approved closing it.

## The gap (coordinator verified)
The hard host-side parts already landed:
  - gate-answer WRITE path: `extension/src/bridge/gateAnswerPath.ts`
    (`answerCapturedGate`) + `bridge/gateAnswerLive.ts` (`answerCapturedGateLive`),
    BL-240.
  - Telegram answer relay (BL-239); read-only bridge (BL-065); device registry
    (`bridge/deviceRegistry.ts` / `deviceRegistryStore.ts`, BL-241).
BUT the PWA (`pwa/app.js`) is READ-ONLY — it only does GET `fetch(...)` on the
dashboard / docs-tree / recert feeds; there is NO gate list and NO answer POST.
So the operator cannot answer a `to:human` gate from the phone app itself.

## Want (observable)
- The phone app shows the currently-pending `to:human` gate(s) awaiting a human
  answer.
- The operator can answer a gate from the phone; the answer reaches the existing
  host write path (`answerCapturedGate`) and unblocks the waiting agent.
- With no pending gate, the surface shows a localized empty state.

## Fit / reuse
- REUSE the host write path (`answerCapturedGate` / `answerCapturedGateLive`) as
  the authoritative integration point — the PWA does NOT write gate state
  directly; it calls an authenticated bridge endpoint that validates and invokes
  the host path.
- REUSE the PWA shell (backlog/docs dashboard) for the gate-list + answer view;
  reuse the pending-gate source the bridge/Telegram relay already reads.

## Constraints (security-sensitive — flag prominently)
- CONTROL ACTION, NOT READ: answering a gate is a WRITE/control action. The PWA is
  read-only today; this must go through the AUTHENTICATED bridge write path using
  the device-registry / token auth (BL-241, M6 "remote security") — never an
  unauthenticated POST. Stronger auth than the read-only dashboard. This is the
  crux the specifier + architect must get right.
- HOST STAYS AUTHORITATIVE: the PWA sends an answer REQUEST; the host validates
  (device/token, gate still pending, well-formed) and performs the write via
  `answerCapturedGate`. No trust in the client.
- IDEMPOTENT / RACE-SAFE: answering an already-answered or stale gate is rejected
  cleanly (compose with how the host write path already guards this).
- TESTABLE host-side: the bridge endpoint (validate + dispatch to
  `answerCapturedGate`) and the PWA answer logic are testable units fed fixtures;
  no live gate / real swarm / real device in unit tests.
- LOCALIZATION (BL-229/230) + a11y (BL-238) for the new UI; graceful empty state.
- PWA-LANE SERIALIZATION (coordinator orthogonality): touches `pwa/app.js` — the
  BL-251/257/261/etc lane; serialize at build time.

## Delivery
Substantial — this is the M6 capstone and it crosses a security boundary. Specifier
to SCOPE (likely sliced: (a) authenticated bridge answer endpoint; (b) PWA gate
list + answer view). Verify the live bridge/auth/gate paths (BL-065/BL-240/BL-241)
before naming files. Park in paused for operator approval. Priority: operator to
set; suggest normal (high value, but larger than the cheap wins).
