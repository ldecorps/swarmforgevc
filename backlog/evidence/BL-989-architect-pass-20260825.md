# BL-989 — architect pass — 20260825

**Tip:** cleaner `45d4ee820f` (coder `ce6e7fdd3f`)
**Handoff:** `00_20260825T185206Z_000856_from_cleaner_to_architect`

## Verdict

**Pass** — forward to hardender. Review inventory: NONE.

## Scope / tip purity

`origin/main...45d4ee820f` = **6 paths**, **0 deletes** (tip-pure reset).
Authorize BL-989 paths only: three shell helpers + property + ticket/evidence.

## Architecture

- Root cause: four `grep -P` / `-qP` sites used GNU PCRE solely for a literal
  TAB anchor; stock macOS BSD grep rejects `-P`, reding BL-343 via
  `test_role_lifecycle_cli.sh` when spawned without the agent `grep` shadow.
- Fix: `printf '^%s\t'` (and fixed `^coordinator\t`) — same tab semantics,
  no GNU-only flag. Both `roles_tsv_has` / `roles_tsv_lacks` updated together.
- Property suite locks source shape + `/usr/bin/grep` portable pattern +
  tree sweep (excludes `pgrep`). No product-surface or ownership change.

## Verification

| Check | Result |
|-------|--------|
| `bl989PortableGrepTabAnchor.property.test.js` | 3/3 pass |
| `*.sh` PCRE-grep sweep under `swarmforge/scripts` | empty |
| `test_role_lifecycle_cli.sh` | ALL CHECKS PASSED |
| `test_coordinator_provider_configurable.sh` | ALL PASS |
| `XDG_RUNTIME_DIR=/tmp test_backlog_depth_pack_override.sh` | ALL PASS |
| Tip deletes vs `origin/main` | 0 |

By architect.
