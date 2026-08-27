# BL-650 — architect review pass — 2026-08-07

**Verdict: PASS.** No architecture violation, invariant violation, or coder-owned
correctness defect found. One spec-gap noted separately (item 6) — routed as a
`note` to specifier + coordinator per Article 4.4, not a bounce.

**Commit reviewed:** `3122a2ffc1` (coder, on top of `main` tip `5721579a`),
merged into this branch as this evidence commit's parent.

## Inventory

1. **Dependency-rule gate (`node extension/out/tools/dependency-gate.js
   <changed-files>`)** — RUN (node 22 via nvm; the pinned `depcruise` binary
   requires `^22||^24||>=26`, and this worktree's default node is 20.20.2).
   The parcel's 5 changed files (`specs/pipeline/steps/bl650…Steps.js`,
   `specs/pipeline/steps/index.js`, `swarmforge/scripts/flow_watchdog_lib.bb`,
   two `swarmforge/scripts/test/*.bb` files) are all outside `extension/src`
   and `extension/media` — the ruleset's forbidden-edge rules only match
   `^src/`/`^media/` paths, so this parcel has no in-scope surface for this
   gate. Confirmed with a full-repo scan (no args): reports pre-existing,
   unrelated `acyclic` violations among `telegram-front-desk-bot.ts` /
   `telegramCursorOperatorExec.ts` / `telegramCursorOperatorLiveness.ts`
   (introduced across BL-611/BL-814/BL-823, per `git log` on those files) —
   none touched by this parcel. N/A for this parcel, not skipped.

2. **Co-change / logical coupling (`node extension/out/tools/co-change-report.js
   <changed-files>`)** — RUN. The new step file shows only 1 co-change each
   with its natural siblings (own commit, first appearance). `flow_watchdog_lib.bb`
   and `flow_watchdog_test_runner.bb` both show `handoffd.bb` at 6-7 co-changes
   (SUSPECTED COUPLING) — the same pre-existing, documented lib/sweep-caller
   relationship BL-835's own architect pass already characterized as
   deliberate, not new. `specs/pipeline/steps/index.js`'s own row is dominated
   by near-universal churn (every ticket that adds a step handler touches this
   registration file) — expected noise for that file, not a signal. No action.

3. **Invariants review (3 declared, BL-654)** — all three have non-vacuous
   property tests authored by the coder in
   `swarmforge/scripts/test/bl650_flow_watchdog_active_time_property_runner.bb`,
   confirmed passing (`bb .../bl650_flow_watchdog_active_time_property_runner.bb`
   → `bl650_flow_watchdog_active_time_property_runner: ok`):
   - P1 effective-age-never-negative-never-exceeds-wall-no-double-subtract —
     matches invariant 1 exactly. **Independently re-verified non-vacuous**:
     patched `merge-and-sum-ms` to sum raw clipped lengths without merging
     overlaps (a real double-subtraction bug), re-ran the property runner —
     35 of 80 P1 trials failed against the independent sweep-line oracle
     (e.g. "got 0, oracle 846588"); reverted the patch, re-ran clean. The
     oracle-equality check (not just the clamp) is what caught it, confirming
     the runner's own claim that the clamp alone cannot.
   - P2 absent-or-unreliable-evidence-subtracts-nothing — matches invariant 2;
     three branches (no-evidence exact-equality, outside-span no-op, open
     swarm-stop unreliable-fallback-and-flagged) all demonstrably reached.
   - P3 tier-never-regresses — matches invariant 3; mirrors `run-sweep!`'s own
     ratchet (state written only on a non-`:none` verdict) across randomized
     multi-sweep sequences with fluctuating age/thresholds, including a
     retroactively-shrinking age. `decide-tier` itself is untouched by this
     ticket (confirmed via diff — zero lines changed in the function body) and
     `tier-decision-input-keys` is unchanged — the structural no-suppression
     guarantee (acceptance-04/05) is intact by construction, which is exactly
     what P3 and acceptance scenario 04 both independently confirm.

4. **Property-testing pass (undeclared properties on touched pure modules)** —
   the new pure surface (`merge-and-sum-ms`, `clip-interval-ms`,
   `provider-outage-intervals`, `resolve-open-ledger-interval`,
   `evaluate-effective-age`, `read-pack-aware-global-thresholds`) is covered by
   a combination of the example-based unit suite (`flow_watchdog_test_runner.bb`
   — dedicated disjoint/overlapping/nested/out-of-order/zero-length/clipped
   cases for `merge-and-sum-ms`, grouping/gap cases for
   `provider-outage-intervals`) and the three declared-invariant property
   tests above, which exercise `merge-and-sum-ms` and `provider-outage-intervals`
   indirectly through `evaluate-effective-age` against an independent oracle.
   No additional property-shaped gap found; none added.

