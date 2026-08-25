# How to: raise active backlog depth on host headroom (BL-1128)

When CPU load and free memory have sustained headroom and Article 3.5 throttle
is not degraded/severe, raise the **standing configured**
`active_backlog_max_depth` (durable conf write), then unhold eligible
`backlog/hold/` tickets into `paused/`.

## Owner CLI

```bash
bb swarmforge/scripts/headroom_cap_raise_cli.bb <project-root> raise
bb swarmforge/scripts/headroom_cap_raise_cli.bb <project-root> unhold
bb swarmforge/scripts/headroom_cap_raise_cli.bb <project-root> undo
```

- **Write target:** the same conf `effective_backlog_depth_cli.bb` already
  treats as standing max (`active_backlog_max_depth_conf_path` in
  `.swarmforge/swarm-identity`, else `swarmforge/swarmforge.conf`).
- **Audit:** `.swarmforge/coordinator/headroom-cap-changes.jsonl`
- **Undo:** restores the prior configured value recorded at the last raise.

## Eligibility / preference

- Unhold only tickets with `headroom_unhold: eligible` (hold→paused only;
  never auto-promote into `active/`).
- Promotion ranking prefers paused depth/cap/throttle correctness titles
  after the expedite lane (`promotion_gates_lib.bb`).

## Safety

Never raises (and unhold refuses) under degraded/severe throttle, pressure,
ceiling, or raise cooldown. Hermetic tests may plant
`.swarmforge/coordinator/headroom-signal-override.json`.
