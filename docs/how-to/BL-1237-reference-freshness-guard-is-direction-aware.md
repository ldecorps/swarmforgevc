# Reference-freshness guard refuses only for amendments the worktree is missing (BL-1237)

## Incident class

BL-640's pre-turn guard (`ready_for_next.bb`, backed by
`reference_freshness_lib.bb`) stops a role from acting on a stale
`swarmforge/constitution/articles/reference/*` elaboration by comparing the
worktree's copy against `main`'s and refusing on **any** content
difference. That conflates two very different situations: the worktree is
*missing* an amendment `main` already has (genuinely stale — refuse), and
the worktree is *ahead* of `main` with its own newer work that has reached
it through an ordinary branch merge but has not yet landed on `main` via QA
(routine for an in-flight parcel — never stale).

The live 20260828 incident: the cleaner was refused on all five
`BL-1227` `articles/reference/` files, which had reached it through
ordinary branch merges but had not yet landed on `main`. The guard's own
prescribed remedy — "merge main, then run again" — is a no-op in that
direction, so the role was refused identically every turn with no way to
clear it, until an unrelated ticket (BL-1227) cleared QA. The block
recurred across every worktree role, and briefly on the specifier's own
`main` checkout, while this fix was pending
(`backlog/evidence/BL-1237-*-20260829.md`).

## What changed

`reference_freshness_lib.bb`'s `stale-paths` gains a third, optional input:
`worktree-has-main-amendment?`, a `{rel-path -> boolean}` map covering every
path whose content differs. `true` means the worktree's own `HEAD` already
contains, as an ancestor, `main`'s most recent commit touching that path —
the differing content is the worktree's own newer work laid on top of an
amendment it has already absorbed, so the path is **not** reported as stale
(invariant: never refuse for content the worktree carries that `main` does
not yet have). A path absent from the map defaults to `false` — fail
closed, preserving BL-640's original refuse-on-any-difference behavior for
the case this ticket does not touch: content the worktree is genuinely
missing. The 2-arity form (`stale-paths worktree-shas main-shas`) is
unchanged and still fails closed on every difference.

`ready_for_next.bb`'s `enforce-reference-freshness-guard!` computes the
ancestry facts and passes them in — `path-ancestry-absorbed?` runs
`git log -1 --format=%H <ref> -- <path>` to find the reference file's most
recent commit on the comparison ref, then
`git merge-base --is-ancestor <that-commit> HEAD` to test absorption — but
only for paths whose content actually differs, so the fast path (no
differing paths) does no extra git work. Any git hiccup (no commit found,
or the ancestry check itself errors) degrades to `false`, so a missing
answer never turns into a silent allow. The library itself stays pure, per
its own docstring contract — all git I/O lives in `ready_for_next.bb`.

Also folded in: a stale `require('./bl1247ReconcileSweepKillSwitchSteps')`
in `specs/pipeline/steps/index.js`, left over from an earlier merge-conflict
resolution that kept the require line without noticing the same merge had
deleted the file it pointed to — breaking every consumer of `index.js`,
including this ticket's own acceptance run, with `MODULE_NOT_FOUND`.

## Verify

```bash
# Ahead case: worktree has its own commit on top of main's unchanged base.
# Guard now passes (previously refused).
bb swarmforge/scripts/ready_for_next.bb   # (or ready_for_next.sh) in the ahead worktree

# Behind case: main advanced past a commit the worktree never merged.
# Guard still refuses with STALE_REFERENCE_ELABORATION and names the
# missing file(s) plus the merge-main remedy — unweakened by this fix.
```

## What this does not cover

- The guard still only compares `swarmforge/constitution/articles/reference/*`
  content — it is not a general worktree-freshness check (see
  [Worktree drift guard](BL-1195-worktree-drift-guard.md) for that class).
- The comparison ref itself (`main` vs `origin/main`) is chosen by
  whole-repo ahead-count in `freshest-main-ref`, a separate mechanism this
  ticket does not touch — that heuristic can itself pick the behind ref
  when the two diverge on unrelated commits, which stays a distinct,
  currently open failure mode of the same guard.

## Acceptance

`specs/features/BL-1237-reference-freshness-guard-is-direction-aware.feature`
