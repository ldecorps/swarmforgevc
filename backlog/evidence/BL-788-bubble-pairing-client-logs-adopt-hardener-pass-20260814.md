# BL-788 hardener pass — Bubble pairing + client-log hotfix adoption

**Ticket:** BL-788. **Reviewed commit:** `6c9b3cdc3c` (architect's re-review
pass, D1 fully remediated, forwarding to hardener). **Role:** hardener.

## Pre-run hygiene

- `pgrep -fl 'node --test|stryker'` (scoped) — none running before start.
- `pgrep -afl tmux` — only the two legitimate swarm sockets, no leaked
  temp-dir fixture servers.
- BL-149 cooldown gate (`mutation_cooldown_gate.bb`) per changed production
  file: `bridgeServer.ts` and `CompanionPrefs.kt` → `skip-cooldown` (touched
  within the 3-day window by this ticket's own coder/architect passes; not
  mutation-tested this pass, per the gate's unconditional skip). 
  `residentSpyTunnelNotify.ts`, `notify-resident-spy-tunnel.ts`,
  `PairingSave.kt` → `run`.

## Coverage-gap hardening (before running any mutation tool)

Manual review turned up two real gaps, both fixed:

1. `buildBubblePairingHttpsUrl` (new BL-788 function,
   `residentSpyTunnelNotify.ts`) mirrors the established sibling
   `buildBubblePairingDeepLink`, which has a test for "neither token nor
   bearer query param present" (defaults to `token=`). The new function had
   no equivalent test — added
   `buildBubblePairingHttpsUrl defaults token to empty string when neither
   token nor bearer is present` to `extension/test/residentSpyTunnelNotify.test.js`.
2. `buildPairPageHtml`/`escapeHtml` (new BL-788 code, `bridgeServer.ts`) —
   `bridgeUrl` is built from the client-controlled `Host` header
   (`tryServePairPage`'s `` `https://${host}` ``) and reflected into the page
   via `escapeHtml`, but no existing test ever drove either function with a
   value containing `&`, `<`, `>` or `"`. A broken/removed `escapeHtml` call
   would have passed every existing assertion. Added
   `buildPairPageHtml escapes HTML-special characters in the bridge URL and
   token` to `extension/test/bridgeServer.test.js`, importing
   `buildPairPageHtml` directly (already exported).

Both new tests pass (`vitest run test/bridgeServer.test.js
test/residentSpyTunnelNotify.test.js` — 129/129).

## Defect found and fixed: acceptance step-handler leaked the bridge on any scenario failure

While running the required BL-113 soft Gherkin mutation pass (the feature
has one `Scenario Outline:`, scenario 03), the first mutation (`m1`) hung
indefinitely — `node --test` sat idle at near-zero CPU for 9+ minutes with
no forward progress (confirmed not a host-load stall: all processes were
sleeping, not busy; `pgrep -afl tmux` showed no leaked fixture server
either). Root-caused by reading
`specs/pipeline/steps/bl788BubblePairingClientLogsAdoptSteps.js`:

The file's own docstring claimed to mirror `bl851SideloadApkPreauthSteps.js`'s
`withBridge(target, fn)` try/finally pattern, but did not actually do so. It
started the bridge once in the Background step and called
`ctx.handle.stop()` manually as the LAST assertion of each scenario's happy
path. A mutant that correctly flips an expected status (exactly what
mutation testing is for) throws at the `the bridge responds with status
<n>` assertion — BEFORE the following step (`no file outside the operator
public directory is read`) that held the only `ctx.handle.stop()` call ever
runs. The listening server outlives the scenario; `node --test` never drains
its event loop and hangs forever. This is not host-load — it is a harness
defect that would ALSO hang any genuine regression that trips this
scenario, or a real CI run once a mutation ever needs to kill this outline.

Cross-checked: roughly half of this codebase's ~20 `startBridge`-driving
step-handler files already use the safe `withBridge(ctx, fn)` try/finally
pattern; the other half share this same eager-Background-start /
last-step-stops-it risk. Out of scope to fix broadly here (each is a
different ticket's file); fixed only `bl788BubblePairingClientLogsAdoptSteps.js`,
the one this ticket owns and the one currently blocking BL-113.

**Fix**: moved `startBridge`/`stop()` into a `withBridge(target, fn)`
try/finally helper (mirroring `bl851SideloadApkPreauthSteps.js` exactly),
wrapped the two request-issuing `When` steps in it, and removed every
now-unnecessary manual `ctx.handle.stop()` from the `Then` steps — including
scenario 05's, which never touched the bridge in the first place and no
longer needs to start one at all now that Background only does file-system
setup.

Re-verified after the fix:
- `specs/pipeline/scripts/run_acceptance.sh` — 8/8 scenarios pass (happy
  path unaffected by the refactor).
- `specs/pipeline/scripts/run_gherkin_mutation.sh ... soft` — completes in
  ~57s (versus hanging indefinitely before), **8/8 mutants killed, 0
  survived, 0 errors**. Manifest freshly stamped into the feature file
  (`tested_at` new, `scenario_hash` for "The pre-auth APK route serves only
  the operator public directory").
- `pgrep -fl 'node --test'` and `pgrep -afl tmux` re-checked clean — no
  orphans, no leaked fixture servers left by the killed hung run.

## CRAP (scoped to changed `src/*.ts`)

`node scripts/crapReport.js src/bridge/bridgeServer.ts
src/concierge/residentSpyTunnelNotify.ts src/tools/notify-resident-spy-tunnel.ts`.
Every function this ticket added or changed is well under the CRAP <= 6
threshold: `buildPairPageHtml`=1.00, `escapeHtml`=1.00, `isPairPagePath`=1.00,
`tryServePairPage`=4.00, `tryServeSideloadApk`=5.00,
`buildBubblePairingHttpsUrl`=3.00. The 17 functions the tool flags (>6) in
these three files are pre-existing debt this ticket didn't introduce or
regress — confirmed for the two this ticket's diff actually touches
(`syncResidentSpyTunnelUrl` CRAP=12, `notifyResidentSpyTunnelUrl` CRAP=10):
both gained only one object-literal property (`pairingHttpsUrl: ...`), no
new branch, so cyclomatic complexity is byte-for-byte unchanged from `main`
— verified by diffing `main`'s copy of `syncResidentSpyTunnelUrl` against
this branch's. Not a regression; out of this ticket's scope to refactor.

## DRY

`npx jscpd --config .jscpd.json src/bridge/bridgeServer.ts
src/concierge/residentSpyTunnelNotify.ts src/tools/notify-resident-spy-tunnel.ts`
— 4 pre-existing clones, all at lines 258-1058 of `bridgeServer.ts` (1999
lines total), well outside this ticket's new code (~1266-1454). No new
duplication introduced.

## Kotlin JVM unit tests (independent re-run, third time this parcel — coder, architect, now hardener)

`JAVA_HOME=/usr/local/opt/openjdk@17 ./gradlew :app:testDebugUnitTest
--tests "...PairingSaveTest" --tests "...PairingSavePropertyTest"` — BUILD
SUCCESSFUL. `PairingSaveTest`: 6/6 pass. `PairingSavePropertyTest`: 3/3 pass
(confirmed by reading the actual JUnit XML result files, not just the
gradle exit code).

## Stryker (differential) — deferred, load-based

Two attempts at `stryker run --mutate out/concierge/residentSpyTunnelNotify.js
--mutate out/tools/notify-resident-spy-tunnel.js` (the two files the BL-149
gate marked `run`) both hit host load well above the 2x-cores threshold
(`uptime` load average repeatedly 10-42 on 4 cores through this pass, driven
by concurrent work elsewhere in this live swarm plus vitest's own worker
pool). The second attempt's dry run hard-crashed after ~5 minutes
("Initial test run timed out!") — the exact documented load-crash signature,
not a code defect. Per the office-hours mutation bypass and the
load-over-2x-cores rule (do not even attempt a concurrency=1 differential
run under that condition), deferred rather than stalling the pipeline.
Substituted a manual coverage-gap pass instead (see above): both files'
actual new/changed observable surface (`buildBubblePairingHttpsUrl`, the
`pairingHttpsUrl` field on `buildResidentSpyTunnelUrls`) is now directly
unit-tested including the edge case a Stryker string-literal mutant would
target. The one remaining untested surface — `pairingHttpsUrl` inside
`syncResidentSpyTunnelUrl`'s and `notifyResidentSpyTunnelUrl`'s own local
`urls` object literals — is genuinely unread downstream in this diff
(`shouldNotifyResidentSpyTunnel` only compares `liveUrl`/`consoleUrl`/
`formatVersion`; the button builders only read `pairingDeepLink`), so a
mutant there would be equivalent (BL-234) under the current wiring, not a
real gap.

## Full unit suite (verification)

First full-suite run (before the acceptance-harness fix) surfaced 3
failures / 136 errors, all `[vitest-worker]: Timeout calling "onTaskUpdate"`
— reproduced at `uptime` load average 42 on 4 cores (~10x), the documented
worker-RPC-timeout-under-load signature, not real assertion failures.
Re-ran once load subsided (~1.4x cores): **428/428 test files, 7563/7563
tests pass** (7561 baseline + the 2 coverage-gap tests added this pass).

## Process hygiene at handoff

`pgrep -fl 'node --test|stryker'`, `pgrep -afl tmux`, and `git status --short
extension/test/` (property-lane fixture leak check) all re-checked clean —
no orphaned processes, no leaked fixture servers, no orphaned property-test
fixtures.

## Disposition

Hardened. One real defect found and fixed (acceptance step-handler leaked
its bridge server on any scenario failure, hanging `node --test`
indefinitely — this ticket's own file, in scope). Two coverage gaps found
and fixed (missing edge-case test for the new pure URL-builder, missing
HTML-escaping test for the new pairing page). CRAP and DRY clean on all
changed/added code, no regression on pre-existing debt. Gherkin mutation:
8/8 killed. Kotlin JVM unit + property tests: 9/9 pass (independently
re-verified). Stryker differential mutation deferred (load-based, two
attempts, documented crash signature) — substituted with targeted
coverage-gap tests covering the same observable surface; the one untested
line is a genuine equivalent-mutant case, not a gap. Full unit suite: clean
green once host load subsided. Forwarding to documenter.

By hardener.
