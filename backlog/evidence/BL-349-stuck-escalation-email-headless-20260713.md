# BL-349 stuck-escalation-email-headless — 20260713 (coder)

## What shipped

`stuck_escalation_email_lib.bb` (new) — the missing email leg for a role stuck past its escalation
threshold on a headless box (BL-336 finding H4). Reuses `daemon_alarm_lib.bb/send-configured-email!`
exactly (the same one Resend client `send-configured-briefing-email!`/the daemon-death alarm already
use — no second sender was built), and reapplies BL-345's own delivery-based arming shape, this time
per-role (multiple roles can independently be stuck at once, each with its own retry/backoff state).

Wired into `handoffd.bb`'s existing `:on-stuck-escalation!` adapter — the SAME closure
`chase_sweep_lib.bb`'s `sweep-in-process!` already calls on every `escalated?` edge
`write-escalation!` computes — now calling `stuck-escalation-email-sweep!` alongside the unchanged
`write-escalation!` call. `write-escalation!`'s own file record (`chase-escalations.json`) is
untouched by this parcel; the email is an addition, not a replacement, per the ticket's own scope
item 4.

## Design: extracted into its own lib, not written directly in handoffd.bb

`handoffd.bb`'s last line is an unconditional `(-main)` call — `load-file`-ing it for a test runner
launches a real daemon loop, exactly the problem `support_thread_store.bb`'s own header comment
documents (`support_thread.bb`'s bottom-level `(-main)` "would exit on empty
*command-line-args* if merely load-file'd for its functions"). The new pure decision logic AND the
adapter-injected orchestration (`sweep!`) both live in `stuck_escalation_email_lib.bb` instead, with
no `-main` of its own — `handoffd.bb` only wires real adapters (`send-configured-email!`, `log!`)
into it. This is what makes both a fast pure-function test runner and a fast fixture-level
orchestration test possible without spinning up a real daemon process.

The two small generic helpers (`classify-delivery-result`, `compute-backoff-ms`) are independently
duplicated from `operator_lib.bb`'s own BL-345 originals rather than cross-required — matching this
project's own stated convention (`operator_lib.bb`'s `compute-alarm-backoff-ms` docstring: "small
duplication over cross-namespace coupling"), and avoiding a new dependency between two otherwise
independent daemons' libs (`handoffd.bb` and `operator_runtime.bb` do not currently load each other's
libs, and this ticket does not introduce the first such coupling).

## BL-333's mistake, re-checked against this new code specifically

