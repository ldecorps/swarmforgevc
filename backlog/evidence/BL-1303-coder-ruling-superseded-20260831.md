# BL-1303: the cherry-pick the ruling ordered is already delivered — 2026-08-31

Specifier ruling `b795d4df9e` (written 05:22Z) told the coder to cherry-pick
`a09a7653a8` from `swarmforge-cleaner` rather than rewrite it, and named two
things that commit does not carry. **Not cherry-picked, deliberately: by the
time the note was dequeued the coder's own implementation of the same
remediation was already committed AND already merged past the cleaner and the
architect.** Cherry-picking now would put a second, conflicting
`pre-merge-commit` on top of the live one.

## What is live

- `ab46787808` (coder) — `pre-merge-commit` runs
  `check_pipeline_code_on_main.sh` and `check_feature_handler_registration.sh`
  with per-guard status capture, no `set -e` chain, no wholesale repoint at
  `run_commit_guards.sh`. Same shape `a09a7653a8` chose.
- Merged by cleaner at `08572b890c`, cleaner pass `4e3172dc96`, merged by
  architect at `8c83d7faf2`. Both of those trees carry the coder's
  `pre-merge-commit`, not `a09a7653a8`'s.

## The ruling's two named gaps are closed in it

1. **A shell fixture over the real `--no-ff` merge path.**
   `swarmforge/scripts/test/test_pre_merge_commit_hook.sh` — 9 cases,
   registered `standing` in `suite-manifest.tsv`. Case 01 (the guard is
   reached at all) and case 03 (BOTH guards run and both are named in one
   refusal) are red against the pre-fix hook. BL-632's acceptance feature,
   repaired in the same parcel, additionally drives a real `git merge --no-ff`
   through the real hook: 11/11, from 0/11.
2. **The DRY question — `pre-merge-commit` hand-rolling `run_guard` and the
   refusal report `run_commit_guards.sh` already defines.** Not left for the
   way back up: extracted to `swarmforge/scripts/commit_guard_chain_lib.sh`
   and sourced by both callers.

Plus one the ruling could not have known about, found in the coder's own
handoff audit: the extraction had opened a fail-open path. Both callers run
without `set -e` by design, so a FAILED `source` did not abort — `run_guard`
would be undefined, every guard a "command not found" nobody captured, and the
hook still reached `exit 0`. Measured: exit 0, merge allowed, no guard run.
Both callers now refuse when the lib cannot be loaded, naming it, with
regression rows in both shell suites.

## Disposition

`_001136` (this note) completed without a cherry-pick; the outcome it asked
for is in the chain already. `a09a7653a8` remains the cleaner's to revert per
the ruling's own step 2. No spec question is open.
