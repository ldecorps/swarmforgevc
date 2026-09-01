# BL-632: Commit-Time Guard Refuses Pipeline Code on Main

Two versioned git hooks refuse, at commit time, a commit or `--no-ff` merge
that would put pipeline code (`extension/src/`, `extension/test/`,
`specs/pipeline/steps/`) onto `main` from any role but QA.

**Last Updated:** 2026-08-31

## Background

The BL-590 post-mortem (2026-07-25) found four commits that put un-QA'd
pipeline code on `main` and `origin/main`. BL-629 (deploy gate) and BL-630
(publish gate) both react to a bad `main` tip that already exists; BL-631
detects one after the fact. None of the three stops the tip from existing
in the first place. BL-632 is that layer: it refuses the commit or merge
before it is made.

## How It Works

`core.hooksPath` is set to the versioned, in-repo `swarmforge/git-hooks`
(`swarmforge.sh:ensure_commit_size_guard`, re-set on every `./swarm`
launch). All role worktrees share one physical `.git` dir, so this one
install covers every role.

Two hooks both run `check_pipeline_code_on_main.sh`, so the QA-exclusive
path definition lives in exactly one place — but as of BL-1303 neither
hook is a delegate to that one script alone; each runs a small ordered
*chain* of independent guards, aggregated through the shared
`swarmforge/scripts/commit_guard_chain_lib.sh` so a violation from any
guard in the chain is collected rather than aborting the rest (see
"Guard-Chain Aggregation Is Shared, Not the Whole Chain (BL-1303)" below):

- **`pre-commit`** — fires for a plain `git commit`, including
  `git commit --amend`. Delegates to `run_commit_guards.sh`, which runs
  five guards in total: `check_commit_size.sh`, `check_ticket_deletion.sh`,
  `check_pipeline_code_on_main.sh`, `check_feature_handler_registration.sh`
  (cheap tier), then `check_property_suite_drift.sh` (expensive tier, run
  only once the cheap tier passes).
- **`pre-merge-commit`** — a separate hook, fires for `git merge --no-ff`
  (the shape `merge_and_process` uses on the handoff path, and how QA
  lands every approved commit). Without this second hook, `pre-commit`
  alone would leave the `--no-ff` merge path unguarded — the exact hole
  the BL-590 post-mortem called out. It runs two of the five:
  `check_pipeline_code_on_main.sh` and `check_feature_handler_registration.sh`
  — not the whole chain (see below for why).

This section (through "QA-exclusive paths") describes `check_pipeline_code_on_main.sh`
itself, the guard both hooks share and the one this ticket is named for.
The guard itself:

1. Exits 0 immediately on any branch other than `main`.
2. Exits 0 if `SWARMFORGE_ROLE=QA` — the deny path deliberately does not
   depend on the role env var being set at all; only this one allowance
   reads it. A role whose env is lost, or a bare human shell, is refused
   rather than waved through.
3. Otherwise checks `git diff --cached --name-only` against the
   QA-exclusive path set. If any staged path matches, it is an *offender*
   — unless the merge-import exemption below clears it — and the commit
   is refused (exit 1) with the remaining offending path(s) and the remedy
   printed to stderr; otherwise exits 0.

### Merge-import exemption (BL-925 / BL-1096)

