# BL-1004 — architect review (post-bounce refix): clean sweep, PASS to hardener

**Parcel:** coder refix `25e002b408` (cross-seat deferral now visible to both
stall sweeps), forwarded unchanged by cleaner at `fa3fb8fb7a`, merged into
architect at `00fed3401`.

**Verdict:** PASS to hardener.

## Review completed (Article 4.4 — full inventory before any verdict)

- **Dependency-rule hard gate (BL-259):** N/A — `git diff --name-only
  159b677c1..fa3fb8fb7a` touches only `swarmforge/scripts/*.bb`,
  `swarmforge/scripts/test/*`, and `swarmforge/swarmforge.conf`. Zero files
  under `extension/src` or `extension/media`, the gate's scope. CLEAN.
- **Co-change coupling (BL-255):** ran
  `node extension/out/tools/co-change-report.js` over the full ticket
  fileset (`git diff --name-only 25412a8f1..fa3fb8fb7a`, 14 files).
  `specs/pipeline/steps/index.js` and `swarmforge/scripts/handoffd.bb` are
  the dominant flags across every touched `.bb` lib — expected hub-file
  noise (index.js is the step registry every ticket touches; handoffd.bb is
  the daemon that calls `run-sweep!`/`sweep-role-inbox!` in both libs).
  Verified this is genuinely not a gap, not just asserted: grepped
  `handoffd.bb` for both call sites (`chase-sweep-lib/run-sweep!` line 1709,
  `flow-watchdog-lib/run-sweep!` line 2099) — neither call's arity or
  argument list changed, the new deferral logic is entirely internal to the
  two libs' own `held?` computation. Ran both dedicated wiring suites live:
  `test_handoffd_flow_watchdog_wiring.sh` (2/2 PASS — real daemon sweep
  records a warn-tier entry and emits a real Telegram alarm) and
  `test_handoffd_chase_sweep_wiring.sh` (3/3 PASS). No coupling gap.
- **Declared invariants (1 bounded, 2 seat-identity-hidden, 3 single-seat
  unchanged):** re-verified live against the NEW code this refix adds
  (`seat_affinity_lib.bb`'s `deferral-hold?`, `handoff_lib.bb`'s
  `stage-seat-worked-task-sets`, and both sweep call sites), not just
  re-trusted from the prior pass:
  - `bb swarmforge/scripts/test/seat_affinity_lib_test_runner.bb` → all
    assertions passed.
  - `bb swarmforge/scripts/test/bl1004_seat_affinity_property_runner.bb` →
    `ALL PROPERTIES HOLD`, 400 draws; the addendum generatively ties
    `deferral-hold?` to `rework-claim-decision` (hold-coverage: held 55,
    released-aged 56, released-unreadable 59, no-worker 61, all-workers 63,
    single-seat 56, non-handoff 50 — all comfortably above the absolute
    floor of 20).
  - Invariant 2 (no seat identity escapes): read `stage-seat-worked-task-sets`
    directly — it returns a vector of task-name SETS with the seat/role
    identity discarded (`mapv` over `worked-task-names-in`, never
    surfacing `:role`), and grepped both sweep libs' new code for any
    string/println/alarm-text construction near the new predicates — none
    references a seat id. Structurally holds.
  - Invariant 3 (single-seat unchanged): `deferral-hold?` requires BOTH a
    seat that worked the task and a seat that did not
    (`seat-worked-task-sets`); a single-seat stage yields exactly one set,
    making that conjunction unsatisfiable by construction. Confirmed
    generatively (property runner's `single-seat` coverage bucket, 56
    draws, all correctly non-holding).
  - `required_wiring` (index.js registration): unchanged by this refix
    (not in the `159b677c1..fa3fb8fb7a` diff); re-confirmed live via the
    acceptance run below rather than assumed stable.
  CLEAN — no invariant-unencoded or invariant-violated finding.
- **The bounced defect itself, re-verified live, non-vacuity self-checked**
  (not taken on the commit message's word): read the diff of
  `flow_watchdog_lib.bb`'s `run-sweep!` — `held?` is now `(or
  (parcel-ambulance-held? …) (and (= :new (:mailbox parcel))
  (parcel-deferral-held? …)))`, gated to `:new` mailbox only (an
  `in_process` parcel is already claimed, past deferral — correct, matches
  the remediation). Same shape in `chase_sweep_lib.bb`'s `held?`. I
  independently broke the fix (temporarily reverted the `held?` OR back to
  bare `parcel-ambulance-held?` in my own worktree, never committed) and
  re-ran `flow_watchdog_test_runner.bb`: `deferral-perimeter-01` and its
  companion durable-state assertion both went RED, reproducing exactly the
  bounce's 16-minute false `:warn` scenario. Restored the file
  (`git diff` clean afterward) and re-ran: `ALL PASS: flow_watchdog_lib.bb`.
  The five dedicated `deferral-perimeter-01..05` scenarios in
  `flow_watchdog_test_runner.bb` and the two BL-1004 scenarios (15, 16) in
  `test_chase_sweep.sh` cover exactly the cases the bounce named: held
  inside window (01/15), not a blanket mute when no seat worked it (02/16),
  released past deadline (03), never holds when every seat worked it (04),
  and the `:new`-only gate — an `in_process` parcel still alarms (05).
- **Property-testing pass (undeclared properties on touched pure modules):**
  the only new pure logic this refix adds (`deferral-hold?`) is already
  covered by the property-runner addendum described above, generatively
  tied to the claim-path decision it mirrors. Nothing further to add.
- **Constraints held:** batch path (`ready_for_next_batch.bb`) deliberately
  left unwired, per the bounce's own do-not-over-correct instruction — no
  multi-seat batch stage exists to protect. No hand-maintained seat-name
  list introduced (`stage-seat-worked-task-sets` reads `roles.tsv` via the
  existing `load-all-roles`/`seat-stage`).

## Broader regression, run live

- `test_branch_claim_guard.sh`, `test_ready_for_next_no_promotion.sh`,
  `test_ready_for_next_rotate_home.sh`, `test_bl982_multi_seat_identity.sh`
  — ALL PASS.
- `node specs/pipeline/cli.js
  specs/features/BL-1004-a-rework-is-claimed-only-a-seat-that-can-work-it-safely.feature`
  — 5/5 (three Examples rows + scenarios 02/03).

## Verdict

No architecture violation, no invariant violation, no correctness defect
found. PASS to hardener.

— By architect.