5. **Correctness read** —
   - `evaluate-effective-age`: age source resolution mirrors `parcel-age-ms`
     exactly (shared `age-source-instant-ms` helper, fails closed to all-nil on
     unparseable headers). Effective age is clamped
     `(max 0 (min wall-age-ms (- wall-age-ms total-subtracted-ms)))` — verified
     this cannot go negative or exceed wall age for any subtraction total.
   - Open-interval resolution matches the ticket's own ruling exactly: open
     `control-pause` → resolved to `now-ms` (subtracted to sweep time); open
     `swarm-stop` → dropped from the subtraction and flagged
     `:unreconstructable?` (confirmed against `availability_ledger_lib.bb`'s
     own `fold-intervals` docstring: `end-ms nil` only ever occurs with
     `:provenance "open"`, and only `swarm-stop` can be `"inferred"` —
     `control-pause` closes only via a real `pause-end`, so it is never
     `"inferred"` with a nil end-ms; the dispatch on `end-ms` alone is safe).
   - Production wiring for the **ledger** (control-pause/swarm-stop) and the
     **pack-aware global thresholds** is live end-to-end: `run-sweep!` calls
     `availability-ledger-lib/fold` unconditionally (not adapter-gated) and
     `read-pack-aware-global-thresholds` replaced the old `read-thresholds`
     call outright — `handoffd.bb`'s only real caller
     (`flow-watchdog-sweep!`) needs no changes to pick both up, and none were
     made (confirmed via diff — `handoffd.bb` untouched by this commit).
   - `resolve-thresholds`, `read-thresholds` (old, still used by other
     callers per `flow_watchdog_test_runner.bb`), and `format-alarm-text`'s
     three new fields are all additive/optional — confirmed via the full
     pre-existing unit suite still `ALL PASS: flow_watchdog_lib.bb`, no
     backward-compat break.
   - Ran the acceptance pipeline directly:
     `node specs/pipeline/cli.js specs/features/BL-650-flow-watchdog-wall-clock-age-must-be-active-time.feature`
     → 11/11 scenarios pass (`# pass 11`, `# fail 0`), including the Scenario
     Outline (06) which asserts distinct, explicit alarm-outcome strings per
     pack type (no passthrough/binary check).
   - Ran `bb swarmforge/scripts/test/flow_watchdog_test_runner.bb` →
     `ALL PASS: flow_watchdog_lib.bb`.

6. **Spec gap (routed as `note`, not a bounce) — provider-outage evidence has
   no live production source.** The ticket's Shape item 1 (backed by the
   2026-07-26 operator ruling: "il faut tenir compte des outages indépendants
   de la swarm dans les calculs de temps effectifs") commits to subtracting
   provider-outage intervals from effective age. The pure capability is built
   and tested (`provider-outage-intervals`, wired through
   `evaluate-effective-age` and `run-sweep!`'s optional
   `:provider-outage-evidence-for` adapter), but `handoffd.bb`'s
   `flow-watchdog-sweep!` — the only real production caller — never supplies
   that adapter (confirmed: `handoffd.bb` has zero diff in this commit, and
   grep of the file shows no `:provider-outage-evidence-for` key anywhere).
   Per `run-sweep!`'s own docstring this is a documented, intentional
   default-to-no-evidence for "every pre-BL-650 caller" — but
   `flow-watchdog-sweep!` is not a pre-BL-650 caller left alone by choice, it
   is the ticket's own real target and it still gets zero provider-outage
   subtraction after this ships. Reading the ticket's own
   `stage_skip_reasons` ("bounded single-lib bb change") against the coder's
   own docstring ("reading a live pane or role transcript is environmental/
   impure and stays outside this lib, per this project's testability-boundary
   convention"), building a live pane/transcript scanner grouped by provider
   is plausibly its own ticket-sized slice (mirroring the BL-823/BL-650 split
   itself) rather than in-scope for this one — searched the codebase for an
   existing durable, queryable, timestamped provider-outage-interval store
   (`classify-provider-error`, `provider_auth_observe_lib.bb`,
   `operator_runtime.bb`'s `PROVIDER_LIMIT_REACHED`/`PROVIDER_AVAILABLE`) and
   found only per-call classification / in-memory episode state, nothing
   already shaped as `{:ts-ms :provider :text}` history. Given the ambiguity
   is about ticket SCOPE, not a defect in what was built against the written
   Gherkin acceptance (which the parcel satisfies in full, including scenario
   08's own subtraction/tracking/no-evidence assertions at the pure-function
   level), this is a spec gap, not a coder bounce: the acceptance criteria
   as written do not require live wiring, but the ticket's own prose intent
   does, and only the specifier/human can rule which. Sent as a `note`
   (priority `00`) to specifier and coordinator in this same pass,
   recommending a follow-up ticket to wire a real evidence source into
   `handoffd.bb` if the human wants provider-outage subtraction to actually
   fire in production.

7. **Substrate / out-of-scope guardrails** — diffed against the ticket's
   `out_of_scope` list (muting alarms during a pause, BL-647's dead-agent-events
   producer, redesigning enqueued_at/created_at semantics) — none touched.
   `decide-tier` confirmed byte-identical (zero lines in the diff touch its
   body). Working tree has one pre-existing untracked file
   (`swarmforge/scripts/operator_path_lib.sh`, matches paused BL-796) not
   created by this pass — left alone, not staged.

## Blocked checks

None. Every check above ran to completion.
