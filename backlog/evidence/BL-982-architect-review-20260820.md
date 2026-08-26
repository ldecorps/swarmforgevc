# BL-982 — architect review pass: PASS to hardener (clean sweep, NONE)

- **Ticket**: BL-982 — a pipeline stage can host a second seat (SEAT
  identity split from STAGE identity), `type: feature`, M8, `mutation_cost:
  high`.
- **Received**: `git_handoff` from cleaner, `edc0e68170` ("BL-982 cleanup:
  raise property-runner reach floor reliability (24 -> 100 default runs)"),
  task `BL-982-second-seat-of-a-stage-boots-with-its-own-model`. Merged
  clean into `swarmforge-architect`.
- **Reviewer**: architect, 2026-08-20.
- **Verdict**: **PASS to hardener — clean sweep, NONE.**

Parcel spans two commits: coder's `966f6b3ea` (the slice itself) and
cleaner's `edc0e68170` (test-only reliability fix to the property runner's
default `runs`, no production-code change). Diffed both against their
respective first parents individually to exclude unrelated merge-up noise
picked up along the branch.

## Architecture review — SEAT vs STAGE keyspace split

Read `swarmforge/scripts/swarmforge.sh`'s full diff (161 lines) line by
line against the ticket's declared design:

- Parse loop derives `seat_stage` from the optional `<stage>@<seat>` form
  (single-`@`, both halves non-empty, validated with a named error).
  Underscore ban (`role names may not contain underscores`) still applies
  to the WHOLE seat id string, unchanged, matching the ticket's own stated
  constraint.
- Coordinator-reserved check and the role-prompt existence check now key
  on `seat_stage` (STAGE); the duplicate-`ROLE_INDEX` guard still keys on
  `$role` (the full SEAT id, so `coder@fable` and `coder@sonnet` are
  distinct); the duplicate-`WORKTREE_INDEX` guard is untouched (still
  per-worktree-name, independent of seat/stage). This exactly matches the
  ticket's "keeps the duplicate-ROLE guard per SEAT id... and the
  duplicate-WORKTREE guard as-is."
- New post-loop rule: a stage with any `@`-seat must also declare its bare
  seat, or `error_msg "...no bare '$stage' seat..."` — correctly named,
  because `to: <stage>` parcel delivery resolves the row keyed by the
  stage name exactly.
- `register_role`'s new 8th param (`stage`, defaulted to `$role`) is a
  parallel `STAGES` array; every existing call site (`provision_coordinator`
  at line 735) omits it and gets the correct default — coordinator is
  never seatable, confirmed refused inline before this point regardless.
- `write_agent_instruction_file`'s new 5th param (`stage`, defaulted to
  `$role`) is passed at BOTH its call sites
  (`generate_dormant_role_launch_artifacts`, `launch_role`) as
  `${STAGES[$index]}` — grepped for other call sites, none exist. Compose
  and compose-metadata both key on stage; the artifact FILE path
  (`$prompt_file`) stays seat-keyed via the unchanged `$role`/`${ROLES[$index]}`
  argument.
- Everything else identity-bearing (`session_name_for_role`,
  `remote_control_session_name_for_role`, `worktree_path_for_name`,
  `WORKTREE_NAMES`, `SESSIONS`) is untouched by this diff and already keys
  on `$role` (the ROLES array element, now holding the seat id for `@`
  rows) — confirmed by re-reading each function; none needed a change,
  matching "everything else stays seat-keyed" by construction.
- `parse_config` is called exactly once per process (single call site,
  line 1864) — the new `STAGE_BARE_SEAT`/`STAGE_EXTRA_SEAT` associative
  arrays being script-scope rather than function-local is not a
  cross-call state-leak risk in production; test harnesses that call
  `parse_config` more than once do so in fresh subshells.

## Constraints held

- No stage hard-coded as the multi-seat one (the `<stage>@<seat>` parse is
  generic; the property runner draws from `coder`/`cleaner`/`architect`
  interchangeably).
- `swarmforge/swarmforge.conf` (the live pack) has a zero-line diff across
  this whole parcel — confirmed with `git diff ... -- swarmforge/swarmforge.conf`.
- No auto-scaling, no mailbox/claim/routing/difficulty-awareness code
  touched. Coordinator-as-seat refused inline (unit test case 6).

