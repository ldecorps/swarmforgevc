# BL-1182 — architect bounce

Architect, 2026-08-30. Reviewed cleaner's `d3c9fef935` (merge of coder's
`1b969296068`, no changes made by cleaner).

## Checks that passed clean

- `node extension/out/tools/dependency-gate.js` (full-repo AND the parcel's
  own `extension/src`/`extension/test` files) — PASSED, no forbidden edges.
- `node extension/out/tools/co-change-report.js` — every flagged pair is
  within the pre-existing model-steward subsystem; no unexpected coupling.
- Re-ran the coder's headline claims directly, all green:
  `model_steward_trial_lib_test_runner.bb` (26 assertions),
  `test_model_steward_trial_cli.sh` (21 checks),
  `bl1182_trial_lifecycle_property_runner.bb` (500 runs/invariant, matching
  coverage numbers), `extension/test/trialBoundaryMemory.test.js` (9/9),
  BL-1182 acceptance (5/5).
- Invariants Review (BL-633/654): all three declared invariants have live,
  non-vacuous property tests in the Babashka property lane, reach floors
  constructed (small-alphabet scores for ties, derived re-nomination draws,
  `nil` cost class included), each shown to fail when its invariant is
  deliberately broken.
- Read `model_steward_trial_lib.bb` in full: the pure state machine
  (`nominate`/`decide`/`assess`/`boundary-for`) is correct, reuses
  `model_factory_lib/cost-class-rank` and `assignment-eligible?` rather than
  restating them, and the transfer-before-persist ordering in
  `model_steward_cli.bb` (`run-trial-nominate`/`run-trial-assess`) is exactly
  as documented — verified by reading the call order, not just the prose.

## D1 — `permanent-for-role`'s first (and documented-primary) clause is dead code across every real CLI invocation (send-back)

`model_steward_cli.bb`'s `permanent-for-role` is documented as resolving in
this order: (1) `trials[:permanent role]` — what the trial ledger itself
recorded at the last promotion/revert — (2) ModelFactory's assignment
overlay, (3) a bootstrap from the top certified recommendation. The
docstring is explicit that clause 1 must win, and explains why at length
(the "design decision that only showed up by running it").

Clause 1 never actually matches. `model_steward_store.bb`'s `read-trials!`
parses JSON through `composite-safe-key-fn`, which **keywordizes any object
key with no `/`** — so a role name like `"coder"`, written as a string key
under `trials[:permanent]`, comes back as the keyword `:coder`. `read-trials!`
already re-stringifies this exact hazard for `:active` and `:losers`
(`(update :active (fn [m] (into {} (map (fn [[k v]] [(name k) v])) ...)))`)
but the same fix was never applied to `:permanent`. Every CLI invocation is a
fresh `bb` process, so this round-trip happens on every command after the
one that wrote it — there is no in-process case where clause 1 can ever be
exercised in production use.

Reproduced directly (fresh `bb -e`, isolated `MODEL_STEWARD_STATE_DIR`):

```
raw trials permanent map: {:coder {:provider anthropic, :model perm-model, :cost_class medium}}
get-in with string role: nil
```

**Concrete behavioral consequence**, reproduced end-to-end against the real
CLI (registry + assignment-overlay fixtures, `MODEL_STEWARD_MEMORY_TOOL`
stubbed to succeed):

1. `trial nominate cerebras/trial-a --role coder`, then `trial assess` →
   promotes (9 > 7). `trials.json`'s `permanent.coder` is now correctly
   `cerebras/trial-a`.
2. Something else writes `ModelFactory`'s assignment overlay for `coder`
   directly to a third model (`openai/drift-model`) — exactly the kind of
   external reassignment clause 1 exists to take precedence over, since the
   overlay does not know about the trial ledger's own adjudication.
3. `trial nominate cerebras/trial-b --role coder`:
   ```
   trial armed role=coder model=cerebras/trial-b permanent=openai/drift-model ends=...
   ```
   The CLI reports (and records into `trial-b`'s own `:permanent` field) the
   drifted overlay value, not `cerebras/trial-a` — silently violating the
   function's own documented precedence.

This is not cosmetic: `assess` reverts a losing trial by writing the seat
back to `(:permanent trial)` (`model_steward_trial_lib.bb`'s `assess`,
`seat = (select-keys permanent ...)` on the revert branch). If `trial-b`
above later loses, the seat is written back to `openai/drift-model` — a
model the trial ledger never adjudicated as permanent for this role — rather
than to `cerebras/trial-a`, the model the lifecycle's own history says should
be there. A losing trial can silently install whatever the overlay happened
to drift to.

**Remediation**: apply the same re-stringify `read-trials!` already uses for
`:active` and `:losers` to `:permanent`:
```clojure
(update :permanent (fn [m] (into {} (map (fn [[k v]] [(name k) v])) (or m {}))))
```
Add a case to `model_steward_trial_lib_test_runner.bb` or the shell test that
round-trips `write-trials!`/`read-trials!` through disk (not just in-process)
and asserts `permanent-for-role` (or an equivalent direct check on
`trials[:permanent]`) still resolves by STRING role name afterward — the
existing property/lib tests never write-then-read through JSON, which is
exactly why this shipped green.

## D2 — dangling evidence-file reference in the property runner's own comment (minor, same bounce)

`bl1182_trial_lifecycle_property_runner.bb`'s header comment says "Non-vacuity
is proven by breaking each invariant and recording the result - see
`backlog/evidence/BL-1182-property-non-vacuity-20260830.md`." That file does
not exist anywhere in this parcel or on `main`; the actual non-vacuity table
is in `backlog/evidence/BL-1182-day-long-trial-lifecycle-20260830.md` (the
main evidence file). Not a functional defect, but a dangling pointer a future
reader will chase and not find — fix the comment to name the file that
actually carries the table, or remove the separate-file claim.

Both items travel in one bounce (Article 4.4): D1 is the correctness defect
that decides this send-back; D2 rides along in the same inventory.
