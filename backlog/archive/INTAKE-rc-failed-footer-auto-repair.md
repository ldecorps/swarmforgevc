# Raw intake — Auto-repair when Claude remote-control shows `/rc failed`

Status: **new intake, not minted.** Capture only (human via Cursor
2026-08-15 ~11:32 CEST). Specifier: mint and spec.

## Why this is in front of you

Observed live 2026-08-15 on the coordinator pane:

- Live process still carried `--remote-control SwarmForge-Coordinator`.
- Pane footer showed **`/rc failed`** (cloud session dead).
- Human lost claude.ai/code / phone remote control for that role.
- `./swarm ensure` reported `rc:coordinator: HEALTHY`.
- `bb remote_control_health.bb` / babysitterd check 2 also treat flag-present
  as healthy.

Repair that worked: wait until the pane was idle, then
`bb swarmforge/scripts/remote_control_respawn.bb . --role coordinator`
→ new session URL
`https://claude.ai/code/session_017sH8L8mMzdXZNdKPS22rsH`, footer back to
`/rc`.

Root cause class: **session connectivity dropped while argv stayed correct.**
Today's RC health (BL-514) deliberately only trusts the `--remote-control`
flag — there is no local websocket liveness file — so this failure mode is
invisible to ensure / babysitter / operator automation.

Human ask: **detect persistent `/rc failed` and auto-repair with the existing
idle-safe respawn path**, then surface the new session URL.

## Goal

1. Mint a defect / enhancement ticket (next free id after the briefing
   intakes already queued — expected **BL-898** if those took BL-896 /
   BL-897) for `/rc failed` auto-repair.
2. Spec detection of **persistent** `/rc failed` footer chrome on a live
   agent that still has the expected `--remote-control` flag (do not
   conflate with `:degraded` missing-flag).
3. Spec idle-safe repair via the existing
   `remote_control_respawn` / `respawn-role-pane!` machinery (wait for idle;
   never kill mid-turn).
4. Spec how the human gets the new `claude.ai/code/session_…` URL after
   repair (Telegram / front-desk notice, coordinator note, or equivalent
   existing notify path — specifier picks the smallest that works).
5. Acceptance must prove: a fixture or live probe where footer is
   `/rc failed` + flag present is classified as needing repair; ensure /
   babysitter / operator_runtime (whichever owns the sweep) performs or
   triggers the idle-safe respawn; healthy `/rc` footer is left alone.

## Preferred directions (specifier picks)

Any of these are acceptable — prefer deterministic automation over an LLM
Operator judgment call:

1. **Extend BL-514 RC health** — new status (e.g. `:session-dead`) from pane
   footer `/rc failed`, actionable like `:degraded`, repaired by ensure's
   existing respawn path.
2. **babysitterd finding + ensure/operator_runtime repair** — babysitterd
   currently never fixes (nudge-only); if detection lives there, pair it
   with a deterministic repair owner, or deliberately keep nudge-only and
   have coordinator run respawn (weaker — human still waits on coordinator).
3. **operator_runtime recurrent check** — same detect → idle-safe respawn
   → notify pattern used for other host repairs.

Out of scope unless you deliberately widen: changing Claude CLI reconnect
behavior; treating "no session URL in scrollback" as dead (known false
negative on long-lived agents — already documented in
`remote_control_health_lib.bb`); repairing missing-flag `:degraded`
(already covered by BL-514).

## Locked human decisions

1. Auto-repair **is wanted** for this failure mode — do not leave
   `/rc failed` as human-only recovery.
2. Repair must stay **idle-safe** (same discipline as
   `remote_control_respawn.bb`: wait, then skip if still busy — never
   mid-turn kill as the default).
3. Prefer extending existing RC health / ensure / babysitter / runtime
   machinery over a new daemon.
4. Deterministic sweep owns detect+repair; the LLM Operator is the wrong
   primary owner.

## Related

- `docs/how-to/BL-514-remote-control-health-and-ensure-wiring.md`
- `swarmforge/scripts/remote_control_health_lib.bb` (flag-only classify;
  documents no websocket liveness signal)
- `swarmforge/scripts/remote_control_respawn.bb` (proven repair today)
- `docs/how-to/BL-611-babysitterd-runbook.md` (check 2 = flag only;
  daemon never fixes)
- Live incident: coordinator `/rc failed` 2026-08-15 ~11:18 CEST; repaired
  by Cursor-assisted `remote_control_respawn.bb --role coordinator`.

---

**Dispositioned 2026-08-15 (specifier).** Specced as **BL-898**
(`backlog/paused/BL-898-rc-failed-auto-repair.yaml`). Preferred direction 1
chosen (extend BL-514 RC health with `:session-dead` through the existing
`actionable?` predicate); reasoning recorded in the ticket.
