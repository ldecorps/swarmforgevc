# BL-1037 architect pass — 2026-08-22

**Parcel:** cleaner forward `5b03ee321b` ("Merge commit 'a1eb76b4b4' into
swarmforge-cleaner"), merged into architect at `19c9dbb0a`. The only new
content commit is the coder's own `a1eb76b4b` ("a healthy front desk is
restarted only once it has served the build it was moved to"); cleaner
forwarded as-is. Merge was clean (no conflict this time), diffed against
both parents: additive both directions, BL-1035's fix in
`front_desk_supervisor_lib.bb` confirmed still intact.

**Verdict: PASS.** Complete review inventory below records **NONE** — no
architecture violation, no invariant violation, no correctness defect
found.

## Review completed first (Article 4.4 — full inventory before judging)

- **Two-layer / extension-host boundary, dependency-gate, co-change:** N/A
  — no `extension/` TypeScript files touched (pure `swarmforge/`
  maintained-fork `.bb` scripts, one new `specs/pipeline/steps/*.js` step
  handler, a doc update). Same posture as the BL-1035/BL-1036 siblings in
  this subsystem.
- **Backward compatibility, checked not assumed:** the new `build-served?`
  parameter is added at the END of `check-one!`'s arity chain, defaulting
  to `true` for the existing 9-arity form — read the multi-arity fallback
  chain by hand (5 arities deep) and confirmed each shorter form still
  resolves to exactly the prior behavior. Confirmed live via the two tests
  the coder added: `"bl1037: the 9-arity form is unchanged - a stale build
  past the grace still restarts"` and the bridge's `:build-served? (fn [_]
  true)` wiring in `front_desk_supervisor.bb`, which keeps BL-582's
  original unbounded-restart behavior for the one caller that cannot
  observe serving (no poll heartbeat) — correct per the ticket's own
  reasoning: a child that cannot prove it served must not thereby become
  unrestartable.
- **Ordering / interaction with existing branches, traced by hand:** a
  concern worth checking explicitly - could a child that never manages to
  serve (permanently hung, not crashed) get stuck in indefinite deferral,
  never restarted? Read `check-one!`'s full `cond`: `pid-alive?` is checked
  first (crash), then `heartbeat-stale?` (stall) - BOTH ahead of the
  build-freshness branch, which is checked LAST. So a genuinely hung child
  is caught by the pre-existing (and BL-1035-hardened) stall-detection
  path regardless of `build-served?` - the deferral only ever matters for a
  child that IS otherwise healthy and simply hasn't rebuilt yet, which is
  exactly the intended scope. Not a gap.
- **`child-build-served?` reuses BL-1035's own fact** (a heartbeat at or
  after this child's spawn) rather than reinventing it - checked the
  definition directly: `(boolean (and hb started (>= hb started)))`,
  identical shape to BL-1035's `own-heartbeat-ms` guard. Consistent, no
  duplicated logic to drift out of sync.
- **Declared invariant 1** ("staleness deferred is never staleness
  dropped"): `build-freshness-transition`'s deferred branch returns
  `{:entry entry ...}` - the entry UNCHANGED, so `:build-stale-since-ms`
  is neither cleared nor re-stamped. Independently verified non-vacuous by
  hand: broke a scratch copy to clear `:build-stale-since-ms` on deferral,
  recompiled nothing needed (pure `.bb`), re-ran the property runner live
  — **P1 failed exactly 1126/1126 times**, matching the commit's claimed
  count exactly. Restored and re-confirmed clean.
- **Declared invariant 2** ("never restart a child that has not served"):
  `build-freshness-transition` only fires `:build-stale` (the actual
  restart-triggering event) when `build-served?` is true; otherwise
  `:build-stale-deferred`. The property test replays whole tick sequences
  (not single decisions) — correctly, since the ticket's own analysis notes
  a "defer forever" implementation would satisfy both invariants
  completely while reinstating BL-582's original 2h23m stale-window fault;
  the runner's `:restarted`/`:debt-paid` coverage floors (not the
  properties themselves) are what would catch that shape, and both floors
  are honestly documented as assertions rather than diagnostics for
  exactly this reason.
- **Generator-reach diligence, read and confirmed genuine:** the runner's
  own comment documents a real authoring-time bug (the un-served stretch
  was drawn shorter than the grace window, so the deferral state was
  unreachable in 0/300 runs) caught by the coverage floor, not by chance -
  the fix (sizing the stretch to outlast the grace) is visible in the
  current generator and the live run's `:deferred 1857` count confirms the
  state is now reached abundantly.
- **`required_wiring`:** none declared (ticket states why: no new call
  site, only behavior changed at the existing one) — confirmed accurate.
- **Observability constraint** (intake's own standing requirement - every
  event must be named in the log): confirmed `:build-stale-deferred` is a
  distinct logged event
  (`front_desk_supervisor.bb`'s `log-event!` cond gains a new clause
  naming the build_sha and stating a restart is still owed), not merely
  inferred from a restart that silently didn't happen - directly addresses
  the intake's complaint that the original storm needed a hand-built
  timeline to diagnose.

## Property-testing pass (BL-654 scope: undeclared properties on touched pure modules)

Both touched decision points (`build-freshness-transition`'s
debt-carrying, and the served/restart gating) are already the direct
subject of the two declared invariants, tested as whole-sequence replays
- the right shape given the ticket's own observation that no single-tick
scenario can state "the debt survives". No further round-trip/ordering
candidate found on the touched pure surface; nothing to add.

## Verification re-run live (not trusted from the commit message)

- `bb swarmforge/scripts/test/bl1037_build_restart_rate_property_runner.bb`
  → **300 runs, ALL PROPERTIES HOLD**, coverage `{:deferred 1857,
  :restarted 343, :fresh 0, :debt-paid 343, :never-stale 87}` — exact
  match to the commit's claims.
- `bb swarmforge/scripts/test/front_desk_supervisor_lib_test_runner.bb` →
  **ALL PASS**.
- `node specs/pipeline/cli.js specs/features/BL-1037-the-build-freshness-watchdog-restarts-fewer-times-than-main-moves.feature`
  → **5/5**.
- Sibling suites claimed green, re-run and confirmed:
  `cursor_bridge_supervisor_test_runner.bb` → ALL PASS;
  `bridge_headless_supervisor_test_runner.bb` → ALL PASS;
  `bl1035_startup_grace_property_runner.bb` → 400 runs, ALL PROPERTIES
  HOLD (unaffected, as expected - `poll-heartbeat-stale?` itself untouched
  by this ticket).

— By architect.
