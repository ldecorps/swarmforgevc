# BL-920 architect pass — 2026-08-19

## Scope

Received from cleaner as `merge_and_process cleaner 486fb4b0d2`. The commit
is coder's own (`git show --stat 486fb4b0d2` — "By coder." trailer); cleaner
forwarded it unchanged (no separate cleaner commit in the merged range).

Files reviewed (`git show --stat 486fb4b0d2`):
- `swarmforge/scripts/master_main_reconcile_lib.bb` (pure: new
  per-episode tick counter + escalation predicate)
- `swarmforge/scripts/handoffd.bb` (wiring: new `:escalate!` adapter,
  threshold resolver)
- `swarmforge/scripts/test/master_main_reconcile_lib_test_runner.bb`
- `swarmforge/scripts/test/master_main_reconcile_lib_property_runner.bb`
- `swarmforge/scripts/test/test_handoffd_master_main_reconcile_wiring.sh`
- `swarmforge/swarmforge.conf` (new commented-out config knob)

## Checks run (complete inventory, not first-failure-stop)

1. **Pure/impure split (Article 1.5 / local-engineering Architecture Rule
   7)** — all new logic in `master_main_reconcile_lib.bb`
   (`parse-escalation-threshold`, `next-block-state`, `escalation-due?`,
   `escalation-reason`/`-telegram-text`/`-email-subject`) is pure: string
   parsing, map transforms, string building — no I/O. The one impure new
   function, `master-main-reconcile-escalate!` (Telegram-outbox `spit` +
   `daemon-alarm-lib/send-configured-email!`), lives in `handoffd.bb` and is
   injected into `sweep!` as `:escalate!`, exactly matching the pre-existing
   `:rev-counts!`/`:merge!`/`:surface!` adapter pattern. `sweep!`'s own
   signature gained a `threshold` parameter (also resolved and passed in
   from `handoffd.bb`, never hardcoded in the lib).
