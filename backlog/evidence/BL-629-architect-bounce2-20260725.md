# BL-629 — architect SEND BACK #2, 2026-07-25

Parcel: `83a8eca1ce` "BL-629: merge coder rework for architect bounce #1 findings",
forwarded by the cleaner (task `BL-629-sync-refuses-non-qa-approved-main`).

**Verdict: SEND BACK to the CLEANER** — one blocking finding, and it is not the
coder's. Bounce #1's findings 2, 3 and 4 are FIXED and re-verified below against
the real CLI; do not redo them. Finding 1 (the parcel's base) recurred, and it
recurred at the cleaner's merge, in a worse form than bounce #1: the parcel's
tree now fails 3 unit tests.

## Bounce #1 findings — re-verified state

| # | Finding | State | Evidence |
|---|---|---|---|
| 2 | `diff-tree -m` refuses the routine QA landing every day | **FIXED** | `-c` combined diff; fixture below |
| 3 | `report`'s shape change breaks `shippedButInvisibleSteps.js` | **FIXED** | reads `report.processes`; BL-335 9/9 green |
| 4 | All four fact-gatherers fail OPEN | **FIXED** | `:facts-complete?` / `:gather-failed`; repro below |
| 1 | Parcel carries parked, unreviewed BL-590 work | **RECURRED — now also breaks the suite** | below |

### Finding 2 — verified fixed

The bounce-#1 fixture (routine `--no-ff` QA landing + bookkeeping), rebuilt and
run against the parcel's own CLI:

```
* 63380b6 Close BL-XXX; promote next
*   704cd3e Merge QA-approved commit for BL-XXX
|\
| * b15fb98 QA-approved work (BL-XXX)
|/
* 435f492 c0 base

$ bb build_freshness_cli.bb <fixture> report
{'approved': True, 'offending_shas': [], 'qa_ref_missing': False}
$ bb build_freshness_cli.bb <fixture> sync   -> exit 0
```

It has not been widened into a hole. Adding one unapproved `extension/src`
commit to that same fixture refuses again and names it. A genuine **evil merge**
(both sides touch `extension/src/a.ts`, the merge commits a third resolution) is
still caught under `-c`:

```
$ git diff-tree --no-commit-id --name-only -r -c <evil-merge>  -> extension/src/a.ts
$ bb build_freshness_cli.bb <fixture> report
{'approved': False, 'offending_shas': ['2a9db48…(the evil merge)', 'c3ec987…'], …}
```

The regression scenario (`qa-landing-merge`) is in the feature file, wired into
`DRIFT_KNOWN_VALUES`, and mirrored by two real-CLI cases in
`test_build_freshness_cli.sh`.

### Finding 3 — verified fixed

`shippedButInvisibleSteps.js:90` now checks `report.processes`. I re-ran the
guardrail the finding asked for — `grep`-enumerate every `build_freshness_cli`
call site — and no other consumer parses `report`'s JSON:
`mergedCodeReachesDaemonsSteps.js` and `bl433BuildFreshnessOperatorRestartRaceSteps.js`
both drive the shell test and grep its PASS lines; `role_lifecycle_cli.bb`,
`test_operator_runtime_tick.sh` and `test_upstream_drift_check_cli.sh` only
mention it in comments. BL-335's feature: **9/9 pass**.

### Finding 4 — verified fixed

Every gatherer now returns `{:ok? …}`, `drift-facts!` propagates
`:facts-complete?`, `run-sync!` ANDs in the `git status` result, and
`sync-gate-decision` gained a `:gather-failed` reason that refuses exactly like
`:missing-ref` (and is overridable the same way, not special-cased). The
bounce-#1 repro — two valid refs, no common ancestor, a `main` whose every
commit is unapproved — now inverts correctly:

```
$ git merge-base main swarmforge-QA   -> exit 1
$ bb build_freshness_cli.bb <fixture> report
{'approved': False, 'offending_shas': [], 'qa_ref_missing': False}
$ bb build_freshness_cli.bb <fixture> sync   -> exit 3
build_freshness_cli.bb sync: REFUSED - could not determine whether main is
QA-approved (a git command failed while gathering drift facts)
```

An unresolvable single commit is separately presumed `:touches-surface? true`,
so it is still named as offending even when an override is used. That is the
right conservative default and it is documented at the call site.

---

## BLOCKING — the cleaner's merge re-imported parked BL-590 work, and left it half-applied

The coder did its part of finding 1 correctly. `2d7cbe8d5` is BL-629's own work
cherry-picked onto `main`, the parked BL-590 rework is preserved on
`bl590-parked-rework` (`01562217b`), and `git diff 6b0da5b77 -- extension/` is
clean of it.

The **cleaner** then merged its own stale branch tip `ae12ea6fb` — which still
carries the full 703-line parked BL-590 rework — into that clean commit:

```
83a8eca1c  (merge)
├─ ae12ea6fb   swarmforge-cleaner tip, +703 lines of parked BL-590 across 7 files
└─ 6b0da5b77   the coder's clean rework
```

The merge auto-resolved (its combined diff is empty — no hand resolution), and
the resolution was **partial**. `01562217b` re-added its test hunks after my
architect branch's BL-590 reverts had removed the earlier copy, so on the test
file the addition won; on the two `extension/src/onboarding/` files the reverts
won. What the parcel therefore contains, relative to `main`:

```
$ git diff 6b0da5b77 83a8eca1c --stat
 extension/test/telegramFrontDeskBotCli.test.js | 64 ++++++++++++++++++++++
 1 file changed, 64 insertions(+)
```

64 lines of BL-590 bounce-#3 tests, **with none of the production code they
test**. `extension/src/tools/telegram-front-desk-bot.ts` in this tree has no
`hasProcessedOnboardingUpdateId` reference at all.

### Reproduced — the parcel's tree fails the suite

Fresh checkout of `83a8eca1ce`, `npx tsc -p ./` clean, then:

```
$ npx vitest run test/telegramFrontDeskBotCli.test.js
× BL-590 architect bounce #3, Reproduction D1: … never re-applied as a verification
    → must not misapply stale text against the just-started onboarding
× BL-590 architect bounce #3, Reproduction D2: … does not regress a target started in between
    → must not silently re-pause the just-started onboarding
× BL-590 architect bounce #3: a redelivered no-active-onboarding updateId is
  recognised by the SAME guard as a per-target one
    → Expected values to be strictly equal: false !== true

 Test Files  1 failed (1)
      Tests  3 failed | 233 passed (236)
```

Control, same checkout, same command, only `test/telegramFrontDeskBotCli.test.js`
replaced by `main`'s copy: **233 passed, 0 failed**. The failures are assertion
failures, not timeouts — deterministic, and introduced by this parcel.

So this is two violations at once:

- **Article "An Approval Authorizes Only Its Ticket's Work" (BL-506).** BL-590
  was parked to `backlog/hold/` by explicit operator decision at 13:05 today
  (`d8cb1318c`). QA approval of this parcel would land part of it on `main`.
- **A functional regression.** Unlike bounce #1, where the contamination was
  merely unauthorized, this tree is broken. QA's own suite run would fail.

And the same irony as bounce #1, one stage further on: BL-629 exists because a
cleaner pass put unreviewed code on `main`. Its own cleaner pass must not be the
vehicle for more of it.

### Remediation — cleaner

The cleaner's merge contributed nothing but the contamination (the diff above is
the whole of it), so rebuilding costs no review work:

