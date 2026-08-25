# BL-911 — coder pass

A role's composed system prompt (`.swarmforge/prompts/<role>.md`) is a
launch-time build output. Rotation re-execs a pre-generated launch script
that names that file by path, so between two full `./swarm` launches no
rotating role ever boots on anything newer than the launch - an accepted
rule proposal or a landed constitution amendment sits on `main`, in force
for nobody, until the swarm is relaunched by hand.

## Fix

- `swarmforge/scripts/handoff_lib.bb`:
  - `prompt-file-path` - the `.swarmforge/prompts/<role>.md` path, sibling
    to the pre-existing `launch-script-path`.
  - `recompose-role-prompt!` - reads the target role's prompt metadata
    sidecar (`<prompt>.md.metadata.json`, already written at launch by
    `write_agent_instruction_file`/BL-563 Slice 2) for the exact
    agent/model/two-pack?/overlay-prompt context the role was last launched
    with, calls `prompt-engine-lib/compose` (BL-546's single composition
    authority - loaded via `load-file`, never a second composer) with that
    context, and overwrites the prompt file with the result. Returns
    `{:ok true}` or `{:ok false :reason ...}`; any failure (missing/corrupt
    metadata sidecar, an empty compose result, compose itself throwing)
    leaves the existing prompt file completely untouched. `compose-fn` is
    an injectable seam (default `prompt-engine-lib/compose`) so the unit
    tests below need no filesystem stub for PromptEngine's own read side.
  - `rotate-resident-to!` (the chokepoint both `respawn-as!`/
    `rotate_to_role.bb`'s resident-invoked path and `handoffd.bb`'s
    daemon-driven chase call directly) now calls `recompose-role-prompt!`
    for the target role immediately before the `tmux respawn-pane` call - a
    fix placed here covers both drivers with no change to either caller.
    A failed recompose prints a `rotate: WARNING recompose failed for
    '<role>': <reason> - booting on the previously composed prompt.` to
    stderr and the rotation proceeds exactly as before (invariant 2): a
    role that fails to boot strands its parcel, which is strictly worse
    than a stale prompt, so recompose failure is reported, never fatal.

Composition itself is unchanged - `write_agent_instruction_file` /
`prompt_engine_cli.bb` / `prompt_engine_lib.bb::compose` are untouched by
this diff. `articles/reference/` on-demand elaborations (BL-640) and
`.swarmforge/launch/<role>.sh` itself are out of scope, per the ticket.

## required_wiring

None - deliberate, per the ticket's own "How" section: a `required_wiring:`
substring pin cannot express "and the daemon path got it too" (BL-874's
standing reminder), so the daemon-path coverage is carried entirely by
acceptance scenario 02 instead.

## Acceptance (BL-112)

New step handlers:
`specs/pipeline/steps/bl911RotationRecomposesRolePromptSteps.js`
(registered in `specs/pipeline/steps/index.js`), driving the real
`rotate_to_role.sh` / `handoff_lib.bb::rotate-resident-to!` via a new fixture
script - `swarmforge/scripts/test/test_rotate_recomposes_role_prompt.sh` -
never a reimplementation. The fixture's `.swarmforge/prompts/hardender.md`
starts deliberately stale; the three markers it asserts
(`"You are the hardender."`, `"# Article 1: Roles and Responsibilities"`,
`"# Parcel Flow"`) are real, already-landed, stable phrases from this
repo's own current `swarmforge/roles/hardender.prompt`, an inlined
constitution article, and `PIPELINE.md` - never freshly fabricated content,
and no tracked file is ever mutated by the test. This works because
`prompt-engine-lib/compose`'s `repo-root` is pinned to wherever
`prompt_engine_lib.bb` physically sits on disk (unchanged by this ticket,
by design - see "How" in the ticket body), so driving the *real* script by
absolute path against a fixture *project-root* (`target-root`, via
`set-project-root!`/git-common-dir resolution) always composes from this
worktree's own current sources while every piece of rotation STATE
(roles.tsv, launch scripts, the prompt artifact + its metadata sidecar,
tmux socket) is fully fixture-isolated - the same split
`test_rotate_to_role_stuck_parcel_gate.sh` (BL-805) established.

```
$ bash specs/pipeline/scripts/run_acceptance.sh specs/features/BL-911-rotation-recomposes-the-role-prompt.feature
...
# tests 7
# pass 7
# fail 0
```

Marker mapping (`<source>` and `<driver>` are both validated against
explicit `KNOWN_VALUES`, throwing on an unrecognized value): Scenario
Outline 01's three `<source>` examples and Outline 02's `"the resident"`
`<driver>` row are the identical physical rotation (all three sources
travel in the one `compose` call `rotate-resident-to!` makes, and the
resident-driven path is that same call), so they collapse to fixture marker
`01` - matching the ticket's own notes on the IR-DRY-resolved step sharing
("the resident and daemon rotations share one step text (and one
handler)"). Outline 02's `"the daemon's chase"` row is marker `02` (drives
`handoff-lib/rotate-resident-to!` directly via `bb -e`, bypassing
`rotate_to_role.sh` entirely, mirroring BL-805's own scenario 04 for the
same daemon-path proof). Scenario 03/04 are markers `03`/`04`.

