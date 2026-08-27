# BL-1043 — hardener pass

Forwarded from the architect. Cleaner and architect both did clean no-op
merges (no new commit of their own — confirmed via `git log
508bcfdc3..9308cdaf8b`, each hop is a bare merge commit) — only the coder's
own evidence file exists. Babashka/shell: per the Startup Tools article,
no mutation/CRAP/DRY tooling is wired for this surface — gated only by its
own unit-test suite.

## Applying the just-accepted `--ignoreStatic` Ignored-accounting rule to my own recent BL-1045 pass, before starting this one

`swarmforge/roles/hardender.prompt` picked up a new accepted rule_proposal
in this same merge: `--ignoreStatic` silently excludes pure-static mutants
from the score's own denominator, so a clean score does not mean every
mutant ran. My own BL-1045 pass (immediately prior, same session) used
`--ignoreStatic` without reading the Ignored count. Checked before starting
this ticket's own work, not deferred: `heldSince.ts` (the wholly-new file
from that pass) has exactly one module-level static constant
(`HOLD_DIR = 'backlog/hold'`); hand-mutated it directly in `out/` and
confirmed the existing exact-array test (`heldSinceGitArgs`'s full
`assert.deepEqual`) still kills it. `pipelineBoard.ts`'s new held-related
constants (`HELD_SECTION_HEADER`, `PIPELINE_BOARD_HELD_MAX`) are likewise
already exercised by exact-match/boundary tests added in that pass. No gap
found; BL-1045 stands as hardened.

## Verification, re-run live

- `bb swarmforge/scripts/test/bl1043_startup_grace_property_runner.bb`:
  **400 runs, ALL PROPERTIES HOLD**, healthy coverage across all 8 declared
  classes (defect-shape, inside/past/at-boundary grace, own-heartbeat,
  no-heartbeat-at-all, form-defaulted, form-explicit).
- `test_onboarder_supervisor_ignores_old_heartbeat.sh` (the shell test
  BL-1043 itself touched): PASSED, all 4 checks.
- `test_negotiation_relay_supervisor_tick.sh`: PASSED, all 16 checks.
- `bb swarmforge/scripts/test/front_desk_supervisor_lib_test_runner.bb`
  (the shared library BL-1043 modified): ALL PASS.
- `node specs/pipeline/cli.js` on BL-1043's feature: **5/5**.
- Confirmed both call sites (`onboarder_supervisor.bb`,
  `negotiation_relay_supervisor.bb`) now pass `(:started-at-ms entry)` with
  their own env-tunable grace through the retained 5-arity, matching the
  pattern `front_desk_supervisor.bb`/`cursor_bridge_supervisor.bb` already
  used.

## Three pre-existing reds, independently re-verified (not merely trusted from the coder's evidence)

The coder's own evidence already named these as pre-existing and out of
scope, verified at the parcel's parent and at "pure main." Re-verified
independently rather than taken on trust, per this role's own standing
practice:

- `test_onboarder_supervisor_tick.sh`'s `spawn_orphaned_reconcile` PPID-1
  check: confirmed via `git log --follow` that this assertion is from
  BL-928, untouched by BL-1043's own commit — the documented WSL2
  subreaper trap already recorded in this role's own prompt (a crash
  orphan reparents to a subreaper pid on this host, never PID 1).
- `test_front_desk_supervisor_tick.sh`'s `bl-303 supervisor-recovery-02
  [not elapsed]` check: confirmed the file carries no diff at all in
  BL-1043's own commit (`git diff 508bcfdc3^ 508bcfdc3 --
  test_front_desk_supervisor_tick.sh` empty), and that
  `front_desk_supervisor.bb` — the file this test drives — is
  **byte-identical** before and after BL-1043 (its one
  `poll-heartbeat-stale?` call site already used the unaffected 5-arity
  with its own pre-existing `heartbeat-startup-grace-ms`, unrelated to the
  3-arity BL-1043 retired).
- `test_front_desk_supervisor_liveness.sh`: **7 of 13 checks fail** — a
  materially bigger finding than the coder's evidence conveyed at a
  glance, worth stating its own size rather than folding into "the pair."
  Re-ran the identical test directly against the `main` worktree
  (`/home/carillon/swarmforgevc`, tip `178a3b0b2`, completely outside this
  branch's history) and got the **identical failure set** — proves this is
  not merely unrelated to BL-1043 but is a live, currently-broken gate on
  `main` itself, independent of this session entirely.

Both untracked findings reported via `note` (priority `00`) to the
specifier for triage — the front-desk-liveness one flagged with its own
message given its size, rather than folded into the smaller tick-test
note.

## Verdict

Everything BL-1043 actually touches is correctly implemented and
thoroughly tested (400-run property suite with 8 declared-invariant
classes, non-vacuity already proven by the coder via 4 breaks-and-restores,
all directly-touched shell/acceptance suites green). No code change
needed. Three pre-existing, unrelated defects independently re-verified
(one confirmed live on `main` itself) and reported for triage rather than
silently absorbed or left implicit in a bounce evidence file nobody may
read. Forwarding to documenter.

— By hardender.
