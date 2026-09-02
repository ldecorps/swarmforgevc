# BL-1334 — architect pass, 2026-09-02

Role: architect. Ticket: BL-1334-a-landed-replay-is-qa-approved-when-it-lands.

## Received
Cleaner commit `1dec4744f8` (no defects found, verified independently; forward
unchanged).

## Scope taken
Coder correctly applied `human_ruling` option 2 (record the replay-to-
approved-source mapping) over option 1 (advancing `swarmforge-QA` from the
tool) — the ticket's own `approval_context` explains why option 1 would hand
a script write access to the ref that DEFINES approval, eroding BL-952's
protection. Confirmed by reading the diff: `land_step_lib.bb`/`land_step_cli.bb`
never touch `swarmforge-QA`.

## Architecture check
- Single predicate preserved (BL-925 invariant 2): `is_qa_ancestor.sh` gains
  one more approval PATH (`LAND_TOKENS`), not a second definition of
  approval. `build_freshness_cli.bb` was changed to DEFER to that predicate
  (`--batch`) rather than compute its own merge-base opinion — this actually
  REMOVES a second-predicate risk rather than adding one, which is the
  correct direction per the ticket's constraints.
- Fail-closed posture (BL-925 invariant 3) correctly followed: an unreadable
  land-approval store, a corrupt record line (missing `commit` or `source`),
  or an absent record all resolve to "not approved" or "undeterminable",
  never a false approval. `record-land-approval!` itself refuses to write a
  record missing either sha, and a write failure is reported but never fatal
  — the land itself still succeeds, degrading to the pre-fix (sanctioned
  `--override`) behavior rather than a wrong approval.
- No recursive/chaining approval: `source_is_approved` deliberately does NOT
  call back into `answer_one` — checked by reading the diff — so a land
  record whose source is itself a replay cannot chain approval outward. This
  is exactly the "approval never spreads" invariant (declared invariant 2).
- Bounce veto ordering preserved (BL-952, declared invariant 3): `LAND_PROBLEM`
  is raised only within `answer_one`, AFTER the bounce-token checks already
  ran — confirmed by reading the code order and by the property sweep's own
  correction (see below). `source_is_approved` also checks bounce tokens on
  the SOURCE before falling through to ancestry.
- Minor observation, not a defect: `source_is_approved` checks bounce/YAML
  stores and ancestry for the cited source, but not the expedite or land
  stores. A source approved only via the expedite path would read as
  "not approved" here. This is a false-negative direction (stricter, not
  looser) — consistent with fail-closed, and out of this ticket's stated
  scope (it only has to make land-step replays resolve correctly). Not
  blocking.

## Invariants Review (BL-633/654)
Three declared invariants, all encoded in one exhaustive property sweep
(`bl1334_land_replay_approval_property_runner.bb`, 4×4×3 = 48 cases,
EXHAUSTIVE — no reachability floor needed since every state is covered by
construction). Coder's evidence documents a property that was initially
VACUOUS (the first bounce-state cut never covered a reachable-and-bounced
source, so deleting the bounce check from `source_is_approved` left all 32
cases passing) and how it was corrected by adding the
`:approved-source-bounced` state. Re-ran independently:
`bb swarmforge/scripts/test/bl1334_land_replay_approval_property_runner.bb`
→ 48 cases, ALL PROPERTIES HOLD. Each of the three invariants is also shown
non-vacuous by a distinct deliberately-broken-implementation failure
(documented in the coder's evidence) — verified the reasoning, not just the
green result.

## Property Testing pass (undeclared coverage)
The 48-case exhaustive sweep already covers the full state space of commit
shape × land-store state × bounce state for the touched pure predicate
logic. No additional property-shaped gap found on the touched surface.

## Verification (independent re-run)
- `bb swarmforge/scripts/test/land_step_lib_test_runner.bb` — ALL PASS.
- `bb swarmforge/scripts/test/build_freshness_lib_test_runner.bb` — ALL TESTS PASSED.
- `bash swarmforge/scripts/test/test_is_qa_ancestor_land_replay_store.sh` — 10/10 pass.
- `bash swarmforge/scripts/test/test_land_step_records_approval.sh` — 9/9 pass (end-to-end wiring proof: the real CLI writes, the real predicate reads).
- `bash swarmforge/scripts/test/test_build_freshness_land_replay_approved.sh` — 8/8 pass.
- `bb swarmforge/scripts/test/bl1334_land_replay_approval_property_runner.bb` — 48/48 pass.
- `node specs/pipeline/cli.js specs/features/BL-1334-a-landed-replay-is-qa-approved-when-it-lands.feature` — 5/5 pass.
- Regression: `test_is_qa_ancestor_expedite_store.sh`,
  `test_is_qa_ancestor_yaml_store.sh`, `test_pipeline_code_on_main_guard.sh`
  — all pass, no disturbance to other approval paths.

## required_wiring
None declared, and the ticket's stated reason is sound: every touched
function already has a live caller (`land_step_cli.bb` already calls
`land_step_lib.bb`; `is_qa_ancestor.sh` already has three live callers), so
no anchor here could prove anything beyond the diff's own presence
(BL-1235). Correct, not an omission.

## D1..Dn (Article 4.4 complete inventory)
NONE. Clean sweep — design-fork choice matches the human ruling, single-
predicate and fail-closed invariants held, no chaining/spreading risk, all
tests and the exhaustive property sweep pass, no regression in sibling
approval-path consumers.

## Disposition
Architecturally compliant. Forwarding unchanged to hardener.

By architect.
