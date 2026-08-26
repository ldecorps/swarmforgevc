# BL-629 — architect SEND BACK #3

- **Ticket**: BL-629 — `build_freshness_cli.bb sync` must refuse a `main` tip that is not QA-approved
- **Parcel received**: `65739e83aa` (`Merge architect bounce e66d9b5401 (BL-629 SEND BACK #2) - rebuild verification`), from **cleaner**
- **Date**: 2026-07-25
- **Verdict**: **SEND BACK to the coder** — one blocking finding, reproduced against the real acceptance runner
- **Prior evidence**: `BL-629-architect-bounce1-20260725.md`, `BL-629-architect-bounce2-20260725.md`

---

## Bounce #2's instruction was followed exactly

Bounce #2 sent the parcel to the **cleaner** with "rebuild on `6b0da5b77`, no code change
needed". The cleaner did precisely that:

```
$ git log -1 --format='%P' 65739e83aa
6b0da5b77a6280c1a776aa6046e1560c3826a25b e66d9b5401c4941e657fada478a9aaf5ccf80bdd
                ^ the requested base                    ^ the architect bounce

$ git diff --stat 6b0da5b77 65739e83aa
 backlog/evidence/BL-629-architect-bounce2-20260725.md | 251 +++++++
 1 file changed, 251 insertions(+)
```

The merge introduced **no code change** — exactly what was asked.

### Bounce #2's finding 1 (parked BL-590) is RESOLVED

The half-applied BL-590 rework is gone. The parcel's own contribution touches no
`extension/` file at all, and after merging it into the architect branch the
`extension/` tree is byte-identical to `main`:

```
$ git diff --stat main HEAD -- extension/
(no output)

$ git diff --stat $(git merge-base main 65739e83aa) 65739e83aa
 18 files changed, 2897 insertions(+), 60 deletions(-)
   (backlog/evidence/*, specs/features/BL-629*.feature,
    specs/pipeline/steps/{bl629SyncQaApprovalGateSteps,index,shippedButInvisible}.js,
    swarmforge/scripts/build_freshness_{cli,lib}.bb,
    swarmforge/scripts/test/{build_freshness_lib_test_runner.bb,test_build_freshness_cli.sh})
```

No `extension/` path in the list. The 703-line parked rework, the stray fifth
BL-590 revert, and the three failing tests bounce #2 reproduced are all gone.

### Bounce #1's findings 2, 3 and 4 remain fixed — re-verified after the merge

Re-run in this worktree on the merged tree (not taken on trust from bounce #2 —
a merge can silently drop a fix when only one side changed a hunk):

| Gate | Result |
|---|---|
| `bb swarmforge/scripts/test/build_freshness_lib_test_runner.bb` | `build_freshness_lib: ALL TESTS PASSED` |
| `bash swarmforge/scripts/test/test_build_freshness_cli.sh` | 12/12, exit 0, `ALL CHECKS PASSED` |
| BL-629 acceptance (13 scenarios) | **13 pass, 0 fail** |
| BL-335 acceptance (finding 3's gate) | **9 pass, 0 fail** |
| Dependency-rule gate on the three changed `.js` files | **PASSED: no forbidden edges** |

Finding 2's fix is now pinned by acceptance as well as by the shell test: the
Scenario Outline gained a `qa-landing-merge` example, and the shell test carries
`BL-629 landing-merge gate: a routine QA-landing merge plus bookkeeping reads as
approved, not offending drift`. Finding 4's fix gained scenario 11 (no common
history → `:gather-failed`, exit 3, "could not determine"). Both non-vacuous.

I also independently cross-checked `report`'s new `qa_approval` block against the
live repo, per the ticket's own QA procedure step 1 — the gate's answer is
*correct*, not merely green:

```
$ bb swarmforge/scripts/build_freshness_cli.bb <root> report | jq .qa_approval
{"approved": true, "offending_shas": [], "qa_ref_missing": false}

$ for s in $(git log --format=%H $(git merge-base main swarmforge-QA)..main); do ... done
clean  1d3fa753ce  clean  7d93ecf13a  clean  6f069609ba  clean  365c041d18
clean  88aee4bfab  clean  807ba03e93  clean  c206d238ee  clean  28d54accb7
clean  b3f8f3d03b  clean  d768e6ba41  clean  2830489862  clean  8883389b77
```

All 12 drift commits genuinely bookkeeping-only → `approved: true` is the right
answer. `report` took **45 ms**, so the per-commit `git diff-tree` fan-out is not
a performance concern either.

---

## BLOCKING FINDING — a third live acceptance gate the parcel did not update

**BL-328 `merged-code-reaches-daemons-05` now fails.** `report`'s shape change was
swept for BL-335 (`shippedButInvisibleSteps.js`) and for the shell test, but the
third consumer of this CLI was missed — and it is missed on the `sync` side, not
the `report` side, so the fix is different in kind.

### The defect

