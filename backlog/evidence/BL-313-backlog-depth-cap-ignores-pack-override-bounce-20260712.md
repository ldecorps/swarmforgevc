# BL-313 bounce evidence — 2026-07-12

## Failing command

Reproduced directly against the merged `backlog_depth_lib.bb`/`swarm_identity_lib.bb`
(no swarmforge.sh needed — this isolates `conf-file-path`'s own read path):

```sh
D=$(mktemp -d)
mkdir -p "$D/swarmforge" "$D/.swarmforge" "$D/other-role-worktree"
cp swarmforge/scripts/backlog_depth_lib.bb swarmforge/scripts/swarm_identity_lib.bb "$D/swarmforge/"
printf 'config active_backlog_max_depth -1\n' > "$D/swarmforge/swarmforge.conf"
mkdir -p "$D/swarmforge/packs"
printf 'config active_backlog_max_depth 1\n' > "$D/swarmforge/packs/lean-drain.conf"
# swarmforge.sh persists CONFIG_FILE verbatim (line 553) - and CONFIG_FILE is
# relative whenever SWARMFORGE_CONFIG itself is set as a relative path, which
# is exactly this ticket's own "LIVE CONFIRMATION" example
# (SWARMFORGE_CONFIG=swarmforge/packs/lean-drain.conf):
printf 'swarm_name\tprimary\nactive_backlog_max_depth\t1\nactive_backlog_max_depth_conf_path\tswarmforge/packs/lean-drain.conf\n' \
  > "$D/.swarmforge/swarm-identity"

# From project-root cwd (matches launch-time cwd) - works:
(cd "$D" && bb -e "(load-file \"swarmforge/backlog_depth_lib.bb\") (println (backlog-depth-lib/read-max-depth \"$D\"))")

# From a role's OWN worktree cwd - how every pipeline role actually invokes
# swarm_handoff.bb/ready_for_next.bb in this repo (coder, QA, etc. each run
# from .worktrees/<role>, never from project-root):
(cd "$D/other-role-worktree" && bb -e "(load-file \"$D/swarmforge/backlog_depth_lib.bb\") (println (backlog-depth-lib/read-max-depth \"$D\"))")
```

## Commit hash

`eae5fcf33d` (coder's BL-313 commit), merged into QA's worktree at the tip
tested.

## First error excerpt

```
=== From project-root cwd (matches launch-time cwd) ===
:enforced-cap 1
=== From a role's own worktree cwd (how every pipeline role actually invokes swarm_handoff.bb) ===
:enforced-cap 5
```

No exception is thrown — `read-max-depth` catches the `slurp` failure and
silently degrades to `default-max-depth` (5). No error, no warning, no log
line distinguishes this from a legitimately-uncapped or legitimately-default
launch.

## Failure class

`behavior`

## Expected vs observed

Expected: from ANY role's own worktree cwd, `read-max-depth` enforces the
pack's actual declared cap (`1` for `lean-drain.conf`) exactly as it does
from the launch cwd — this is the ticket's own stated acceptance criterion
("the real WARNING and AUTO-PROMOTE gates enforce the pack's cap... not the
default swarmforge.conf's").

Observed: `conf-file-path` (`backlog_depth_lib.bb`) does `(fs/path
persisted)` on the raw `active_backlog_max_depth_conf_path` string with no
join against `project-root`, so a RELATIVE persisted path (produced whenever
`SWARMFORGE_CONFIG` itself is set as a relative path at launch — the exact
scenario this ticket's own "LIVE CONFIRMATION" section describes as this
session's live condition) resolves against each READER's own cwd instead of
`project-root`. Every pipeline role invokes `swarm_handoff.bb`/
`ready_for_next.bb` from its own `.worktrees/<role>` directory, never from
project-root, so from every real invocation site the persisted path fails to
resolve and the reader silently falls back to the hardcoded
`default-max-depth` (`5`) — neither the pack's real cap (`1`) nor even the
tracked default file's own declared value (`-1`). The codebase already has
precedent for this exact hazard: `swarmforge.sh`'s own
`config_overlay_prompt` explicitly normalizes a relative `CONFIG_FILE`
against `WORKING_DIR` before using it as a path (`if [[ "$CONFIG_FILE" = /*
]]; then base="$CONFIG_FILE"; else base="$WORKING_DIR/$CONFIG_FILE"; fi`,
`swarmforge.sh:728-731`) — the new `write_swarm_identity_file` persistence
and `conf-file-path`'s read of it do not apply the equivalent normalization,
so the fix does not fully close the gap the ticket exists to close.

Suggested fix direction (not prescriptive): either (a) `swarmforge.sh`
persists an ABSOLUTE `CONFIG_FILE` into `active_backlog_max_depth_conf_path`
(normalize relative-to-`WORKING_DIR` the same way `config_overlay_prompt`
already does, before the `printf` in `write_swarm_identity_file`), or (b)
`conf-file-path` joins a relative persisted path against `project-root`
rather than treating it as resolvable from the calling process's own cwd.
