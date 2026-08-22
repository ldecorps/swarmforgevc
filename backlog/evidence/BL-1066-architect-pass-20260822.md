# BL-1066 — architect pass, clean review (Article 4.4: NONE)

Reviewed merge `ea95bb5de4` (cleaner, on top of coder `649c4e5f1`) into the
architect worktree. Merged first, then read ticket/evidence (per
[[architect-merge-before-reading-ticket]]), then recompiled `extension/out/`
before running any tool against it (per [[architect-stale-build-gotcha]]).

## Scope

`extension/src/metrics/metricsTickGate.ts` (new), `extension/src/metrics/swarmMetrics.ts`,
`extension/src/panel/swarmPanel.ts`, five new test files under `extension/test/`
(+3 test helpers), `specs/pipeline/steps/bl1066MetricsTickSteps.js` +
`specs/pipeline/steps/index.js` registration.

## Architecture

- Policy/IO separation intact: `metricsTickGate.ts` is a pure, generic,
  vscode-free gate (no fs/child_process import) — the "may this tick compute
  now" decision lives independently of what it computes. `swarmMetrics.ts`
  stays the single vscode-free IO module the panel and the CLI both call
  (BL-071 precedent, unchanged). `swarmPanel.ts` (host, imports vscode) owns
  the one gate instance as a private field so it survives across ticks, and
  is the only place `Date.now()`/wall-clock live for this feature.
- `computeSwarmMetricsOnTick`'s gate `run()` is called with `this.targetPath`
  as the subject — re-pointing the panel via `updateTarget` cannot serve a
  stale cross-repo mean, confirmed by reading `metricsTickGate.ts` and its
  regression test together (a throw while switching subjects does not adopt
  the new subject — this is exactly cleaner's follow-up commit).
- No IO added to the webview, no new webview storage, no direct process
  spawn outside the tmux substrate — this parcel touches no webview code.

## Required hard gate: `node extension/out/tools/dependency-gate.js`

Full-repo scan (paths straddle `extension/`/`specs/`, so ran with no args per
[[bl259-dependency-gate-and-npx-namespace-trap]]):

    Dependency-rule gate FAILED:
      src/tools/telegram-front-desk-bot.ts -> src/tools/telegramCursorOperatorExec.ts violates "acyclic"
      src/tools/telegram-front-desk-bot.ts -> src/tools/telegramCursorOperatorLiveness.ts violates "acyclic"
      src/tools/telegramCursorOperatorExec.ts -> src/tools/telegramCursorOperatorLiveness.ts violates "acyclic"

None of this parcel's files. Confirmed pre-existing at my prior tip
(`b74fcfb803`, before this merge) via `git show <prior-tip>:...` — the dynamic
`await import(...)` edges were already there. **Already tracked as BL-759**
(paused, priority 40) — re-verified against the ticket file itself, not
assumed; I initially sent a redundant "worth a ticket?" note before finding
BL-759 and had to retract it (own mistake, recorded in
[[architect-grep-exact-filenames-before-worth-a-ticket-note]]). Not this
parcel's scope. Same disposition as BL-1036 and BL-1058's own architect
passes.

Scoped-to-parcel run (files relative to `extension/`) reports the identical
three edges — `acyclic` is graph-wide regardless of the file filter, confirms
nothing else. Zero violations attributable to BL-1066.

## Co-change (`node extension/out/tools/co-change-report.js`)

`swarmMetrics.ts`'s top suspected couplings are its own CLI
(`tools/swarm-metrics.ts`), its own CLI test, and `specs/pipeline/steps/index.js`
— exactly the BL-071 shared-module pattern, not new. `swarmPanel.ts`'s top
couplings (`webviewHtml.ts`, `panel.js`, `extension.ts`, `paneTailer.ts`) are
this file's known pre-existing structural coupling, untouched by this diff.
`metricsTickGate.ts` (new file) co-changes only with its own test and the
files that wire it in — expected for a brand-new module. Nothing flagged
needs action.

## Invariants review (BL-633/BL-654) — all three declared, all three real

| # | Invariant | Test | Verified myself |
|---|---|---|---|
| 1 | tick never re-enters a running computation | `metricsTickGate.property.test.js` | ran green (2/2); read the generator — asserts `maxDepth<=1` over generated nested-tick interleavings, reach floor asserted (`casesReachingMidFlight >= numRuns/4`), not merely hoped for |
| 2 | cost does not grow with corpus size | `meanTicketTimeCost.property.test.js` | ran green (2/2); real git repos at generated sizes (small + large-regime floor 200+, reach asserted), git PROCESSES counted via a shim on PATH, asserted `<= MEAN_TICKET_TIME_GIT_SUBPROCESS_BOUND` (1) |
| 3 | every git child reaped, none defunct | `meanTicketTimeReaping.property.test.js` | ran green (2/2); scoped to this process's own children via `pgrep -P`, covers non-repo and missing-path failure targets too, self-proved via an instrument-check test against a real live child |

No missing/vacuous property test found — did not need to hand-verify any of
the three from first principles, per my own Review Order.

## Property-testing pass (BL-654 scope: undeclared properties on touched pure modules)

The three declared invariants already cover the two new pure modules'
interesting properties (gate re-entrancy/throttling, git-subprocess cost).
Duration-computation *correctness* (as opposed to cost) is covered by
`meanTicketTimeWalk.test.js`'s example-based cases plus the coder's own
101-ticket parity check against the live repo (98/98 matching, 3 gained,
0 lost) — a parity/regression check is the right verification shape here,
not a universal property; nothing else on the touched surface is a natural
round-trip/idempotence/ordering candidate. Nothing added.

## Correctness read-through

Read `indexArrivals`/`activationTimeMs`/`ticketDurationMs` end to end
(the rename-chain walk replacing per-file `--follow`). Confirmed: the
`ACTIVE_PREFIX` early-return, the two-hop re-file loop, and the copy-status
fallback (basename lookup under `backlog/active/`) are each exercised by
`meanTicketTimeWalk.test.js`. One narrow same-second-commit edge (two
arrivals within the same `%cI` second collapse `arrivalBefore`'s strict `<`
to a miss) exists but is an existing precision limit of second-granularity
git timestamps, not a regression — pre-BL-1066 semantics had the same
granularity floor, and it can only ever under-count (never fabricate) a
duration. Not bounce-worthy.

The coder's own flagged, deliberately-preserved quirk (a ticket re-filed
after close inflates its measured duration) is real, unchanged from
pre-BL-1066 behavior, and already pinned by a named test. Relayed to
specifier+coordinator as a non-blocking note (priority 50) for a possible
future ticket, per Article 4.4's routing for an out-of-scope item found
during review — it does not block this parcel.

