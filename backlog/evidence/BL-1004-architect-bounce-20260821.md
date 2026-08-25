# BL-1004 — architect SEND BACK: a legitimate cross-seat deferral is invisible to the two existing stall-alarm mechanisms, so it will trip a false "stuck parcel" alert during its own designed wait window

**Parcel:** cleaner commit `31c0981b88` (forwarding coder `19b28a1a84` unchanged),
merged into architect at `d27643df9`.

**Verdict:** SEND BACK to coder.

## Review completed first (Article 4.4 — full inventory before bouncing)

- **Dependency-rule hard gate (BL-259):** N/A for this parcel — zero files
  under `extension/` are touched (`git diff --name-only 25412a8f1..19b28a1a8 |
  grep '^extension/'` → 0). `dependency-gate.js` scopes to `extension/src` +
  `extension/media`; there is nothing in that scope to scan. CLEAN.
- **Co-change coupling (BL-255):** ran
  `node extension/out/tools/co-change-report.js` over all nine changed files.
  `specs/pipeline/steps/index.js` flags dozens of "SUSPECTED COUPLING" hits —
  expected hub-file noise (it is the step registry every ticket's acceptance
  file touches). `handoff_lib.bb` flags `ready_for_next_batch.bb` (9
  co-changes) as suspected coupling; checked whether the seat-affinity
  deferral should also wire into the BATCH claim path
  (`ready_for_next_batch.bb`, used by `cleaner`/`hardender`) — live
  `.swarmforge/roles.tsv` today has exactly one seat for every batch-mode
  role, so the deferral path is structurally unreachable there by the
  ticket's own invariant 3 (and the ticket's "seven single-seat stages"
  count already includes cleaner and hardender). Not a gap; noted, not
  bounced.
- **Declared invariants (1 bounded, 2 seat-identity-hidden, 3 single-seat
  unchanged):** all three executably encoded and re-verified live in this
  worktree, not just trusted from the commit message:
  - `bb swarmforge/scripts/test/seat_affinity_lib_test_runner.bb` → all
    assertions passed.
  - `bb swarmforge/scripts/test/bl1004_seat_affinity_property_runner.bb` →
    `ALL PROPERTIES HOLD` (400 draws, every coverage floor cleared:
    defer 64, cross-seat-aged 70, cross-seat-unreadable 69, self-affinity
    66, empty-sibling 59, non-handoff 72 — all ≥ the absolute floor of 20).
  - `node specs/pipeline/cli.js specs/features/BL-1004-….feature` → 5/5
    scenarios pass live (three Examples rows + scenarios 02/03).
  - `required_wiring` (index.js registration) confirmed by diff AND proven
    live: an unregistered handler throws on every scenario per
    `runtime.js`, and all 5 passed.
  - Regression sweep: `test_branch_claim_guard.sh`,
    `test_ready_for_next_no_promotion.sh`, `test_ready_for_next_rotate_home.sh`,
    `test_bl982_multi_seat_identity.sh` all PASS. `npx vitest run
    test/*Guard*.test.js` → 11 files, 81/81 passing, matching the commit's
    own claim exactly.
  CLEAN — no invariant-unencoded or invariant-violated finding.
