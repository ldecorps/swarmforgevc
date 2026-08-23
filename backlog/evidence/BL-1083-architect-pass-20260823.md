# BL-1083 — architect pass

Received from cleaner as `merge_and_process cleaner b405878cec` (cleaner's own
decomposition commit — split `consultPromotionGates` into `runGateCli` +
`parseGateVerdict` for CRAP<=6, closed two missing branches to 100% coverage,
fixed a stray `;;` docstring artifact in `promotion_gates_cli.bb`). Rebuilt
`extension/out` before trusting anything (stale-build precedent,
[[architect-stale-build-gotcha]]) — confirmed fresh via mtime and a grep for
the new `runGateCli`/`consultPromotionGates` symbols in the compiled output.

## Required hard gate — dependency-rule checker (BL-259)

Parcel straddles `extension/` and repo-root paths (`specs/pipeline/steps/**`,
`swarmforge/scripts/promotion_gates_cli.bb`), so ran the full-repo scan
(`node out/tools/dependency-gate.js`, no args). Reports the same 3
pre-existing `acyclic` violations among `telegram-front-desk-bot.ts` /
`telegramCursorOperatorExec.ts` / `telegramCursorOperatorLiveness.ts` already
tracked as **BL-759** (paused, priority 40) — confirmed still present in
`backlog/paused/`. Confirmed the two lines causing the triangle
(`await import('./telegramCursorOperatorExec')` /
`...telegramCursorOperatorLiveness')`) predate this ticket entirely (present
at `a2523f3fb`, the ticket's own promotion commit, and dated back to
2026-07-29 per file history). Per
[[architect-grep-exact-filenames-before-worth-a-ticket-note]] — this exact
cycle has already been independently rediscovered and reported three times
before (BL-1066, a BL-723 pilot review, a BL-911 architect repass); BL-759
already tracks it. Not this parcel's to fix, and no new note sent (already
tracked, re-reporting it again would repeat a documented mistake).

No other rule (`no-io-from-policy`, `view-not-import-host-io`,
`no-process-spawn-from-view`, `core-not-vscode-api`, `no-webview-storage`)
fired anywhere in the repo. `backlogWriter.ts` lives in `src/panel/` (host
core, not `media/`), so its new `execFileSync('bb', ...)` call is not a
process-spawn-from-view violation — confirmed by reading the ruleset's own
`from: media/` scoping on that rule.

## Co-change coupling (BL-255)

Ran against all 5 production files this parcel changes. Flags
`backlogWriter.ts <-> {its own test, telegram-front-desk-bot.ts,
telegramFrontDeskBotCore.ts, specs/pipeline/steps/index.js,
promotion_gates_cli.bb}` as "SUSPECTED COUPLING" — expected: these are
exactly the mover, its two callers, the shared gate CLI, and the step
registry this single ticket wires together. Not accidental drift.

## required_wiring anchors — both verified present

- `backlogWriter.ts` reaches `promotion_gates_cli.bb` via
  `execFileSync('bb', [cli, 'gate-promotion', ...])` — confirmed in the diff
  and by running it against a real fixture (below).
- `specs/pipeline/steps/index.js` registers
  `require('./bl1083PromotionGateSteps')` in `DOMAINS` — confirmed present.

## Invariants Review (BL-633/654) — both declared, both encoded, non-vacuous

