# BL-629 — architect PASS (after three send-backs)

- **Ticket**: BL-629 — `build_freshness_cli.bb sync` must refuse a `main` tip that is not QA-approved
- **Parcel received**: `878f55de72` (`BL-629 rework: fix architect bounce #3's blocking finding + advisories`), from **coder**
- **Date**: 2026-07-25
- **Verdict**: **PASS — forward to the hardener**
- **Prior evidence**: `BL-629-architect-bounce1-20260725.md`, `-bounce2-`, `-bounce3-`

---

## Merge hygiene — the revert-the-revert trap was live here

Bounce #3 reverted its own review merge out of this branch (`54e2f245b`, per Article
5.1, `65739e83aa` not being on `main`). A plain `git merge` of the rework would then
have resolved the reverted base content away in the revert's favour, landing the
parcel half-applied and green. Bounce #3's evidence carried a note to the next
architect for exactly this; it was followed:

```
git revert --no-edit 54e2f245b   -> 259ab15dc  (Reapply "Merge cleaner rebuild 65739e83aa")
git merge --no-ff 878f55de72     -> 2430091ff
```

Verified **by content**, not by ancestry (ancestry can never go FALSE after a revert):

| Check | Result |
|---|---|
| Parcel's own files present (`bl629SyncQaApprovalGateSteps.js`, feature, both `.bb`) | all present |
| Full parcel diff vs `merge-base main HEAD` | 20 files, +3196/-60 |
| `git diff main HEAD -- extension/` | **empty** — bounce #2's finding 1 stays resolved |
| `git merge-base --is-ancestor 878f55de72 HEAD` | true (lineage intact) |

---

## Bounce #3's BLOCKING finding — FIXED

`mergedCodeReachesDaemonsSteps.js`'s `mkGitRoot()` now points the QA integration
branch at `main`, the exact one-line remediation prescribed, applied at `:72`:

```js
execFileSync('git', ['branch', 'main'], { cwd: root });
execFileSync('git', ['branch', 'swarmforge-QA', 'main'], { cwd: root });   // added
```

Critically, the coder did **not** reach for `--override` in the fixture — which
would have hidden precisely the regression this gate exists to catch. The
prescribed remediation was followed to the letter.

```
$ node specs/pipeline/cli.js specs/features/BL-328-merged-code-reaches-running-daemons.feature
# tests 9   # pass 9   # fail 0        (was 8 pass / 1 fail at bounce #3)
```

## Both advisories — CLOSED

**Advisory 1 (real production credentials).** `runCliWithFakeNpm` no longer spreads
the ambient environment into a `sync` that can reach `restart-front-desk-group!` →
`launch_front_desk.sh`:

```js
env: { PATH: `${ctx.fakeBin}:${process.env.PATH}`, HOME: process.env.HOME },
```

`grep -n 'process\.env'` over the file returns only this line and its explanatory
comment — no `{...process.env}` survives anywhere in it. This also incidentally
satisfies engineering.prompt's "`env -u SWARMFORGE_CONFIG` before fixture confs":
an ambient `SWARMFORGE_CONFIG` can no longer leak into the fixture CLI at all.

**Advisory 2 (`report` dropped the gather-failed distinction).** `run-report!` now
emits `could_not_determine`. I case-analysed all four reachable states rather than
trusting the diff, and they are coherent and mutually distinguishable:

| `qa-ref-exists?` / `facts-complete?` | `approved` | `qa_ref_missing` | `could_not_determine` |
|---|---|---|---|
| true / true, no drift | true | false | false |
| true / true, drift | false | false | false |
| true / **false** | false | false | **true** — "could not tell" |
| **false** / any | false | **true** | false — a *known* reason, not a gap |

The fourth row is the one worth stating: a missing ref reports
`could_not_determine: false` because it is a determinate answer, and the reason is
already carried by `qa_ref_missing`. Fail-closed in every row (`approved` false
whenever not affirmatively approved). The field is additive, so the existing
`report` consumer (`shippedButInvisibleSteps.js`) is unaffected — confirmed by
running it, below.

---

## Gates run on the merged tree

Re-run here rather than taken on trust — a merge can silently drop a fix when only
one side changed a hunk, and this merge in particular followed a revert-the-revert.

