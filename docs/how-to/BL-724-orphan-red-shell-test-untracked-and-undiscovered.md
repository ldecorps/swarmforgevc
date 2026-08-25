# Shell-test discovery: no silent orphans under `scripts/test/` (BL-724)

There are many `test_*.sh` files under `swarmforge/scripts/test/`. Until
BL-724 nothing globs that directory for *accountability*: an untracked or
unlisted shell test neither ran nor failed — it was invisible. That is how
`test_swarm_handoff_mono_router_auto_rotate.sh` sat red and untracked for a
week (fault 1: asserts unshipped mono-router auto-rotate; fault 2: no
discovery). This ticket closes **fault 2 only**.

BL-973's `suite-manifest.tsv` / `run_bb_suite.sh` inventory already gates
`.bb` runners. BL-724 adds a **git-aware** sweep for `test_*.sh` that
distinguishes untracked orphans from unaccounted tracked files.

## Run the sweep

From the repo root (master checkout or a linked worktree):

```bash
bb swarmforge/scripts/test/shell_test_discovery_cli.bb .
```

Clean:

```text
shell_test_discovery: ok - <N> tracked shell test(s), <M> excluded
```

Loud failure (exit 1) — examples:

| Message | Meaning | What to do |
|---|---|---|
| `untracked orphan: test_….sh` | File exists on disk, not in git | Track it, exclude it with a dated reason, or remove it |
| `unaccounted test: test_….sh` | Tracked but not in the manifest | Add a `standing` or `excluded` row |
| `exclusion missing its reason: …` | `excluded` lane with empty reason | Fill the reason column |
| `stale exclusion: …` | Manifest names a file not in the tree | Drop or fix the row |

Self-test: `bash swarmforge/scripts/test/test_shell_test_discovery.sh`.

## Accounting a shell test

Add a row to `swarmforge/scripts/test/suite-manifest.tsv`:

- `standing` — reached / expected to run under the standing inventory posture.
- `excluded` — deliberately not run; **date + one-line reason required**.

The sweep only labels `test_*.sh` rows; `.bb` runners stay under the BL-973
inventory gate. See
[BL-973 suite inventory](BL-973-bb-fixture-closure-guards-and-suite-inventory.md).

## What this does not do

- Does not implement mono-router auto-rotate on `git_handoff`.
- Does not rewrite or batch-run the existing 169 shell tests.
- Does not delete or commit the historic mono-router orphan as a passing
  test — untracked remains the correct loud outcome until a design decision.

Acceptance: `specs/features/BL-724-orphan-red-shell-test-untracked-and-undiscovered.feature`.
