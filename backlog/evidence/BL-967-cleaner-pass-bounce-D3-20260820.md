# BL-967 — cleaner pass on the architect's D1–D4 bounce re-fix

**Received**: `git_handoff` from coder, `d135ddafa9`, task
`BL-967-handoffd-cycle-stall-bounded-waits-and-sweep-boundaries-BOUNCE-D1-D4`.
**Inventory carried**: `backlog/evidence/BL-967-architect-review-20260820.md`
(pass 1, BOUNCE to coder). D1/D2/D4 blamed coder — cleared by the coder in this
parcel. **D3 blamed cleaner — cleared here.**
**Verdict**: forward to **architect**. No new bounce.

---

## D3 (mine) — CLEARED

`swarmforge/scripts/handoffd.bb`. The BL-967 DRY extraction
(`node-tool-path` / `node-tool-line`) had been inserted *inside* the
pre-existing BL-252 comment block, cutting its sentence off at "Any" and
leaving the orphaned tail (";; failure (CLI not yet compiled …)") attached to
`suite-duration-briefing-line`.

Remediation applied, all three parts the architect asked for:

1. The BL-967 comment and both defns now sit **before** the BL-252 block, as
   their own unit — nothing is interleaved.
2. BL-252's sentence is **restored whole**: "…so the briefing can never
   disagree with the live UI about what 'regressing' means. Any failure (CLI
   not yet compiled on this checkout, etc.) degrades to omitting the line
   entirely - never crashes the sweep, never a fabricated value."
3. The `[cmd & args]`-not-flat-varargs / silently-drops-`:dir` warning
   **moved to `node-tool-line`**, where the shelling now happens. It had been
   left sitting above a function that no longer shells at all.

---

## Own cleanup this pass (beyond D3)

**C1 — load-file spelling normalized.** BL-967's three new `load-file` lines
(`briefing_email_lib.bb:21`, `control_plane_lib.bb:32`,
`master_checkout_drift_lib.bb:46`) spelled the path fully-qualified
(`babashka.fs/path (babashka.fs/parent (babashka.fs/canonicalize *file*))`)
while sitting directly beside sibling `load-file` lines using the `fs/` alias
already in each file's own `ns` require — two spellings of one expression,
adjacent. Normalized to `fs/`.

**C2 — fixture temp root leaked on a throwing assert.**
`daemon_cycle_guard_lib_test_runner.bb:30` created a temp root with
`fs/create-temp-dir` and deleted it **after** the last assertion rather than in
a `finally`, so any failing assert leaked it permanently. Wrapped in
`try`/`finally`. This is the engineering rule's own measured failure mode, and
it was failing the standing gate `extension/test/tempDirTrapGuard.test.js`.

**C3 — three hand-maintained mirror lists drifted on BL-967's new load-file
edge.** `handoff_lib.bb` now load-files `daemon_cycle_guard_lib.bb`, and every
fixture that copies a NAMED list of `.bb` files into a temp root went stale at
once:

| List | Symptom |
|---|---|
| `specs/pipeline/steps/lib/operatorRuntimeBbFixtureFiles.js` | closure gate named `daemon_cycle_guard_lib.bb` missing (2 tests) |
| `extension/test/readLiveRoleHeldTicketsCli.test.js` `REQUIRED_SCRIPT_FILES` | `pipeline_stage_cli.bb report` failed to run in the fixture (3 tests) |

Both lists updated, each with a comment recording BL-967 in its own recurrence
history (that history is now seven entries long on the first list, four on the
second).

**Observation for the architect, NOT acted on** (out of scope for this
ticket's fence): D2's remediation was "fix the class, not the instance", and
the closure gate the coder built does exactly that — but only for
`handoffd.bb`'s closure. The two lists in C3 are the SAME class of hand-
maintained mirror and still have no derived-from-source gate; they drifted
again here, on schedule. A generalization is a separate ticket, not this one.

---

## Checks run — nothing assumed clean

| Check | Result |
|---|---|
| `daemon_cycle_guard_lib_test_runner.bb` (incl. D2's new closure gate) | PASS |
| `daemon_cycle_guard_lib_property_runner.bb` | PASS |
| `handoff_lib_test_runner.bb` | PASS |
| `agent_runtime_test_runner.bb` | PASS |
| `briefing_email_test_runner.bb` | PASS |
| `bl839_master_checkout_drift_property_runner.bb` | PASS |
| `control_plane_lib_test_runner.bb` | PASS |
| `mono_router_lib_test_runner.bb` | PASS |
| `handoffd.bb` / `agent_runtime_inject.bb` / `master_checkout_drift_lib.bb` | parse + load clean |
| `npm test` (unit) | see below |

**Degraded tooling — recorded, not implied away.** Every source file this pass
changed is Babashka. Per the Engineering Rules, Babashka/Clojure has NO
mutation, CRAP, or DRY tooling wired in this repo (BL-472 deferred): this pass
is gated by the bb unit runners and the TS unit suite alone. **Mutation, CRAP,
and DRY did NOT run on the `.bb` changes.** The BL-485 mutation-site count is
likewise N/A — it counts against compiled `out/**/*.js`, and no changed file
has a compiled counterpart.

## Coder's D1/D2/D4 re-fix — reviewed, sound

- **D1a/D1b**: `agent_runtime_inject.bb`'s `tmux!` and
  `master_checkout_drift_lib.bb`'s `run-git` both route through
  `daemon-cycle-guard-lib/sh!`; `babashka.process` is gone from both `ns`
  requires and from `handoffd.bb`'s.
- **D2**: the structural half is now executable — a closure gate over the
  **computed** transitive load-file closure from `handoffd.bb` (BFS, never a
  hand-list), banning `babashka.process` / `clojure.java.shell` /
  `process/sh` / `process/process` outside the chokepoint, with comments and
  string contents stripped first so `handoff_lib.bb`'s prose (which NAMES
  `clojure.java.shell` while forbidding it) cannot trip a gate meant for
  calls. The sanity assertion that the BFS resolved >20 files is the right
  guard against a gate that passes because it walked nothing.
- **D4**: the step file's Background comment now cites `WAIT_BOUND_MS`
  instead of the stale `500ms`.

## Unit suite

`npm test`: **1 failed | 7903 passed (7904)** — down from 8 failed on the
received commit. Every one of the seven fixed was BL-967's own collateral
(C2 + C3 above), not unrelated breakage.

The single remaining failure, `renderBriefingBurndownCli.test.js > the
compiled CLI reads --snapshot from argv and reflects the shared snapshot
data`, is a **load-induced timeout, not a defect**: it passes alone in 48.5s
against a suite where that file was already measured at 115.7s under
contention. Two other tests (`mermaidRender`, `emitLifecycleSnapshotCli`,
`dependencyGateCliStorageGlobals`) failed the same way on earlier runs of this
same tree and each passed in isolation. Recorded, not swept: the per-file
budget warnings in the suite tail name this file among the slowest, and a
genuinely slow file that only fails under parallel load is a test-speed
concern for the hardener, not a behavior defect in this parcel.