2. **Reuses the established operator-alert channel, builds no second one**
   — `master-main-reconcile-escalate!` is structurally identical to the
   existing `send-open-slot-escalation-alert!` (BL-798): same
   `telegram-reply-outbox.jsonl` / `OPERATOR` threadId, same
   `daemon-alarm-lib/send-configured-email!` call with the same shared
   `escalation-email-missing-key-warned?` atom (confirmed by grep — 7 call
   sites all close over the one atom). Satisfies the ticket's own
   out-of-scope line ("reuse a path that already reaches the human; do not
   build a second one").
3. **Correctness read of the persistence/escalation state machine** —
   traced `next-block-state`/`escalation-due?`/`handle-blocked!` by hand:
   - Same reason as the previous tick → `:ticks` increments, `:escalated`
     carried forward unchanged (never re-escalates once true, since
     `escalation-due?` requires `(not escalated)`).
   - A different reason (including no prior state) → fresh episode:
     `{:ticks 1 :escalated false}`, and `handle-blocked!`'s `first-tick?` is
     computed from the OLD `(:surfaced state)` before the update, so the
     coordinator `:surface!` note still fires exactly once per episode,
     unchanged from pre-BL-920 behavior — additive, never replaced
     (invariant 1).
   - `:up-to-date` and a successful `:should-reconcile` both `write-state!`
     `{}` (full clear — surfaced reason, ticks, AND escalated), so a later,
     unrelated block is judged fresh (invariant 2). Confirmed by reading the
     `case` branches directly, not just the diff hunk.
   - State round-trips through `read-json ... true` (keywordizes keys) /
     `json/generate-string`, so `:escalated false` and missing `:ticks` on
     an old-format (pre-upgrade) state file both degrade safely (`(not
     nil)` reads as "not escalated", `(fnil inc 0)` starts a fresh count) —
     no crash, no false-escalate on a mid-upgrade state file.
   - `parse-escalation-threshold` degrades absent/zero/negative/malformed
     to the documented default (3), identical shape to
     `chase-sweep-lib/parse-open-slot-escalation-threshold`; only a
     deliberately-configured `threshold=1` collapses "first tick" and
     "escalate" into the same tick, an operator-chosen edge case, not a
     default-path defect.
4. **Declared invariants (2, per the ticket YAML) — Invariants Review**:
   - Both invariants are encoded as ONE generator-based property
     ("invariants 4 & 5", continuing BL-891/BL-919's numbering) in
     `master_main_reconcile_lib_property_runner.bb`, coder-authored, driving
     randomized tick sequences (dirty/conflict/resolved, weighted per
     BL-654's generator-reach guidance) against a real state dir, checked
     against an independent oracle (`oracle-tick-step`) that never calls
     `next-block-state`/`escalation-due?` itself.
   - Non-vacuity confirmed by inspection AND by re-running: two deliberate
     mutants (`mutant-escalates-immediately!` for invariant 1,
     `mutant-resolve-doesnt-clear-state!` for invariant 2) each proven to
     trip the oracle.
   - The real-git half is separately proven end-to-end by the wiring test
     (new scenario: a real daemon tick loop against a real git repo,
     confirming `master-main-reconcile-escalation dirty` is logged and the
     Telegram outbox file actually receives a `dirty-blocked` line, additive
     to the first-tick coordinator note already asserted earlier in the
     same script).
   - Ran independently, all green (below).
5. **Dependency-rule gate (BL-259 hard gate)** —
   `node extension/out/tools/dependency-gate.js` against the parcel's 6
   changed files: all under `swarmforge/scripts/` or `swarmforge/`, none
   under `extension/src/`. The tool errors immediately (`Can't open
   'swarmforge/scripts/master_main_reconcile_lib.bb' for reading`) —
   depcruise's scan root is `extension/`, scoped to the TypeScript
   module-boundary ruleset, no applicable rule for Babashka files. Same
   structural N/A as the BL-919/BL-891 architect passes on this same file.
6. **Co-change coupling (BL-255)** — ran `co-change-report.js` against the
   two non-test changed files.
   - `master_main_reconcile_lib.bb` co-changes only with its own sibling
     test files and `handoffd.bb` — tight, expected, intentional coupling,
     nothing new.
   - `handoffd.bb` co-changes broadly (dozens of files) — its
     well-documented baseline as the daemon hub every sweep wires into (same
     observation as every prior architect pass touching this file); nothing
     new or cross-boundary (no webview/UI, no `extension/src/` beyond the
     pre-existing baseline) introduced by this parcel specifically.
7. **Two-layer boundary / host-IO-ownership / webview-storage / secrets /
   integrate-not-fork** — not applicable: no tile/webview code touched, no
   VS Code extension code touched at all. `swarmforge/` is this project's
   own maintained fork; this is ordinary fork-maintenance extending an
   existing daemon sweep, not a modification of an externally-driven,
   unmodified SwarmForge instance.
8. **Property-testing pass (own section)** — the touched pure module's new
   helpers (`parse-escalation-threshold`, `next-block-state`,
   `escalation-due?`, the three text builders) are all exercised either by
   direct exhaustive unit tests (`parse-escalation-threshold`'s six
   degrade-to-default cases) or transitively by the same sequence-based
   generator that encodes the two declared invariants. No additional
   undeclared-property gap found; no new property test added, none needed.

## Tests re-run independently (all green)

- `bb swarmforge/scripts/test/master_main_reconcile_lib_test_runner.bb` →
  ALL TESTS PASS
- `bb swarmforge/scripts/test/master_main_reconcile_lib_property_runner.bb`
  → 5 non-vacuity mutants confirmed (3 pre-existing + 2 new), 500/500 runs,
  ALL PROPERTIES HOLD
- `bash swarmforge/scripts/test/test_handoffd_master_main_reconcile_wiring.sh`
  → 17/17 scenarios PASS, including the new BL-920 escalation scenario
  against a real daemon tick loop and real git repo.

## Verdict

No architecture violation, no invariant violation, no correctness defect
found. Forwarding to hardender.

By architect.
