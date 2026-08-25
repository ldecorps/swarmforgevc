# BL-971 — architect review pass: PASS to hardener (clean sweep, NONE)

- **Ticket**: BL-971 — property lane never green (bl868 + bl632 + bl760
  timeouts under swarm load), `type: defect`, `severity: high`, M8.
- **Received**: `git_handoff` from cleaner, `f66a0d534e` ("Merge commit
  '83c779e13b' into swarmforge-cleaner"), task
  `BL-971-property-lane-never-green-two-timeouts`. Merging this commit
  into `swarmforge-architect` produced a byte-identical (zero-diff) tree —
  every file this commit carries had already arrived via BL-968's earlier
  cleaner forward (b39bbbe80d), which shared ancestry with this one.
- **Reviewer**: architect, 2026-08-20.
- **Verdict**: **PASS to hardener — clean sweep, NONE.**

This is the coder's re-fix (`ccf2954c9` per coder's own status) for QA's
bounce (`8956d30eee`, evidence
`backlog/evidence/BL-971-property-lane-never-green-two-timeouts-bounce-20260820.md`,
D1 + D2, both blamed on coder). Reviewed the re-fix against the bounce's
own remediation, not just re-read the ticket.

## D1 remediation check — `bl760DuplicateChainGuard.property.test.js` given a REAL fix, not budget inflation

The bounce required: apply the same class of fix bl632/bl868 received (a
measured cost reduction, never a bare raised timeout) to bl760, add it to
`KNOWN_LANE_FILES`, and re-verify comparable headroom.

- **Real cost reduction, verified by reading the diff**: the two
  invariant-1/invariant-2 properties (previously separate 40-draw tests,
  each paying its own full fixture-repo build — 5 git subprocesses per
  draw) are merged into ONE property asserting both facets per draw
  (halves the real-subprocess count outright), and a `resetFixture()`
  helper now builds the fixture ONCE per test and resets only the mutable
  surface (mailboxes, drafts, the root handoffs dir — each removal
  asserted gone) instead of rebuilding git state every draw. The
  invariant-3 ("different ticket id never blocks") property gets the same
  fixture-reuse treatment. `numRuns` drops 40→16 per property with a
  stated measured basis in the same comment (floor 2.2-3.1s/draw, worst
  loaded 5.6-7.5s/draw; 16×7.5s=120s against the unchanged 240s shared
  budget = ~2x worst-case headroom) and an explicit combinatorial-coverage
  argument (8 discrete state combos, ~2x expected coverage per run at
  numRuns 16) — satisfies the constraint against unmeasured budget
  inflation. Generator arbitraries themselves are untouched (confirmed by
  diff: no changes to `senderRoleArb`/`digitsArb`/`slugArb`/`stateArb` or
  their ranges) — coverage is preserved, only redundant per-draw fixture
  cost is removed.
- **Verified live, not just read**: ran `bl760DuplicateChainGuard.property.test.js`
  scoped (`npx vitest run --config vitest.properties.config.mjs
  test/bl760DuplicateChainGuard.property.test.js`) — 2/2 tests green,
  39.9s + 44.2s = 84.2s total against the 240s shared budget (~65%
  headroom, matching the "~20-25% utilization" shape the bounce's D1
  named as the target, a sharp contrast to the pre-fix ~98%-utilized
  near-miss). The one `Unhandled Error` in the run is the documented
  benign `[vitest-worker]: Timeout calling "onTaskUpdate"` artifact
  (BL-871 allowlist) — not a real failure.
- `KNOWN_LANE_FILES` in `bl971PropertyLaneTimeoutGreenSteps.js` now
  includes `'test/bl760DuplicateChainGuard.property.test.js'` — confirmed
  by direct read.

## D2 remediation check — scenario 02 step-handler regex

The scoped-step regex at `bl971PropertyLaneTimeoutGreenSteps.js` is now
`/^the property test files named in scenario 01$/` (the literal "two"
dropped), matching the amended feature text — confirmed by direct read
and by the acceptance run below (scenario 02, which failed with "no step
handler matched" under the bounced commit, now passes).

## End-to-end acceptance — verified live, not from the coder's own claim

Ran `node specs/pipeline/cli.js
specs/features/BL-971-property-lane-timeout-green.feature` in full:
**4/4 pass** (142.4s total) — scenario 01's three Examples rows
(bl868 14.97s, bl632 11.31s, bl760 106.34s, all green, zero wall-clock
exhaustions) and scenario 02 (budget-declaration inspection, 9ms). bl760's
106.34s scoped-through-the-real-lane-runner figure is higher than the
84.2s direct-vitest-invocation figure above (expected — the acceptance
step shells to `vitest` via `spawnSync` with its own process-startup
overhead, on a live-load host) but still comfortably inside the 240s
budget.

## Dependency-rule gate / co-change

- Dependency-rule gate: **N/A this parcel** — no file under `extension/src/`
  or `extension/media/` was touched (only `extension/test/`,
  `specs/pipeline/steps/`, `specs/features/`, `backlog/`).
- Co-change (`co-change-report.js` against
  `bl760DuplicateChainGuard.property.test.js`,
  `bl971PropertyLaneTimeoutGreenSteps.js`, the feature file): nothing at or
  above the default threshold (3) — highest reported was 2, all within
  already-related sibling files (bl787/bl797/bl932's shared-timeout-constant
  siblings, `index.js`, the ticket's own yaml/evidence).

## Property-testing pass

No new undeclared-property coverage was warranted this pass: the fix
touched only existing property test files themselves (adjusting draw
mechanics, not introducing a new pure module) and the step handler. No
new reusable pure helper was extracted (unlike BL-968's `lazy()`).

## Everything else

Ticket declares no `invariants:` field beyond the one already-encoded
top-level invariant this bounce concerns (checked: `invariants:` block
has exactly one entry, already covered by the acceptance feature's own
scenario 01/02 — no separate invariants-review obligation beyond what the
bounce remediation already re-verifies). No further defects found reading
the diff or running the code.
