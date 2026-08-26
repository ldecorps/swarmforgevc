# BL-381 QA bounce — 2026-07-15

## Failing command
```
grep -rn "relay-onboarding-negotiation-telegram" swarmforge/
grep -rn "relayOnboardingNegotiationTelegram\|negotiation-relay\|NegotiationRelay" swarmforge/
```
(exhaustive repo grep for any production caller of the new CLI/relay modules)

## Commit hash
`f376e2189d92caae7be4eaebd59f3ca584c0c2d7` (documenter's BL-381 commit,
merged into `swarmforge-QA` for this verification).

## First error excerpt
```
(no output — zero matches in swarmforge/, any .bb file, any .sh file,
swarmforge.conf, or any package.json script)
```
The only caller of `runPostProposal`/`runPoll` anywhere in the repo is the
acceptance step handler itself
(`specs/pipeline/steps/theContractIsNegotiatedOverTelegramSteps.js:23`),
which imports and calls them directly as a library — a test harness, not a
production entrypoint. `extension/src/tools/relay-onboarding-negotiation-telegram.ts`
is a CLI with `post-proposal`/`poll` actions that nothing in the live swarm
ever invokes: no supervisor script, no `.bb` loop, no cron-equivalent, no
`package.json` script, no reference in any role prompt.

## Failure class
`behavior` — unit suite green (273 files / 3892 tests), acceptance for this
feature green (5/5). The gap is that the ticket's own scope is explicitly to
be "the epic's wiring ticket" (BL-381 YAML notes: "An emit -> route -> consume
epic whose slices are pure modules stays DARK until something calls them on a
real trigger... without this ticket neither can ever fire over Telegram"),
matching the engineering article's epic-runtime-wiring-slice rule (a pure
module with zero production callers is a dark feature regardless of test
coverage). The delivered code is exactly that: `negotiationTelegramRouting.ts`
and `negotiationTelegramRelay.ts` are pure/adapter-tested with zero production
callers, and the CLI wrapper `relay-onboarding-negotiation-telegram.ts` that
was supposed to close that gap is itself never invoked by anything live.

Compare to the ALREADY-LIVE analogous mechanism this ticket needed to extend:
the Telegram front-desk bot's poll loop is not a bare CLI a human runs by
hand — `swarmforge/scripts/front_desk_supervisor.bb` spawns
`telegram-front-desk-bot.js` as a long-running child process whose own
internal `pollLoop` (`extension/src/tools/telegram-front-desk-bot.ts:355`,
driven by `runContainedLoop`) long-polls continuously and writes a heartbeat
the supervisor watches for staleness. BL-381's `poll` action has no
equivalent: nothing spawns it once, let alone repeatedly, so a human
objecting or agreeing in the negotiation topic is never actually seen by the
swarm in a live run — the E2E QA procedure the ticket itself specifies
("Object to it from the phone; assert a REVISED contract comes back into the
same topic... Restart the swarm and assert every round is still in the
target's negotiation record") cannot happen, because nothing is polling.

Note: `post-proposal` being a manual, run-once CLI is fine and matches
BL-380's own provisioning CLI (also legitimately one-shot, documented as
such) — that half is not in question. It is specifically `poll`, which by
its nature must run repeatedly against a live chat, that has no scheduling
hookup anywhere.

## Expected vs observed
Expected: something in the live swarm (a supervisor script analogous to
`front_desk_supervisor.bb`, or a hook into the existing front-desk
supervisor/bot process) actually calls `poll` on a recurring basis once a
target is provisioned, so a human's objection or agreement in the
negotiation topic is picked up without a human manually running the CLI.
Observed: `poll` and `post-proposal` are reachable only by a human typing the
`node .../relay-onboarding-negotiation-telegram.js <args>` command by hand,
or by the acceptance test's direct library import — no live trigger exists,
so the negotiation-over-Telegram loop the ticket exists to deliver can never
fire in a running swarm.
