# BL-814 — hardener pass

Reviewed commit: `a03b863d18` (architect pass — clean, no findings).
Parcel diff scope (unchanged from architect's): `e3a894da..a03b863d18`,
production code in `extension/src/concierge/conciergeTick.ts` and
`extension/src/tools/telegram-front-desk-bot.ts`.

Result: **NONE — no defects found, no test gaps found. Forwarding as-is.**

## Mutation cooldown gate (BL-149) — SKIP-BUSY on both changed files

```
$ bb swarmforge/scripts/mutation_cooldown_gate.bb <repo> extension/src/concierge/conciergeTick.ts
DECISION: skip-busy
file_age_days: 13.80 (cooldown: 3 days)
load_avg: 76.86 cores: 4 busy_threshold: 2.00x (busy)

$ bb swarmforge/scripts/mutation_cooldown_gate.bb <repo> extension/src/tools/telegram-front-desk-bot.ts
DECISION: skip-busy
file_age_days: 4.27 (cooldown: 3 days)
load_avg: 76.86 cores: 4 busy_threshold: 2.00x (busy)
```

`uptime` showed load average 71-82 on a 4-core host (18-20x cores) for the
whole pass — well past the "do not even attempt a concurrency=1 differential
Stryker dry run" threshold (engineering.prompt Hardening Order). Per the
office-hours mutation bypass: deferred the full Stryker pass rather than
stall the pipeline, and did a manual/targeted hardening pass instead
(below) so BL-814 is not held hostage to the host clearing.

## Manual mutation review (in place of Stryker, host busy)

Read the diff for the classic survivor shapes and checked each against the
existing test suite:

- **Each of the two new try/catch wraps in `readLiveRoleHeldTickets`**
  (exec failure -> `RoleHeldTicketsComputationFailedError`, JSON.parse
  failure -> same) has a dedicated test asserting the specific error class
  via `assert.rejects(..., RoleHeldTicketsComputationFailedError)` — a
  mutant that dropped either wrap (raw error escapes unwrapped) is killed
  by `instanceof` failing.
- **`syncBoardIfWired`'s new catch-and-return-prior-board path**: TS control
  flow analysis makes `roleHeldTickets` "used before assigned" if the
  `return` inside the catch is removed, so that particular mutant does not
  even compile — a structural kill, not a test-dependent one.
- **The three `Examples:` deletions** (mono_router_lib.bb / ambulance_lib.bb
  / handoff_lib.bb) each have their own unit test AND their own acceptance
  Scenario Outline example, so a mutant re-adding any one dependency back to
  "optional" is caught on both layers.
- Confirmed only one production caller of `readLiveRoleHeldTickets`
  (`syncBoardIfWired`, via `buildConciergeTickAdapters`) — no other call
  site assumes the old `{}`-on-failure contract.
- Considered a not-covered edge case: `readLiveRoleHeldTickets` returning
  well-formed-but-non-object JSON (e.g. `null`) would throw a raw
  `TypeError` out of `invertTicketStageToRoleHeldTickets`'s
  `Object.entries` rather than `RoleHeldTicketsComputationFailedError`.
  Not treated as a gap: it is still a loud throw (never a silent `{}`), so
  invariant 2 holds regardless of the exact class, and the sole caller's
  catch is generic (`catch (err)`, not a type-narrowed catch) so production
  behavior is identical either way. Also outside the ticket's own named
  failure modes ("bb missing, a torn/non-JSON stdout, a script error") and
  `pipeline_stage_cli.bb report` is a project-owned script that always
  emits an object. Not worth a bespoke test for an unreachable-in-practice
  shape.

## CRAP (scoped to `src/*.ts`, BL-381 posture)

Full-suite coverage skipped (same host-load reasoning as above); ran
coverage scoped to the two directly relevant test files instead, which can
only *undercount* coverage for the touched functions (fewer tests than the
full suite exercise them), never overcount — a pass here is a safe lower
bound:

```
npx vitest run test/readLiveRoleHeldTicketsCli.test.js test/conciergeTick.test.js --coverage
node scripts/crapReport.js src/concierge/conciergeTick.ts src/tools/telegram-front-desk-bot.ts
```

- `syncBoardIfWired`: complexity=6, coverage=100%, **CRAP=6.00** (at, not
  over, the <=6 threshold).
- `readLiveRoleHeldTickets`: complexity=3, coverage=81%, **CRAP=3.06**.

The report additionally flags 42 functions elsewhere in the large
`telegram-front-desk-bot.ts` file (e.g. `ensureApprovalsTopic`,
`executeStop`, `candidateApprovalsTopicIds`) at 0-14% coverage. All are
pre-existing, untouched by this parcel's diff, and their apparent low
coverage here is a measurement artifact of scoping the coverage run to only
2 of this file's many test files rather than the full suite — not a
regression BL-814 introduced. Not this ticket's scope to fix.

## DRY

`npm run dry` (jscpd, full `src/`): 36 clones total project-wide, none
touching either changed region. The one hit inside
`tools/telegram-front-desk-bot.ts` (`[1528:43-1542:2]`, inside
`synthesizeVoiceReply`) is >1000 lines from this parcel's diff
(~2655-2690) and pre-existing.

## Verification run myself

- `npm run compile` — clean (the prior stale `out/` from before this merge
  false-failed 6 of the parcel's own tests on the first run; rebuilding
  fixed it — the BL-497 stale-`out/`-after-merge trap, not a code defect).
- `npx vitest run test/readLiveRoleHeldTicketsCli.test.js
  test/conciergeTick.test.js` — 119/119 pass.
- `npx vitest run test/telegramFrontDeskBotCli.test.js` (broader file
  covering `readLiveRoleHeldTickets`'s home file end to end) — 607/607
  pass.
- `npx vitest run --config vitest.properties.config.mjs
  test/telegramFrontDeskBotCli.property.test.js
  test/onboarderRedeliveryIdempotent.property.test.js` — 2/2 pass, kept
  separate from the commands above per the property-test isolation rule.
- `node specs/pipeline/cli.js
  specs/features/BL-814-live-role-held-fixture-loud-degrade.feature` —
  6/6 scenarios pass.
- `node specs/pipeline/cli.js
  specs/features/BL-487-board-freshness-without-coordinator-sync.feature`
  (sibling feature sharing the same fixture technique) — 2/2 pass.
- Confirmed no orphaned `node --test`/`stryker` processes survive this pass
  (`pgrep -fl 'node --test|stryker'`, scoped to this worktree).

No hardening changes needed. Forwarding to documenter.