`specs/pipeline/steps/mergedCodeReachesDaemonsSteps.js:402` spawns the **real**
`sync` against its own fixture repo:

```js
const result = spawnSync('bb', [CLI, ctx.target, 'sync'], { ... });   // :402
...
if (result.status !== 0) {
  throw new Error(`sync failed: ${result.stderr}`);                   // :407-409
}
```

That fixture is built by `mkGitRoot()` (`:64-72`), which creates **`main` only** —
there is no `swarmforge-QA` branch:

```js
execFileSync('git', ['init', '-q'], { cwd: root });
execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'init'], { cwd: root });
execFileSync('git', ['branch', 'main'], { cwd: root });
return root;                     // <- no `git branch swarmforge-QA main`
```

So the new gate's **missing-ref fail-closed** path (spec resolution item 4, the
one the parcel correctly implements) fires, `sync` exits 3, and the step throws.

### Reproduced — twice

**1. Minimal repro, a fixture repo built exactly like `mkGitRoot()`:**

```
$ git init -q . && git commit -q --allow-empty -m init && git branch main
$ bb swarmforge/scripts/build_freshness_cli.bb $ROOT sync
build_freshness_cli.bb sync: REFUSED - the QA approval reference (swarmforge-QA) is missing
  remedy: land the change through QA, or rerun with --override (logged, one-shot)
EXIT=3
```

**2. The real acceptance runner, on the merged parcel tree:**

```
$ node specs/pipeline/cli.js specs/features/BL-328-merged-code-reaches-running-daemons.feature
not ok 8 - A restart loses no messages in either direction
  error: |-
    Scenario "A restart loses no messages in either direction" failed at step
    "When the affected processes are restarted to pick up new code":
    sync failed: build_freshness_cli.bb sync: REFUSED - the QA approval reference
    (swarmforge-QA) is missing
      remedy: land the change through QA, or rerun with --override (logged, one-shot)
# tests 9
# pass 8
# fail 1
```

### Why this is the coder's, and how it was findable

This is bounce #1 finding 3's **exact class**: a production shape/behaviour change
that breaks a live acceptance gate elsewhere in the suite. The parcel found two of
the three consumers and fixed both well — the shell test got
`git branch swarmforge-QA main` added to **six** separate fixtures (`:138`, `:357`,
`:416`, `:481`, `:526`, `:583`), which is precisely the right treatment. The third
consumer just was not enumerated.

The co-change tool names it directly:

```
$ node extension/out/tools/co-change-report.js swarmforge/scripts/build_freshness_cli.bb
  specs/pipeline/steps/index.js: 5 co-change(s) (SUSPECTED COUPLING)
  swarmforge/scripts/test/test_build_freshness_cli.sh: 5 co-change(s) (SUSPECTED COUPLING)
  ...
  specs/pipeline/steps/bl433BuildFreshnessOperatorRestartRaceSteps.js: 1 co-change(s)
  specs/pipeline/steps/mergedCodeReachesDaemonsSteps.js: 1 co-change(s)   <- this one
```

The full consumer sweep (I did it exhaustively, so the rebuild does not have to):

| Consumer | Uses | Status |
|---|---|---|
| `swarmforge/scripts/test/test_build_freshness_cli.sh` | real `report` + `sync` | **fixed** (5 fixtures) |
| `specs/pipeline/steps/shippedButInvisibleSteps.js` | parses `report` JSON | **fixed** (`report.processes`) |
| `specs/pipeline/steps/mergedCodeReachesDaemonsSteps.js` | **real `sync`, `:402`** | **BROKEN** |
| `specs/pipeline/steps/bl433BuildFreshnessOperatorRestartRaceSteps.js` | drives the shell test, greps PASS lines | OK — fragments still emitted |
| `swarmforge/scripts/role_lifecycle_cli.bb` | comment reference only | not a consumer |
| `test_operator_runtime_tick.sh`, `test_upstream_drift_check_cli.sh` | comment references only | not consumers |
| `swarmforge/roles/coordinator.prompt` | documents the operator-facing command | see advisory 3 |

**No production consumer parses `report`'s JSON** — the spec's claim on that point
holds; I re-verified it. `role_lifecycle_cli.bb`'s only mention is a comment about
single-ownership posture.

### Remediation

In `mkGitRoot()` (`mergedCodeReachesDaemonsSteps.js:64-72`), point the fixture's QA
integration branch at `main`, the same one-line treatment the coder already applied
six times in the shell test:

```js
execFileSync('git', ['branch', 'main'], { cwd: root });
execFileSync('git', ['branch', 'swarmforge-QA', 'main'], { cwd: root });
```

Note this fixture *advances* `main` mid-scenario (`:391-393`: an empty `merge`
commit, then `git branch -f main`). An empty commit touches nothing, so it is
bookkeeping-only drift and the gate stays silent — no `--override` needed, and
none should be added: reaching for the override in a fixture would hide exactly
the regression this gate exists to catch. Re-run
`node specs/pipeline/cli.js specs/features/BL-328-merged-code-reaches-running-daemons.feature`
and expect **9/9**.