| Gate | Result |
|---|---|
| `bb build_freshness_lib_test_runner.bb` | `ALL TESTS PASSED` |
| `bash test_build_freshness_cli.sh` | **12/12**, exit 0 |
| BL-629 acceptance | **13/13** |
| BL-328 acceptance (bounce #3's blocking finding) | **9/9** (was 8/9) |
| BL-335 acceptance (bounce #1 finding 3) | **9/9** |
| **BL-433 acceptance** (never run in any prior bounce) | **5/5** |
| Dependency gate, changed `.js` files | PASSED: no forbidden edges |
| Dependency gate, **full-repo scan** | PASSED: no forbidden edges |

Two of those needed corrected invocations, both tooling artefacts and **not**
findings: `dependency-gate.js` takes paths relative to `extension/` (it runs
`depcruise` with `cwd=EXTENSION_ROOT`), and the BL-335 feature file is
`BL-335-shipped-but-invisible-to-the-human.feature`.

`extension/` is byte-identical to `main`, so the Vitest unit suite is unaffected by
this parcel by construction; not re-run for that reason.

### The consumer sweep, closed out exhaustively

Three bounces each found a missed consumer, so this round enumerated them to
exhaustion instead of sampling:

| Reference | Executes the CLI? | Status |
|---|---|---|
| `test_build_freshness_cli.sh` | real `report` + `sync` | fixed (6 fixtures) |
| `shippedButInvisibleSteps.js` | parses `report` JSON | fixed |
| `mergedCodeReachesDaemonsSteps.js:403` | real `sync` | **fixed this round** |
| `bl433BuildFreshnessOperatorRestartRaceSteps.js` | drives the shell test, greps PASS lines | OK — **proven by running BL-433, 5/5** |
| `role_lifecycle_cli.bb`, `test_operator_runtime_tick.sh`, `test_upstream_drift_check_cli.sh` | comment references only | not consumers |
| `bl464PipelineBoardAuthoritativeStageSourceSteps.js` | spawns `pipeline_stage_cli.bb sync` — a **different** CLI | not a consumer |
| `frontDeskSurvivesRebootSteps.js` | same `main`-only fixture shape, but invokes `launch_front_desk.sh` **directly** | not a consumer; BL-351's mention is about who calls *launch_front_desk.sh*, the reverse direction |
| `coordinator.prompt` | operator-facing doc | documenter — advisory below |

The co-change tool now ranks `mergedCodeReachesDaemonsSteps.js` at 2 co-changes with
`build_freshness_cli.bb` (was 1) — the coupling it flagged at bounce #3 is now
recorded in history rather than latent.

---

## Property testing (architect-owned phase)

**No property test is warranted by this parcel, and none was manufactured.** The
only pure module it touches is `build_freshness_lib.bb`, which is Babashka —
fast-check is a JS framework and cannot reach it, and per engineering.prompt's
Startup Tools the `.bb` mutation/CRAP/DRY toolchain is explicitly not wired
(BL-472, deliberately deferred), so the `.bb` unit suite *is* the gate for it and it
passes. Everything else the parcel touches is either an adapter (`build_freshness_cli.bb`)
or acceptance-test infrastructure — neither is a property-shaped pure production
module.

---

## Architecture: sound, undisturbed by the rework

The rework touched only the fixture, the step-file env, and `report`'s output shape
plus its usage header. Every architectural property recorded in bounce #3 is intact:

- **Pure/adapter split** — `build_freshness_lib.bb` holds `on-deployed-surface?`,
  `code-drift-shas`, `tip-approval-status`, `sync-gate-decision`, `execute-sync!`
  with no git and no fs; all facts and effects injected from the CLI.
- **Gate-first ordering is structural** — `execute-sync!` returns `{:refused true}`
  before `recompile!` or `restart-group!` is reachable, proven by an injected spy.
- **Fail-closed is uniform** — missing ref, failed `merge-base`/`git log`/`diff-tree`/
  `git status` all converge on refusal; an unresolvable individual commit is presumed
  to touch the surface.
- **Override is one-shot by construction** — `sync-gate-decision` is pure and
  stateless and the CLI never reads `sync-overrides.jsonl` back, so it cannot become
  sticky; the record is written before any recompile, so the trail survives a failed
  deploy.
- **One surface definition used two ways**, so the tip check and working-tree check
  can never disagree.

---

## For the hardener

1. **`could_not_determine` has no assertion on the CLI's actual JSON output.** The
   underlying pure `tip-approval-status` gather-failed path *is* covered
   (`build_freshness_lib_test_runner.bb:122,125`), but the one-line adapter mapping
   in `run-report!:249` is asserted nowhere — no shell-test case, no acceptance
   scenario. Not blocking (additive, informational, fail-closed either way, and
   advisory 2 was explicitly non-blocking), but it is a new public output field with
   zero coverage at the boundary that emits it. Natural home: a
   `test_build_freshness_cli.sh` case alongside the existing BL-629 report-gate case.
2. Note the `.bb` toolchain gap above — mutation/CRAP/DRY do not exist for these
   files; the `.bb` unit suite plus the shell test are the real gate.

## For the documenter (carried forward from bounce #3, still open)

`swarmforge/roles/coordinator.prompt:198-217` makes `build_freshness_cli.bb <root> sync`
the coordinator's mandatory step 0 after every QA landing and gives it a **two**-outcome
contract (worked / "say so loudly"). This ticket adds a **third** — refusal, exit 3 —
with a remedy the coordinator is never told about. Operationally live, not
hypothetical: the master checkout is routinely dirty with ticket-less operator edits,
and any under `extension/src/` or `swarmforge/scripts/` refuses step 0 by design
(scenario 09). The CLI usage header documents exit 3, satisfying spec resolution item
5; the role prompt is the gap.

## Ticket-less content surfaced, not swept (BL-506)

Two untracked paths sit in this worktree, neither created by me and neither part of
BL-629. Left unstaged and un-deleted, reported rather than tidied:

- `node_modules/` (at the worktree root)
- `swarmforge/scripts/test/test_swarm_handoff_mono_router_auto_rotate.sh`

Only `backlog/evidence/BL-629-architect-pass-20260725.md` was staged for this commit.