Before BL-925, completing a merge that only **imports** an already
QA-published `origin/main` was refused exactly like fresh non-QA
authorship — the guard asked only branch and `SWARMFORGE_ROLE`, with no
notion of a merge at all. That's the routine shape of BL-891's reconcile
sweep merging `origin/main` forward into the master checkout's local
`main`: the checkout is non-QA, but the content came from QA. The refusal
made that clean join never complete while `main` was ahead-and-behind —
its steady state — so [BL-891's sweep](../how-to/BL-891-master-main-reconcile-sweep.md)
aborted the same merge on every tick and logged a false conflict.

The guard now checks, for each offending path, whether that path's
**last-touching commit on the incoming side** is already an ancestor of
`swarmforge-QA` and, if so, whether that path's staged content is
byte-identical to what the incoming parent holds:

- **Content provenance decides, not merge-in-progress.** Being mid-merge
  is never on its own sufficient — a writer could stage fresh pipeline
  edits on top of a legitimate merge of a published tip and ride through
  on its coat-tails. Every offending path is judged individually; only a
  path whose staged content exactly matches the incoming parent is
  cleared. A path with any real difference stays refused, even inside an
  otherwise-exempt merge.
- **Per-path anchor (BL-1096), not merge tip alone (BL-925).** Asking
  `is_qa_ancestor.sh` about `MERGE_HEAD` once for the whole merge worked
  when the tip *was* QA's landing (single-hop-behind). On a multi-hop
  reconcile the tip is often a later bookkeeping commit — not a QA
  ancestor — and the old tip-level gate withdrew the exemption for every
  path, including those whose last-touching incoming commit QA did
  publish. Each path now runs `git log -1` on the incoming parent for that
  path, then asks the shared predicate about that commit. Absent,
  undeterminable, bounced, or unpublished anchors fail closed for that
  path only.
- **Finding the incoming merge parent** needs two routes, because
  `.git/MERGE_HEAD` is not always written yet when the hook runs:
  reliable when the merge was explicitly stopped (`--no-commit`) or a
  conflict was later completed via `git commit --no-edit` (the
  `pre-commit` path), but *not* written to disk before `pre-merge-commit`
  fires for a clean, no-conflict `git merge` (confirmed empirically
  against git 2.36.1 — the fast path commits in one step and never
  persists throwaway merge state). When `MERGE_HEAD` is absent, the guard
  falls back to the `GITHEAD_<sha>=<name>` environment variables git's own
  merge machinery sets for each parent — the same contract external
  merge-driver tools rely on — and only when *exactly one* such variable
  is present, so an ambiguous or absent signal never grants the exemption
  (fails closed).
- **One shared definition of "QA-approved tip."** The approval check lives
  in exactly one place, `swarmforge/scripts/is_qa_ancestor.sh` — called
  directly here and shelled to by `handoffd.bb`'s push-sweep gate
  (`qa-ancestor?`). Originally pure ancestry (`git merge-base --is-ancestor
  <sha> swarmforge-QA`); as of BL-952 it also refuses a sha carrying an
  unreverted QA bounce verdict (either the JSONL store `record-bounce.js`
  appends or a ticket's tracked `bounce_history`), since QA merges a parcel
  into `swarmforge-QA` to review it, so a bounced parcel stays reachable
  from that ref and otherwise reads as approved forever. Neither caller
  re-implements the check; a "kept in sync" comment across that
  bash/Babashka boundary was explicitly rejected as not a gate. BL-1096
  changes only *which* commit is asked about (per path), not the
  predicate itself.
- **A genuine conflict is untouched** — git itself fails the merge before
  any hook runs, so a real conflict still aborts exactly as before.

### QA-exclusive paths

```
extension/src/
extension/test/
specs/pipeline/steps/
```

Defined once in the script; run `check_pipeline_code_on_main.sh
--list-paths` to print the set instead of hand-copying it into a second
consumer (e.g. BL-631's detector shares this definition).

### Refusal message

```
Commit refused: staged change touches pipeline code on `main`:
  - extension/src/foo.ts

Pipeline code (extension/src/ extension/test/ specs/pipeline/steps/) may only land on main via QA (Article 1.8/4.2, BL-247).
Remedy: commit in your own worktree and hand off through the pipeline (swarm_handoff.sh) instead of committing directly to main.
```

`specifier` and `coordinator` are unaffected without any special-casing:
both work in the master checkout and commit to `main` routinely, but only
under `backlog/`, `docs/`, `specs/features/` and `swarmforge/` — none of
which are in the refused set.

## Guard-Chain Aggregation Is Shared, Not the Whole Chain (BL-1303)

`check_feature_handler_registration.sh` (a sibling guard, refusing a
`specs/features/*.feature` file that reaches `main` with no registered — or
no longer runnable — step handler; see its own ticket, BL-1303, for that
guard's own behavior) is reached from both `pre-commit` and
`pre-merge-commit`, because both incidents that motivated it put `main`
into the bad state by `--no-ff` merge (BL-1253's resurrecting merge,
BL-709's merge `45625ef9cb`) — a guard wired only into `pre-commit` would
have caught neither.

`pre-merge-commit` was NOT repointed at `run_commit_guards.sh` wholesale to
pick this guard up: that would newly subject every merge to
`check_commit_size.sh`, `check_ticket_deletion.sh`, and the expensive
`check_property_suite_drift.sh` (whose allowlist matcher is currently
broken and running under an operator override, BL-1234) — widening the
whole chain to the merge path is a separate concern from closing this one
guard's coverage hole. So `pre-merge-commit` runs its own two-guard chain
instead, order matching `pre-commit`'s so a merge with exactly one
violation reports the same guard a commit with that violation would.

Both hooks must run every guard in their own chain and report every
violation in one refusal — never abort at the first (Article 4.4's shape,
applied in a gate; the same discipline BL-1242/BL-1252 established for
`pre-commit`). That aggregation (`run_guard`, `guard_chain_has_refusal`,
`report_refusals`) is a shared, sourced library,
`swarmforge/scripts/commit_guard_chain_lib.sh`, rather than re-derived in
each hook — the one way to get it wrong (a `set -e` chain that aborts at
the first refusal) is shared code, not something to keep in sync by hand
across two files. Both callers source it and run under `set -uo pipefail`
with **no** `-e`; a chain member itself still keeps its own
`set -euo pipefail`. A missing/unreadable library file is itself a refusal
in both hooks — never a silent fall-through that waves a commit or merge
through with every guard skipped.

**Known residual, unchanged by BL-1303:** a fast-forward merge fires
neither hook, so no commit-hook guard — this one or
`check_feature_handler_registration.sh` — covers that path at all (see
below).

## Holes This Guard Does NOT Close

Stated plainly, per the ticket's own honesty requirement — a guard oversold
is BL-629's original mistake repeated:

1. **A fast-forward merge fires no hook at all.** Nothing can be caught
   there.
2. `git commit --no-verify` bypasses both hooks by design.
3. `git reset --hard`, `git branch -f`, `git cherry-pick` onto a checked-out
   `main`, and a direct `git push` from another checkout all move `main`
   without a commit hook running.

This is why BL-630 (publish gate) and BL-631 (detection) are not made
redundant by this ticket and still run regardless — three imperfect layers
in series, not one claimed-perfect one.

## Testing

- **Shell tests**
  (`swarmforge/scripts/test/test_pipeline_code_on_main_guard.sh`): guard
  behavior against the standalone script directly, including the BL-925
  merge-import exemption (an unchanged import is allowed; a fresh edit
  staged on top of that same merge is still refused — invariant 1; a
  genuine content conflict still aborts; both hook entry points agree) and
  an invariant-2 wiring check that both `check_pipeline_code_on_main.sh`
  and `handoffd.bb` call `is_qa_ancestor.sh` rather than a second inline
  `git merge-base --is-ancestor`.
- **`is_qa_ancestor.sh`'s own suite**
  (part of `test_pipeline_code_on_main_guard.sh`): includes a hand-authored
  mutation check (no Stryker for bash) killing a swapped-argument mutant —
  `git merge-base --is-ancestor swarmforge-QA "$SHA"` answers a different,
  wrong question ("is the published tip an ancestor of this commit") than
  the intended `is-ancestor "$SHA" swarmforge-QA`, and would wave through
  any commit merely built on top of a published tip.
- **Acceptance tests**
  (`specs/features/BL-632-commit-time-guard-refuses-pipeline-code-on-main.feature`):
  a non-QA commit touching pipeline code is refused; the same change is
  allowed under the QA role; a bookkeeping-only commit on `main` is
  allowed with no role set; a commit on any branch other than `main` is
  never refused; a `--no-ff` merge of pipeline code into `main` is refused
  by `pre-merge-commit`; the existing commit-size guard keeps firing
  independently; the refusal message states the remedy.
  (`specs/features/BL-925-reconcile-merge-of-qa-published-tip-completes.feature`):
  the merge-import exemption itself — content provenance decides pipeline
  content is allowed only when it comes unchanged from the QA-published
  parent; both `pre-commit` (via `git commit --no-edit`) and
  `pre-merge-commit` agree; a real conflict still aborts with no
  half-finished merge; the reconcile sweep completes a join it previously
  could not; a commit built on top of, but not itself descended from,
  `swarmforge-QA` is not waved through.
- **Property tests**
  (`extension/test/bl632CommitTimeGuardInvariants.property.test.js`).
- **Guard-chain aggregation** (BL-1303):
  `swarmforge/scripts/test/test_pre_merge_commit_hook.sh` and the widened
  `test_run_commit_guards.sh` exercise both hooks' full-chain reporting —
  a commit/merge violating more than one guard is refused once, naming
  every offending guard, never stopping at the first.

## Related Tickets

- **BL-629:** Deploy-time QA approval gate (complement, reacts to a bad tip).
- **BL-630:** Publish sweep refuses non-QA-approved main (complement) —
  `git merge-base --is-ancestor` question this guard's merge-import
  exemption also answers, now via the shared `is_qa_ancestor.sh`.
- **BL-631:** Babysitter detects pipeline work on main (land-time detection).
- **BL-105:** Original commit-size guard precedent this hook pattern follows.
- **BL-891:** Master-main reconcile sweep — the caller whose clean,
  already-published import this guard previously refused; see
  [the runbook](../how-to/BL-891-master-main-reconcile-sweep.md).
- **BL-925:** Adds the merge-import exemption documented above and
  extracts `is_qa_ancestor.sh` as the one shared QA-ancestry definition.
- **BL-1096:** Anchors that exemption per offending path's last-touching
  incoming commit, not the merge tip alone — so multi-hop reconciles whose
  tip is bookkeeping still import QA-published blobs path-by-path.
- **BL-962:** Carries that same merge-import exemption into BL-631's
  history sweep, which had it only at commit time — `babysitter_check.bb`'s
  gatherer now adjudicates a merge's offending paths against its
  non-first parents (QA-approved AND byte-identical clears; anything else
  still reports), using this guard's own `is_qa_ancestor.sh`.
- **BL-1240:** Same accumulate-unseen failure shape as BL-1303, different
  registry (`suite-manifest.tsv`, not `specs/pipeline/steps/index.js`).
- **BL-1303:** Adds `check_feature_handler_registration.sh` to both hooks'
  chains and extracts the shared `commit_guard_chain_lib.sh` aggregation
  documented above — the first ticket to widen `pre-merge-commit` beyond
  this guard alone.
