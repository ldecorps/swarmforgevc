# BL-1340 — hardener pass (20260902)

Received: architect commit `de23548030` (cleaner `e5dc8849ea`, forwarding
coder's three-part fix per human ruling A), unchanged.

## BL-149 cooldown gate

`promotion_gates_lib.bb`, `promote_and_route_next.sh`,
`acceptance_contract_gate_lib.bb`, `acceptance_pointer_gate_lib.bb`,
`specs/pipeline/steps/bl626PromotionGateSteps.js` — all **run** (host
quiet, load 2.5-5.5/20 cores throughout the pass).
`pre_qa_gate_gather_lib.bb` — skip-cooldown (still churning).

## Non-vacuity check on the property test (beyond architect/cleaner's
flakiness analysis)

Architect and cleaner both independently computed reach probability and
ran the suite 4-5x to rule out flakiness, but neither demonstrated the
property actually CATCHES a real regression. Reverted
`acceptance-executable-refusal`'s core admit condition (`(and
(draft-pointer? raw) (pins-draft-conversion? content))` → `(and
(draft-pointer? raw) false)`, i.e. the pre-BL-1340 behavior of refusing
every draft regardless of pin) and re-ran the property test: 2 of 3
failed exactly as expected (invariant 1's self-converting-admitted
assertion, and its own reach-floor assertion). Restored, byte-identical
`git diff`, re-ran clean.

## Hand-authored mutation sweep, `promotion_gates_lib.bb` (BL-472: no
Stryker for Babashka)

The ticket's own `promotion_gates_lib_test_runner.bb` additions already
cover `pins-draft-conversion?` and `acceptance-executable-refusal`
thoroughly (self-converting admitted, parked refused by name with full
reason-text checks, unrelated `required_wiring` entry not mistaken for a
pin, pinned-but-missing-file still refused). Two independent probes
beyond the existing suite, run directly (not via mutation, since these
confirm correct behavior rather than find gaps):

- A `required_wiring:` block naming an unrelated anchor, followed by a
  `notes:` field that happens to mention `specs/pipeline/steps` in prose
  — confirmed `pins-draft-conversion?` returns `false` (the mention does
  not leak past the block boundary).
- `required_wiring:` present with no indented lines under it (empty
  block) — confirmed returns `false`.

One hand-mutation attempted (removing the early `false` return when the
`required_wiring:` block ends, replacing it with continuing the scan)
survived, but is an **equivalent mutant**: the mutated branch still
resets `inside?` to `false` before continuing, and nothing after the
block boundary can ever re-set `inside?` to `true` (that requires a
second `required_wiring:` top-level key, invalid YAML), so the final
answer is identical for every real input. Not pinned with a test —
would assert implementation trivia (BL-234 class).

## Real gap found and closed: declared ordering in `acceptance_contract_gate_lib.bb`

The doc comment states `declaration-draft` is "checked BEFORE the step
resolution below on purpose", and the architect's own evidence
confirmed this ordering by reading the source ("ordered ahead of
`wait-bound-hit?`"). Hand-mutated the `cond` to swap the
`declaration-draft` and `wait-bound-hit?` clauses: **survived** the full
existing test suite — no test combined both conditions being true, so
nothing observed which one wins. Both branches fail closed with exactly
one finding either way (the ticket is still refused regardless of
order), but the SPECIFIC finding text differs: draft-first tells the
human "convert your draft"; wait-bound-first reads as a transient
infrastructure timeout, which would send them chasing the wrong fix.
Added a test constructing both conditions simultaneously, asserting the
draft finding wins. Re-verified the swap mutant is now killed, isolated
to exactly the new test, before restoring
(`swarmforge/scripts/acceptance_contract_gate_lib.bb` diff empty
afterward).

## Mutation manifest re-stamp (flagged by both architect and cleaner as
out of their scope — Guardrails forbids hand-editing a manifest)

`specs/features/BL-626-promotion-gate-rejects-unmaterialized-feature-draft.feature`'s
stamp covered the pre-amendment scenario set (dated 2026-08-25, one
scenario). Ran
`specs/pipeline/scripts/run_gherkin_mutation.sh <feature> <fresh mktemp
under ./tmp/> specs/pipeline/steps/index.js hard` (host quiet,
load 5.57/20 cores) — the ticket's one `Scenario Outline:` (`a candidate
with no executable acceptance is refused by name`) mutated cleanly:
6/6 mutants killed, 0 survived, 0 errors. Stamp and manifest rewritten by
the tool itself, never hand-edited. Work dir removed after the run
(`rm -rf ./tmp/bl626-mutation-*`), never `.` and never a tracked path
(BL-1224 lesson).

## Verification (all green)

- `bb swarmforge/scripts/test/promotion_gates_lib_test_runner.bb` — ALL PASS
- `bb swarmforge/scripts/test/acceptance_contract_gate_lib_test_runner.bb` — ALL PASS (was N assertions, +1 new)
- `bb swarmforge/scripts/test/promotion_gates_cli_test_runner.bb` — ALL PASS
- `bb swarmforge/scripts/test/pre_qa_gate_gather_lib_acceptance_contract_test_runner.bb` — ALL PASS
- `bash -n swarmforge/scripts/promote_and_route_next.sh` — syntax OK
- `bash specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-626-promotion-gate-rejects-unmaterialized-feature-draft.feature`
  — 10/10 (re-ran after the manifest re-stamp too)
- `npm run test:properties -- test/bl1340SelfConvertingDraftInvariants.property.test.js` — 3/3
- Full unit suite (`npx vitest run`, no exclusions): 571 files, 9899
  tests, 9874 passed / 25 failed — the exact same pre-existing,
  already-ticketed standing reds documented throughout this session.
  Zero new failures. (`test_promote_and_route_next_priority.sh`'s own
  pre-existing red — a fixture missing `daemon_cycle_guard_lib.bb`,
  BL-967-era — independently reproduced and confirmed pre-existing, same
  as coder/cleaner/architect all found.)

## CRAP / DRY

No production TypeScript file changed by this ticket (only a property
test, excluded from CRAP/DRY per the shared property-test-separation
rule). Babashka has no CRAP/DRY tooling wired (BL-472 deferred), gated
by its own unit suite only, green throughout.

## Orphan check

`pgrep -fl 'node --test|stryker'` scoped to this worktree: clean.
`git status --short`: only the intended diff plus the same two
pre-existing untracked files noted throughout this session.

## Verdict

One real gap found and closed (declared-but-unverified ordering
guarantee in the documenter->QA backstop). Mutation manifest re-stamped
clean. No other defect. Forwarding to documenter.

By hardener.