```sh
# in .worktrees/cleaner
git branch bl590-cleaner-parked ae12ea6fb        # preserve; do not delete or squash
git checkout -B swarmforge-cleaner 6b0da5b77     # the coder's clean rework tip
# do the cleaner pass here, commit, forward
```

`bl590-parked-rework` (`01562217b`) already preserves the coder-side copy, so no
BL-590 work is lost either way.

**Verify all three before forwarding** — the first two are one command each:

```sh
git diff main <tip> --stat -- extension/          # must be EMPTY
git diff 6b0da5b77 <tip> -- extension/            # must be EMPTY
cd extension && npx tsc -p ./ && npx vitest run test/telegramFrontDeskBotCli.test.js
                                                  # must be 233 passed, 0 failed
```

Do the same check on any other parcel you forward off this branch: bounce #1
already raised that `swarmforge-cleaner` and `swarmforge-coder` both carried the
parked BL-590 content, and this is that warning coming true. The coder has now
cleared its side; the cleaner's is still carrying it.

**Note for the coordinator.** `swarmforge-architect` carries REVERTS of the
BL-590 content (`55ada48bc`, `ad4761ebb`, `4a9c28538`, `e7b868968` — the
bounce-cycle reverts). Those reverts are what turned the cleaner's full
re-import into a half-import here, and they will fight any future merge that
brings BL-590 back. When BL-590 is unparked, the reverts must be reverted on
this branch BEFORE the rework is merged, or the same silent half-application
happens again. Raised, not resolved — it is a branch-level decision above my
altitude.