---

## Advisories — fix in the same rebuild, not blocking on their own

**1. `bl629SyncQaApprovalGateSteps.js` spreads the real environment into a `sync`
that can spawn the front desk.** `runCliWithFakeNpm` passes
`env: { ...process.env, PATH: ... }`. `sync` can reach
`restart-front-desk-group!` → `launch_front_desk.sh`, which accepts whatever
`TELEGRAM_*` it is handed — and this box exports the **real** production bot
credentials (self-hosting). `mergedCodeReachesDaemonsSteps.js:110-116` documents
this hazard at length and defends against it with an explicit-allowlist
`fixtureEnv()`. Today the new file is safe *by luck of scenario composition*: the
only scenarios that make a process stale (06/07) request a `report`, never a
`sync`, so no restart path is ever entered. One future scenario pairing "a tracked
process is stale against main" with "a sync is requested" turns it live. Please
switch to the allowlist form (`PATH`, `HOME`) now, while it is a one-line change.

**2. `report` drops the `:gather-failed?` distinction that `sync` surfaces.**
`tip-approval-status` returns `{:approved? false :offending-shas [] :gather-failed? true}`
when facts are incomplete, but `run-report!` emits only
`{approved, offending_shas, qa_ref_missing}`. A reader of `report` therefore cannot
tell "unapproved, and here is why" from "could not tell" — the very distinction
finding 4 was about, present in the refusal message but absent from `report`. It is
fail-closed either way (`approved: false`), and no scenario requires it, so this is
not blocking; a `could_not_determine` sibling of `qa_ref_missing` would close it.

**3. For the documenter, when the parcel reaches that stage:**
`swarmforge/roles/coordinator.prompt:198-217` makes
`build_freshness_cli.bb <root> sync` the coordinator's mandatory step 0 after every
QA landing, and gives it a two-outcome contract (worked / "say so loudly"). The gate
adds a third outcome — refusal, exit 3 — with a remedy the coordinator is not told
about. This matters operationally, not hypothetically: the live master checkout is
routinely dirty with ticket-less operator edits, and any of them under
`extension/src/` or `swarmforge/scripts/` refuses step 0 by design (scenario 09).
The CLI usage header documents exit 3, which satisfies spec resolution item 5; the
role prompt is the gap.

---

## Architecture: sound, and better than it was

Recorded so the rebuild does not disturb it:

- **Pure/adapter split is exemplary.** `build_freshness_lib.bb` holds
  `on-deployed-surface?`, `touches-deployed-surface?`, `code-drift-shas`,
  `tip-approval-status`, `sync-gate-decision` and `execute-sync!` with no git and no
  fs; every fact-gatherer and side effect is injected from the CLI. This is the same
  contract `stale?` already kept (spec resolution item 7).
- **One surface definition, used two ways.** `on-deployed-surface?` is applied to
  both historical commit paths and `git status` paths, so the tip check and the
  working-tree check can never disagree about what counts.
- **Gate-first ordering is structural, not incidental.** `execute-sync!` returns
  `{:refused true}` before `recompile!` or `restart-group!` can be reached, and the
  ordering is proven by an injected spy in the `.bb` unit suite rather than left to a
  fixture that has no stale processes to restart anyway.
- **Fail-closed is uniform.** Missing ref, failed `merge-base`, failed `git log`,
  failed per-commit `diff-tree`, failed `git status` all converge on a refusal, and
  an unresolvable *individual* commit is presumed to touch the surface — the
  conservative default for that one commit, independent of the overall
  `facts-complete?` flag.
- **The `-c` choice is right, and the reasoning is captured in the code.** The
  combined diff reports only a merge's own resolution, so a routine `--no-ff` QA
  landing is silent while an evil merge is not; BL-590's own `f8dc07963` still
  refuses because its content commit `73706d79e` is enumerated independently. `-m`
  would have refused every day (bounce #1 finding 2).
- **Override is one-shot by construction.** `sync-gate-decision` is pure and
  stateless, and the CLI never reads `sync-overrides.jsonl` back — it cannot become
  sticky. The record is written before any recompile or restart, so the audit trail
  survives a failed deploy.
- Full-repo dependency-rule gate passed in bounce #1; the three changed `.js` files
  pass it again here. No new coupling introduced.

## Parcel disposition in the architect branch

The parcel WAS merged this round (`5c19d688f`) so the acceptance suites could be run
against the real merged tree — that is how finding 1 was cleared and how the BL-328
failure was reproduced non-vacuously. Because `65739e83aa` is **not** an ancestor of
`main`, Article 5.1 obliges the revert, so the merge is reverted out of this branch
in the same step as the send-back, verified **by content**.

> **For the architect receiving the rework:** this branch carries a revert of
> `5c19d688f`. Revert that revert **before** merging the rework, or the rework's
> content will be resolved away in the revert's favour.
