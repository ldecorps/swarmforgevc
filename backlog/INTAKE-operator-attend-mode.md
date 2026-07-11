# INTAKE: Operator attended mode — summon a live remote session on demand

Source: human direction 2026-07-11 (phone session, following the
Operator-RC-churn incident). Full design + settled decisions:
`docs/specs/operator-attend-mode.md`. The human answered all four open
questions there — this intake is the agreed shape, routed to the specifier.

## The gap

Operator v2's LLM half is disposable: launched per event batch, torn down by
the runtime on `operator.done`. There is no way for the human to summon an
interactive, phone-reachable (Remote Control) Operator session on demand,
even though the Operator is exactly the agent with swarm + repo access and
its own swarm-independent tmux socket. The `HUMAN_COMMAND` file buys one
fire-and-forget run, not a conversation.

Companion fix (already landed with the spec): disposable runs are now
HEADLESS — `launch_operator.sh` no longer passes `--remote-control`, ending
the disconnected-"Operator"-session pile-up in the Claude app. Attended mode
is where the RC flag returns, for summoned sessions only.

## Want (observable)

- Writing `.swarmforge/operator/attend` (optionally containing an initial
  brief) results, within one runtime tick, in a persistent Operator session
  named `Operator` visible in claude.ai Remote Control, greeting the human
  and awaiting instructions.
- The session stays up until the human dismisses it (Operator touches
  `operator.done`), a `.swarmforge/operator/dismiss` file forces teardown,
  or the TTL (default 4h, `OPERATOR_ATTEND_TTL_MS`) expires — expiry reaps
  with a log line, no notification.
- `status.json` shows `state: "attended"` while the session is live.
- Routine events queue while attended and dispatch on the first tick after
  dismissal (single-Operator invariant; no second launch, no interruption).
- Slice 2: a "Summon Operator" button in the PWA writes the attend file via
  the host bridge.

## Fit / reuse

- `HUMAN_ATTEND` joins `event-types` AND `coalescing-types` in
  `operator_lib.bb` (double-summon adds nothing).
- The attend file follows the existing `command` file lifecycle in
  `operator_runtime.bb` (observed each tick, consumed on launch).
- Reap logic is UNCHANGED: the runtime already reaps on `operator.done`;
  attended mode simply instructs the Operator not to write it until
  dismissed. TTL + dismiss are new guards in the runtime tick.
- `launch_operator.sh` gains an `--attend` flag: adds
  `--remote-control Operator` back (attended runs ONLY) and swaps the
  kickoff message (greet the human, take instructions, hard limits in
  operator.prompt still apply — attended input IS `HUMAN_COMMAND`).
- `operator.prompt` gains an attended-mode section.
- Slice 2 reuses the PWA→host-bridge pattern (same shape as the BL-265
  `GET /gates` routes).

## Constraints

- NO REAL TIMERS in tests: TTL logic must be pure given now-ms (same
  posture as `operator_lib.bb`'s `timer-due?` / `cooldown-elapsed?`).
- Launcher assertions extend the existing dry-run smoke
  (`OPERATOR_LAUNCH_DRYRUN=1`): disposable command has NO
  `--remote-control`; `--attend` command has `--remote-control Operator`.
- Two-phone-surface boundary (project Architecture Rule): the PWA button is
  a host-bridge write, not a webview shell-out.
- Do not regress the headless-disposable fix.

## Delivery

Two slices (human-decided):
1. Attend-file trigger + `HUMAN_ATTEND` + attended launch/lifecycle
   (TTL, dismiss, status). Buildable now; touches operator_lib/runtime/
   launcher/prompt + their existing test runners.
2. PWA "Summon Operator" button via host bridge.

Priority: suggest normal — quality-of-life for the human operator, no
swarm-throughput impact; slice 1 is small given the reuse above.