## Dependency-rule gate / co-change

- Dependency-rule gate: ran `node extension/out/tools/dependency-gate.js`
  against the parcel's changed files. All three forbidden edges reported
  (`telegram-front-desk-bot.js` → `telegramCursorOperatorExec.js` /
  `telegramCursorOperatorLiveness.js`, and the third pairwise edge) are the
  pre-existing BL-759 `acyclic` cycle, unrelated to any file this parcel
  touches (none of `swarmforge.sh`, `bl982SecondSeatSteps.js`,
  `specs/pipeline/steps/index.js` sit under `extension/src` or
  `extension/media` — the gate's own scope). Not a BL-982 regression.
- Co-change (`co-change-report.js` against `swarmforge.sh`,
  `bl982SecondSeatSteps.js`, `specs/pipeline/steps/index.js`): the reported
  high-frequency co-changers (`specs/pipeline/steps/index.js` at 32, the
  various `swarmforge/scripts/*.bb`/test siblings) are `swarmforge.sh`'s
  long-standing history-wide coupling (a huge, frequently-touched file) and
  the always-expected registry-file pairing for any new step-handler
  addition — nothing here is a NEW coupling introduced by this parcel.

## Invariants review (BL-633/654) — all three declared, all encoded and non-vacuous

1. **Keyspace non-leak**: encoded by `bl982_multi_seat_identity_property_runner.bb`'s
   `check-identity-derivations!` (roles.tsv col1/session seat-derived) and
   `check-compose!` (compose metadata `role == stage` AND the composed
   `.md` text IS the stage's role prompt — the `.md` clause exists
   specifically because the runner's own documented break 1 proved the
   metadata-only assertion blind to a mis-keyed compose call), plus the
   delivery half via invariant 3. Also unit-tested (cases 1-3) and
   acceptance-tested (scenarios 01-03).
2. **Single-seat byte-identity**: encoded by `check-byte-identity!`
   (REAL-vs-REAL oracle against the pre-change script pinned by blob sha
   `2edd9a17ba`), unit-tested (case 7) and acceptance-tested (scenario 04).
3. **Second seat inert**: encoded by `check-delivery!` (real
   `swarm_handoff.bb` send + real `ready_for_next.sh` claim), acceptance-
   tested (scenario 06, driving the actual send/claim binaries, not a
   simulation).
- Non-vacuity: all three invariants have a documented staged-first
  break-then-restore in the runner's own header comment (break 1: compose
  arg reverted to seat id → RED on composed draws; break 2: unconditional
  extra roles.tsv column → RED on single-seat draws; break 3: bare row
  withheld from delivery fixture → RED on the bare-seat-delivery
  assertion) — none vacuous.
- No violation found on any declared invariant; no site-sweep needed.

## Verified live, not from the parcel's own claims

- `bash swarmforge/scripts/test/test_bl982_multi_seat_identity.sh`: **7/7
  PASS**.
- `node specs/pipeline/cli.js specs/features/BL-982-second-seat-of-a-stage-boots-with-its-own-model.feature`:
  **7/7 pass** (all six scenarios incl. both Scenario Outline rows).
- `bb swarmforge/scripts/test/bl982_multi_seat_identity_property_runner.bb`
  at the shipped default (`runs=100`, run detached to avoid this session's
  ~2min foreground tool cap): **ALL PROPERTIES HOLD**, coverage
  `{:single 11 :multi 89 :triple 53 :composed 8 :delivered 6}` — every
  reach floor met (single≥5, multi≥8, triple≥3, composed≥6, delivered≥5).
  Also spot-checked at `PROPERTY_RUNS=24`: single-seat coverage fell short
  (1 of 24, floor 5) exactly as the cleaner's own math predicts for the old
  default — corroborates the cleaner's stated rationale for raising the
  default rather than taking the commit message's numbers on faith.

## Property-testing pass

No new undeclared-property coverage warranted: the parcel touches no
TypeScript/JS pure module under `extension/src` — only bash
(`swarmforge.sh`), Babashka (`.bb`), and integration-style acceptance step
handlers (I/O-heavy, not property-shaped). The declared invariants above
are already the property-testing surface for this slice and are fully
covered by the coder's generative `.bb` runner.

## Everything else

No correctness defects found reading the diff or exercising the code.
