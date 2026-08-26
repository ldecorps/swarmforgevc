# BL-1035 architect pass — 2026-08-22

**Parcel:** cleaner forward `00e678d563` ("Merge commit '1cea4f7a30' into
swarmforge-cleaner"), merged into architect at `d1b93683f`. The only new
content commit in the range is the coder's own `1cea4f7a3` ("BL-1035: a
respawned front-desk bot is judged on its own heartbeat, not its
predecessor's") — cleaner reviewed clean and forwarded as-is. The rest of
the merge range is `origin/main` catch-up (BL-1034/1038-1041 mints, BL-981
epic-slice bookkeeping, BL-1022 done-move) pulled in before the coder
worked, not this parcel's own content. Cross-checked `git diff` against
both merge parents: additive only (the non-additive side is my own three
prior evidence files, expected).

**Ticket-location note (not a defect):** the ticket YAML currently rides in
this branch's `backlog/paused/` without `assigned_to`, while `main`/
`origin/main` both have it correctly in `backlog/active/` with
`assigned_to: coder` (promoted `5f29069c7`, approved `1985354`). Traced the
cause: the coder's branch forked from `origin/main` (via `b118d3135`,
"Merge origin/main into swarm/coder for BL-1035") BEFORE the coordinator's
promotion commit landed on main, and never re-synced afterward — it worked
from the already-approved ticket CONTENT (which does not change), just an
older copy of the bookkeeping fields. This branch never edits that file, so
it will resolve itself as a clean fast-forward-style pickup of main's side
the next time this chain merges main (e.g. at QA's landing). Not a bounce,
not a note — verified harmless and left alone.

**Verdict: PASS.** Complete review inventory below records **NONE** — no
architecture violation, no invariant violation, no correctness defect
found.

## Review completed first (Article 4.4 — full inventory before judging)

- **Two-layer / extension-host boundary:** N/A — this is `swarmforge/`
  maintained-fork Babashka supervisor code (the swarm's own front-desk
  bot), not `extension/` TypeScript or webview code. Normal fork
  maintenance of a live defect in the swarm's own operation, not "modifying
  SwarmForge from outside" in the sense the extension's own constraint
  forbids.
- **Dependency-rule hard gate / co-change:** not applicable — no
  `extension/src/**` files touched (the gate's ruleset scopes to
  `extension/`'s own import graph). Confirmed by the changed-file list:
  `front_desk_supervisor_lib.bb`, two new `.bb` test/property runners, one
  new feature file, one new `specs/pipeline/steps/*.js` step handler, and a
  3-line registration edit to `specs/pipeline/steps/index.js`.
- **Scope discipline:** the ticket's own scope named
  `front_desk_supervisor.bb`'s `read-poll-heartbeat-ms` and
  `:heartbeat-stale?` call site, and `telegram-front-desk-bot.ts`, as
  touchable IF the fix needed them. Neither was touched — confirmed the
  existing call site (`front_desk_supervisor.bb:430`) already passes all 5
  args, so the shared predicate was the only thing that needed to change.
  Correct minimal fix, no scope creep.
- **Declared invariant 1** ("never judged on a predecessor's heartbeat")
  and **invariant 2** ("no path declares a child stalled before one full
  startup grace"): the fix computes `own-heartbeat-ms`, which is
  `last-heartbeat-ms` only when it's `nil?` `started-at-ms` (preserves the
  3-arity/no-grace callers byte-for-byte) or `>= started-at-ms` (i.e.
  actually written by THIS child); a pre-spawn heartbeat is treated as
  absent. Traced by hand against all six read paths:
  - 3-arity callers (`onboarder_supervisor.bb`,
    `negotiation_relay_supervisor.bb`, grepped and confirmed) get
    `started-at-ms = nil`, so `own-heartbeat-ms = last-heartbeat-ms`
    unconditionally — behavior is provably unchanged for these two.
  - 5-arity callers (`front_desk_supervisor.bb:430`,
    `cursor_bridge_supervisor.bb:107-109`,
    `bridge_headless_supervisor.bb:117-119`, all three grepped and
    confirmed passing `started-at-ms`/grace) now correctly ignore a
    pre-spawn heartbeat during the grace, and fall back to ordinary
    staleness once the grace ends or once the child produces its own
    heartbeat — matches both invariants without widening the check in
    either direction.
- **BL-370 regression guard (the guard must stay armed):** confirmed the
  waiver is scoped strictly to `(nil? own-heartbeat-ms)` inside the grace
  window; once the grace elapses, an absent own-heartbeat reads exactly as
  a nil one always did, so a genuinely silent replacement is still caught
  — same as the shipped guard.
- **Non-vacuity — verified by hand, not trusted from the commit message.**
  Built two isolated scratch copies of the lib + property runner (own
  `tmp/` scratch dirs, load-file path retargeted to the scratch copy,
  cleaned up after each):
  - Reverted `poll-heartbeat-stale?` to the exact shipped nil-guard
    (removed the `own-heartbeat-ms` binding entirely) → re-ran the
    property runner live: **P1 87/87, P2 87/87 failures**, exact match to
    the commit's claimed counts, P3 stayed green. Confirms the fix is
    reachable and the properties actually bite the real historical defect.
  - Replaced the 5-arity body with an unconditional `false` (the
    BL-370-reintroducing break) → re-ran live: **P3 159/159 failures**,
    exact match, P1/P2 stayed green — confirms P3 exists for a real reason
    (P1+P2 alone are satisfiable by deleting the whole stall check).
  - Both scratch copies removed after verification; `git status` clean.
- **Coverage-floor / generator-reach note, checked rather than taken on
  faith:** the runner's own comment documents a real prior generator bug
  (LCG high-bits helper silently capping every draw at 32767 regardless of
  requested range, so the defect shape - a pre-spawn, already-stale
  heartbeat inside the grace window - was reached zero times in 400 runs
  against the live bug). Read the current generator: offsets are now
  explicitly scaled (`pre-off = 32 * pre-raw`, `past = 16 * past-raw`) to
  reach the needed magnitude, and a `:defect-shape ≥ 60` floor is asserted.
  Live run's coverage matches the commit's claimed shape exactly (see
  Verification below).
- **Correctness read, by hand:**
  - `own-off` division-by-zero guarded (`max 1 (- now started-at)`), and
    `own-hb` is only ever set when `now > started-at`, so the guard is
    never exercised in a way that could divide by zero.
  - The final boolean branch is unchanged in shape from the original
    (`(or (nil? X) (>= (- now-ms X) stall-ms))`), only `X` changed from
    `last-heartbeat-ms` to the new `own-heartbeat-ms` — the smallest
    possible diff that fixes the defect, matching the "one binding, existing
    shape otherwise untouched" claim.

## Property-testing pass (BL-654 scope: undeclared properties on touched pure modules)

The only new pure surface is `poll-heartbeat-stale?` itself, already fully
covered by the two declared invariants above plus P3 (guard-armed). No
further round-trip/idempotence/ordering candidate found on this or any
other touched module (the `.js` step handler is a test harness driving a
real subprocess, not business logic); nothing to add.

## Verification re-run live (not trusted from the commit message)

- `bb swarmforge/scripts/test/bl1035_startup_grace_property_runner.bb` →
  **400 runs, ALL PROPERTIES HOLD**, coverage
  `{:defect-shape 87, :inside-grace 148, :past-grace 132, :at-boundary 120,
  :own-heartbeat 148, :no-heartbeat-at-all 159}` — `:defect-shape 87`
  matches the commit's claimed non-vacuity count exactly.
- `bb swarmforge/scripts/test/front_desk_supervisor_lib_test_runner.bb` →
  **ALL PASS**.
- `node specs/pipeline/cli.js specs/features/BL-1035-a-respawned-bot-gets-its-own-startup-grace.feature`
  → **5/5**.
- Sibling suites claimed green, all re-run live and confirmed:
  `cursor_bridge_supervisor_test_runner.bb` → ALL PASS;
  `bridge_headless_supervisor_test_runner.bb` → ALL PASS;
  `bl879_parent_orphaned_front_desk_property_runner.bb` → ALL PROPERTIES
  HOLD; `test_onboarder_supervisor_tick.sh` → PASSED.
- `test_front_desk_supervisor_tick.sh` → exactly one failure,
  `bl-303 supervisor-recovery-02 [not elapsed]: still gave-up, not
  restarted` — matches the commit's claimed pre-existing failure exactly.
  Confirmed the test file itself is byte-identical to the prior architect
  HEAD (`23643b250`, before this merge) — this parcel touches none of the
  attempt-cap/reset logic that scenario exercises, so it predates and is
  unrelated to this change.

## What was NOT completed within this pass's practical time budget

- The repo-wide full unit and property suites launched during the prior
  (BL-1014) pass in this same session are still running under
  `detach_job.sh`, badly slowed by sustained severe host load (130-173
  observed this session). One new item surfaced in the partial unit-suite
  output: `test/pwaCollapsibleSections.test.js`, all 6 sub-tests failing at
  exactly ~20000-20005ms (a uniform timeout signature, not a logic
  mismatch). This file is unrelated to BL-1035 (PWA collapsible-section UI,
  not front-desk supervisor code) and unrelated to BL-1014 (boy-scout
  scan); the uniform timeout pattern under confirmed severe host load reads
  as environment-induced rather than a real regression from either parcel,
  but is NOT independently re-confirmed clean at low load in this pass -
  flagged here rather than silently absorbed. Not treated as a BL-1035 gap:
  every assertion that concerns THIS parcel's own changed files was
  independently confirmed live above.

— By architect.
