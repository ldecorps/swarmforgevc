# BL-881 — hardener pass — 2026-08-13

## Scope reviewed

Parcel received from architect at `3a10d8152d` (merged into hardener on top
of prior hardener HEAD). Architect's own review-stamp-off evidence
(`backlog/evidence/BL-881-architect-pass-20260813.md`) covers the bounce
history: coder's original TTL cache landed at `73a6e5e885`, was bounced by
the architect at `af62f336e4` (nowMs DI seam not wired at `bridgeServer.ts`'s
`/resident-pane` call site), fixed by the coder at `b95dacf5a`, and
re-verified by the architect at `3a10d8152d`. This pass independently
re-verifies rather than taking that stamp on faith.

Files this ticket actually changed: `extension/src/bridge/residentPaneLive.ts`
(new `captureMonoRouterLiveScreen` TTL-cache wrapper around the renamed
`captureMonoRouterLiveScreenUncached`), `extension/src/bridge/bridgeServer.ts`
(the `/resident-pane` route's `compute()` now threads `nowMs`),
`extension/src/bridge/residentSpyUiHtml.ts` (poll interval 1500ms→4000ms),
plus `extension/test/residentPaneLive.test.js` (TTL-boundary/cache-key/clear
tests), `extension/test/residentPaneLive.property.test.js` (new, walk-count
conservation property), and `extension/test/bridgeServer.test.js` (new
nowMs-threading regression test pinning the bounce fix).

## BL-149 mutation cooldown gate

`SWARMFORGE_MUTATION_GATE_FORCE_CORES=4 bb swarmforge/scripts/
mutation_cooldown_gate.bb <root> <file>` (macOS has no `nproc`; forced cores
per the accepted 2026-08-03 workaround):

- `residentPaneLive.ts`: `skip-busy` (age 21.7d past cooldown, but host
  load 45.76 on 4 cores — busy)
- `bridgeServer.ts`: `skip-cooldown` (age 0.24d, inside the 3-day cooldown
  window from the architect's just-landed re-verification commit)
- `residentSpyUiHtml.ts`: `skip-busy` (age 16.6d past cooldown, host busy)

`uptime` independently confirmed load 45–58 on 4 cores (~11–14.5x cores)
throughout this pass — well over the 2x-cores threshold, and Stryker's
perTest dry-run is known to hard-crash or time out at this load even at
concurrency=1. No file reached `run` this pass; Stryker mutation deferred
to the next quiet pass per the office-hours bypass (targeted-test hardening
now, full mutation pass overnight).

## BL-113 / BL-638 Gherkin acceptance mutation

`specs/features/BL-881-resident-pane-live-capture-ttl-cache.feature` has no
`Scenario Outline:` / `Examples:` block — only plain `Scenario:`s. Ran it
through `run_gherkin_mutation.sh` anyway to get the authoritative verdict:

```
outcome: "inapplicable"  (Total 0, Killed 0, Survived 0, Errors 0)
```

This is the BL-638 zero-mutant case, not a pass — manifest stamped into the
feature file records `outcome: inapplicable` (kept, not hand-edited).
Per BL-638, fell back to a hand-authored surgical mutation sweep over this
ticket's own changed behavior (same posture as `expedite_mutation_sweep.sh`
for untooled `.bb` code). Five single-edit mutants, each applied, compiled,
run against the relevant suite, and reverted immediately after confirming
the kill (working tree diffed clean against the merged state afterward):

| # | Mutant | Killed by |
|---|--------|-----------|
| M1 | TTL boundary `<` → `<=` in the cache-hit check | `residentPaneLive.test.js`: "performs a fresh walk once the TTL expires" |
| M2 | Cache key collapsed to a constant (`targetPath` → `'__all__'` for both get/set) | `residentPaneLive.test.js`: "keys the cache by targetPath" |
| M3 | Dropped `nowMs` at the `bridgeServer.ts` `/resident-pane` call site (exact bounce regression) | `bridgeServer.test.js`: "threads the server-injected nowMs through to captureMonoRouterLiveScreen (BL-881 bounce)" |
| M4 | `clearResidentPaneLiveCache` made a no-op | `residentPaneLive.test.js`: "clearResidentPaneLiveCache forces the next capture to re-walk immediately" |
| M5 | `RESIDENT_PANE_CACHE_TTL_MS` 5000→4000 | `run_acceptance.sh` scenario 3 ("Mini App poll interval does not outrun the capture TTL") |

All five killed. No survivors, nothing to fix.

## Coverage-gap pass

`residentPaneLive.test.js` + `residentPaneLive.property.test.js` +
`bridgeServer.test.js` were already comprehensive for the ticket's own
diff — the property test alone establishes the TTL-cache's core invariant
(real-walk count matches a greedy-TTL model) for 200 generated poll-instant
sequences per run, confirmed non-vacuous (its own header comment records
the broken-implementation counter-check). No coverage gap found; no new
test needed beyond what coder/architect already added.

## CRAP (scoped `src/*.ts`, targeted coverage run)

Ran `vitest run --coverage` scoped to `test/residentPaneLive.test.js
test/bridgeServer.test.js` (a full-suite coverage run was avoided given the
~45-58 load average; per BL-381 CRAP must read `src/*.ts` paths against
`coverage-final.json`, not `out/*.js`), then `node scripts/crapReport.js
src/bridge/residentPaneLive.ts src/bridge/bridgeServer.ts`:

- `captureMonoRouterLiveScreen` (this ticket's changed function):
  complexity=3, coverage=100%, **CRAP=3.00** — clean.
- `captureMonoRouterLiveScreenUncached`: CRAP=3.00 — clean.
- Two pre-existing, ticket-untouched functions in the same file
  (`tryCaptureRolePane` CRAP=6.06, `captureCoordinatorPaneLive` CRAP=7.93)
  reported over threshold. Confirmed via `git diff 73a6e5e88^ 3a10d8152 --
  residentPaneLive.ts` that BL-881 never touched either function (the only
  change is the `captureMonoRouterLiveScreen` rename + new TTL wrapper).
  Their reported CRAP here is a measurement artifact of this pass's
  targeted (not full-suite) coverage run — out of this ticket's changed-code
  scope, not a regression to fix in this parcel.

## DRY

`npm run dry` (jscpd, full `src/`): 36 pre-existing clones reported,
duplicated-lines 0.56% — none involve `residentPaneLive.ts` or the
`/resident-pane` route in `bridgeServer.ts`. No new duplication introduced.

## Fresh verification

- `npm run compile`: clean.
- `npx vitest run test/residentPaneLive.test.js test/bridgeServer.test.js`:
  96/96 passing.
- `npm run test:properties -- test/residentPaneLive.property.test.js`:
  1/1 passing.
- `run_acceptance.sh specs/features/BL-881-resident-pane-live-capture-ttl-
  cache.feature`: 3/3 scenarios pass (fresh `npm run compile` taken first,
  per BL-497 — this merge touched TS source).

## Process hygiene

Checked before and after (`pgrep -fl 'node --test|stryker'`, `pgrep -afl
tmux`): no leaked fixture processes. The only live tmux servers are the
real swarm sockets (`.swarmforge/tmux/*.sock`, `.swarmforge/operator/
operator-tmux.sock`) — nothing under `$TMPDIR` to reap.

## Verdict

Clean. No surviving mutants (hand-authored BL-638 sweep, 5/5 killed), no
coverage gap, no CRAP/DRY regression on the ticket's own changed code.
Forwarding to documenter.

By hardender.
