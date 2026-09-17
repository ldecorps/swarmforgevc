# Give a fixture swarm root a complete swarm-identity (BL-966)

## Why this matters

`backlog_depth_lib.bb/conf-file-path` (BL-966) resolves the effective
`active_backlog_max_depth` config for the swarm that is actually running by
reading `active_backlog_max_depth_conf_path` from `.swarmforge/swarm-identity`
at the repository's master checkout. When that key is absent, it falls back
to the tracked default `swarmforge/swarmforge.conf` — but the fallback is
**loud by design** (BL-966 invariant 2): it prints a warning to stderr every
time, never silently.

`ready_for_next_task.bb` reads the pack conf through this function on every
claim (BL-1004), so any shell test whose fixture writes a swarm-identity
without this key and then drives the claim path will see that warning on
stderr — and a test asserting empty stderr around a passing claim goes red.
This is exactly what happened to `test_branch_claim_guard.sh` (BL-1613): its
fixture wrote only `swarm_name` and `swarm_mode`, so every claim printed the
fallback line and the "a passing guard emits no warning" assertion failed —
unrecorded on `main` for 27 days.

## The fix

A fixture swarm root that drives the claim path (`ready_for_next_task.bb` /
`ready_for_next.sh`) and asserts on stderr must be a **complete** swarm root:
give it the tracked conf file the identity points at, and point the identity
at it.

```sh
mkdir -p "$ROOT/swarmforge"
: > "$ROOT/swarmforge/swarmforge.conf"
```

and add a third tab-separated row to the fixture's `.swarmforge/swarm-identity`:

```
active_backlog_max_depth_conf_path<TAB>swarmforge/swarmforge.conf
```

(the same relative form `test_backlog_depth_conf.sh` uses — resolved against
the identity root, never the caller's cwd).

## Not every fixture needs this

Only a fixture that (a) writes a swarm-identity at all, and (b) drives the
claim path, and (c) asserts on empty/exact stderr is exposed. A fixture that
never asserts on stderr keeps passing with an incomplete identity — the
fallback still fires, it just isn't checked. `test_branch_claim_guard.sh` is,
as of BL-1613, the only shell test in that intersection; the census that
found it:

```sh
for t in $(grep -l 'swarm-identity' swarmforge/scripts/test/*.sh); do
  echo "$t $(grep -c active_backlog_max_depth_conf_path "$t") \
$(grep -cE 'ready_for_next_task|ready_for_next\.sh' "$t") \
$(grep -c '-z "\$ERR"' "$t")"
done
```

Re-run this census before trusting a new stderr assertion around the claim
path — a second fixture in the same shape goes red the day it adds one.

Acceptance:
`specs/features/BL-1613-the-branch-claim-guard-test-fixture-is-a-complete-swarm-root.feature`
