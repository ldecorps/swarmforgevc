# BL-998: architect review, PASS (2026-08-21)

**Reviewer**: architect.
**Reviewed**: cleaner's DRY hoist `19e0ad093f` ("BL-998 cleanup: hoist the
five duplicated install_scripts bodies into lib/install_scripts.sh"),
forwarding coder's D1 refix `0153d2257` on top of the specifier's spec
correction `62370af74`.

## Scope

Pure shell/Babashka test infrastructure under `swarmforge/scripts/test/` —
no `extension/src/*.ts` touched. `swarmforge/` here is this project's
maintained fork (Architecture Rule 2), and this ticket fixes the fork's own
test suite; not the "don't modify SwarmForge itself" extension boundary,
which governs the extension driving a separately-installed SwarmForge, not
this repo's own fork.

## Invariants review

Both declared invariants carry an executable, non-vacuous encoding, checked
before any hand-verification of the property itself:

- **Invariant 1** ("no test run alters live swarm state... real mailboxes...
  byte-identical before and after"): acceptance scenarios 01/02
  (`bl998ShellFixtureDispatchIsolationSteps.js`) build a byte-and-name
  mailbox fingerprint of a *stand-in* "live" repo (deliberately never this
  checkout — see the step file's own header comment), dispatch the receive
  and completion helpers from a fixture, and assert the fingerprint is
  unchanged. Genuine, not a passthrough — it fingerprints names AND file
  bytes, so both a claim (file moving `new/` → `in_process/`) and an
  in-place edit would show up.
- **Invariant 2** ("the guard decides membership by inspecting what each
  test executes, never a checked-in roster"): encoded twice — acceptance
  scenario 03 + the Scenario Outline (guard fails and names a generated
  offender; guard passes for both safe shapes, validated against an
  explicit `SAFE_SHAPES` table with no passthrough) and
  `bl998_guard_membership_property_runner.bb` (96 generative runs across
  the full `:direct`/`:transitive`/`:leaf` × anchor × executed matrix).
  Non-vacuity proven two ways per the coder's evidence: the closure step
  disabled makes the property fail on exactly the `:transitive` cases, and
  a throwaway real offender is flagged and named by file.

Neither invariant was hand-verified without first confirming its property
test exists and is non-vacuous — both hold.

## D1's own correctness (re-read, not just re-run)

D1 was a two-part defect: the guard's self-rooting derivation stopped one
hop short, classifying `done_with_current_task.bb` as a safe leaf when its
`run-ready!` tail call `process/exec`s `ready_for_next_task.sh` resolved
against the file's own on-disk directory — which then `cd`s to its own
dirname, escaping the fixture one hop later than the original derivation
looked. Read the fixpoint closure (`test_shell_fixture_dispatch_isolation.sh`
step 1b) directly: it distinguishes a real process invocation
(`process/exec`/`process/shell`/`sh/sh`/etc., an edge) from a same-shape
`load-file` of a sibling lib (in-process, not an edge — counting it would
flag nearly every helper). The distinction is real, not just claimed: I
independently re-ran the guard and it derives exactly the same four
newly-self-rooting helpers the coder's evidence lists, with no roster.

Checked the corrected call sites by hand, not just by test result:
`test_handoff_state_dir_worktree_root.sh`'s `DONE_TASK` now binds the
fixture's own installed copy (`$CODER_WT/swarmforge/scripts/…`) while
`READY_TASK` deliberately stays bound to the real scripts dir — correct,
since `ready_for_next_task.bb` has zero `process/exec` calls (confirmed by
grep) and is the one true leaf shape the ticket's corrected constraint
protects from unnecessary conversion.

## DRY hoist (cleaner's own pass, this forward)

`lib/install_scripts.sh` is a clean, single-purpose extraction: one function,
one documented contract ("requires `REAL_SCRIPTS_DIR` set by the caller").
Verified all five original call sites plus the guard's own reference source
it identically (`REAL_SCRIPTS_DIR` set before `source .../install_scripts.sh`
before `install_scripts "$wt"`, no drift in behavior). No new coupling this
introduces beyond what the co-change tool already shows as *expected*
coupling (the guard and the five files it was written to police moved
together across this ticket's bounce/refix/hoist history — not a hidden
design smell; the shared `install_scripts.sh` is exactly the fix for it).

## Independent reverification

- `bash -n` on all 7 changed shell files: clean. No `"${arr[@]}"` usage
  anywhere in this diff, so the bash-3.2-empty-array trap doesn't apply.
- `test_shell_fixture_dispatch_isolation.sh`: **PASS**.
- All 8 affected/control suites, run individually (host load made the
  batched run unreliable — see below): `test_handoff_state_dir_worktree_root.sh`
  (5/5), `test_idle_clear_respawn.sh` (4/4), `test_sidecar_tolerant_completion.sh`
  (5/5), `test_ready_for_next_no_promotion.sh` (4/4),
  `test_ready_for_next_rotate_home.sh` (9/9 + summary), `test_compliance_battery_cli.sh`
  (8/8), `test_dispatch_lib_receive_mode.sh` (5/5), `test_reference_freshness_guard.sh`
  (4/4) — **ALL PASS**, all green independently, not merely re-quoted from
  the coder's evidence.
- `bl998_guard_membership_property_runner.bb`: **96/96 runs PASS**.
- `node specs/pipeline/cli.js specs/features/BL-998-…feature`: **5/5 PASS**.
- `required_wiring`: `specs/pipeline/steps/index.js` registers
  `bl998ShellFixtureDispatchIsolationSteps` — confirmed present.
- Dependency-gate: BL-998 changes zero `extension/src/*.ts` files, so the
  hard gate has nothing to check for this parcel. A full-repo scan (run
  anyway, for due diligence) surfaces a pre-existing `telegram-front-desk-bot`
  ↔ `telegramCursorOperator*` acyclic-rule violation, untouched by and
  unrelated to this diff — not this parcel's regression.

## Host-load note, not a regression

Running the eight affected suites as one batched command hung under today's
sustained multi-role contention (matches the hardender's/QA's own load notes
this shift); killed by exact PID and re-ran each file individually instead,
all green as listed above. The earlier BL-990 pass on this same shift hit
the identical pattern with two unrelated TypeScript files
(`pausedPagerUiHtml.test.js`, `pwaApprovalDetail.test.js`) — same discipline
applied here.

## Outcome

BL-998 is architecturally compliant, both declared invariants hold with
non-vacuous property coverage, and the D1 fix is correct at the derivation,
not just at the call sites. Forwarding to hardener.