Non-vacuity: re-ran both the unit runner and the fixture script against the
pre-fix tree (`git stash` on `handoff_lib.bb` alone) -
`bl911_rotation_recompose_test_runner.bb` fails to even resolve
`handoff-lib/prompt-file-path` (the seam does not exist yet), and
`test_rotate_recomposes_role_prompt.sh` fails scenario 01 outright ("missing
the role-prompt source marker") - confirming neither can pass by accident.
Both restored before commit.

## Unit / regression runs

```
$ bb swarmforge/scripts/test/bl911_rotation_recompose_test_runner.bb      -> ALL TESTS PASSED (new)
$ bash swarmforge/scripts/test/test_rotate_recomposes_role_prompt.sh      -> ALL CHECKS PASSED (new)
$ bb swarmforge/scripts/test/handoff_lib_test_runner.bb                  -> ALL TESTS PASSED
$ bb swarmforge/scripts/test/mono_router_lib_test_runner.bb              -> ok
$ bb swarmforge/scripts/test/prompt_engine_test_runner.bb                -> ALL PASS
$ bash swarmforge/scripts/test/test_rotate_to_role_stuck_parcel_gate.sh  -> ALL CHECKS PASSED
$ bash swarmforge/scripts/test/test_handoffd_rule_proposal_rotate_wiring.sh -> ALL PASS
$ bash swarmforge/scripts/test/test_ready_for_next_rotate_home.sh        -> ALL CHECKS PASSED
```

`test_rotate_to_role_stuck_parcel_gate.sh`'s own fixture (BL-805, unmodified
by this ticket) has no metadata sidecar for its `cleaner` prompt fixture, so
its run now also exercises - and correctly survives - the new
"no-metadata-sidecar" degrade path: `rotate: WARNING recompose failed for
'cleaner': no-metadata-sidecar - booting on the previously composed
prompt.` appears in its output, and every one of its 8 pre-existing
assertions still passes unchanged.

`test_handoffd_priority_rotate_wiring.sh` and
`test_handoffd_starve_rotate_wiring.sh` fail in this dev tree
(`mapfile: command not found`) - confirmed pre-existing and unrelated by
re-running against the unmodified tree (`git stash` on
`handoff_lib.bb`): byte-identical failure. Root cause: stock macOS
`/bin/bash` is 3.2.57 (per this project's own Engineering Rules -
"Target stock macOS `/bin/bash` 3.2, not Homebrew bash"), and `mapfile` is
a bash-4.0+ builtin; these two scripts assume a newer bash than the host
default provides. Not fixed here (out of this ticket's scope, and neither
script touches anything this diff changes); worth a follow-up ticket if not
already tracked.

## BL-654 declared-invariant coverage

Ticket declares two invariants. Per coder.prompt's Invariants section,
first authorship of each invariant's property test rests with the coder.

1. **"No rotation boots a role on a composed prompt that omits prose
   already present in that role's prompt sources - freshness is
   established at rotation, never inherited from launch."** — **stated
   reason, no property test**. This project's property-test tooling
   (`*.property.test.js` under `extension/`, run via `npm run
   test:properties`) is TypeScript/Vitest-only; per Engineering Rules,
   Babashka/Clojure has no mutation/CRAP/DRY/property-test framework wired
   at all, gated only by its own unit-test suite. The function this
   invariant describes (`rotate-resident-to!`) is inherently impure - it
   captures the live resident tmux pane and performs the actual respawn
   over a real tmux socket, not a pure, testable module - the identical
   shape BL-812's own invariant 2 and BL-795's invariant 2 both already
   recorded this same stated-reason for. Encoded instead via the
   real-fixture acceptance scenarios 01/02 above, which drive
   `rotate-resident-to!` itself (both the resident-invoked and
   daemon-chase-invoked paths) under a fake-tmux fixture and assert the
   freshly composed prompt lands before the pane is respawned.
2. **"A composition that fails never prevents the rotation: the role still
   boots, on the prompt it already had, and the failure is reported rather
   than swallowed."** — **stated reason, no property test**, same
   tooling-gap rationale as invariant 1: the observable behavior lives
   inside `rotate-resident-to!`'s own tmux-respawn control flow, not a pure
   module. `recompose-role-prompt!` itself - the pure part of this
   invariant (never writing the prompt file on any failure path) - IS
   fully covered by pure unit tests
   (`bl911_rotation_recompose_test_runner.bb` assertions 01, 04, 05, 06),
   with an injected `compose-fn` and no filesystem stub needed beyond real
   temp-dir fixtures; what those unit tests cannot reach is
   `rotate-resident-to!`'s own decision to proceed with the respawn anyway
   and print the warning, which requires the real tmux-touching control
   flow. Encoded end-to-end via real-fixture acceptance scenario 03, which
   corrupts the fixture's metadata sidecar, drives the real rotation, and
   asserts all three: the respawn still happens, the previous prompt
   content survives byte-for-byte, and the warning is printed naming the
   role.

## e2e QA procedure

The ticket's own `qa_e2e_procedure` requires a live daemon, a real tmux
socket, and a live rotation into a currently-dormant role on the actual
swarm - this project's Testability Boundary excludes live tmux/PTY
interaction from the coder's own verification (the same boundary BL-805,
BL-795, and BL-812 all respected). Every step of that procedure is a live
re-enactment of exactly what acceptance scenarios 01-04 above already prove
against a fixture; QA owns running it against the real swarm per the
ticket's own procedure.