**Invariant 1** ("every path into active takes its verdict from the one
chokepoint — a second copy, in any language, is the defect"): P1/P2 in
`bl1083PromotionGateInvariants.property.test.js` state this as a claim about
the source tree via `findActivePromotionSources()` (repo-wide enumeration,
not a remembered-paths spot check — the defect *was* the path nobody was
checking). Ran the enumeration myself, independent of the test:

```
sources: ['extension/src/panel/backlogWriter.ts',
          'swarmforge/scripts/promote_and_route_next.sh']
both -> referencesPromotionGates: true
```

Matches the coder's evidence exactly, and matches the two real movers named
in the ticket. `gateRuleNamesInCode` (P2) confirms none of the three gate
rule names (`depends_on`, `active_backlog_max_depth`, `human_approval`)
appear as live code outside `promotion_gates_lib.bb` — read the stripComments
implementation myself; it strips full-line `//`/`;;`/`#` comments only (not
trailing same-line comments), which is over-conservative in the safe
direction (a name in a trailing comment would still count as "found," never
the reverse) — no false-negative risk for this check.

**Invariant 2** ("a refused promotion leaves the ticket exactly where it was
and names the gate + reason — never a silent no-op"): P3 states this as a
conjunction (not moved AND folder listing byte-identical AND named
gate+reason) over every one of the four gates that can refuse
(`hold`, `human_approval`, `depends_on`, `active_backlog_max_depth`) plus the
unreachable-CLI case. P4 is the armed-ness backstop (a clear ticket still
promotes; a satisfied dependency does not refuse) — without it, invariants 1-3
are all satisfied by a mover that refuses everything, which is the
over-correction the ticket's own QA step 5 warns against.

Ran the full property file myself via `npm run test:properties`-equivalent
(`vitest run --config vitest.properties.config.mjs`): **6/6 pass**.

Did not just trust the coder's non-vacuity table — broke invariant 2 myself
to confirm the test actually bites: temporarily dropped the `refusal` field
from the refuse branch in `backlogWriter.ts` (`return { moved: false }`
instead of including `refusal: {...}`), recompiled, reran. Result: **2 of 6
properties failed** (`P3` hold-marker case, `P3` unreachable-CLI case), both
with the expected assertion message ("a refusal must be reported, never a
silent no-op"). Reverted, recompiled, reconfirmed 6/6 green and `git diff`
empty on the source file — no residue from the spot check.

## Property Testing pass (undeclared coverage)

No further property test warranted beyond the two declared invariants. The
touched pure surface (`consultPromotionGates`/`runGateCli`/
`parseGateVerdict` in `backlogWriter.ts`, `activePromotionSources.js`) is
already exercised by P1-P4 at the level that matters (source-tree enumeration
and refusal-effect conjunction); nothing round-trip/idempotence/ordering
shaped is left undercovered.

## Architecture rules

Two-layer boundary: `promoteToActive`'s new gate consultation lives in
`src/panel/backlogWriter.ts` (extension host, not webview) and shells to
`bb`, the same pattern already used by `runExpediteDispatch ->
route_backlog_to_coder.sh` — no new process-spawn path from the view layer,
no bypass of the tmux substrate (this doesn't touch agent processes at all).
Extension host owns the I/O: both callers (`telegram-front-desk-bot.ts`,
`bridgeServer.ts`) are host-side; neither is webview code. No browser storage
or secrets touched. Integrate-not-fork: `promotion_gates_lib.bb` (the actual
gate rules) is untouched — confirmed empty diff
(`git diff a2523f3fb..b405878ce -- swarmforge/scripts/promotion_gates_lib.bb`)
— and `promote_and_route_next.sh` is likewise untouched, matching the
ticket's own "not in this slice." High-level policy (which gates, in what
order, against which cap) stays entirely in Babashka; the TypeScript side
only ever sees `ALLOW`/`REFUSE|gate|reason`/`NOT_FOUND` and takes the verdict
— correct dependency direction, no restated rules on the wrong side of the
language boundary (the BL-897 shape this ticket is itself a case of).

`resolve-max-depth` in the cli reads the configured cap directly via
`backlog-depth-lib` (already in this CLI's load-file closure) rather than
shelling to sibling CLIs by name — the coder explicitly called out applying
the BL-973 lesson here the same day it landed; confirmed by reading the
function, the one remaining shell-out (`effective_backlog_depth_cli.bb`) can
only tighten the cap, never loosen it, so its absence degrades safely and
Article 3.2.4's "expedite never overrides the circuit breaker" holds either
way.

## Human-approval trade-off (approval_context) — implementation matches

The ticket's `approval_context` explicitly flagged one live policy choice:
whether the depth cap should refuse an expedited promotion (constitutional
reading, Article 3.2.4) or remain overridable by a human tap. Recorded
disposition is `human_approval: approved` (enforce the constitutional
reading). Confirmed the implementation matches: `active_backlog_max_depth`
is one of the four gates in `REFUSING_GATES`/`bl1083PromotionGateSteps.js`'s
scenario 02 and refuses exactly like `depends_on`/`hold` — no special-case
override for Expedite. No discrepancy between disposition and code.

## Correctness read

**One judgment call to weigh, as the coder flagged it explicitly:**
`PollAdapters.promoteTicketIfPaused` now returns a union
(`Promise<boolean | PromotionOutcome>`), reconciled in one place
(`normalizePromotionOutcome`). Considered collapsing it to the object shape
everywhere instead — rejected: it would touch ~5 unrelated call sites'
boolean-returning stubs for no architectural gain, since the union is already
resolved at exactly one seam. Keeping it is the smaller diff and matches "no
premature abstraction, no churn for its own sake." No change requested.

**One coverage gap, not bounce-worthy — flagged for the hardener's own gate,
not fixed here:** `bridgeServer.ts`'s new `if (promotion.refusal)` branch in
`handlePausedPagerExpediteRoute` (the paused-pager Expedite endpoint's 409
response) has **zero automated test coverage** in this parcel —
`pausedPagerBridge.test.js`'s new/changed tests all exercise the *allow* path
only; the refusal path is exercised only via the *other* caller (the
Telegram verb, through `bl1083PromotionGateSteps.js`). This is exactly the
shape the ticket's own `qa_e2e_procedure` step 3 warns about ("a fix that
only covers the Telegram verb is the defect again with one caller fewer") —
so I did not take the code's correctness on faith. Wrote a throwaway
integration script (`tmp/`, deleted after) that starts the real bridge server
against a real gate-CLI fixture and POSTs to `/paused-pager/expedite` for a
ticket with an unlanded `depends_on`:

```
STATUS: 409
BODY: {"success":false,"id":"BL-9500","gate":"depends_on",
       "reason":"depends_on not yet landed in backlog/done/: BL-9501"}
still in paused: true / landed in active: false
human_approval in the ticket file: approved (recorded before the gate refused)
```

Matches the documented contract exactly — the code is correct. Not bouncing
for the missing regression test itself: coverage enforcement on new branches
is explicitly the hardener's own Article 4.1 gate (100% coverage), and a
brand-new, cleanly-isolated conditional with 0% coverage is precisely the
shape that gate is built to catch — unlike a CRAP-masked or comment-hidden
gap, this one cannot slip past `npm run coverage` unnoticed. Flagging here so
it isn't mistaken for baseline debt if the hardener's tooling surfaces it.

## Verification run myself

| check | result |
|---|---|
| `node out/tools/dependency-gate.js` (full repo) | 3 pre-existing BL-759 violations only, none new |
| `node out/tools/co-change-report.js` (5 changed files) | expected coupling only |
| `findActivePromotionSources()` (manual, independent of the test) | 2 sources, both gated |
| `bl1083PromotionGateInvariants.property.test.js` | 6/6 (break-then-fix on invariant 2 confirmed non-vacuous) |
| `backlogWriter.test.js` / `pausedPagerBridge.test.js` | 34 / 15 pass |
| BL-1083 acceptance feature | 5/5 |
| BL-490 acceptance feature (regression check) | 8/8 unchanged |
| BL-721 acceptance feature (regression check) | 4/4 unchanged |
| full extension unit suite | 8560/8560, 477/477 files |
| manual HTTP spot-check of the paused-pager refusal branch | 409, correct body, correct file state |
| `promote_and_route_next.sh` / `promotion_gates_lib.bb` diff | empty (untouched, per "not in this slice") |

## Verdict

COMPLIANT. No architecture violation, no invariant violation, no correctness
defect. Forwarded to hardener.
