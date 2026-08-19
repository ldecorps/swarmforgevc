# BL-632: Commit-Time Guard Refuses Pipeline Code on Main

Two versioned git hooks refuse, at commit time, a commit or `--no-ff` merge
that would put pipeline code (`extension/src/`, `extension/test/`,
`specs/pipeline/steps/`) onto `main` from any role but QA.

**Last Updated:** 2026-08-19

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

Two hooks delegate to the same standalone script,
`swarmforge/scripts/check_pipeline_code_on_main.sh`, so the QA-exclusive
path definition lives in exactly one place:

- **`pre-commit`** — fires for a plain `git commit`, including
  `git commit --amend`.
- **`pre-merge-commit`** — a separate hook, fires for `git merge --no-ff`
  (the shape `merge_and_process` uses on the handoff path). Without this
  second hook, `pre-commit` alone would leave the `--no-ff` merge path
  unguarded — the exact hole the BL-590 post-mortem called out.

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

### Merge-import exemption (BL-925)

Before BL-925, completing a merge that only **imports** an already
QA-published `origin/main` was refused exactly like fresh non-QA
authorship — the guard asked only branch and `SWARMFORGE_ROLE`, with no
notion of a merge at all. That's the routine shape of BL-891's reconcile
sweep merging `origin/main` forward into the master checkout's local
`main`: the checkout is non-QA, but the content came from QA. The refusal
made that clean join never complete while `main` was ahead-and-behind —
its steady state — so [BL-891's sweep](../how-to/BL-891-master-main-reconcile-sweep.md)
aborted the same merge on every tick and logged a false conflict.

The guard now checks, for each offending path, whether the incoming merge
parent is already an ancestor of `swarmforge-QA` and, if so, whether that
path's staged content is byte-identical to what that parent holds:

- **Content provenance decides, not merge-in-progress.** Being mid-merge
  is never on its own sufficient — a writer could stage fresh pipeline
  edits on top of a legitimate merge of a published tip and ride through
  on its coat-tails. Every offending path is diffed individually against
  the incoming parent; only a path whose staged content exactly matches is
  cleared. A path with any real difference stays refused, even inside an
  otherwise-exempt merge.
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
  bash/Babashka boundary was explicitly rejected as not a gate.
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
