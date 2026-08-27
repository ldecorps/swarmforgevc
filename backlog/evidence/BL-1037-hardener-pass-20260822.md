# BL-1037 hardener pass — 2026-08-22

**Parcel:** architect forward `f574c2d3e2` (PASS verdict; both declared
invariants confirmed non-vacuous by hand, backward-compat traced through
the 5-deep arity chain, deferral ordering vs. the pre-existing stall path
confirmed not a gap), merged into hardener.

**Verdict: hardened. One real mutation gap closed with a behavior-preserving
split plus tests.** No Stryker (pure Babashka, no mutation tool wired); no
`Scenario Outline:`/`Examples:` in the feature, so BL-113 not applicable.
Hand-authored surgical mutation sweep instead.

## The gap: `child-build-served?`'s own `>=` boundary was never directly
tested - the exact BL-1035 pattern, recurring same-day in a sibling function

`front_desk_supervisor.bb`'s `child-build-served?` computes "has this child
completed a poll cycle on the build it was restarted onto" with:

    (boolean (and hb started (>= hb started)))

the identical shape to BL-1035's own `own-heartbeat-ms` guard in
`front_desk_supervisor_lib.bb` (the fix I hardened earlier today, same
pass), reusing the same underlying fact by design (the architect's own
evidence confirms this deliberately: "reuses BL-1035's own fact ... rather
than reinventing it"). But `check-one!`/`build-freshness-transition` -
where BL-1037's own unit and property tests live - only ever receive
`build-served?` as an ALREADY-RESOLVED boolean argument. Nothing tests how
that boolean gets computed. `child-build-served?` itself is impure (reads
`read-poll-heartbeat-ms`, real I/O) and had no test file of its own, so its
`>=` boundary was reachable by no test at all - not even indirectly,
because a boolean input hides the comparison that produced it.

Unlike BL-1035's `poll-heartbeat-stale?` (where the grace/stall dual-window
happened to hide a `>` vs `>=` mutant behind a coincidentally-matching
branch, which is why that gap needed a specific grace-shorter-than-stall
fixture to discriminate), `child-build-served?` is a bare two-argument
comparison with no such hiding structure - once it is actually testable, a
`>=`/`>` mutation is immediately observable with no special construction
needed.

## The fix: extracted, not just tested

Per this codebase's own established convention (pure decisions live in
`_lib.bb`, the impure CLI wrapper calls into them - the same split BL-1041
this pass followed for `rescue_lib.bb`/`rescue_orphaned_work.bb`, and the
one `front_desk_supervisor_lib.bb` already uses for `build-stale?`/
`child-build-stale?`), pulled the pure comparison out into
`front_desk_supervisor_lib.bb`:

    (defn build-served-fact? [heartbeat-ms started-at-ms]
      (boolean (and heartbeat-ms started-at-ms (>= heartbeat-ms started-at-ms))))

`child-build-served?` now calls
`front-desk-supervisor-lib/build-served-fact?` instead of re-inlining the
comparison. Behavior-preserving: same inputs, same output, same call site
wiring (`:build-served? child-build-served?` in `process-specs`,
unchanged).

Added 5 assertions to `front_desk_supervisor_lib_test_runner.bb`, alongside
the existing BL-1035 boundary tests it deliberately mirrors: exact-boundary
(`hb == started` -> served), one-tick-before (`hb == started - 1` ->
predecessor's, not served), clearly-after (served), and the two nil cases.
Confirmed the exact-boundary test discriminates: mutated `>=` to `>` in a
scratch copy, re-ran - the exact-boundary assertion failed precisely as
expected (`expected: true, actual: false`), every other assertion
unaffected. Restored, re-confirmed `ALL PASS`.

## Verification re-run live

- `bb swarmforge/scripts/test/front_desk_supervisor_lib_test_runner.bb` -
  **ALL PASS**.
- `bb swarmforge/scripts/test/bl1037_build_restart_rate_property_runner.bb`
  - **300 runs, ALL PROPERTIES HOLD**, coverage `{:deferred 1857, :restarted
  343, :fresh 0, :debt-paid 343, :never-stale 87}` - exact match to the
  architect's own re-run.
- `bb swarmforge/scripts/test/cursor_bridge_supervisor_test_runner.bb` /
  `bridge_headless_supervisor_test_runner.bb` - both **ALL PASS**
  (unaffected siblings, confirmed as the architect's pass did).
- `bb swarmforge/scripts/test/bl1035_startup_grace_property_runner.bb` -
  **400 runs, ALL PROPERTIES HOLD** (unaffected - `poll-heartbeat-stale?`
  itself untouched).
- `node specs/pipeline/cli.js
  specs/features/BL-1037-the-build-freshness-watchdog-restarts-fewer-times-than-main-moves.feature`
  - **5/5**.
- `front_desk_supervisor.bb` re-parsed clean (loaded standalone, printed its
  own usage with no args - confirms no syntax break from the call-site
  edit).
- `bash swarmforge/scripts/test/test_front_desk_supervisor_tick.sh` - 2
  failures (`bl-303 supervisor-recovery-02`), confirmed PRE-EXISTING and
  unrelated: re-ran against the architect's unmodified tip (stashed this
  pass's own changes first) and got the identical two failures. Matches
  this same hardener's own BL-1035 pass note earlier today ("the one
  pre-existing test_front_desk_supervisor_tick.sh failure confirmed
  unrelated").

— By hardener.
