# BL-1061 — coder pass, 2026-08-22: the ticket names the wrong file, and the root cause is a different defect

The defect is real, both invariants are right, and the feature file is
correct as written. Two things in the **description** are not, and both change
what a reviewer should look at.

## 1. The file named is not the file that binds the production name

The description says:

> `extension/test/bl857TunnelOwnershipInvariants.property.test.js` ... The
> fixture launches its fake cloudflared under the literal production tunnel
> name `swarmforge-bubble`

Measured at the parcel's base commit:

- `bl857TunnelOwnershipInvariants.property.test.js` contains `swarmforge-bubble`
  exactly **once**, in a comment at line 18 saying it must **never** be used.
  Every fixture there goes through `uniqueName()`.
- `extension/test/bl787NamedTunnelInvariants.property.test.js` binds
  `SWARMFORGE_NAMED_TUNNEL: 'swarmforge-bubble'` at **three** sites (lines 165,
  231, 348), and its fixture roots are `bl787-ready-prop-*` — which is exactly
  what the leaked processes on this host were launched from:

  ```
  3260911 bash /tmp/bl787-ready-prop-EeeBwH/bin/cloudflared ... run swarmforge-bubble
  3261290 bash /tmp/bl787-ready-prop-daPUNu/bin/cloudflared ... run swarmforge-bubble
  ```

So bl857 is the suite that FAILS; bl787 is the suite that BINDS. Fixing bl857's
fixture would have changed nothing.

## 2. The reason bl857 fails is a third defect the ticket does not mention

bl857's invariant 1 failed with `pid[0] expected alive=false, got alive=true` —
its own fixture, under its own unique name, survived its own reap. That has
nothing to do with the production name, and it reproduces with a name no other
process could be serving.

`tunnel_ownership_lib.sh:166` enumerated candidates with:

```sh
pgrep -fl -- "run $name"
```

`-f` makes pgrep **match** on the full command line, which is right. `-l`
decides what it **prints**, and the two userlands disagree:

| | `pgrep -fl` prints |
|---|---|
| BSD / macOS | the full argument list |
| procps-ng (Linux) | the process NAME only |

Measured on this host (procps-ng 4.0.4):

```
pgrep -fl  -> 3345486 bash
pgrep -af  -> 3345486 bash /tmp/.../cloudflared tunnel ... run bl1061-diag2-...
```

`tunnel_decide_orphans` looks for a `run <name>` token pair in the text after
the pid. Given `3345486 bash` there is nothing to match, so it selects nothing
and **the reap has never worked on a GNU userland**. That is why orphaned
fixture tunnels accumulate here, and it is the same class as BL-1058's
BSD-only `mktemp -t`: authored on macOS, silently inert on Linux.

Fixed by keeping the pgrep narrowing and moving the LISTING to
`ps -o pid= -o args=`, which is POSIX and prints the full command line on both.
`tunnel_decide_orphans`' word-boundary check is untouched.

## 3. Why the order mattered — fixing the reap ARMS the hazard

While the reap silently no-opped, bl787's production-name binding was
harmless: nothing was ever selected, so nothing was ever signalled. Repairing
the enumeration is what makes a reap scoped to `swarmforge-bubble` able to
reach the operator's live tunnel.

So the two fixes could not land separately, and landing only the reap fix
would have been strictly worse than landing nothing. Both are in this parcel:
the enumeration repair, and `extension/test/helpers/fixtureTunnelName.js`,
through which every fixture name now passes and which refuses the production
name outright.

## 4. A leak found in this parcel's own first draft

The shell test's first version registered its fixture pids in a shell ARRAY
appended to from inside a `$(...)` command substitution. `$(...)` forks, the
subshell's copy of the array is discarded on exit, and the registration was
lost — it left eight `sleep 300` processes alive on the host before the
cleanup was moved to a FILE. This is BL-801's finding in
`swarmforge/scripts/test/lib/tmp_cleanup.sh`, rediscovered independently.

## 5. Out of scope, and surfaced rather than swept

`pgrep -fl` appears in six production scripts. Four take only `${line%% *}`
(the pid) and are unaffected — the `-f` match is correct, only the listing is
truncated. Two use the command text and are therefore broken on Linux the same
way this one was:

- `swarmforge/scripts/start_bridge_headless.sh:140` — guards its kill with
  `[[ "$line" != *"$ROOT"* ]]`. With `-l` the line carries no path, so the
  condition is always true and it can signal bridges belonging to OTHER roots.
- `swarmforge/scripts/kill_pipeline_swarm.sh:243` — pipes through
  `grep -v handoffd_supervisor`. With `-l` the line never contains that string,
  so the filter never excludes anything and the supervisor is reapable.

Neither is BL-1061 and neither is touched here. Both are worth a ticket.