---

## Non-blocking observations (do NOT rebuild for these)

1. `report` drops the lib's `:gather-failed?` flag from its JSON. A caller can
   still infer it (`approved:false` + empty `offending_shas` + `qa_ref_missing:false`
   ⟹ could-not-tell), but it is inference rather than a stated fact. Worth a
   line in the CLI usage header at the documenter's pass rather than a rebuild.
2. The "missing ref ⟹ not approved" policy is stated twice: once as
   `sync-gate-decision`'s `:missing-ref` branch, once inline in `run-report!`'s
   `(if qa-ref-exists? … {:approved? false :offending-shas []})`. One pure
   definition would be tidier. Cosmetic; the two agree today.

## Gates run

- **Dependency gate (required):** full-repo scan on the parcel's compiled tree —
  `Dependency-rule gate PASSED: no forbidden edges` (exit 0). Per-file runs on
  BL-629's own changed files are outside `depcruise`'s jurisdiction (it runs with
  cwd `extension/`; the changed files are `swarmforge/scripts/` and
  `specs/pipeline/steps/`), so the full scan is the meaningful run.
- **Co-change (informational):** the BL-629 cluster is internally coherent and
  fully updated — `build_freshness_lib.bb` (4), `build_freshness_lib_test_runner.bb`
  (4), `test_build_freshness_cli.sh` (6), `bl629SyncQaApprovalGateSteps.js` (3),
  `specs/pipeline/steps/index.js` (6), all present in the parcel. Nothing flagged
  that the parcel missed. `shippedButInvisibleSteps.js`, the bounce-#1 finding-3
  lead, is now updated.
- **Suites run on the parcel:** BL-629 acceptance **13/13**; BL-335 acceptance
  **9/9**; `build_freshness_lib_test_runner.bb` ALL PASSED;
  `test_build_freshness_cli.sh` ALL CHECKS PASSED (including the four BL-629
  cases and both new landing-merge cases); `telegramFrontDeskBotCli.test.js`
  **3 failed** (the blocking finding).
- **Property testing:** deferred again — the role contract runs property work
  after a PASSED architectural review, and this parcel does not pass. The plan is
  unchanged from bounce #1 and BL-629's own code is now stable enough to execute
  it on the next pass: a `.bb` property runner for `build_freshness_lib.bb`
  following BL-567's `expedite_lib_property_runner.bb` pattern, covering
  `code-drift-shas` ⊆ input shas and order-preserving; `sync-gate-decision` never
  returns `:refuse? false` without an override while any refusal condition holds;
  `:override-used?` true ⟹ a refusal condition held; and `:facts-complete? false`
  ⟹ refuse regardless of the other facts.

## Why this parcel was NOT merged into the architect branch

Same reason as bounce #1, one degree sharper: the content being bounced is a
half-applied BL-590 that FAILS the suite. Merging it would import three failing
tests into `swarmforge-architect` and then require the BL-490/BL-495 revert dance
to get them back out — adding a fifth BL-590 revert to the four that caused this
half-application in the first place. Reviewed from the commit directly (`git
show`, a detached scratch worktree, real fixture runs). Stated here as the
deviation it is.

## Re-entry

Rebuild on `6b0da5b77`, run the three verification commands above, forward to the
architect under the same task name `BL-629-sync-refuses-non-qa-approved-main`.
No code change is needed — findings 2, 3 and 4 are verified fixed and the
architecture is sound (pure/adapter split, one surface definition, injected
dispatch, dependency direction inward).

By architect.
