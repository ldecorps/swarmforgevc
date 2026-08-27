# Raw intake — Switch off Claude remote connections via config; gate RC repair on that config

Status: **new intake, not minted.** Capture only (human via Cursor,
2026-08-28 ~00:46 BST). Specifier: mint and spec.

## Operator directives (verbatim intent)

1. Switch off the Claude remote connections via config.
2. The swarm will try to fix connections it considers failed: make this
   read the config and only fix the connection if the conf says they
   should be up & running.

## Why this is in front of you

`config remote_control on|off` already exists (`swarmforge.sh` parse) and
several packs set `config remote_control off` (cursor-forge, mono-router
variants, etc.). Today that knob only controls **auto-inject**: if a
Claude window line omits `--remote-control`, the launcher adds one when
the default is on, and skips inject when off
(`test_remote_control_launch.sh` 01/02).

It does **not** fully turn RC off when window lines (or already-written
launch scripts) still carry an explicit `--remote-control …` flag — which
is the standing full-forge / `swarmforge.conf` shape. RC health/repair
(BL-514 / BL-898) then treats the **persisted launch script** as source of
truth: if the script still has the flag, `./swarm ensure` /
`remote_control_health.bb --fix` will classify `:degraded` or
`:session-dead` (`/rc failed` footer streak) as actionable and idle-safe
respawn to "restore" the cloud session — even when the human's intent via
pack config is that Claude remote connections should not be running.

Human ask: config must be the gate for both **desired state** and
**repair**. Do not fight a deliberate off.

## Goal

1. Mint a ticket (defect or enhancement; specifier picks) so that
   `config remote_control off` is a real desired-state switch for Claude
   seats, not only an auto-inject default.
2. Spec that every RC repair path (`./swarm ensure` `rc:<role>`,
   `remote_control_health.bb --fix`, BL-898 `:session-dead` repair, and
   any sibling that respawns to restore `--remote-control` / heal
   `/rc failed`) **reads pack config** (or an equivalent durable desired-
   state derived from it at launch-script write time) and **refuses
   repair** when config says RC should not be up.
3. When config says off: report `OFF` / leave alone — do not respawn to
   re-attach claude.ai/code, do not treat `/rc failed` as actionable,
   do not escalate a "missing" RC flag as something to restore.
4. When config says on (or window lines intentionally enable RC under an
   on policy): keep today's BL-514 / BL-898 idle-safe repair behavior.
5. Acceptance must prove both sides: (a) config off → failed/missing RC
   is not repaired; (b) config on + expected flag → existing
   degraded/session-dead repair still fires.

## Preferred directions (specifier picks)

Any of these are acceptable — prefer one clear desired-state source over
dual truths (pack config vs stale launch script):

1. **Config wins at launch-script write:** `config remote_control off`
   strips / refuses to persist `--remote-control` even when a window line
   names it (or errors loudly until the window line is cleaned). Repair
   then continues to trust the launch script, which now matches config.
2. **Config wins at classify/repair time:** health/ensure consults the
   effective pack `remote_control` setting (and/or per-role desired RC)
   before `actionable?`; launch scripts may still be stale until next
   rewrite, but repair never fights `off`.
3. **Hybrid:** rewrite launch scripts when the pack flips off, *and*
   gate repair on config so a mid-flip / stale script cannot re-enable.

Out of scope unless you deliberately widen: Cursor Remote / non-Claude
phone paths (already `OFF` under BL-1108); changing Claude CLI reconnect
behavior itself; removing the human ability to enable RC when config is
on.

## Locked human decisions

1. Claude remote connections must be switchable **off via config**.
2. Auto-repair of "failed" RC is wanted **only when config says those
   connections should be up**; otherwise leave them alone.
3. Prefer extending BL-514 / BL-898 / ensure machinery over a new daemon.
4. Deterministic config gate — not an LLM Operator judgment call.

## Related shipped work

- BL-514 — RC health + `./swarm ensure` `rc:<role>` wiring
- BL-898 — `/rc failed` → `:session-dead` idle-safe repair
- BL-1108 — non-Claude seats report RC `OFF` (not false HEALTHY)
- `config remote_control off` auto-inject skip (`test_remote_control_launch.sh`)
- Archived intake that minted BL-898:
  `backlog/archive/INTAKE-rc-failed-footer-auto-repair.md`
