# BL-632: Commit-Time Guard Refuses Pipeline Code on Main

Two versioned git hooks refuse, at commit time, a commit or `--no-ff` merge
that would put pipeline code (`extension/src/`, `extension/test/`,
`specs/pipeline/steps/`) onto `main` from any role but QA.

**Last Updated:** 2026-08-18

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
   QA-exclusive path set. If any staged path matches, the commit is
   refused (exit 1) with the offending path(s) and the remedy printed to
   stderr; otherwise exits 0.

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
  behavior against the standalone script directly.
- **Acceptance tests**
  (`specs/features/BL-632-commit-time-guard-refuses-pipeline-code-on-main.feature`):
  a non-QA commit touching pipeline code is refused; the same change is
  allowed under the QA role; a bookkeeping-only commit on `main` is
  allowed with no role set; a commit on any branch other than `main` is
  never refused; a `--no-ff` merge of pipeline code into `main` is refused
  by `pre-merge-commit`; the existing commit-size guard keeps firing
  independently; the refusal message states the remedy.
- **Property tests**
  (`extension/test/bl632CommitTimeGuardInvariants.property.test.js`).

## Related Tickets

- **BL-629:** Deploy-time QA approval gate (complement, reacts to a bad tip).
- **BL-630:** Publish sweep refuses non-QA-approved main (complement).
- **BL-631:** Babysitter detects pipeline work on main (land-time detection).
- **BL-105:** Original commit-size guard precedent this hook pattern follows.
