# BL-339 recert-notify-and-deep-link-via-telegram — 20260713 (coder)

## What shipped

A standalone CLI (`extension/src/tools/notify-recert-batch.ts`, compiled to
`extension/out/tools/notify-recert-batch.js`) that:
1. Computes the real waiting recert batch via `computeRecertBatch` (docs/recertificationStore.ts)
   — the SAME data the PWA itself renders, never a second derivation.
2. Decides whether to announce via `decideRecertAnnouncement` (extension/src/notify/recertBatchNotifier.ts).
3. Sends one Telegram message naming the batch count plus a `#recert=1` deep link
   (`buildRecertDeepLink`, extension/src/metrics/pwaDeepLinks.ts) into the PWA.
4. Arms the announced-state ONLY on confirmed delivery (BL-345's own "arm on delivery, never on
   attempt" lesson, reapplied verbatim).

Wired into `handoffd.bb`'s existing chase-sweep cadence as `recert-notify-sweep!`, shelling to the
compiled CLI exactly like every other `*-briefing-line`/`*-sweep!` Babashka-to-Node adapter in that
file (no `{:continue true}` — this file's own established `(process/sh ["node" cli-path] {:dir ...})`
call shape).

`pwa/app.js` now parses a `#recert=1` hash route and scrolls the recert section into view on load,
so the deep link actually lands on the work, not just a bare page load.

## Design decision: standalone CLI, not the live Telegram Front Desk Bot process

The recert announcement is a periodic, one-way, daemon-driven push — it does not need a live
bidirectional bot connection. Building it as its own disposable CLI (invoked by `handoffd.bb`'s
poll loop, same shape as `notify-recert-batch.js`'s siblings) means it can never destabilize the
REAL, currently-running production Telegram Front Desk Bot process (`front_desk_supervisor.bb`'s
`spawn-bot!`) — no shared state, no shared connection, nothing to crash or leak into. This mirrors
BL-345's own `OPERATOR_ALARM_FORCE_RESULT`-seamed standalone alarm CLI rather than extending
`operator_runtime.bb`'s live tick loop directly.

## Design evolution: boolean → id-set announced-state (the real finding this ticket surfaced)

The first-pass design tracked a single boolean `announced` flag (armed on send, cleared only when
`computeRecertBatch` returned an empty batch). Reading `selectForRecertification`'s real logic
(extension/src/docs/recertification.ts) found this was wrong: it ALWAYS returns up to `batchSize`
scenarios from the WHOLE recertifiable pool, oldest-reviewed-first — marking a scenario reviewed
only reorders the pool, it never empties it. In a system with any ongoing recertifiable pool, batch
size effectively never returns to 0, so a boolean-armed design would announce once, ever, and then
go permanently silent — directly contradicting the ticket's own scenario 06 ("A new batch after an
answered one is announced again").

Fixed by tracking the batch's own scenario ID SET instead of a boolean: `decideRecertAnnouncement`
re-announces exactly when the current waiting id set differs from the last-announced id set
(order-independent), which correctly covers "first time waiting", "same outstanding batch, don't
spam" (BL-326: 136 real notifications already sent by accident once), and "genuinely different
batch after the prior one was answered", all from one comparison — no separate boolean, no separate
empty-pool special case.

Verified this by extending `notifyRecertBatchCli.test.js` with a real two-scenario fixture: after
the first scenario is announced and then marked reviewed (rotating the second scenario to the
front, pool never empties), the CLI announces again — this is `recert-notify-deep-link-06`'s exact
shape, driven against the real compiled CLI, not just the pure unit-level decision function.

## Scope boundary: verdicts are not accepted through Telegram (scenario 07)

Per the ticket's own framing, recert is a batch review activity and Telegram is a conversational
surface — pushing the batch content or accepting replies-as-verdicts into Telegram would either
spam the human or rebuild a form the PWA already does better. This was proven as a real absence,
not asserted narratively: `confirmScenario`'s only caller anywhere in `extension/src` is
`recertification.ts` itself (the existing inbound-email verdict pipeline, BL-223) — grepped, not
assumed — and `notify-recert-batch.ts` itself contains no reference to `confirmScenario` at all. It
only ever sends; there is no listener, no webhook, no reply-polling loop in this CLI.

## Test coverage

- `extension/test/recertBatchNotifier.test.js` — pure `decideRecertAnnouncement`/
  `buildRecertAnnouncementText` unit coverage, including the id-set redesign and scenario 06's own
  shape.
- `extension/test/notifyRecertBatchCli.test.js` — real git-fixture, real compiled-CLI coverage:
  first announce + deep link, no re-announce on an unchanged outstanding batch, nothing announced
  with no batch waiting, a cleared-then-returned batch re-arms, a genuinely NEW batch (different
  scenario, same size) after the prior one is answered re-announces, a failed send stays unarmed
  (retries next tick, reapplying BL-345's lesson), missing Telegram config never arms, no
  `pwa_base_url` configured still sends (just without a deep link).
- `extension/test/pwaDeepLinks.test.js` — `buildRecertDeepLink` shape (trailing-slash
  normalization, `null` with no base URL configured).
- `swarmforge/scripts/test/test_handoffd_recert_notify_wiring.sh` (new) — proves the REAL daemon's
  poll loop reaches `recert-notify-sweep!`, invokes the compiled CLI at the right path with
  `cwd=project-root`, surfaces its stdout into the daemon log, repeats on the shared chase-sweep
  cadence (not a one-shot), and never throws. Uses the same "stub the compiled JS entry point under
  the fixture root" technique `test_operator_runtime_tick.sh`/`test_front_desk_supervisor_tick.sh`
  already use, so no real Telegram token/network is needed.
- `specs/pipeline/steps/recertNotifySteps.js` (new, registered in `specs/pipeline/steps/index.js`)
  — all 7 Gherkin scenarios in `BL-339-recert-notify-and-deep-link-via-telegram.feature`, driven
  against the real compiled CLI and real fixtures (mirroring `notifyRecertBatchCli.test.js`'s own
  fixture shape). Scenario 02's "following the link lands on the recert work" and scenario 07's
  verdict-scope-boundary check are proven by reading the real `pwa/app.js`/`extension/src` source
  directly (grepped, not re-implemented) — there is no live PWA/Telegram round trip to drive in an
  acceptance step. Scenario 03 ("one message, not one per scenario") calls the real, compiled
  `buildRecertAnnouncementText` with a 17-scenario count directly: production batch size is
  hardcoded to 1 everywhere (`DEFAULT_RECERT_BATCH_SIZE`, no config override), so a true
  17-scenario CLI-level fixture is out of reach — the collapsing-to-one-message behavior is a pure
  property of that one function, exercised here at its real, compiled boundary.

Full regression: `npx vitest run` in `extension/` — 233 test files, 3231 tests, all green.
`test_handoffd_role_context_clear_wiring.sh` (the sibling sweep sharing the same cadence block)
re-run clean, confirming the new `recert-notify-sweep!` wiring introduced no regression there.

## What was explicitly not done

No live Telegram round-trip was exercised anywhere (BL-326: never send real messages from
automated tests) — every send in every test uses `TELEGRAM_NOTIFY_FORCE_RESULT`. No verdict-
recording path was added for Telegram — proven as a scope boundary, not built. No change to the
live, currently-running `front_desk_supervisor.bb`-spawned bot process — this ships as an
independent CLI sharing only the compiled recert-batch data, per the design decision above.
