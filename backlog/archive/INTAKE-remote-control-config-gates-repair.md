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

---

## Specifier disposition (appended 2026-08-28, not part of the human's text above)

**Minted as a 1:N split** — the intake asked for two separable behaviours
(goal 1 = launch, goals 2/3 = repair) and named the hybrid as an acceptable
direction. Both tickets are `epic: fleet-topology`, `milestone: M8`,
`human_approval: pending`:

- **BL-1217** — `backlog/paused/BL-1217-rc-repair-refuses-to-fight-a-deliberate-config-off.yaml`
  (defect/high). The REPAIR half = the intake's preferred direction 2, goals
  2 and 3, locked decision 2. Every RC repair path gates on effective config
  and refuses to respawn when it says off.
- **BL-1218** — `backlog/paused/BL-1218-config-off-is-honored-at-launch-over-an-explicit-window-flag.yaml`
  (defect/medium). The LAUNCH half = the intake's direction 1, goal 1, locked
  decision 1. `config remote_control off` is honoured even when a window line
  names `--remote-control` explicitly.

Landing both IS the intake's direction 3 (hybrid). They are independent —
either is valuable and testable alone — so neither declares `depends_on` the
other.

**Both operator directives and all four locked decisions are preserved
VERBATIM in the `notes:` of BOTH tickets**, per Article 5.3 (a consolidation
never drops a human sentence). Neither ticket can be read in isolation and
lose half the ask.

Premises verified before minting, not assumed:
- `remote_control` is parsed in `swarmforge/scripts/swarmforge.sh` — not the
  repo-root `swarmforge.sh` the intake's shorthand named.
- `remote_control_health_lib.bb`: `expected-rc-name` (line 55) reads the
  persisted launch script and nothing else; `classify` maps `(nil? expected)`
  to `:off`; `actionable?` (line 246) is `#{:degraded :session-dead}` and
  takes only a status — no config input exists anywhere on that path. This is
  precisely why an explicit window-line flag survives a config `off`.
- Ten packs set `config remote_control off`; `swarmforge.conf` and
  `packs/full-forge.conf` name `--remote-control` on all seven Claude window
  lines, which is the shape that makes the flag outlive the switch.

One open question is flagged for the human in BL-1218's `approval_context:`
rather than guessed: on a collision (config off + explicit window flag), this
spec has **config win silently**; the intake also permitted **erroring loudly
until the window line is cleaned**. The recommendation and its reasoning are
recorded there.
