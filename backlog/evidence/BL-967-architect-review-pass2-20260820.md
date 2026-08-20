# BL-967 — architect review pass 2 (bounce D1–D4 re-fix): complete inventory, PASS

- **Ticket**: BL-967 handoffd cycle stall — bounded waits and sweep boundaries
- **Commit reviewed**: `266adf1403` (cleaner) — re-fix for my pass-1 bounce
- **Reviewer**: architect, 2026-08-20
- **Prior bounce**: 1 — architect→coder, `behavior`, `ac342019ed` (D1–D4), evidence `BL-967-architect-review-20260820.md`
- **Verdict**: **PASS — inventory items: NONE.** Forward to hardender.

---

## Every pass-1 defect, re-verified

| # | Defect | Status |
|---|---|---|
| **D1a** | `agent_runtime_inject.bb:15` — a second, identically-named `tmux!` on unbounded `process/sh`, on the 1s delivery tick | **CLOSED** — now `(apply daemon-cycle-guard-lib/sh! "tmux" args)`; the lib load-files the guard and no longer requires `babashka.process` at all. |
| **D1b** | `master_checkout_drift_lib.bb:180` — unbounded `git -C` in the heavy bundle | **CLOSED** — `run-git` routes through the chokepoint; require dropped. |
| **D2** | Invariant 1's structural half unencoded, its stated reason falsified | **CLOSED** — see below. |
| **D3** | DRY extraction inserted mid-sentence in the BL-252 comment | **CLOSED** — extraction moved out; BL-252's sentence reads whole again (*"…Any failure (CLI not yet compiled on this checkout, etc.) degrades to omitting the line entirely…"*); the orphan fragment is gone and the stale `:dir`/varargs warning no longer sits above a function that does not shell. |
| **D4** | Step file said "500ms" after the bound was raised | **CLOSED** — now "WAIT_BOUND_MS (5000)". |

### D1 re-verified the way it was found
I re-ran the same transitive `load-file` closure from `handoffd.bb` (37 files),
comment-stripped. The ONLY surviving matches are `daemon_cycle_guard_lib.bb`'s own
intentional `process/process` and docstring prose in two files. Both pass-1 sites
are gone.

### D2 — the gate is real, and I proved it bites
`daemon_cycle_guard_lib_test_runner.bb` now computes the closure via
`master_checkout_drift_lib`'s BFS (**not** a hand-maintained list — the exact
failure mode that produced D1) and asserts no file outside the chokepoint
references `babashka.process` / `clojure.java.shell` / `process/sh` /
`process/process`. Comments and string contents are stripped first, so
`handoff_lib.bb`'s docstrings — which *name* `clojure.java.shell` while forbidding
it — cannot trip a gate meant to catch calls. A sanity assert requires the BFS to
resolve >20 files, so a broken walk cannot pass vacuously.

**Non-vacuity, reproduced by me rather than taken on the author's word**: I
reintroduced the exact D1a regression (`(apply process/sh "tmux" args)`) and the
gate failed naming it —
`["agent_runtime_inject.bb:17: (apply process/sh \"\" args))"]` — then restored and
confirmed green.

---

## Regression checks on the re-fix itself

The coder dropped `handoffd.bb`'s now-unused `babashka.process` require, which
would break any *other* `process/…` call the gate's token list does not name.

| Check | Result |
|---|---|
| Orphaned `process/` calls after the require removal | **NONE** in `handoffd.bb`, `agent_runtime_inject.bb`, `master_checkout_drift_lib.bb` (comment-stripped scan); all three now carry zero `babashka.process` requires. |
| Parse | `handoffd.bb`, `handoff_lib.bb`, `agent_runtime_inject.bb`, `master_checkout_drift_lib.bb`, `daemon_cycle_guard_lib.bb` — all OK. |
| Guard-lib unit runner (carries the new gate) | **ALL PASS** |
| Guard-lib property runner (both invariants) | **ALL PROPERTIES HOLD** — P1 20 runs w/ real children, P2 180 runs; generator coverage non-degenerate. |
| `master_checkout_drift_lib` unit runner (newly routed) | **ALL TESTS PASSED** |
| `mono_router_lib` unit runner | **ok** |
| Acceptance 01–04 vs the REAL `handoffd.bb` | **4/4 pass** |
| Dependency-rule gate (BL-259, hard gate) | RUN — only the pre-existing `out/tools/telegram*` `acyclic` cycle; parcel touches **no** telegram file. Not a BL-967 defect. |
| Co-change (BL-255) | RUN, informational — `agent_runtime_inject.bb` ↔ `handoffd.bb` (4) and `handoff_inject_lib.bb` (3). See the observation below. |
| Cross-ticket collateral (BL-506) | **In scope.** Both files the cleaner touched outside BL-967 (`readLiveRoleHeldTicketsCli.test.js`, `operatorRuntimeBbFixtureFiles.js`) are copy-lists of `handoff_lib.bb`'s dependencies that BL-967's own new load-file made stale. Patching them is required by this ticket, not scope creep. |

## Observation, not a defect

`handoff_inject_lib.bb` carries the same "second `tmux!` helper" shape D1a had.
It is **not** in `handoffd.bb`'s load-file closure (it serves `swarm_handoff.bb`,
not the poll cycle), so invariant 1 does not reach it and the gate correctly does
not police it. Recorded so the next reader does not mistake it for a missed D1 site.

---

## Routed separately by `note` — a PRE-EXISTING defect I found while sweeping D1

Chasing whether a *third* copy-list had been missed, I found **four** that still
lack `daemon_cycle_guard_lib.bb`:

- `specs/pipeline/steps/bl814LiveRoleHeldLoudDegradeSteps.js`
- `specs/pipeline/steps/bl487BoardFreshnessWithoutCoordinatorSyncSteps.js`
- `swarmforge/scripts/test/lib/operator_runtime_sandbox.sh`
- `swarmforge/scripts/test/test_lean_ledger_bb_wiring.sh`

**This is NOT a BL-967 defect, and I verified that rather than assuming it.** All
four also lack `prompt_engine_lib.bb`, which `handoff_lib.bb` has load-filed since
**BL-911 (2026-08-17)**. Reproduced against a true pre-BL-967 base (`95eebfcbf^`):
the same list already fails on `prompt_engine_lib.bb` at `handoff_lib.bb:37`.
`test_lean_ledger_bb_wiring.sh` is red today (exit 1) and was red before this
parcel; BL-967 only changes *which* missing file it dies on (line 29 vs 37), not
the outcome. **No standing gate runs that test**, which is why three days passed
unnoticed.

Routing this as a `note` to specifier + coordinator per Article 4.4 — it is not a
second bounce, and BL-967 must not be held for a defect it did not cause. The
durable fix is the one BL-944 already built for the guarded list: derive the copy
list from the real closure instead of hand-maintaining it. Two lists now have that
guard; four do not.
