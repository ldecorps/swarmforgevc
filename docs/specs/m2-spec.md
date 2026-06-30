# M2 Specification — Reliability Layer

**Goal:** Stop relying on the human to babysit tiles. Make the swarm survive its own failure modes.

**Exit criterion:** A developer can leave a run unattended; stalls are visibly flagged and recoverable without restarting the swarm.

---

## Slice 1: Hardened Message Bus

**What:** Replace the current mutable-YAML message bus with an append-only event log per message.

**Behavior wanted:**
- Each message lives as a log file at `.swarmforge/messages/<id>.log`, one YAML event per line.
- Events: `created`, `received`, `done`, `chased`, `dead-letter`.
- `created` event carries: `id`, `seq`, `from`, `to`, `subject`, `body`, `schema: 1`, `at`.
- `received` event carries: `by`, `at`, `claimed_by: <role>@<epoch>` (the WIP lease).
- `done` event carries: `by`, `at`.
- Current status = last event type. History is free.
- All writes are atomic: write to temp file, then `rename()` into place (already done for MessageBus writes — extend to appends).
- Receivers record handled `id`s; re-delivered messages are no-ops (idempotent delivery).
- A `received` message with a live lease (its owning process is still running) is not re-claimable. A stale lease (process gone) is claimable by a respawned process.
- Monotonic `seq` per sender; a receiver rejects a `done` event that arrives before its `received`.
- `schema: 1` on every `created` event for forward compatibility.

**Acceptance signal:**
- Unit tests: write a message, append events, read back current status correctly.
- Two simulated processes pass a handoff through the log; replay shows full history.
- Atomic write test: interrupt mid-write, verify no corrupt state.

**Constraints:**
- Lives in `extension/src/orchestrator/MessageBus.ts` — replace or extend the existing class.
- Do not change the `.swarmforge/handoffs/` directory used by the SwarmForge tmux layer — those are separate. The new message log goes under `.swarmforge/messages/`.
- Expose helper CLI commands on PATH (`send-handoff`, `ack-handoff`, `complete-handoff`) at `extension/src/tools/` for agents to call.

---

## Slice 2: Heartbeat Decorator

**What:** Wrap every agent tool call to emit a heartbeat timestamp on entry and exit.

**Behavior wanted:**
- Each tool invocation writes (atomically) to `.swarmforge/heartbeats/<role>.yaml`:
  ```yaml
  role: coder
  last_beat: <ISO timestamp>
  last_tool: write_file
  phase: exit        # entry | exit
  in_flight: false   # true between entry and exit
  beat_count: 412
  ```
- `in_flight: true` is set on tool entry; `false` on tool exit (even on error).
- The decorator wraps the tool layer in `extension/src/tools/` — agents get heartbeats for free by using standard tools, with no per-agent opt-in.
- No heartbeat instrumentation leaks into the target project.

**Acceptance signal:**
- Run a tool call; confirm the heartbeat file is written with correct `phase` and `in_flight` values.
- Run a long-running tool (simulated slow operation); confirm `in_flight: true` is set before it exits.

**Constraints:**
- The decorator is a wrapper in `extension/src/tools/` — not in agent code or target code.
- Works for both the shell backend and the in-process `vscode.lm` runtime.

---

## Slice 3: Watchdog (Extension Host)

**What:** A polling monitor in the extension host that reads heartbeat state and updates tile liveness.

