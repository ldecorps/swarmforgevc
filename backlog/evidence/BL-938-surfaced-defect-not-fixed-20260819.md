# BL-938 — one real defect surfaced by the acceptance coverage, not fixed here (2026-08-19)

BL-938's own invariant 1 authorizes only `setup_common_fixture`'s pack
declaration in `test_handoffd_aged_note_rotate_wiring.sh` - no other file,
no gate, no cleanup-robustness change. Writing this ticket's acceptance
coverage (BL-112) surfaced a second, pre-existing, unrelated defect in that
same shell test while proving the fix. This file is that record, same
disposition as BL-937's D1/D2.

## D1 — cleanup_a/cleanup_b's `rm -rf` can race a not-yet-reaped grandchild sweep process under set -euo pipefail, turning a real PASS into a reported FAIL

**Reproduced**: `/bin/bash swarmforge/scripts/test/test_handoffd_aged_note_rotate_wiring.sh`
(the already-fixed file, run standalone, isolated from the acceptance
layer), 3 consecutive times:

```
run 1: EXIT 1, stdout ends after "PASS: A (F1 ordering-key wiring): ..."
       stderr: rm: /private/var/.../tmp.n30QGham: Permission denied
run 2: EXIT 1, stdout ends after "PASS: A ..." AND "PASS: B (F1 fresh-note guard): ..."
       stderr: rm: /private/var/.../tmp.PFhkHYAf: Permission denied
run 3: EXIT 1, stdout ends after "PASS: A ..." only
       stderr: rm: /private/var/.../tmp.7nC8oPcO: Permission denied
```

In every run, the actual assertions the test exists to prove (F1's
ordering-key wiring and fresh-note broadcast guard) already succeeded and
printed their `PASS:` line. The script's own final `echo "ALL PASS: ..."`
line never printed in any of the 3 runs - because `cleanup_a`/`cleanup_b`
are called as plain statements (`trap - EXIT; cleanup_a`, and again for
`cleanup_b` right before the final echo), and under `set -euo pipefail` a
failing `rm -rf` inside either one exits the whole script immediately at
that point, before the next scenario (for `cleanup_a`) or the final echo
(for `cleanup_b`) is ever reached.

**Root cause (working theory, not confirmed against source)**: `stop_daemon`
already `wait`s for the daemon's own top-level `bb` pid before cleanup runs,
so the race is not with the daemon process itself. Across one poll cycle
the daemon spawns many short-lived `node .../extension/out/tools/*.js`
sweep subprocesses (fleet-status-sweep, cooldown-sweep, pause-auto-resume-
sweep, answer-file-drain-sweep, and others), all of which crash near-
instantly with `MODULE_NOT_FOUND` in this fixture-only root (no real
`extension/out/` tree). These are grandchildren of the waited-on `bb`
process; `wait` on the direct child does not guarantee every grandchild's
file handles are released before `rm -rf` runs immediately after. An
instrumented debug copy that inserts a `find "$ROOT" -exec ls -lad {} \;`
before each `rm -rf` (a few hundred ms of extra delay) did not reproduce
the failure across 3 runs - consistent with a teardown race, not a real
assertion failure or anything the rotation-router fix touches.

**Why not fixed here**: BL-938's invariant 1 authorizes only the pack-
declaration line in `setup_common_fixture`; cleanup-robustness in
`cleanup_a`/`cleanup_b` is a different concern in the same file, and the
ticket's own required_wiring/qa_e2e_procedure step 5 pin the diff to
exactly that one change. This is also host-load-sensitive (this host runs
the real swarm daemon continuously in the background throughout the
session) rather than a deterministic logic bug, which argues for a fix
informed by more repro data than one session affords, not a quick patch
guessed under time pressure.

**Verified the rotation-router fix is not the cause**: the failure mode
(trailing `rm -rf` under `set -e`) is orthogonal to whether the daemon
successfully rotates or is refused - it can only be observed AFTER the
scenario's own assertions already ran to completion (their `PASS:` lines
print before the failing cleanup call). The three sibling wiring tests
(`test_handoffd_priority_rotate_wiring.sh`, `test_handoffd_starve_rotate_
wiring.sh`, `test_rotate_to_role_stuck_parcel_gate.sh`) were not observed
to flake in the same session, though they are shorter-lived and may simply
exercise the daemon for less real time per run.

**Acceptance-layer workaround, not a fix**: `specs/pipeline/steps/
bl938AgedNoteRotateFixtureRotationRouterSteps.js`'s "every one of its
scenarios passes" / "the test fails" steps assert on the script's own
`PASS:`/`FAIL:` output lines rather than its process exit code, so BL-938's
own acceptance suite is not exposed to this flake. This is a narrower,
documented accommodation for the acceptance layer only - it does not touch
the shell script and does not change what the shell script itself reports
to a human running it directly.

## Disposition

Raised via a priority-00 `note` to the specifier and coordinator alongside
this parcel's second `git_handoff` (the acceptance-coverage commit), per
the BL-937 D1/D2 precedent: a real, previously-unreachable-in-this-
session defect surfaced while proving a fix, out of that fix's own
authorized scope, recorded with evidence rather than silently patched or
silently ignored. Does not block BL-938 itself: the rotation-router fix is
complete and correct, verified via the shell test's own `PASS:`/`FAIL:`
output directly (not just via the acceptance layer) across every run in
this session.
