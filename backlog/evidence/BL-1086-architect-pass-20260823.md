# BL-1086 — architect pass

Received from cleaner as `merge_and_process cleaner 974c677d92` (cleaner's own
commit: dropped a vestigial status variable in batch mode, no behavior
change). Merge produced ONE conflict in `specs/pipeline/steps/index.js` —
expected: cleaner's branch was built before my BL-1063 bounce-revert reached
this branch, so its side still registered `bl1063BoundedWaitSteps`, a file my
revert had already deleted. Resolved by keeping the post-bounce registry
(dropping the `bl1063BoundedWaitSteps` require, keeping
`bl1083PromotionGateSteps` and adding `bl1086BabysitterCacheBatchSteps`) —
confirmed afterward that no `bl1063` reference survived and none of that
ticket's deleted files were reintroduced.

## required_wiring anchors — both verified present AND reached on the live path

- `pipeline-code-on-main-cache`: the live gather call at the bottom of
  `babysitter_check.bb` now reads `(gather-pipeline-code-on-main-cached)`, not
  the uncached `gather-pipeline-code-on-main` — the anchor's own named
  failure mode (a cache that exists while the live path still walks
  unconditionally) does not recur.
- `batched-qa-ancestry`: `gather-pipeline-code-on-main`'s live body calls
  `(batched-qa-ancestry all-shas)`, not a per-sha `mapv qa-ancestor?` loop —
  confirmed by reading the diff, not by the function's existence alone.

## Invariant 3 ("one predicate, fails closed as a whole") — checked directly

Grepped the full diff for `merge-base`: exactly one occurrence, the same
`git merge-base --is-ancestor "$FULL_SHA" swarmforge-QA` line moved into
`answer_one` (previously the script's own tail) — not duplicated, not
reimplemented elsewhere. `babysitter_check.bb` itself contains zero
`merge-base` calls; it only ever shells to `is_qa_ancestor.sh`. BL-925
invariant 2 holds literally.

## The two hazards the coder's own evidence flags — verified, not trusted

**Store-consultation order.** Read `collect_verdict_stores`/`answer_one`
directly: bounce stores (JSONL + YAML) are checked first inside `answer_one`,
and `EXPEDITE_PROBLEM` (set once, up front, if the expedite store itself
can't be read) is only raised *after* those checks — matching the original
single-SHA script's order (bounce veto takes precedence over an unreadable
expedite store). Confirmed by reading the control flow, not by re-deriving
it from scratch.

**`set -e` / failed grep in a substitution.** Both collection sites
(`BOUNCE_TOKENS`, `EXPEDITE_TOKENS`) end their pipeline with `|| true` before
assignment — checked each one is present at the actual collection line, not
just claimed in a comment.

## Verification run myself (not just re-reading the coder's evidence)

Rebuilt `extension/out` first (stale-build precedent).

| check | result |
|---|---|
| `bl1086_cache_and_batch_property_runner.bb` | ALL PROPERTIES HOLD (40 runs, coverage matches evidence exactly) |
| BL-1086 acceptance feature | 8/8 |
| `test_is_qa_ancestor_yaml_store.sh` | ALL CHECKS PASSED |
| `test_is_qa_ancestor_expedite_store.sh` | ALL CHECKS PASSED (15/15, incl. the BL-972 subject-claim guard and 3 real-writer end-to-end checks) |
| `test_babysitter_check.sh` | ALL PASS (13/13) |
| `node out/tools/dependency-gate.js` (full repo) | only the pre-existing, already-ticketed BL-759 cycle — this parcel touches none of those 3 files |
| `node out/tools/co-change-report.js` (4 changed files) | expected coupling only (babysitter sibling scripts, the step registry) |

**`test_pipeline_code_on_main_guard.sh`'s claimed pre-existing red — verified
independently, not taken on trust.** Built a detached worktree at this
parcel's own parent commit (`070c0487fc`, outside my working checkout so
nothing in my own tree was disturbed) and ran the same script there:
identical failure (`fatal: empty ident name ... not allowed` — a
scratch-fixture git-identity problem local to this machine, unrelated to
BL-1086's diff). Removed the worktree afterward. Confirms the coder's claim
rather than repeating it on faith.

Spot-checked the trickiest acceptance step handler by reading it directly:
the "one commit unanswerable inside an otherwise-successful batch" scenario
(`selective.sh`) deliberately makes the wrapper batch exit 0 with one line
rewritten to code `2`, rather than failing the whole batch process — the
step handler's own comment names why (failing the batch wholesale would
leave the "batch ran but one answer is undeterminable" branch, the one a
partial-result leak would actually hide in, completely untested). This is
the adversarial case that matters and it is genuinely exercised, not
simulated.

## Architecture

`is_qa_ancestor.sh` and `babysitter_check.bb` are the SwarmForge-fork
maintenance surface this pipeline builds (`swarmforge/scripts/`), not
upstream `unclebob/swarm-forge` code copied or forked further — in scope for
this pipeline. No VS Code extension / webview boundary applies here (pure
Babashka/shell); the project's Babashka testability gap is pre-existing and
correctly disclosed by the coder (BL-472: no mutation/CRAP/DRY wired for
`.bb`/shell, gated by its own unit/property/acceptance suites only — the
coder's evidence states this rather than implying more ran). Cache state
lives under `.swarmforge/babysitter/`, matching the existing daemon-state
convention, not a target-repo tracked path. No second copy of the approval
predicate; no in-memory cache masquerading as a fix for a process that never
survives a tick (the coder's own correct rejection of the ticket's suggested
"How," with a clear justification tied to the daemon's actual process
lifecycle — `babysitterd.sh` execs a fresh `bb` process every tick).

## Correctness read

No defect found. The one thing worth recording rather than gating on: **P1
(result equivalence) explicitly does not cross-check against an independent
reference implementation** — it compares the cached/batched path's answer
against a second run of the *same* code, so a bug wrong in the same way twice
would slip past it. The coder discloses this rather than hiding it, and P3-P6
(cache-a-hole, unanswered-as-no, whole-sweep-failure, one-predicate) together
cover the realistic wrong-in-a-new-way failure modes a refactor like this
actually risks. Not bounce-worthy — a stronger P1 would need an independent
non-cached/non-batched oracle, which is exactly the O(N) process-per-SHA cost
this ticket exists to remove, so demanding one here would be self-defeating.

## Verdict

COMPLIANT. No architecture violation, no invariant violation, no correctness
defect. Forwarded to hardener.
