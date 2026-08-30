# BL-1250 — the expeditor counts roles, not processes

Coder, 2026-08-30.

## The arithmetic, confirmed again

`probe-liveness` counted every process whose argv named
`<root>/.swarmforge/launch/`. A launched role contributes two:

```
zsh    <root>/.swarmforge/launch/specifier.sh
claude --settings <root>/.swarmforge/launch/specifier.claude-settings.json
```

Against `expected-live-set`'s `:role-agents 8`, a whole eight-role pack
observed sixteen, `live-set-delta` returned non-empty, and `restart-stack!`
reported `:degraded` — on every healthy restart, indistinguishable from the
genuine half-launch that verdict exists to catch.

Confirmed on the live pack before and after, not only in fixtures:

```
pgrep -af "<root>/.swarmforge/launch/" | wc -l   -> 18
expedite_cli.bb --probe-liveness <root>          -> "role-agents": 8
```

## What changed

`expedite_lib.bb` gains three pure functions —
`launch-files-by-role`, `launcher-only?`, `role-agent-names` /
`count-role-agents`. The probe groups the matching argv lines by role and
counts roles.

`expedite_cli.bb`'s `pids-matching` becomes `ps-entries-matching`, carrying
`{:pid :argv}`; `pids-matching` and a new `argvs-matching` are one-line views
over it. The argv had to stop being discarded: a count of pids cannot say
which role each process belongs to, which is exactly how eight became sixteen.
Every other probe's behaviour is untouched.

**The needle is unchanged and still root-scoped**, on purpose rather than by
accident (BL-782). The prefix carries the project root, so another swarm on
the same host contributes nothing — asserted on every property draw, not in
one example.

## A role is observed when its AGENT is up

Scenario 02 settles what a role "being up" means, and it is the harder half:
a role running only its launcher must be SHORT, not counted. The zsh launcher
outlives its claude child, so a role whose agent has died is still in the
process table — counting the role name alone would have hidden precisely the
half-launch being detected, which is the defect again with the sign flipped.

So `launcher-only?` excludes a role named ONLY by its own `<role>.sh`. Any
other file under the launch directory — the settings file today, a wrapper
tomorrow — makes the role observed, and any number of them is still one role.

## The three firm lines, kept

- `expected-live-set` still says **8**. Changing it to 16 would have tied the
  expectation to today's launcher shape and reported a pack of eight launchers
  with no agents at all as healthy.
- `live-set-delta` is untouched; an empty map still means "matched what we
  expected" and never "we asserted health".
- The tmux, handoffd and handoffd-supervisor probes are untouched, and no
  socket-file glob was reintroduced. The companion tmux observation in the
  ticket's notes is deliberately not scoped here.

## The invariant (BL-654)

`swarmforge/scripts/test/bl1250_role_agent_count_property_runner.bb`, seeded
LCG, 400 runs each.

**Generator reach is constructed for the dimension the invariant is about.**
The claim is independence from per-role process count, so that is drawn wide —
1 to 5 processes, drawn PER ROLE so a pack mixes arities (a pack where every
role runs the same number cannot distinguish "counts roles" from "divides by a
constant"), across packs of 1 to 12 roles. Measured coverage: 40 single-role,
104 ten-plus-role, 266 with a one-process role, 376 with a wrapper role, 349
mixed-arity packs, 323 carrying a foreign root's pack.

P2 is the other direction, because the ticket is explicit this must not become
an assertion of health: a pack with k dead agents is observed short by exactly
k, no dead role is counted from its surviving launcher, and an eight-role pack
missing agents still produces a non-empty delta. Without P2, a probe returning
the expected number unconditionally would satisfy P1.

**Non-vacuity, by breaking the code and running:**

| break | result |
|---|---|
| count processes again (the original defect) | P1 FAILS, 393 draws |
| halve the process count | P1+P2 FAIL, 735 draws |
| count a launcher-only role as live | P2 FAILS, 400 draws |
| drop the root scoping | P1 FAILS, 323 draws |

Restored; ALL PASS. The halving break is the one the ticket predicted and the
one scenario 02 exists for.

## Runs

| what | result |
|---|---|
| BL-1250 acceptance | **7/7** |
| `expedite_lib_test_runner.bb` (10 new assertions) | ALL PASS |
| `bl1250_role_agent_count_property_runner.bb` | ALL PASS, 400 runs each |
| `expedite_lib_property_runner.bb` | pass |
| `test_expedite_cli.sh` | pass |
| BL-782 liveness acceptance | 8/8 |
| live probe against the running pack | 18 processes → `"role-agents": 8` |
| suite inventory | ok — 439 files |

The acceptance drives the REAL `expedite_cli.bb --probe-liveness` with
`EXPEDITE_PROBE_FILE` unset — that entry point refuses to run with the seam
set, precisely so a caller cannot stub the process table it is meant to read.
The "recorded process table" is realised as real processes with the recorded
argv (`exec -a` over `sleep`, BL-782's own device); no swarm is launched, per
qa_e2e step 6. Driving the pure counter directly would have reported green for
a fix that was never wired into the probe.