The ticket's own central warning: `send-configured-email!` returns `{:success bool :reason kw :error
str}` and can fail silently by construction — a repeat-suppression flag must never be set on a merely
*attempted* send. Verified `sweep!`'s own control flow directly: the per-role state is written ONLY
inside the branch that has already consulted `classify-delivery-result`'s real outcome — there is no
code path that persists `:armed? true` before or without calling `send-email!` and inspecting its
result. `should-attempt?` is the ONLY gate deciding whether a send is even attempted; every branch
that reaches a `write-state!` call has a `result`/`outcome` already in hand.

## Edge-triggering and recovery, precisely

`write-escalation!`'s own `escalated?` argument is `true` on EVERY sweep while a role remains stuck
(not just the first), so re-emailing on every truthy call would spam. `sweep!` doesn't re-derive its
own edge — it reuses `should-attempt?`'s `armed?`/backoff gate for the "stays stuck" case (matching
BL-345's own reuse of `armed?` for exactly this), and for "recovers and gets stuck again" it takes a
different, arguably simpler approach than BL-345's own starvation state (which keeps one persistent
record and resets fields in place): the ENTIRE per-role state entry is `dissoc`'d the moment
`escalated?` goes false, so a later re-escalation starts from a genuinely fresh (never-attempted)
state and emails again without any special-cased "was this armed before" logic. This was possible
here (and wasn't for the single global starvation-alarm state) because escalation state is naturally
keyed per-role — dissoc is a normal, cheap operation for a map, not a global file rewrite.

## Test coverage

- `swarmforge/scripts/test/stuck_escalation_email_lib_test_runner.bb` (new, TDD-style assert battery
  mirroring `operator_lib_test_runner.bb`) — `classify-delivery-result`, `should-attempt?`,
  `next-state` exhaustively at the pure-function level, PLUS `sweep!` itself against a real fixture
  state-file directory with fake `send-email!`/`log!` adapters and explicit `now-ms`: first escalation
  emails once, stays-stuck doesn't re-email, recovery clears state, a NEW stuck episode after recovery
  emails again, a transient failure never arms and a later retry (once backoff elapses) does attempt
  again, a terminal misconfiguration arms immediately and is logged, and exhausting the retry cap
  (3 consecutive transient failures) arms anyway and logs a loud give-up — never retries forever.
- `swarmforge/scripts/test/stuck_escalation_email_sweep_cli.bb` (new, test-only) — a thin CLI that
  calls the EXACT two functions handoffd.bb's real adapter calls (`write-escalation!` then
  `stuck-escalation-email-lib/sweep!`) against a real fixture, with an explicit `now-ms` and a forced
  send result (`STUCK_ESCALATION_EMAIL_FORCE_RESULT`, mirroring BL-345's own
  `OPERATOR_ALARM_FORCE_RESULT` convention) — never a real network call. This is the acceptance
  suite's own driver.
- `specs/pipeline/steps/stuckEscalationEmailSteps.js` (new, registered in
  `specs/pipeline/steps/index.js`) — all 7 Gherkin scenarios in
  `BL-349-stuck-escalation-email-headless.feature`, driven against the real CLI above. Found and fixed
  a real step-text collision: "the sweep runs" was already registered by `dispatchGapSteps.js`
  (BL-222) for an unrelated fixture — resolved by extending that earlier handler with a
  `ctx.stuckEscalationRunner` branch-on-flag delegation (this project's own established pattern for
  exactly this collision shape, see `mergedCodeReachesDaemonsSteps.js`'s identical note for "the
  swarm's health is reported"), rather than silently shadowing it with a second, never-reached
  definition.
- `swarmforge/scripts/test/test_handoffd_stuck_escalation_email_wiring.sh` (new) — the one genuinely
  real-daemon proof: a real `handoffd.bb` subprocess, a real in_process fixture pre-seeded at the
  configured nudge cap (so the first real wall-clock crossing of the 60s stuck-timeout decides "alert"
  directly), `ESCALATION_ALARM_FORCE_RESULT` so no real network is ever reached. Confirms the REAL
  `:on-stuck-escalation!` closure reaches the new sweep, `write-escalation!`'s own file record is
  still written unchanged, the new per-role state file arms correctly, and the sweep never throws.
  Accepts a real ~60s wall-clock cost (hardcoded `stuckInProcessTimeoutSeconds`, unchanged/out of
  scope to make configurable) as a ONE-TIME cost for this single wiring proof; every other scenario
  (repeat-suppression, recovery, retry/backoff, terminal-misconfig, give-up, no-stuck-role) is proven
  fast and deterministically via the CLI/test-runner above, with no dependency on real elapsed time.

Regression: re-ran `test_chase_sweep.sh`, `test_handoffd_chase_sweep_wiring.sh` (both green,
`write-escalation!`/`decide-stuck-action` themselves untouched), the dispatch-gap acceptance feature
(`BL-222-active-item-dispatch-gap-autoroute.feature`, green — confirms the shared-step-text edit in
`dispatchGapSteps.js` didn't change its own existing scenarios), and every OTHER `handoffd.bb`-sweep
wiring test already in this branch (briefing-email, role-context-clear, recert-notify) — all green,
confirming this parcel's edits to the shared cadence block introduced no regression elsewhere in that
file. No TypeScript/extension code was touched by this ticket.

## A pre-existing, unticketed, dormant test-seam gap noted (not fixed, out of scope)

While building `parse-force-result` (my own CLI's fix for round-tripping a `:reason` value through
`json/parse-string`'s keywordize-keys, which only keywordizes map KEYS, never values), found that
`operator_runtime.bb`'s own production `OPERATOR_ALARM_FORCE_RESULT`/`ESCALATION_ALARM_FORCE_RESULT`
seams (`send-starvation-alarm-email!`, and this ticket's own `send-escalation-alarm-email!`) have the
identical latent gap: a test that tried to FORCE a `:reason :missing-api-key`/`:disabled` outcome via
that env var would silently misclassify it as `:transient-failure` instead. This has never actually
been hit — BL-345's own `test_operator_runtime_tick.sh` scenario 11 achieves the terminal-misconfig
path through REAL config absence (no `notify_email_to`, unset `RESEND_API_KEY`), never through the
FORCE_RESULT seam. Fixed only in my own new test-only CLI (`stuck_escalation_email_sweep_cli.bb`),
which needed it; left the pre-existing `operator_runtime.bb` seam and this ticket's own
`send-escalation-alarm-email!` untouched, since FORCE_RESULT is never set in production and no
currently-passing test depends on the buggy behavior. Worth a small follow-up if a future ticket ever
needs to simulate a terminal-misconfig outcome via that seam directly.
