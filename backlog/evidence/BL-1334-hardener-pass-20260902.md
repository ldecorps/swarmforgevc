# BL-1334 — hardener pass, 2026-09-02

Reviewed commit `39a815e605` (architect clean sweep), merged into hardender.
Real, security-critical production change: `is_qa_ancestor.sh` (the ONE
shared QA-approval predicate, BL-925 invariant 2) gains a land-replay
approval path, plus `land_step_lib.bb`/`land_step_cli.bb` writing the new
`.swarmforge/land-approvals/*.jsonl` store and `build_freshness_cli.bb`
deferring to the shared predicate.

## Load / process hygiene
- `uptime`: load average ~1.6-2.2 on 20 cores — quiet.
- `pgrep -fl 'node --test|stryker'`: no strays before starting.

## Verification (independent re-run, all green)
- `bb swarmforge/scripts/test/land_step_lib_test_runner.bb` — ALL PASS.
- `bb swarmforge/scripts/test/build_freshness_lib_test_runner.bb` — ALL
  TESTS PASSED.
- `bash swarmforge/scripts/test/test_is_qa_ancestor_land_replay_store.sh`
  — 10/10 pass before my addition (see below), 11/11 after.
- `bash swarmforge/scripts/test/test_land_step_records_approval.sh` — 9/9.
- `bash swarmforge/scripts/test/test_build_freshness_land_replay_approved.sh`
  — 8/8.
- `bb swarmforge/scripts/test/bl1334_land_replay_approval_property_runner.bb`
  — 48/48, exhaustive.
- `node specs/pipeline/cli.js
  specs/features/BL-1334-a-landed-replay-is-qa-approved-when-it-lands.feature`
  — 5/5.
- Regression: `test_is_qa_ancestor_expedite_store.sh`,
  `test_is_qa_ancestor_yaml_store.sh`, `test_pipeline_code_on_main_guard.sh`
  — all pass, no disturbance to sibling approval paths.
- No TS/JS production source touched (`git diff --stat main...HEAD --
  'extension/src/*.ts'` empty) — CRAP/DRY N/A for this parcel.

## Hand-authored mutation sweep — Babashka/shell has no wired mutation tool
`is_qa_ancestor.sh` defines the single approval predicate three other
consumers trust (BL-925 invariant 2), so this pass went beyond the
mutation_cost:low default and hand-mutated `source_is_approved()` (the new
function `answer_one` calls to resolve whether a land-replay's cited source
is itself approved):

1. **Removed the JSONL `BOUNCE_TOKENS` veto check** from `source_is_approved`.
   `test_is_qa_ancestor_land_replay_store.sh`'s own row 3 ("a replay whose
   source carries a bounce verdict is NOT approved") did NOT catch this —
   **SURVIVED** against the shell test alone. The exhaustive 48-case
   property sweep DID catch it (`bl1334_land_replay_approval_property_runner.bb`
   failed `replay-of-approved / land=recorded / bounce=approved-source-bounced`
   — expected exit 1, got 0). Confirms the property sweep, not the shell
   test, is the real safety net for this specific check.
2. **Swapped the prefix-match direction** in the YAML_TOKENS check inside
   `source_is_approved` (`case "$token" in "$full_source"*)` instead of
   `case "$full_source" in "$token"*)`) — the asymmetric-predicate class of
   mutant (per the "needs a strictly-ordered fixture" discipline). **SURVIVED
   BOTH** the shell test suite AND the 48-case property sweep. Root cause:
   the property runner's `bounce-states` (`:clean :source-bounced
   :approved-source-bounced`) writes ONLY to the JSONL bounce store
   (`reset-bounce-store!` spits `bounce-file`, a `.jsonl` path) — it never
   exercises a ticket-YAML `bounce_history` entry at all, so
   `source_is_approved`'s YAML_TOKENS branch had **zero test coverage** from
   either the shell suite or the property sweep before this pass.

## Defect found and closed
A genuine, previously-uncovered gap in security-critical code: a land-replay
whose cited SOURCE was bounced only via a tracked ticket's `bounce_history`
(no JSONL record) would incorrectly read as approved through the new
land-replay path — the exact class of bug BL-952 exists to prevent, now
reachable through the one code path this ticket's own property sweep never
touched.

**Closed**: added a new case to
`swarmforge/scripts/test/test_is_qa_ancestor_land_replay_store.sh` — a
source commit reachable from `swarmforge-QA` (so it would read approved by
ancestry alone) but bounced ONLY via a ticket-YAML `bounce_history` entry,
with a land-replay record naming it. Verified: passes against the real code
(`ok - a replay whose source carries a YAML-only bounce verdict is NOT
approved`), and re-confirmed it kills BOTH hand-mutants above (both mutants
re-applied individually, both now caught by this one new test row; both
then reverted, `git status` confirmed clean of production-file changes —
only the test file carries a real, tracked change).

This is a test-coverage fix only: `is_qa_ancestor.sh` and
`bl1334_land_replay_approval_property_runner.bb` are unchanged; only
`test_is_qa_ancestor_land_replay_store.sh` gained the new fixture and
assertion.

## Whole-tree acceptance guard sweep
Parcel touches no `specs/pipeline/steps/` or `extension/test/` file directly
in a way that would trip the whole-tree JS guards (the one new file,
`bl1334LandedReplayIsQaApprovedSteps.js`, is acceptance-domain content); ran
the sweep anyway for completeness — same 3 pre-existing failures
(BL-1289/1290/1291), unrelated.

## Lessons
Proposing a `rule_proposal` for the specifier: an exhaustive property sweep
that writes bounce fixtures to only ONE of two independent verdict stores
(here: JSONL-only, never YAML `bounce_history`) is "exhaustive" only over
the states it models — a second, independent guard reading a DIFFERENT
store the sweep never populates gets zero coverage from an otherwise
100%-branch-claiming exhaustive sweep. This is a sibling of the
"overlapping guards each need an isolating test" and "two independent
hardening passes... union of mutants" rules already on file, but distinct:
here it is ONE sweep, mis-scoped to one of two real stores, not two
divergent sweeps.

## Verdict
One real, previously-uncovered security gap found and closed via a new test
case (no production code change needed — `source_is_approved`'s existing
YAML_TOKENS check was already correct, only untested). Forwarding to
documenter.
