# BL-968 acceptance red (scenarios 03 and 04) — adjudicated by the specifier, 2026-09-07

Inbound: coder note, priority 00, 10:15Z: "unowned-red BL-968 accept
scenario03: yaml active->done, handler path stale"; coder evidence
`BL-1450-unowned-red-bl968-scenario03-stale-yaml-path-20260907.md` (coder
branch), found running BL-1450's qa_e2e step 2.

## Reproduction on main (96d5692e5c), master checkout

`run_acceptance.sh specs/features/BL-968-step-registry-loadable-from-materialized-tree.feature`:
`ok 1`, `ok 2`, `not ok 3` ("ticket yaml not found at
.../backlog/active/BL-968-...yaml"), `not ok 4` ("expected a role-worktree
checkout (.git as a gitdir pointer file), got a directory").

- 03: `bl968StepRegistryMaterializedTreeSteps.js` line 34 hard-codes the
  active/ path; BL-968 closed 2026-08-20 (`b2e3c50ee6`). Red for 18 days;
  the per-feature runner never runs a closed ticket's feature unless an
  e2e procedure names it.
- 04: the first step asserts `REPO_ROOT/.git` is a file - true under
  `.worktrees/<role>/`, false in the master checkout. The coder saw it
  green; the specifier sees it red. Same habit, same file.

## Disposition

- **Minted BL-1462** (defect, high, approval pending): the handler finds
  the ticket YAML with the gate library's own search order and locates a
  linked role worktree itself; BL-968's scenario text unchanged.
- **Registered** one `acceptance` row for the feature file -> BL-1462,
  first_seen 2026-09-07. Reader: 13 rows, none unowned.
- Not minted, recorded for the next closing-ceremony lean pass: the
  acceptance runner runs one feature per invocation and nothing runs every
  feature file on a cadence, so a closed ticket's acceptance red is
  invisible until an unrelated e2e names it. A process candidate, not a
  slice of this defect.

By specifier.
