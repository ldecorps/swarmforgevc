# Pause-aware flow-watchdog alarms (BL-779)

*How-to. Task-oriented: read flow-stall alarms and babysitter all-clear lines
during a control pause without mistaking intentional quiet for a rotation starve.*

A **control pause** (`.swarmforge/operator/control-pause.json`, see
[BL-617 nightly cooldown](BL-617-nightly-cooldown-window.md)) deliberately
freezes chase, rotation, and most sweeps (BL-617). Parcels can still age in
mailboxes, and the **flow watchdog still runs** through a pause (BL-577) — by
design it is not muted.

Before BL-779, that combination produced misleading copy: alarms prescribed
`- rotate` or `- nudge` actions the paused daemon cannot take, and the
babysitter printed a bare `OK all checks green` with no mention of the pause.
Humans read that as a starve and queue-jumped rotation tickets (BL-651 audit).

BL-779 is **observability only** — it does not change what a pause freezes.

## Flow-watchdog alarm text

While `pause-active?` holds (`backlog_depth_lib.bb` reading
`control-pause.json`):

| Pause shape | Alarm header | Action suffix (replaces verb) |
| --- | --- | --- |
| Timed (`untilMs` set) | `⚠️ WARN flow-stall (swarm paused):` … | `paused until <UTC instant>.` |
| Until operator resumes (`untilMs` absent) | same `(swarm paused)` marker | `paused until operator resumes.` |
| No pause | unchanged — no `(swarm paused)` | `- rotate.` / `- nudge.` / `- investigate.` as today |

The **tier decision is unchanged** — a parcel past warn still alarms during a
pause; only the prescribed verb is replaced with pause timing.

Example (timed pause, warn tier):

```text
⚠️ WARN flow-stall (swarm paused): parcel p (hardender->documenter, git_handoff) aged 1h0m in documenter new - paused until 2026-08-02T08:00:00Z.
```

Same parcel with no pause keeps today's byte-identical suffix, e.g.
`… in documenter new - rotate.`

## Babysitter all-clear line

When every check is green but a control pause is live,
`babysitterd_sweep_lib.bb` / `babysitter_check.bb` names the pause instead of
a bare idle-correct line:

```text
OK all checks green — control pause active until 2026-08-02T08:00:00Z
```

An until-I-resume pause uses `control pause active until operator resumes`.

## Modules

| Piece | Location |
| --- | --- |
| Pause state + formatting | `swarmforge/scripts/backlog_depth_lib.bb` — `read-pause-state`, `pause-active?`, `format-pause-until-text`, `format-control-pause-active-text` |
| Alarm text | `swarmforge/scripts/flow_watchdog_lib.bb` — `format-alarm-text` (injects pause from live marker at sweep time) |
| Babysitter verdict | `swarmforge/scripts/babysitterd_sweep_lib.bb` — `format-all-clear-line`; wired from `babysitter_check.bb` |

## Verify

```bash
bb swarmforge/scripts/test/flow_watchdog_test_runner.bb
bb swarmforge/scripts/test/backlog_depth_test_runner.bb
bb swarmforge/scripts/test/babysitterd_sweep_lib_test_runner.bb
bash swarmforge/scripts/test/test_babysitter_check.sh
bash specs/pipeline/scripts/run_acceptance.sh \
  specs/features/BL-779-pause-blind-flow-watchdog-alarm.feature
```

## Siblings

- [Nightly cooldown window (control-pause state)](BL-617-nightly-cooldown-window.md) — how the pause marker is written (BL-617)
- [babysitterd runbook](BL-611-babysitterd-runbook.md) — checks 9/10 suppressed during pause; all-clear now names pause (BL-779)
- BL-651 — resident rotation ordering (orthogonal; BL-779 explains *why* nobody is rotating)
