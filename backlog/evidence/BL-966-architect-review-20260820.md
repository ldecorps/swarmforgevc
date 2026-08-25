# BL-966 — architect review pass 1: complete inventory, PASS (with a landing-order hazard for QA)

- **Ticket**: BL-966 — depth resolution answers identically from every checkout (`type: defect`, `severity: medium`, M8)
- **Commit reviewed**: `dd00974f3b` (cleaner) — coder `5c8b0835f8`
- **Reviewer**: architect, 2026-08-20
- **Verdict**: **PASS — inventory items: NONE.** Forward to hardender.
- ⚠️ **QA MUST READ the landing-order section below before landing this parcel.**

---

## Declared-invariant pass — all three verified, two of them empirically

**Invariant 1** — *same cap from the master checkout and every linked worktree.*
Verified against **real checkouts of this very repository**, not only fixtures:

| Root | This parcel's CLI | `main`'s CLI (pre-fix) |
|---|---|---|
| `swarmforgevc` (master) | **7**, exit 0, stderr empty | 7 |
| `.worktrees/architect` | **7**, exit 0, stderr empty | **3** |
| `.worktrees/coder` | **7**, exit 0, stderr empty | — |

That is the reported defect reproduced pre-fix and closed post-fix.

**Invariant 2** — *a cap not derived from a resolvable identity is never returned
silently.* The fall-through prints to `*err*` and leaves stdout/exit untouched, so
scripted callers that parse stdout are unaffected.

**Invariant 3** — *a non-git scratch root keeps today's stdout and exit code.*
`resolve-identity-root` returns the given root unchanged on any git failure, and
the `:non-git` generator arm plus `test_effective_backlog_depth_cli.sh` (ALL PASS)
cover it. The one harness asserting merged streams was adjusted in this parcel, as
invariant 3 requires.

**Non-vacuity — reproduced by me, not taken on the author's word:**

| Break | Result |
|---|---|
| `identity-root` pinned back to the caller's own root (the pre-fix shape) | FAIL — *"checkouts disagree (invariant 1)"* with concrete differing caps (7 vs 6, 6 vs 9) |
| fall-through notice silenced | FAIL — *"non-git fall-through must be loud on stderr, got \"\""* |

Both restored; runner green again.

| Check | Result |
|---|---|
| `bl966_depth_identity_root_property_runner.bb` | ALL PROPERTIES HOLD — 20 runs over REAL git checkouts; coverage `{:with-identity 6, :no-identity 11, :non-git 3, :two-worktrees 6}` (the two-worktrees arm is what makes invariant 1 meaningful). |
| `backlog_depth_test_runner.bb` | ALL PASS |
| `test_effective_backlog_depth_cli.sh` | ALL PASS, exit 0 |
| Acceptance 01–04 | **4/4 pass** |
| Dependency-rule gate (BL-259, hard gate) | RUN — only the pre-existing `out/tools/telegram*` cycle; no telegram file touched. |
| BL-967's closure gate with BL-966's new subprocess call | **ALL PASS** — the new `git rev-parse --git-common-dir` correctly routes through the bounded chokepoint, so invariant 1 of BL-967 stays satisfied. |
| Memoization | `defonce` cache keyed by root; safe under repeated poll-cycle calls and across the several load-file re-evaluations this lib sees. |
| Architecture | Single resolution point (`resolve-identity-root`) consumed by `conf-file-path`; no second identity path introduced. |

---

## ⚠️ Landing-order hazard — NOT a defect in this parcel, but it must not land first

This parcel makes `backlog_depth_lib.bb` `load-file` **`daemon_cycle_guard_lib.bb`**,
which exists **only in BL-967's parcel** — still in flight (with the hardender) and
**absent from both `main` and `origin/main`**. BL-966 declares `depends_on: []`.

**Proven, not asserted.** I built the exact post-landing state (main's script set +
this parcel's `backlog_depth_lib.bb`) and loaded it:

```
Type:     java.io.FileNotFoundException
Message:  …/scripts/daemon_cycle_guard_lib.bb (No such file or directory)
Location: …/scripts/backlog_depth_lib.bb:42:1
```

Adding the guard lib back → `LOADED OK`.

**Blast radius if BL-966 lands before BL-967**: `backlog_depth_lib.bb` is
load-filed by **10 files including `handoffd.bb`** — plus `ambulance_lib.bb`,
`flow_watchdog_lib.bb`, `coordinator_config_lib.bb`, `compliance_battery`, and the
depth CLIs. The daemon would fail to load: a swarm-wide transport outage from a
sequencing accident.

**Why this is not a coder defect.** Routing the new subprocess through the
chokepoint is the *correct* choice — using `process/sh` directly would violate
BL-967's invariant 1 the moment BL-967 lands, and I confirmed BL-967's closure gate
passes precisely because the coder did this. The coupling is inherent to the two
tickets, and the coder's commit message names it. What is missing is only that the
*landing-order* consequence is recorded nowhere the landing decision is made
(`depends_on` is still `[]`, and it gates promotion, not landing — BL-966 is
already active, so amending it now would not gate anything either).

The risk is not hypothetical: **BL-967 has already bounced once** (my own pass-1
bounce), so it can fall behind BL-966 in the pipeline.

**Required of QA at landing**: land **BL-967 before BL-966**, or confirm
`swarmforge/scripts/daemon_cycle_guard_lib.bb` is present on `main` first. A
one-line check: `git cat-file -e main:swarmforge/scripts/daemon_cycle_guard_lib.bb`.

Also routed as a priority-`00` `note` to QA and the coordinator so it does not
depend on this file being read.
