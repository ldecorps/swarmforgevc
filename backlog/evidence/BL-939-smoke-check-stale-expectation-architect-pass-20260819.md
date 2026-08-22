# BL-939 architect pass — 2026-08-19

## Scope

Received from cleaner as `merge_and_process cleaner 8038e7250d`. Reviewed
commit is `8038e7250d` (coder-authored; cleaner forwarded it unchanged —
`git show --stat 8038e7250d` is the sole commit in the merged range).

Files reviewed (`git show --stat 8038e7250d`):
- `swarmforge/scripts/smoke_check_stabilize_two_pack.sh` (production: fixed
  `expected=(coder cleaner)`, reworded failure message)
- `specs/pipeline/steps/bl939TwoPackSmokeCheckDropsCoordinatorWindowSteps.js`
  (new acceptance step handlers, drives the real script and the real
  `parse_config`)
- `specs/pipeline/steps/index.js` (registry wiring, one line)

No property-test file: this ticket's fix is a bash integration script, not
a pure TS/JS module, so BL-654's executability requirement does not apply
(same situation as BL-938, reviewed earlier today).

## Checks run (complete inventory, not first-failure-stop)

1. **Two-layer boundary / host-IO-ownership / webview-storage / secrets /
   integrate-not-fork** — not applicable: this is a maintenance fix inside
   `swarmforge/scripts/` (the maintained-fork territory Local Engineering
   Rule 2 covers), a static smoke check with no extension/webview/tmux code
   touched. Not a modification of SwarmForge's own runtime behavior, only
   of a check script that verifies wiring around it.
2. **Correctness read of the fix** — the old `expected=(coordinator coder
   cleaner)` compared against a profile's own `^window ` lines, which can
   never include `coordinator` since `parse_config` rejects that line
   outright (BL-243). `expected=(coder cleaner)` matches what the real
   profile can legally declare, in the same order the profile actually
   lists them (checked `swarmforge/profiles/stabilize-two-pack.conf`:
   `window coder ...` then `window cleaner ...` — order-sensitive
   comparison, confirmed it matches).
3. **Declared invariants (2, per the ticket YAML) — Invariants Review,
   independently re-verified, not read from the commit message**:
   - Invariant 1 (profile untouched) — confirmed via `git show --stat
     8038e7250d` myself: no `swarmforge/profiles/` path in the diff, and
     `grep -c '^window coordinator' swarmforge/profiles/stabilize-two-pack.conf`
     is still 0.
   - Also independently re-ran the rejection this invariant rests on:
     copied the real profile to a scratch file, appended `window
     coordinator claude coordinator`, pointed `SWARMFORGE_CONFIG` at it,
     and ran `parse_config` under zsh — exits 1 with "coordinator is
     reserved infrastructure and may not be declared as a window",
     confirming adding the line (the check's own old advice) really would
     have broken `./swarm`.
   - Invariant 2 (check corrected, never weakened) — independently built a
     scratch copy of the profile with `window cleaner` removed and ran the
     real smoke check against it: `SMOKE FAIL: profile defines roles
     [coder], expected [coder cleaner]...` — still fails, names the
     missing role. Not an always-pass.
   - Ran the fixed check against the real, unchanged profile:
     `/bin/bash swarmforge/scripts/smoke_check_stabilize_two_pack.sh`
     from repo root — `SMOKE PASS`.
4. **Non-encodability claim for the property-test obligation** — the
   commit message records BL-939's invariants as diff-scope constraints
   over a bash integration script rather than a pure function's input
   space, matching BL-938's identical carve-out from the same day.
   Independently agree: neither invariant is a property over generated
   inputs to a pure function — both are "is this file byte-identical" and
   "does this script still exit non-zero for a real gap", verified
   procedurally above rather than via fast-check.
5. **Dependency-rule gate (BL-259 hard gate)** — ran `node
   out/tools/dependency-gate.js` against the changed non-TS file; passes
   trivially (no TS import graph to violate). No forbidden edges.
6. **Co-change coupling (BL-255)** — ran `co-change-report.js` against both
   changed files. `smoke_check_stabilize_two_pack.sh`'s co-changes are all
   ≤2, under the suspected-coupling threshold. `specs/pipeline/steps/index.js`
   flags many SUSPECTED COUPLING entries — the same append-only-registry
   baseline noise already judged benign in prior passes (e.g. BL-909's
   evidence file): the file is a `require()` list plus one array push, with
   no logic that could hide an architectural edge.
7. **Property-testing pass (own section)** — no pure TS/JS module was
   touched (bash script only); no property-shaped gap to fill.
8. **Scope check** — the ticket's invariant 1 IS the scope boundary here
   (profile untouched); confirmed above. No other file outside the smoke
   check + acceptance layer was touched.
9. **Acceptance field format (BL-761 contract)** — `acceptance:` in the
   ticket YAML is a single-line pointer
   (`specs/features/BL-939-two-pack-smoke-check-stops-demanding-a-coordinator-window.feature`),
   not a block scalar.

## Tests re-run independently (all green)

- `/bin/bash swarmforge/scripts/smoke_check_stabilize_two_pack.sh` (repo
  root as target) → SMOKE PASS, all four checks OK.
- Scratch-copy rejection probe (invariant 1's premise) → `parse_config`
  exits 1, "coordinator is reserved infrastructure".
- Scratch-copy non-vacuity probe (invariant 2) → smoke check fails, names
  the missing `cleaner` role.
- Drove `specs/pipeline/runnerAdapter.js#runPipeline` directly against
  `specs/features/BL-939-two-pack-smoke-check-stops-demanding-a-coordinator-window.feature`
  with `specs/pipeline/steps/index.js` → 4/4 Gherkin scenarios pass (the
  3 named scenarios, one an Outline with 2 rows).

## Verdict

No architecture violation, no invariant violation, no correctness defect
found. Clean sweep — items: NONE. Forwarding to hardender.

By architect.
