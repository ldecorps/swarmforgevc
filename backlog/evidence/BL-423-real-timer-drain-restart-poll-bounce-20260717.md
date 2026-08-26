# BL-423 QA bounce — drain-stop and restart-ack poll loops wait on the real
# clock in unit tests, violating the ticket's own explicit no-real-timers
# instruction

## Failing command
```
cd extension && npx vitest run test/telegramFrontDeskBotCli.test.js \
  -t "drain window elapses" --reporter=verbose
cd extension && npx vitest run test/telegramFrontDeskBotCli.test.js \
  -t "times out and reports it when the bounce-ack never arrives" --reporter=verbose
```

## Commit hash tested
`23318e7058` (documenter's handoff, bundles BL-471/BL-468/BL-423). BL-423's
own coder commit is `cc780b2135` ("BL-423: Telegram swarm control verbs
(stop/restart/pause)"), an ancestor of the tested commit.

## First error excerpt
Both tests pass, but each takes wall-clock seconds instead of running
instantly:

```
BL-423: executeStop in drain mode forces teardown and reports forced once
the drain window elapses with work still in flight
  Duration  2.33s (... tests 2.01s ...)

BL-423: executeRestart times out and reports it when the bounce-ack never
arrives
  Duration  1.24s (... tests 1.01s ...)
```

`executeStop`'s drain wait (`waitForDrainOutcome` in
`extension/src/tools/telegram-front-desk-bot.ts:1022`) polls in a loop:

```ts
async function waitForDrainOutcome(targetPath, startedAtMs, timeoutMs) {
  for (;;) {
    const outcome = decideDrainOutcome(isPipelineEmpty(targetPath), startedAtMs, Date.now(), timeoutMs);
    if (outcome === 'wait') {
      await sleep(CONTROL_DRAIN_POLL_INTERVAL_MS);   // hardcoded 2000ms, no override
      continue;
    }
    return outcome;
  }
}
```

The "drain window elapses" test overrides only the overall timeout via
`SWARMFORGE_CONTROL_DRAIN_TIMEOUT_MS = '10'`, but `CONTROL_DRAIN_POLL_INTERVAL_MS`
(`telegram-front-desk-bot.ts:923`, hardcoded `2000`) has no env-override seam,
so the first "wait" branch still calls a real `sleep(2000)` before the loop
re-checks and returns `forced`. The restart-ack poll
(`CONTROL_RESTART_ACK_POLL_INTERVAL_MS = 1000`, `telegram-front-desk-bot.ts:936`)
has the identical shape: `SWARMFORGE_CONTROL_RESTART_ACK_TIMEOUT_MS` is
env-overridable, the 1000ms poll interval between checks is not.

## Failure class
`behavior` — the shipped tests do not honor the ticket's own written
acceptance/testability contract; this is an intent mismatch, not a compile
or ordinary unit failure (both tests report green).

## Expected vs observed
Expected (BL-423's own ticket text, Testability section): "DRAIN TIMEOUT +
AUTO-RESUME are TIME-DEPENDENT: obey the no-real-timers ban. The drain wait
must NOT poll the real inbox dirs with real sleeps — inject the
in-flight-count seam and an injected clock, and give the drain timeout an
ENV-OVERRIDE seam ... so a test drives it small and deterministic." The
shared engineering article is the same, unconditionally: "Never use real
timers in tests. No setTimeout / setInterval delays ... Time must be driven
explicitly: inject a test double (fake timer, mock clock) and advance it
programmatically, so every test is deterministic and instant."

Observed: both the drain-forced test and the restart-ack-timeout test still
wait on `setTimeout`-backed real sleeps of the loops' own POLL INTERVAL
(2000ms / 1000ms respectively) — only the outer TIMEOUT got an env-override
seam; the poll interval between checks did not. This is exactly the failure
mode the ticket's own text and the shared engineering article both name, and
the same class of past incident the engineering article documents (BL-349:
`test_handoffd_stuck_escalation_email_wiring.sh` polling a hardcoded
production timeout with real sleeps).

## What to verify before re-landing
1. Give `CONTROL_DRAIN_POLL_INTERVAL_MS` and `CONTROL_RESTART_ACK_POLL_INTERVAL_MS`
   the same env-override seam already used for their respective timeouts
   (`SWARMFORGE_CONTROL_DRAIN_POLL_MS` / `SWARMFORGE_CONTROL_RESTART_ACK_POLL_MS`,
   or fold the interval into the same injected-clock/wait-fn seam the
   ticket's testability section asked for), and drive both env vars to a
   tiny value (e.g. `1`) in the two affected tests.
2. Re-run both tests and confirm each completes in low tens of milliseconds,
   not wall-clock seconds.
3. Sweep the rest of `telegramFrontDeskBotCli.test.js` / `telegramFrontDeskBotCore.test.js`
   for any other poll loop introduced by this ticket that shares the same
   shape (fixed interval constant with no override) before re-handing off —
   the pause/auto-resume sweep path was checked and is fine (it rides the
   daemon's existing cadence and is tested via injected clock in
   `pipeline_stage_lib`/`backlog_depth_lib` bb runners and the handoffd
   wiring shell test, none of which use a real sleep).
4. This is a low-severity, narrow finding — the rest of the ticket's very
   large surface (guards, confirm state machine, stop/restart/pause
   acceptance scenarios, kill_all_swarm.sh reap, pause wiring break-then-fix
   proof) was independently verified and is solid; only these two poll
   intervals need the seam.

## Note on backlog bookkeeping
The coordinator already closed this ticket (`504890b3`, "Close BL-423,
BL-468: QA-approved (23318e7058), backlog bookkeeping") citing Article 2.6's
batch-forward-gap rule, inferring QA approval from the fact that the same
commit had already been approved for BL-471/BL-468. That inference was
premature for BL-423 specifically: QA had not yet independently verified
BL-423's own acceptance criteria when that bookkeeping commit landed. This
bounce is notice to reopen BL-423 (move back from `backlog/done/` to
`backlog/active/`) rather than treat it as QA-approved.
