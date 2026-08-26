# BL-1011 hardener pass — 2026-08-22

**Parcel:** architect forward `f6a3d08d37` (evidence-only commit; the real
diff is the coder's own `b0defa106`), merged into hardender. Architect
reviewed clean, no defect found, forwarded as-is.

**Verdict: hardened. Three real mutation gaps closed with tests, all in the
`grace`/`escalate` action branches the ticket's own test suite never
exercised for the new fields.** No production code changed this pass — this
is a POSIX shell script with no mutation/CRAP/DRY tool wired (per
engineering.prompt), so the gap was closed with hand-authored surgical
mutation, same as the BL-567 pattern.

## Host load — office-hours bypass invoked (second ticket this pass, same reason)

`uptime` read 30–70 (avg) on 4 cores throughout this pass, having spiked to
100+ during the prior BL-1010 pass. Per the office-hours bypass and "binds
every mutation runner" rule: no BL-113 Gherkin mutation run was attempted on
this feature's two Scenario Outlines
(`a violation states which condition fired, never a raw sentinel`,
`every alarm names the swarm it came from`) — deferred to the next quiet
pass. First deferral for this ticket. Everything else below (hand-mutation
of the shell script, and full targeted suite/property/acceptance re-runs)
is cheap enough to run regardless of load, and was run live.

## Mutation gaps found and closed (hand-authored, kill/restore verified each time)

The architect's own non-vacuity table (in the BL-1011 architect evidence
file) proved the properties and the RESTART-path record/announce correctly
catch every break they tried. What none of the existing tests — shell suite,
property runner, or acceptance steps — ever drove was the **`grace`** and
**`escalate`** action branches' OWN `swarm=`/`reason=`/`render_age` fields,
even though the coder's diff added those fields to all four record/announce
sites identically. All three gaps below were found by literally reverting
one call site at a time to its pre-BL-1011 shape and confirming the full
suite still reported `ALL CHECKS PASSED` before adding a test, then
confirming the same revert now fails, then restoring (byte-diffed clean
every time).

1. **The `grace` durable record's `swarm=`/`reason=`/`render_age` were
   completely unexercised.** `grace` never calls `do_announce` (it is a
   silent suppression, record-only), and the pre-existing `grace_run` test
   helper only ever checked `action=grace` was present — never that the
   record it wrote also named a swarm or a reason, or that it avoided the
   raw sentinel it is BY CONSTRUCTION always dealing with (grace only fires
   when `age -eq SENTINEL_AGE`). Reverting the grace record's three new
   fields back to `daemon=${name} age_secs=${age}` (no `swarm=`/`reason=`/
   `render_age` at all — meaning the record would print the raw
   `999999999` again) left `test_daemon_log_freshness.sh` fully green.
   Added three checks to the existing `grace_run 10` case in
   `test_daemon_log_freshness.sh`: swarm attribution, the correct reason
   (`log-absent`, since the grace fixture's log is absent by construction),
   and no raw sentinel in that specific record line. All three independently
   confirmed to fail against the revert and pass against the real code.

2. **The `escalate` durable record's `swarm=`/`reason=`/`render_age` were
   likewise unexercised** — existing case `06` checked the escalate
   ANNOUNCE verbatim (which does include `swarm=`) and separately checked
   only `action=escalate` on the record, never the record's own `swarm=`/
   `reason=`. Reverting just the record line (leaving the announce
   untouched) left the whole suite green. Added two checks to case `06`:
   the record names its swarm, and states `reason=stale-heartbeat` (this
   fixture's log is a real, aged heartbeat). Both independently confirmed to
   fail against the revert and pass against the real code.

3. **`SWARMFORGE_SWARM_NAME`, the FIRST source `resolve_swarm_name` checks
   (ahead of the identity file), was never set by any existing test** — not
   the shell suite, not the property runner. This line's body predates the
   ticket (it was already the first check inside the old credential-fallback
   branch), but `resolve_swarm_name` now runs UNCONDITIONALLY, so this
   source is reachable on every single run rather than only when
   credentials are missing — strictly more live code than before this
   ticket, and worth covering for that reason. Clearing it to always-empty
   left the whole suite green. Added a case exporting
   `SWARMFORGE_SWARM_NAME=env-override` with an identity file present, and
   asserting the env var wins. Confirmed to fail against the mutant and
   pass against the real code.

## Non-gaps checked and ruled already-covered

- The **`restart`** action's own durable record (not just its announce) IS
  already covered: reverting that record line to the pre-BL-1011 shape
  broke 10 existing checks across the three sentinel-condition cases (the
  default action for a first-ever violation is `restart`).
- The **`escalate`** ANNOUNCE line is already covered verbatim by existing
  case `06` (`grep -q "FRESHNESS_VIOLATION escalate swarm=primary
  daemon=handoffd"`) — reverting it independently broke that exact check.

## Standing whole-tree guards

Parcel touches `specs/pipeline/steps/` (new
`bl1011FreshnessAlarmNamesSwarmAndReasonSteps.js` + `index.js`
registration). Ran all 11 guard test files
(`ls extension/test/*Guard*.test.js`, excluding `.property.` siblings): 9/11
clean. The same 2 pre-existing failures as the BL-1010 pass earlier today
(`tempDirTrapGuard` on BL-1025's property runner, `tmuxReaperGuard` on
BL-1018's step handler) — both outside this parcel's changed-file set,
already documented pre-existing by the coder's and architect's own BL-1011
evidence, not re-litigated again here.

## Step-handler review (BL-908 shape-vs-value lookup check)

The new acceptance step file resolves every Outline column
(`<state>`→known reason, `<swarm>`, `<threshold>`) through explicit
`KNOWN_LOG_STATES`/`KNOWN_REASONS` maps or direct literal comparison against
the real script's output — never by scenario shape. No gap of the BL-908
class found. Fixture lifetime: created and removed within the single
`the freshness check reports a violation` step (try/finally) — no
cross-step leak of the BL-921/BL-931 class.

## Verification re-run live

- `bash swarmforge/scripts/test/test_daemon_log_freshness.sh` → **ALL
  CHECKS PASSED**, including the 5 new hardening checks (3 grace, 2
  escalate-record) and the 1 new env-var-precedence check. Re-run clean
  after each of the 3 mutant restores above.
- `bb swarmforge/scripts/test/bl1011_freshness_attribution_property_runner.bb`
  → **48 runs, ALL PROPERTIES HOLD**, coverage floors unchanged from the
  architect's own run (creds-set 23/48, matching its stated floor).
- `node specs/pipeline/cli.js specs/features/BL-1011-a-freshness-alarm-names-its-swarm-and-its-reason.feature`
  → **8/8**.

## What was NOT run this pass, and why

- BL-113 Gherkin mutation for this feature's two Scenario Outlines —
  deferred to the next quiet host pass per the office-hours bypass; see
  load evidence above. First deferral for this ticket.
- `npx vitest run test/swarmMetrics.test.js`/`costHealthSidecar.test.js` —
  not re-run; this parcel added no new commit touching `extension/src/` (the
  coder's `swarmMetrics.ts` comment-only edit was already re-verified live
  by the architect at 138/138, and nothing in this hardening pass touched
  that file).

— By hardener.