## Verification re-run live (not trusted from the commit message)

- `npm run compile` (from `extension/`): clean; confirmed by grepping the new
  exports out of the compiled `out/` files, not by exit code alone.
- `npx vitest run metricsTickGate.test.js meanTicketTimeWalk.test.js` → 17/17.
- `npx vitest run` (full unit suite) → **469 files / 8292 tests, ALL PASS**.
- `npm run test:properties` scoped to this ticket's three property files →
  **6/6 PASS**.
- `npm run test:properties` (full lane) → 144 passed / 2 failed (426 total).
  Both failures are pre-existing, already-triaged, already-ticketed flakes
  unrelated to this parcel: `bl796NvmNodePathFollowUpAdoptInvariants` (BL-1063,
  backgrounded-child race) and `bl968MaterializedGuardSensitivity` (BL-1062,
  unseeded generator-reach floor) — cross-checked against
  `backlog/evidence/BL-1061-property-lane-triage-20260822.md`'s own mechanism
  table, not assumed.
- `specs/pipeline/scripts/run_acceptance.sh` on this ticket's feature → **5/5**.
- `swarmforge/scripts/gherkin_lint_gate.sh` on the feature → parses cleanly.
- `required_wiring` (`bl1066MetricsTickSteps` in `specs/pipeline/steps/index.js`)
  → confirmed present.
- `npm run dry` (jscpd) → exit 0, 34 clones, all pre-existing in
  `telegram*` files this parcel does not touch.

## Verdict

**NONE.** No architecture violation, no invariant gap, no correctness defect
in the parcel. Forwarding to hardener.

— By architect.
