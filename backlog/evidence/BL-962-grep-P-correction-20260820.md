# Correction to BL-962/961/966 cleaner batch evidence (2026-08-20)

## What was wrong

`backlog/evidence/BL-962-BL-961-BL-966-cleaner-batch-20260820.md` claimed:

> `test_backlog_depth_pack_override.sh` — claimed cause: "`grep -P` (stock
> BSD grep)". Measured: `grep -P` **works on this host**
> (`printf 'a\tb\n' | grep -P "^a\t"` succeeds).

That measurement was taken in an interactive shell where `grep` is a
**Claude Code shell function** (`type grep` → `grep is a function`,
aliased to `ugrep`, which supports `-P`). It was not testing the real
`grep` binary at all.

## What's actually true

In a clean, non-interactive shell (`bash -lc '...'`, no Claude Code
function wrapper), `command -v grep` → `/usr/bin/grep`, and:

```
$ printf 'a\tb\n' | grep -P '^a\t'
grep: invalid option -- P
usage: grep [-abcdDEFGHhIiJLlMmnOopqRSsUVvwXxZz] ...
```

Stock macOS BSD grep genuinely does not support `-P`. The original
BL-966 handoff's "grep -P (stock BSD grep)" attribution was **correct**,
not wrong.

## Both causes are real - they stack, not either/or

`test_backlog_depth_pack_override.sh` has two independent, genuine
defects that fire in sequence:

1. `resolve_swarm_socket.bb`'s 100-char unix-socket path limit, hit
   first when `XDG_RUNTIME_DIR` is unset (the fixture's macOS temp root
   is 102 chars) - this part of the original correction still stands,
   confirmed by direct reproduction.
2. Once that's bypassed (`XDG_RUNTIME_DIR=/tmp`), the script reaches
   line 38 - `grep -P "^${key}\t" "$file"` - and fails identically with
   `invalid option -- P` on real BSD grep.

Reproduced live, this session:

```
$ bash swarmforge/scripts/test/test_backlog_depth_pack_override.sh
Error: resolve_swarm_socket.bb: Socket path exceeds ... (102 chars)

$ XDG_RUNTIME_DIR=/tmp bash swarmforge/scripts/test/test_backlog_depth_pack_override.sh
grep: invalid option -- P
...
FAIL: 01: expected the persisted effective cap to be the PACK's 1, got: ...
```

## Two more unticketed sites of the same class

BL-989 covers `test_role_lifecycle_cli.sh:102-103` only. A repo-wide
sweep (`grep -P`/`-qP`, excluding `pgrep`) under a clean shell found two
more genuine GNU-only `-P` call sites, neither covered by any ticket:

- `swarmforge/scripts/test/test_backlog_depth_pack_override.sh:38`
- `swarmforge/scripts/test/test_coordinator_provider_configurable.sh:130`
  (confirmed failing identically: `printf 'coordinator\tval\n' | grep -P
  '^coordinator\t'` → `invalid option -- P`)

## Why this matters

BL-989's own description cites the earlier (wrong) correction as
precedent for demanding "direct evidence" before naming BSD grep as a
cause - ironic, since that precedent was itself an artifact of a shadowed
`grep`. Anyone reproducing shell findings on this host should verify
`type grep` / `command -v grep` first, since an interactive Claude Code
shell silently shadows several common tools.

By cleaner, 2026-08-20, on specifier's flag (note 20260820T142029Z_000301).
