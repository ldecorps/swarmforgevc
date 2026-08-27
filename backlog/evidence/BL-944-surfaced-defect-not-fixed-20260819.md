# BL-944 — one real defect surfaced by the fix, not fixed here (2026-08-19)

BL-944's own constraints section anticipates exactly this: "Once the
fixture loads, a scenario may fail on something real that has been
invisible behind the load error for two weeks. That is a SEPARATE defect
this parcel has surfaced: record it with evidence and raise it, do not fix
it here." This file is that record, same disposition as BL-937/BL-938's
own D1-style findings.

## D1 — role_lifecycle.sh's unpark path refuses on a descriptive fixture root, for an unrelated reason, before ever reaching the "still alive" check

**Reproduced**: `specs/features/BL-368-control-loss-is-not-agent-death.feature`,
scenario "A role whose process is still alive is never relaunched":

```
not ok 2 - A role whose process is still alive is never relaunched
error: ...failed at step "Then it refuses, because that role's process is
still running": expected the refusal to name the reason, got stderr:
```

Direct reproduction of `controlLossIsNotAgentDeathSteps.js`'s own exact
fixture-building and `spawnSync` sequence (not the acceptance runner - a
standalone script mirroring it line for line) shows the real captured
output:

```
status: 1
stdout: "[0;31mError:[0m resolve_swarm_socket.bb: Socket path
exceeds the operating system's unix-socket path limit (100 chars) and
XDG_RUNTIME_DIR is not set for a fallback. primary=/var/folders/.../T/
sfvc-bl368-relaunch-i0mmnO/.swarmforge/tmux/723282937.sock (107 chars)"
stderr: ""
```

**Root cause**: `role_lifecycle.sh unpark` calls `create_role_session`,
which calls `resolve_swarm_socket.bb` to compute the tmux control socket
path under `<fixture-root>/.swarmforge/tmux/<hash>.sock`
(`swarm_socket_lib.bb`'s own `primary-socket-path`, the same BL-367
path-length guard this session's own BL-817 work read directly).
`mkdtempSync(os.tmpdir(), 'sfvc-bl368-relaunch-')` on macOS resolves under
the long `/var/folders/<hash>/<hash>/T/` base; combined with this
step file's own descriptive `sfvc-bl368-relaunch-` prefix, the resulting
socket path is 107 bytes - 7 over the guard's own 100-byte safety margin
(itself already under Linux's 108/macOS's 104 sun_path hard limit). The
guard correctly refuses and exits 1 (fail-closed, exactly as designed) -
but it does so BEFORE `create_role_session` ever reaches the "is the
previous claude process still alive" check the scenario means to exercise,
so the refusal's own reason (socket-path-too-long) is real but is not the
one the scenario asserts on, and the message lands on STDOUT, not STDERR
(the step handler only asserts on `stderr`, which is why it read empty).

**Why not fixed here**: this is not a Babashka load-file dependency at
all - `resolve_swarm_socket.bb`/`role_lifecycle.sh`/`swarmforge.sh` are
entirely outside BL-944's own scope, which is the fixture DEPENDENCY LIST
`operatorRuntimeBbFixtureFiles.js` exports, consumed only via
`--tick-once`. This scenario doesn't even touch that list or
`operator_runtime.bb` - `mkRoleLifecycleFixture()` is a completely
separate fixture builder for a completely separate script. BL-944's own
constraints explicitly forbid touching anything under
`swarmforge/scripts/` and forbid fixing surfaced scenario failures in this
parcel.

**Verified the dependency-closure fix is not the cause**: the failure
mode is a socket-path-length refusal inside a DIFFERENT script
(`role_lifecycle.sh`/`resolve_swarm_socket.bb`) this ticket's own fix
(`operatorRuntimeBbFixtureFiles.js`, `operator_runtime.bb`'s closure)
never touches or reaches. The same session's own BL-817 and BL-938 work
independently hit and worked around the identical macOS unix-socket
length constraint in two OTHER files this same day (both fixed by
shortening the fixture root's own base path, e.g. `/tmp/...` instead of
`os.tmpdir()`'s long macOS base) - this is that same host-specific
constraint, encountered here for a third time, in code this ticket does
not own.

**Likely remedy** (not attempted, a note for whoever picks this up):
`mkRoleLifecycleFixture()`'s own `mkTmp('sfvc-bl368-relaunch-')` call
could use a shorter prefix, or root under `/tmp` directly rather than
`os.tmpdir()`, mirroring the fix already applied twice elsewhere this
session. A more durable fix would give `role_lifecycle.sh`/
`create_role_session` a way to surface ITS OWN distinct refusal reason on
stderr (today `resolve_swarm_socket.bb`'s error appears to land on
stdout), so a future step handler asserting on stderr does not silently
misread a socket-length refusal as "no output at all".

## Disposition

Raised via a priority-00 `note` to the specifier and coordinator alongside
this parcel's `git_handoff`, per the BL-937/BL-938 precedent. Does not
block BL-944 itself: this ticket's own invariants (the fixture dependency
list matches the real load-file closure) are independently verified
correct - BL-647-rotation-router-liveness now passes 7/7 (was 0/7) and
BL-359-always-on-operator-presence now passes 7/7 (was 5/7);
BL-368-control-loss-is-not-agent-death now passes 3/4 (was 0/4), the one
remaining failure being this surfaced, unrelated defect.
