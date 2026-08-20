# BL-957 / BL-958 / BL-960 — hardener batch pass (2026-08-20)

Batch of three parcels from the architect, merged into one working set and
hardened in a **single combined pass** (batch-mode discipline — the expensive
runs are paid once for the union, never per ticket).

| Ticket | Received commit |
|---|---|
| `BL-957-promotion-gate-refuses-unsatisfied-depends-on` | `36f3ef076b` |
| `BL-958-full-forge-tmux-control-plane-crash-root-cause` | `7ba07840ac` |
| `BL-960-heal-wrapper-parse-safe-round-trip` | `ce871cd965` |

## Verdict

**PASS — all three forwarded to documenter**, each as its own `git_handoff`
under its own task name. One defect found and fixed; one new defect found and
raised on its own ticket rather than fixed here (production behaviour, not the
hardener's to author).

## Merge

`specs/pipeline/steps/index.js` conflicted (append-only registry: BL-571 vs
BL-958). Resolved keeping **both** entries; verified `node --check` and that
`bl958ControlPlaneLossSteps.js` exists. Lineage re-checked after all three
merges — every received commit is an ancestor of the forwarded commit. My
prior BL-571 hardening was re-verified present afterwards (the silent-revert
check), not assumed.

## Gates run

| Gate | Result |
|---|---|
| `control_plane_lib_test_runner.bb` (BL-958) | **ok** |
| `bl958_control_plane_property_runner.bb` | **ok** — 400 runs |
| `promotion_gates_lib_test_runner.bb` (BL-957) | **ALL PASS** |
| `promotion_gates_lib_property_runner.bb` | **ALL PROPERTIES HOLD** |
| `tool_miss_heal_lib_test_runner.bb` (BL-960) | **ALL TESTS PASS** |
| `tool_miss_heal_lib_property_runner.bb` | **ALL PROPERTIES HOLD** |
| `swarm_status_lib_test_runner.bb` | **ok** |
| `test_tool_miss_heal_hook_wiring.sh` | **ALL SCENARIOS PASS** (10) |
| Acceptance — BL-957 | **15/15**, exit 0 |
| Acceptance — BL-958 | **5/5**, exit 0 |
| Acceptance — BL-960 | **10/10**, exit 0 |
| Standing whole-tree guards (7 files) | **51/51** — after the fix below |
| `test_swarm_ensure.sh` (BL-958 adds 105 lines to it) | **47 PASS / 0 FAIL, exit 0 — ran to completion** |

The ensure suite completing matters beyond this batch: four attempts during the
preceding BL-571 pass were killed by host saturation before reaching the tail.
This run covers BL-958's new control-plane cases, BL-571's sequential-dormant
case, and the whole `RC-*` tail, so it also retires the open verification
caveat recorded in `BL-571-hardener-pass-20260819.md`.

Static leak checks on all three new step files: each creates its fixture with
`mkdtempSync` and removes it in an `afterEach` tracked-roots reaper (survives a
throw), none starts a bridge, and BL-957/BL-958 assert their Outline values
against explicit `KNOWN_VALUES` — so a mutated example cell throws rather than
silently re-running the same test (the BL-908 shape-blindness trap is avoided).

## Defect found and FIXED — H1: a standing guard caught a tmux leak

`extension/test/tmuxReaperGuard.test.js` **failed**:
`bl958ControlPlaneLossSteps.js` starts a tmux server (`new-session`) without
requiring `./lib/fixtureReaper` and calling `track()`.

This is exactly the class QA bounced BL-631 for, and it is invisible to any
targeted run — a repo-wide invariant no per-file gate can see. The file's fake
tmux is a PATH stub, so no *real* server starts; but `track()` also installs
**abnormal-exit** reaping, which a plain `afterEach` cannot give — a SIGKILL
mid-run skips `afterEach` entirely. That is not hypothetical here: three runs
in the preceding BL-571 pass were killed mid-flight on this saturated host,
each leaving orphans behind.

Fixed by requiring `fixtureReaper`, calling `track(root)` at fixture creation
and `reap(root)` before `rmSync` in the `afterEach`. Guards re-run: **51/51
pass**.

## Defect found, NOT fixed here — raised on its own ticket

**BL-960's wrapper leaks a temp file on abnormal termination.**

BL-960 changes the generated heal wrapper from `$()`-capture to a `mktemp`
temp file:

```
__sfh_out_file="$(mktemp "${TMPDIR:-/tmp}/sfh.XXXXXX")" || exit 1
...
cat "$__sfh_out_file"
rm -f "$__sfh_out_file"
```

There is **no `trap`**. If the wrapped command is killed, the `rm -f` never
runs and the file is stranded. Confirmed this is *introduced* by this parcel,
not inherited: `main`'s wrapper uses `$()` capture and calls `mktemp` **zero**
times; the current file calls it once, with zero `trap` occurrences.

The blast radius is every Bash call in every role shell, since BL-960 also
re-registers the `PreToolUse` hook the operator disabled on 2026-08-19.
**Measured, not theorised: 13 stranded `sfh.*` files are already sitting in
`$TMPDIR`**, all timestamped 21:11 on 2026-08-19 — the window this code was
being exercised.

Not fixed here deliberately: adding a `trap` changes the generated wrapper —
production behaviour, the coder's domain, and it would move the byte-identity
baselines BL-960's own round-trip test asserts against. So it wants its own
spec and tests rather than a hardener edit. Raised by `note` to specifier and
coordinator. The 13 existing files were left in place — they are not this
worktree's to delete.

## Follow-up: BL-958's own fixtures carried the same dead seams

After this batch was forwarded, the coordinator reported (`af1f66406`) that
BL-958's two new blocks in `test_swarm_ensure.sh` set
`SWARMFORGE_ENSURE_EXTENSION_CHECK/_BOUNCE/SUPERVISOR` and pointed at
`fake_supervisor.bb`. Correct, and it is the identical defect fixed during the
BL-571 pass: `swarm_ensure.bb` reads none of those names and that stub file is
never created, so both blocks ran the REAL extension bounce and REAL daemon
start against a `$TMPDIR` root while their assertions — which only inspect the
control-plane row — passed regardless.

Why the earlier sweep did not catch them: these blocks arrived **with the
BL-958 merge**, after that sweep was verified. The check was sound; the file
changed under it.

Fixed in `69663acbd1` (real `SWARM_ENSURE_*_CMD` seams plus
`SKIP_CURSOR_BRIDGE`/`SKIP_BABYSITTERD`). The documenter already held a live
BL-958 parcel naming the older commit, so a `note` was sent naming
`69663acbd1` rather than forcing a duplicate parcel through `redo_from.sh`.

**Re-verified after the fix: `test_swarm_ensure.sh` ran to completion again —
47 PASS / 0 FAIL, exit 0** — with both BL-958 cases (`control-plane FIXED` and
`D1 :halt honored`) passing with the stubs genuinely in effect for the first
time.

## Gates NOT run (BLOCKED — never recorded as passing)

- **Stryker mutation, CRAP, DRY — not applicable.** All three parcels are
  Babashka + bash + acceptance step handlers. Per engineering.prompt Startup
  Tools, Babashka/Clojure has no mutation/CRAP/DRY wired at all; the degraded
  fallback (each module's own unit + property runners, all listed above) is
  what ran and is recorded as such, never implied to be a mutation pass. No
  TypeScript changed in this batch.
- **BL-113 Gherkin acceptance mutation — BLOCKED BY host load.** Load ran
  68–340 on 4 cores across the pass. Applicable (all three features carry
  `Scenario Outline`s) and therefore NOT claimed as passed. Mitigating static
  evidence: BL-957 and BL-958 pin their Outline cells against `KNOWN_VALUES`
  and throw on an unrecognised value, which is the remedy a survived Gherkin
  mutant would call for. First deferral for these tickets.

## Cleanliness

No `node --test` / stryker / mutation processes left behind; no fixture-rooted
processes from this worktree; no leaked `*.property.test.js`; scratch logs
removed. `tmp/detach.py`, `tmp/suites.sh`, `tmp/suites.log` were **not created
by this role** and are left untouched (see the concurrent-writer note in the
BL-571 evidence).
