# Operator attended mode — summon a live, phone-reachable Operator on demand

Status: PROPOSAL (human + Claude discussion, 2026-07-11). Not yet a backlog
intake — deliberately parked in docs/specs so the swarm does not pick it up
before the human has settled the open questions at the bottom.

## Problem

Operator v2 split the Operator into an always-alive cheap runtime
(`operator_runtime.bb`) and a disposable LLM half that is launched per event
batch and torn down by the runtime the moment it touches
`.swarmforge/operator/operator.done` (`reap-finished-operator!` →
`kill-operator-window!`).

That disposability is right for autonomous event handling, but it means
there is no way for the human to get an **interactive, remote-controllable
Operator session on demand** — even though the Operator is exactly the agent
with the right access (the swarm's tmux socket, the local repo, the handoff
mailboxes) and the right independence (its own tmux server, survives swarm
death). Today the human's only lever is the `HUMAN_COMMAND` file, which buys
one fire-and-forget run, not a conversation.

Side observation from the same investigation: because every disposable run
is launched with `--remote-control Operator` and then killed, each run
leaves a dead "Operator" session in the claude.ai phone app — the
"sessions dropping like flies" symptom of 2026-07-10/11.

## Proposal

Add an **attended mode**: a new event type that launches the Operator as a
persistent, remote-controlled session that greets the human and stays up
until dismissed.

### 1. New event type: `HUMAN_ATTEND`

- Added to `event-types` in `operator_lib.bb`, and to `coalescing-types`
  (summoning twice while one summon is pending adds nothing).
- Observed by the runtime from a trigger file
  `.swarmforge/operator/attend`. File content (optional) becomes the event
  `detail` — an initial brief, e.g. `echo "review BL-269 spec" > attend`.

### 2. Trigger surfaces (how the human summons it while away)

1. **PWA button** ("Summon Operator") → host bridge writes the attend file.
   Fits the existing PWA→host pattern (same shape as the BL-265 gates
   routes). This is the surface that works from the phone with no live
   session at all.
2. Direct file touch over any channel that can reach the box (SSH, an
   existing agent session asked to write it).

### 3. Runtime changes (`operator_runtime.bb`)

- Observe the attend file each tick → enqueue `HUMAN_ATTEND`, delete the
  file on launch (same lifecycle as `command`).
- When the pending queue contains `HUMAN_ATTEND`, the launch passes an
  `--attend` flag to `launch_operator.sh`.
- **Reap logic is unchanged**: the runtime still reaps on `operator.done`.
  The only difference is the attended Operator is instructed not to write it
  until dismissed.
- New TTL guard: `OPERATOR_ATTEND_TTL_MS` (default 4h). An attended session
  older than the TTL is killed and reaped by the runtime, so a forgotten
  summon cannot idle forever.
- `status.json` gains a state value `attended` so the PWA/briefing can show
  that the Operator is currently in a human session.
- Escape hatch: a `.swarmforge/operator/dismiss` file makes the runtime
  kill + reap the attended session even if it is wedged.

### 4. Launcher changes (`launch_operator.sh`)

- `--attend` switches the kickoff message to: greet the human on the Remote
  Control session, take instructions interactively, do NOT touch
  `operator.done` until the human dismisses you; the standing hard limits
  in operator.prompt still apply (attended = every instruction is a
  HUMAN_COMMAND, which "overrides routine caution but never the hard
  limits").
- Pairs with the disconnect fix: **disposable runs drop `--remote-control`**
  (their activity is already in `operator.log`; a 2-minute process killed by
  its parent should not register phone-visible sessions). Attended runs keep
  RC name `Operator`. Net effect in the phone app: exactly one "Operator"
  entry, live only when summoned.

### 5. Event flow while attended

- `operator-running?` already prevents a second launch, so routine events
  queue up during an attended session and dispatch on the first tick after
  dismissal. This pause of autonomous handling is accepted: two Operators
  reaching into the same swarm concurrently is a race we do not want.
- The attended kickoff tells the Operator it may read
  `.swarmforge/operator/events.jsonl` if the human asks "what's pending".

### 6. Tests

- `operator_lib_test_runner.bb`: `HUMAN_ATTEND` validity + coalescing.
- `test_operator_runtime_tick.sh`: attend-file observation → event enqueued
  → file consumed on launch; TTL reap path with a faked mtime.
- `launch_operator.sh` dry-run (`OPERATOR_LAUNCH_DRYRUN=1`) asserts the
  attended command keeps `--remote-control` and the disposable command
  drops it.

## Open questions for the human

1. RC naming: single `Operator` name (recommended, with disposable runs
   headless) vs a distinct `Operator-Attended`?
2. TTL default: 4h reasonable? Should TTL expiry notify (email/briefing)
   rather than silently reap?
3. Should the PWA summon button be part of slice 1, or is the attend file
   alone enough to start (PWA as slice 2)?
4. While attended, is pausing autonomous event handling acceptable, or do
   AGENT_EXITED events need to interrupt the attended session (e.g. the
   runtime injects a note into the attended pane)?
