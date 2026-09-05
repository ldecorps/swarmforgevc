# A role's own before/after orphan gate (BL-1370)

*How-to. Task-oriented: run the per-pass stray-process check a role owes
before and after verification, instead of hand-running `pgrep` and
hand-wording the result.*

QA's own prompt states the ritual precisely: no leftover test or mutation
processes BEFORE verification (a run on top of one skews results and pins
cores), none alive AFTER it (an orphaned run reparents to the OS and burns
cores for hours), and a straggler is reaped by process GROUP
(`kill -- -<pgid>`), never by pid. Every clause was mechanical and none of
it had a tool: 326 evidence files recorded this check in almost as many
different wordings (`Orphans | NONE |`, `Orphan check`, `Orphan test procs
| none |`, ...) — the signature of a step composed from scratch each pass.

## Not the background janitor

`orphan_janitor_lib.bb` and its siblings reclaim what nobody is watching,
on their own cadence, with deliberately conservative predicates (its own
numbers — 8402 sweeps for 27546 candidates, 3 reaped — look damning until
you read them: reaping almost nothing is correct behaviour for a
background reclaimer that must never kill live work). This tool answers a
different question — "is MY pass clean, right now" — which had no entry
point before BL-1370.

## Run it

```bash
bb swarmforge/scripts/check_worktree_strays.bb <worktree-root>          # check only
bb swarmforge/scripts/check_worktree_strays.bb <worktree-root> --reap   # check, kill, re-check
```

Exits non-zero when a stray is found (`check` mode) or still present after
a reap — **a stray is a refusal, not a warning**: a pass cannot be
approved with test or mutation processes still alive.

Output is one stable, recordable line instead of 326 wordings:

```
WORKTREE_STRAYS: none in <root> (<N> process(es) scanned, patterns: stryker, node --test, property-lane vitest)
WORKTREE_STRAYS: 2 stray job process(es) in <root> — pid=1234 pgid=1234 stryker ..., pid=1240 pgid=1234 node --test ... (reap by process group: kill -- -<pgid>)
```

## What counts as a stray

Both halves are required — the pattern alone matches a colleague's
legitimate suite, and the scope alone matches every ordinary process in
the checkout:

1. **Job pattern** (`worktree_stray_lib.bb`'s `job-process-pattern`):
   Stryker mutation roots, `node --test` batches, and the property-lane
   vitest tree — mirrored from `handoffd_supervisor.bb`'s own
   `job-process-pattern` (that script cannot be `load-file`d to share the
   constant directly, since its top level exits with usage), with a test
   (`test_bl1370_worktree_strays.sh`) asserting the two literals agree
   (BL-897).
2. **Scope**: the SAME shared classifier the orphan janitor and the
   handoffd supervisor already defer to —
   `process_table_lib.bb`'s `project-scoped-process?` — never a second
   notion of "mine" invented here. Growing a second scope predicate is
   exactly how a tool that kills processes ends up killing a colleague's
   running suite.

## The scope classifier now matches at a path-component boundary (BL-1370 amendment, 2026-09-05)

Before this ticket, `project-scoped-process?` matched by bare
`str/includes?`/`str/starts-with?` with no boundary check — so
`.worktrees/coder` claimed `.worktrees/coder-cursor2`'s processes (a live
sibling worktree on the same host), and `/repo` claimed `/repo-2`.
Delegating to it as it stood could not satisfy this ticket's own
invariant 1 in the killing direction, so the fix was scoped INTO this
parcel rather than filed as a sibling ticket:

- A **cwd** match now requires the cwd to equal the scoped path or
  continue with `/` right after it.
- A **command-line** match now requires what follows the matched path to
  be `/`, whitespace, a quote, or end of string.

Both the janitor and the supervisor inherit the narrower scope through the
same shared function — this only ever REDUCES what they may reap, never
expands it. `process_table_lib_test_runner.bb` and
`bl887_scope_predicate_invariants_property_runner.bb` both carry the
prefix-sibling case now.

## Reaping is by process group, and never signals the role's own pane

`--reap` sends `kill -- -<pgid>` to each stray's process group (never a
bare pid — an orphaned run's children outlive a pid-only kill). Two
exceptions, both reported rather than killed:

- A stray with **no readable process group** (a kill aimed at `nil` is
  how a tool like this takes out the wrong thing).
- A stray that shares **this process's own group** — a stray started from
  the role's own shell without `setsid` shares that shell's group, so
  `kill -- -<pgid>` would take the role's own session down along with the
  stray (measured while building this tool: the probe killed the shell
  that ran it). Reported with the pid to kill by hand instead.

## Where it lives

| Piece | Location |
| --- | --- |
| CLI entry point | `swarmforge/scripts/check_worktree_strays.bb` |
| Pure stray logic | `swarmforge/scripts/worktree_stray_lib.bb` |
| Shared scope classifier | `swarmforge/scripts/process_table_lib.bb`'s `project-scoped-process?` (BL-887) |

## Related

- Orphan janitor family (`orphan_janitor_lib.bb`,
  `orphan_janitor_sweep_lib.bb`, `orphan_agent_reaper_lib.bb`,
  `fixture_reaper_lib.bb`) — the background reclaimer this tool is NOT a
  replacement for.
- BL-887 — the shared `project-scoped-process?` classifier this tool,
  the janitor, and the handoffd supervisor all defer to, so they can
  never disagree about what "mine" means.

## Verify

```bash
bash swarmforge/scripts/test/test_bl1370_worktree_strays.sh
bash swarmforge/scripts/test/process_table_lib_test_runner.bb
npx vitest run --config vitest.properties.config.mjs bl1370WorktreeStrayCheck
specs/pipeline/scripts/run_acceptance.sh specs/features/BL-1370-a-role-checks-its-own-worktree-for-strays.feature
```