- **Property-testing pass (undeclared properties on touched pure modules):**
  `seat_affinity_lib.bb` is the only pure module this parcel touches, and
  the coder's own property runner already covers it exhaustively
  (non-vacuity demonstrated via three break-then-restore runs in the commit
  message, floors absolute per the codebase's own reachability-floor rule).
  Nothing to add.
- **Constraints held:** no BL-1001 dependency; BL-994 untouched (none of its
  files appear in this parcel's diff); no hand-maintained seat-name list in
  production code (`stage-sibling-seats` reads `roles.tsv` via the existing
  BL-982 parse — the property runner's `seat-pool` and the JS steps'
  `KNOWN_PRIORS`/`KNOWN_ASKERS` are test-fixture/scenario-validation
  literals, not a production routing list).

## Defect — the deferral this ticket adds has no equivalent to the ambulance-hold snooze the codebase already established for exactly this class of problem

This codebase has an existing, working pattern for "a parcel is sitting
untouched in a mailbox on purpose — don't alarm on it": `ambulance-lib/
parcel-held?`, consumed by BOTH of the two stall-detection sweeps —
`flow_watchdog_lib.bb`'s `parcel-ambulance-held?` (feeds `evaluate-parcel-tier`'s
`ambulance-held?` arg, which mutes the tier via `:snoozed?`) and
`chase_sweep_lib.bb`'s `item-ambulance-held?`. BL-1004 introduces a SECOND,
independent "sitting untouched on purpose" state — the sibling-rework
deferral — and its own commit message and `seat_affinity_lib.bb`'s docstring
both describe it as "left untouched in the stage queue exactly like an
ambulance hold." But neither sweep learned about it: both hold predicates
key ONLY off `ambulance-lib/read-ambulance-state`, which has no knowledge of
a seat-affinity deferral decision.

Concretely, `swarmforge.conf`'s new `cross_seat_claim_deadline_ms` default is
1,800,000ms (30 min) — a deferred parcel is DESIGNED to sit that long before
any seat may claim it. `flow_watchdog_lib.bb`'s global-fallback
`default-warn-ms` is 900,000ms (15 min) — less than half the deferral
window. Verified live, not just read statically:

```
bb -e '
(load-file "swarmforge/scripts/flow_watchdog_lib.bb")
(println (flow-watchdog-lib/evaluate-parcel-tier 960000 900000 3600000 {} "test-parcel-id"))
'
:warn
```

At 16 minutes of age — still inside the deferral's own 30-minute design
window, behaving exactly as this ticket specifies — `evaluate-parcel-tier`
already returns `:warn` with no ambulance/snooze signal available to stop
it. `run-sweep!` (flow_watchdog_lib.bb:826-891) scans every role's `:new`
mailbox (line 848), including the `coder` stage row itself — which, per
BL-983, IS the stage queue a deferred parcel sits in — and on a non-`:none`
tier it calls the daemon's real `:emit-alarm!` adapter (line 882), a
human-visible Telegram/email alert, not a log line. `chase_sweep_lib.bb`'s
parallel `item-ambulance-held?` check (line 495-497, feeding the `held?`
used at line 521) has the identical gap for whatever chase/nudge threshold
applies to a stage's `new/` queue.

This is live now, not hypothetical: `.swarmforge/roles.tsv` already has two
seats on the `coder` stage today, this ticket exists because a rework
already landed on the wrong one (BL-994), and the very next bounce back to
`coder` will exercise this exact deferral path. A busy sibling seat taking
anywhere from 15 to 30 minutes to poll again is an entirely ordinary turn
length, not an edge case. The result: the swarm's own health-signal
machinery (the same chase/alarm telemetry Article 3.5's circuit breaker
watches) will fire false "stuck parcel" alerts for a parcel that is working
exactly as BL-1004 designed it to — undermining trust in those alerts and
risking an unwarranted `active_backlog_max_depth` throttle on a false
health signal.

## What is NOT the problem (do not over-correct)

- The claim-path decision itself (`seat_affinity_lib.bb`,
  `ready_for_next_task.bb`'s wiring) is correct and thoroughly verified —
  see the review-completed section above. Nothing there needs to change.
- The batch-path (`ready_for_next_batch.bb`) gap is a documented non-issue
  today (see co-change section) — do not wire deferral awareness in there
  as part of this fix; there is no multi-seat batch stage to protect yet.
- This is not a request to build a generic cross-cutting "held" abstraction
  refactoring ambulance's own predicate — `ambulance-lib/parcel-held?` is
  legitimately ambulance-marker-specific (verified by reading it); the fix
  is to OR a second, independent signal into the two sweep call sites named
  above, the same shape BL-679 used to add the ambulance signal in the
  first place.

## Remediation

At minimum, both of:

1. `flow_watchdog_lib.bb:866` — `held?` currently reads only
   `parcel-ambulance-held?`. OR in a BL-1004-deferral check for the scanned
   parcel (its `:role`, not `current-role`, since the sweep iterates every
   role from one daemon process — the sibling-lookup in `handoff_lib.bb`/
   `seat_affinity_lib.bb` is written from a single seat's own point of view
   today and will need a role-parameterized variant here).
2. `chase_sweep_lib.bb:495-497` (`item-ambulance-held?`, feeding `held?` at
   line 521) — the same OR.

Exact shape (a shared predicate the two call sites both consume vs. two
independent ORs) is an implementation choice, not dictated here. After
wiring it, confirm by fixture: a parcel deferred by BL-1004's own decision,
aged past `default-warn-ms` but still inside
`cross_seat_claim_deadline_ms`, must NOT reach `:emit-alarm!` in
`flow_watchdog_lib.bb` nor whatever nudge/chase `chase_sweep_lib.bb` emits
for an aged `new/` item.

— By architect.