**Behavior wanted:**
- Polls every `swarmforge.heartbeat.intervalSeconds` (default: 15s).
- Per-role checks:
  - No heartbeat past `staleTimeoutSeconds` (60s) and `in_flight: false` → mark tile **amber** ("idle"), emit a nudge (write a wakeup note to the agent's inbox).
  - A tool `in_flight: true` past `inFlightTimeoutSeconds` (600s) → mark tile **amber → red**; surface the stuck tool name on the tile.
  - Still stale past `deadTimeoutSeconds` (180s) after nudges → mark tile **red** ("not responding"); optionally auto-respawn if `swarmforge.watchdog.autoRespawn` is true.
  - Process PID for a role no longer exists → mark red; auto-respawn if enabled.
- Per-role respawn cap: `swarmforge.watchdog.maxRespawnsPerRole` (default: 3) within a sliding window — once exceeded, leave tile red for human intervention.
- Aggregate health shown in status bar: e.g. `4 agents · 3 alive · 1 idle`.

**Acceptance signal:**
- Stop a simulated agent's heartbeat; confirm tile goes amber at stale timeout, then red at dead timeout.
- Simulate an in-flight tool that never exits; confirm tile shows the stuck tool name.
- Confirm respawn cap prevents crash-loop.

**Constraints:**
- Watchdog lives in the extension host only — not in agents, not in the target.
- Uses the settings keys already defined in the spec (`swarmforge.heartbeat.*`, `swarmforge.watchdog.*`).
- Dormant agents (per M3 dynamic workflow — out of scope here) should not false-alarm; for now all spawned agents are live.

---

## Slice 4: Chase + Dead-Letter Escalation

**What:** The watchdog chases sleeping agents by re-notifying them when a message stays `sent` too long; escalates to dead-letter after `maxChases`.

**Behavior wanted:**
- Extension host polls message log files on `swarmforge.comms.chaseTimeoutSeconds` (default: 90s).
- If a message stays in `created` (no `received` event) past timeout:
  - Append a `chased` event to the log with `chase_count` and `at`.
  - Write a nudge note to the receiver's inbox.
  - Increment chase count.
- After `swarmforge.comms.maxChases` (default: 3) chases with no `received`:
  - Append a `dead-letter` event (terminal).
  - Surface a red tile warning on the receiver.
- **Heartbeat-gated chasing:** before chasing, check watchdog state. If receiver is dead (not just slow), escalate to **respawn first**, then let auto-pickup handle the pending message — don't chase a corpse.
- Messages stuck in `received` (picked up but never completed) past a longer timeout (2× `chaseTimeoutSeconds`) are also flagged amber on the tile.
- Each tile shows a small badge: `2 sent · 1 received`.
- A messages view (panel tab) lists all messages with status, age, and chase count. Stuck messages are highlighted.

**Acceptance signal:**
- Write a message to a simulated unresponsive receiver; confirm chases fire at the right intervals, dead-letter fires at max.
- Confirm heartbeat-gated logic: when receiver is dead, respawn is triggered before chase.
- Confirm tile badge updates.

**Constraints:**
- Chase monitor runs in extension host, not in agents.
- Nudge is a `note`-type message written to the receiver's inbox (same message bus).
- Garbage collection: `done` message logs older than the current run are archived (moved to `.swarmforge/messages/archive/`) on run start to prevent unbounded growth.

---

## Slice 5: Per-Agent Respawn with Auto-Pickup

**What:** Kill and relaunch a single agent in its existing worktree; on relaunch the agent automatically picks up its pending messages.

**Behavior wanted:**
- `SwarmForge: Respawn Agent` command (and the ⟳ button per tile) kills only that role's backend PID and relaunches it in the same worktree.
- The rest of the swarm continues uninterrupted.
- On relaunch, the agent scans `.swarmforge/messages/` for messages addressed to it still in `created` or `received` with a stale/absent lease and resumes them automatically.
- A `received` message with a live lease is left alone (another process is working it).
- Respawn replaces only the process — worktree, branch, and all on-disk state are preserved.
- The tile's `model ▾` dropdown swaps the backend and triggers a respawn on that role only.

**Acceptance signal:**
- Kill an agent mid-work; respawn it; confirm it picks up its pending message without being re-chased.
- Confirm live-lease message is not double-claimed.
- Confirm other agents are unaffected.

**Constraints:**
- Respawn is already partially implemented (⟳ button may exist from M1) — extend or complete it.
- Auto-pickup logic scans message logs; it does not re-read the tmux handoff layer.

---

## Slice 6: Tracked Human Input

**What:** Keystrokes typed directly into a tile are mirrored into the message store as a `human-input` event, making human guidance auditable alongside agent-to-agent traffic.

**Behavior wanted:**
- Any keystroke forwarded to an agent's process via the tile is also captured as a message:
  ```yaml
  # .swarmforge/messages/<id>.log
  {id: ..., seq: 1, from: human, to: <role>, event: created, subject: "human-input", body: "<text>", at: ...}
  ```
- A "✎ human" marker appears on the tile and in the message view to distinguish human nudges from agent traffic.
- A dedicated **"Send instruction" input box** per tile is the primary path (one message per submission, cleanly logged). Raw keyboard typing is the fallback — best-effort capture.
- Human input messages appear in the messages view panel tab alongside agent-to-agent handoffs.

**Acceptance signal:**
- Type into the send-instruction box on a tile; confirm the message appears in the messages view with `from: human`.
- Confirm the `✎ human` marker is visible on the tile and in the message view.

**Constraints:**
- The "send instruction" box is a UI addition to the tile header (webview change).
- Raw keystroke capture is best-effort — some terminal sequences may not be capturable cleanly; the send-instruction box is the reliable path.
- Human input is never automatically acted on by the chase monitor (it's an audit record, not a handoff).
