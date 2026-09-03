# BL-1337 — architect bounce (2026-09-03)

## Review pass completed before this bounce (Article 4.4 — complete inventory)

- Merged cleaner `93ccca2316` (coder `922078d70f`) into architect worktree.
  Clean fast-forward, no conflicts.
- `required_wiring` (`bob_starting_cast_lib.bb::apply-via-modelfactory-overlay`):
  confirmed present, 2 occurrences. Confirmed the gate is a new arity on the
  SAME function — the one-arg arity (BL-1181's own call site) is byte-for-byte
  unchanged; the two-arg arity adds the runnable-or-refuse gate. No second
  door.
- Read `generate-cast-from-profile`/`handshake-role`/`candidate-verdict`: each
  seat walks its ranked candidates and takes the first passing provider
  allowlist, quality floor, registry eligibility (`assignment-eligible?`) AND
  host reachability (an injected predicate) in that order, keeping every
  rejected candidate's verdict for the evidence note. A seat nothing can
  staff produces no cast entry (never a silent substitution or omission) —
  matches invariant 2.
- Read `bob_starting_cast_cli.bb`'s `host-reachable?`: checks only whether a
  named env var is non-blank, never reads or forwards the value; a provider
  not in the map is NOT assumed reachable (fails closed). Matches invariant 3
  structurally.
- Confirmed "propose, do not silently install": `run-profile-apply` writes
  through `model_factory_store/write-assignment-overlay!`, the SAME gitignored
  overlay file BL-1181's apply path already writes — read only by a later
  cold-apply/relaunch step, never a direct pane mutation.
- `bb swarmforge/scripts/test/bl1337_profile_cast_test_runner.bb` — ALL PASS.
- `run_acceptance.sh specs/features/BL-1337-…feature` — 7/7 pass, including
  the invariant-3 no-credential-material scenario.
- No regression: `bb swarmforge/scripts/test/bob_starting_cast_test_runner.bb`
  — ALL PASS; `bb swarmforge/scripts/test/model_steward_test_runner.bb` — ALL
  PASS; `run_acceptance.sh specs/features/BL-1181-…feature` — 3/3 pass.
- Dependency-rule gate (BL-259), scoped and full-repo: PASSED, no forbidden
  edges.
- Co-change report (BL-255): all reported co-changes at frequency 1 — no
  suspected coupling.
- Invariants 2 and 3's property tests have no reach-floor risk: invariant 2's
  fixture is constructed so every candidate scores below the floor by
  construction (deterministic, always unstaffable); invariant 3 has no reach
  counter at all (a single fixed run, asserted directly).

## D1 — invariant 1's reach floor is drawn by luck, not by construction

- **File**: `extension/test/bl1337ProfileCastInvariants.property.test.js`,
  test `BL-1337/BL-654 invariant 1: runnable only when every seat passed BOTH
  bars` (lines 129–167).
- **Class**: test-flakiness / non-vacuity gap — the third occurrence of this
  exact shape this session (BL-1345's D1, BL-1352's D1; both were fixed by
  enumerating the arm as an explicit loop case instead of leaving it to a
  draw).
- **Blamed role**: coder (BL-654: property authorship rests with the coder,
  first pass).
- **Failure scenario**: `reach.runnable` is only incremented when
  `expectRunnable` is true, i.e. when EVERY unique seat drawn (1–3 roles, each
  with 1–4 candidates) has at least one candidate that is simultaneously
  `certified`, `reachable`, and scores at or above the drawn `floor`
  (0, 0.5, or 0.9). Both `certified` and `reachable` are independent 50/50
  boolean draws per candidate, so across 12 runs it is a real, measurable
  possibility that no draw produces a fully-staffable cast, and the closing
  `assert.ok(reach.runnable > 0, 'never reached a fully staffable cast')`
  fails.
- **Reproduction**: ran `npx vitest run --config vitest.properties.config.mjs
  bl1337ProfileCastInvariants` in a loop, 40 total runs — **7/40 failed**
  (17.5%), every failure on the same `never reached a fully staffable cast`
  assertion. Invariants 2 and 3 were stable across all 40 runs.
- **Consequence if forwarded unfixed**: `npm run test:properties` is a real
  gate the hardener and QA will both run; this ships them a ~1-in-6
  intermittent red on a file they don't own fixing.
- **Remediation pointer**: the same fix BL-1345/BL-1352 used — choose the
  target scenario (fully-staffable vs. blocked-by-registry vs.
  blocked-by-host) as an enclosing-loop CASE rather than leaving it to
  chance. For example: enumerate `for (const shape of ['allPass',
  'oneRegistryFail', 'oneHostFail'])` and construct each seat's candidate
  list to deterministically produce that shape (an all-certified-all-
  reachable-above-floor candidate for `allPass`; one seat forced with only a
  non-certified above-floor candidate for `oneRegistryFail`; one seat forced
  with only an unreachable above-floor candidate for `oneHostFail`), so all
  three reach counters are guaranteed non-zero by construction rather than by
  luck. `blockedByRegistry`/`blockedByHost` are less exposed than `runnable`
  (each only needs ONE seat among up to 3 to hit, vs. `runnable` needing
  EVERY seat to hit simultaneously) but the same remedy fixes all three at
  once.

## Nothing else found

D1 is the sole defect. The production code (both library functions and the
CLI adapter), invariants 2 and 3, the unit runner, the acceptance feature,
and the BL-1181/model-steward regression suites are all clean and do not
need to be re-run once D1 is fixed, but the coder should re-run
`npm run test:properties` several times (not once — the failure is
probabilistic, ~17.5% per run) before forwarding again.

## Action taken

Recorded via `record-bounce.js` and sending `git_handoff` back to coder,
naming this evidence file and the failure class.
