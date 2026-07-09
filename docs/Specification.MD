# SwarmForge VS Code Extension — Specification

**Last Updated:** July 9, 2026

## Overview

A VS Code extension that runs a multi-agent coding swarm and brings the work back as a PR. It is a **standalone orchestrator** — inspired by Uncle Bob's SwarmForge agent-orchestration model, but it spawns and manages the agent processes itself rather than driving SwarmForge or tmux. The extension lives entirely in the forge codebase. It points at any target project, runs the swarm on it, and brings the work back as a PR. The target project carries only two swarm bootstrap files and otherwise has no knowledge of the swarm machinery.

**Getting started?** See [Getting Started with SwarmForge VC](GettingStarted.md) for install, setup, and first run. This specification is the detailed reference.

**Diagrams:** [Architecture diagram](diagrams/architecture.mmd) and
[Swarm workflow flow diagram](diagrams/swarm-flow.mmd) (Mermaid sources)
depict the system as actually built. Flagging a doc/code disagreement here
per BL-095: the Overview paragraph above describes a "standalone
orchestrator" that spawns and manages agent processes itself — the code
does not do this. The extension drives an unmodified, separately-installed
SwarmForge over tmux and reads its `.swarmforge/` state files (see
`swarmforge/constitution/articles/local-engineering.prompt` and
`swarmDiscovery.ts`'s own BL-066 note); it never spawns agent processes
directly. The diagrams reflect the tmux-driving architecture.

---

## Core Design Principles

| Principle | What it means |
|---|---|
| **Forge owns the tooling** | All extension code, generic role prompts, and reusable tools built by the swarm stay in the forge repo |
| **Target stays clean** | Only `project.prompt` and `engineering.prompt` live in the target repo |
| **Target is unaware** | The target repo has no SwarmForge dependency, no lockfile entry, no import |
| **PR is the handoff** | Swarm work returns to the target via a pull request; human always reviews |
| **Human triggers, swarm executes** | The developer kicks off a run manually; the swarm runs autonomously from there |

---

## Relationship to SwarmForge (Inspired By, Not Dependent On)

The extension is a **standalone orchestrator** inspired by SwarmForge — it borrows the *model* (a sequential role pipeline, worktree-per-role, filesystem-mediated handoffs) but spawns and manages the agent processes itself. SwarmForge is **not a runtime dependency**: no fork, no vendored source, no `./swarm` wrapper, no tmux, nothing fetched at setup.

**Why own orchestration.** The driving constraint is native Windows. tmux — SwarmForge's process substrate — has no native Windows implementation, and WSL/emulation layers were explicitly rejected in favor of a clean cross-platform path. Owning the orchestrator means one process API across Windows, macOS, and Linux. The cost is giving up upstream feature relay; the benefit is a substrate the extension fully controls and can run anywhere VS Code runs.

**The substrate is process + filesystem, owned in-repo.** The extension runs the swarm through its own thin orchestrator:
- spawns each agent as an `InteractiveProcess` (a `child_process.spawn` shell backend, or an in-process `vscode.lm` runtime — see Agent Backends),
- owns each process's output stream directly (`onData`), which is what makes live tiles, message-bus capture, and input forwarding all work from a single handle,
- reads and writes swarm state under `.swarmforge/` (messages, heartbeats) and `.worktrees/` in the target clone,
- configures swarm shape through this repo's own role/constitution prompt files and pack config — all *configuration in this repo*, not an external dependency.

Almost everything in this spec — hardened comms, watchdog/heartbeat, work tree, tiles, cost logic — sits on top of that owned substrate.

**Reproducibility.** Because the orchestrator, role runtimes, message bus, and all prompts live in this repo and are versioned in git, a given extension version *is* the complete definition of swarm behaviour. Nothing is fetched upstream that could silently change results between two runs of the same version. (The former `dependency-pinning.md` / `swarmforge.lock.json` discipline is therefore retired — there is no upstream artifact to pin.)

**Borrowing from SwarmForge going forward.** Uncle Bob's pipeline shape remains a useful reference; a human may consult it and port ideas deliberately into this repo's prompts or orchestrator. That is a human design act, not an automated fetch — the inspiration never re-enters as a runtime input.

---

## Repository Layout

### Forge Repo (this extension lives here)

```
swarmforge-vscode/
├── extension/                  # VS Code extension source
│   ├── src/
│   │   ├── panel/              # Webview panel — tiled agent UI
│   │   ├── orchestrator/       # Agent process orchestrator (spawn, stream, worktrees, lifecycle)
│   │   ├── git/                # PR creation, branch management
│   │   ├── config/             # Target project resolution, pack selection
│   │   └── tools/              # Reusable tools accumulated by the swarm
│   └── package.json
├── roles/                      # Generic role prompts (coordinator, coder, cleaner…)
│   ├── coordinator.prompt
│   ├── coder.prompt
│   ├── cleaner.prompt
│   └── architect.prompt
└── constitution/               # Shared constitution articles
    └── articles/
```

### Target Repo (minimal footprint)

```
target-project/
├── project.prompt              # What this project is, its goals, constraints
├── engineering.prompt          # Tech stack, conventions, architectural rules
└── ... (everything else)
```

The extension clones the target repo and operates via git worktrees — one per agent role, exactly as SwarmForge does natively. The extension does not use a separate temp directory; worktrees are created under `.worktrees/` inside the clone. Nothing is committed to the target's main branch until the PR is merged by the human.

---

## UI: Tiled Agent Panel

The extension opens a VS Code Webview panel with one tile per active agent role, one tile per orchestrator-spawned process.

### Panel Layout

```
┌─────────────────────────────────────────────────────┐
│  SwarmForge  [target: my-app]  [7-pack ▾]  [▶ Run] │
├──────────────────┬──────────────────────────────────┤
│  coordinator     │  coder                           │
│  ─────────────── │  ──────────────────────────────  │
│  [live output]   │  [live output]                   │
│                  │                                  │
│                  │                                  │
├──────────────────┼──────────────────────────────────┤
│  cleaner      │  architect                       │
│  ─────────────── │  ──────────────────────────────  │
│  [live output]   │  [live output]                   │
│                  │                                  │
│                  │                                  │
└──────────────────┴──────────────────────────────────┘
│  Status: running  •  Stage: architect  •  dev/feat-login  │
└─────────────────────────────────────────────────────┘
```

### Two layers: tile-as-view, process-as-substrate

A point worth stating plainly, because there's a tempting wrong turn nearby: **the tiles are TypeScript/webview views; the agent processes the orchestrator spawns are the substrate underneath.** They are not alternatives — they are different layers.

- The **tile** is what you see and interact with: a terminal widget the extension renders and fully controls (styling, layout, the per-tile controls, tracked input).
- The **process** is what runs the agent: an `InteractiveProcess` the orchestrator spawned (shell backend or `vscode.lm` runtime), in its own worktree, with its output stream owned directly by the host. The tile reads that stream and paints it, and forwards your keystrokes back down via `write()`.

Spawning agent processes from TypeScript **is** the intended design — that is what the orchestrator is for. The line not to cross is a different one: do not let **coordination logic** (pipeline sequencing, merge, message routing, convergence) leak into the process layer. The orchestrator is a *process manager* only; coordination belongs in the coordinator role and the message bus. If a step at build time feels like you're building pipeline or routing logic inside the process manager, that's the signal you've drifted across this line.

### Tile Behavior

- Each tile streams stdout of its agent's process in real time (subscribe to the `InteractiveProcess` `onData` stream)
- **Tile border states** (with precedence rules applied):
  - **Dead** (steady red) — agent process terminated abnormally
  - **Needs Human** (blue pulse, 1.5s cycle) — agent awaiting human input (permission prompts, yes/no questions, multiple-choice selections)
  - **Stalled** (steady yellow) — agent idle with no output for >2 minutes
  - **Normal** (grey) — agent idle with recent output
  - **Active** (blue) — agent currently producing output
  - *Precedence: dead > needs-human > stalled > normal. A needs-human border suppresses the stalled color, so you can see when an agent is waiting for you to respond.*
- Tile header shows the role name and (when active) a badge with the backlog item ID and short summary (e.g., "BL-038 · tile header active ticket"); when a role holds multiple parcels, the badge shows the lowest ticket ID plus a "+N" count for the others (e.g., "BL-036 · redo_from tool +1"), so you can see at a glance what each agent is working on
- Each tile is always a live embedded terminal — you click into any tile and type directly, exactly as you would in a real terminal attached to that agent
- No expand needed; all tiles are simultaneously interactive, one live terminal per role

#### Tile Selection

- Click a tile header to select it; the selected tile expands to fill 2×2 grid cells (double width and height) for easier reading and interaction
- Click the selected tile header again to deselect it and return to equal-sized tiles
- Only one tile can be selected at a time; selecting a new tile automatically deselects the previous one
- Selection persists across webview reloads

#### Tile Scrolling and Autoscroll

Tiles automatically follow the agent's live output ("tail-locked") so you always see the newest transcript line:

- **Autoscroll**: By default, tiles scroll to show the newest output as it streams. The tile anchors to the agent's live content line, positioned just above any pinned TUI footer (the input prompt, status bar, or interrupt indicator)
- **Scrollback history**: Each tile retains a history of earlier output, bounded by `swarmforge.tile.historyLines` (default 500 lines). The extension accumulates this host-side since agents running in tmux's alternate screen have no tmux scrollback to retrieve
- **Manual scroll-up**: Scroll up to read earlier output beyond the visible rows and the tile releases tail-lock — new output no longer forces the view downward. Scroll up to reach the retained history, not just the immediate scrollback
- **Re-engage**: Scroll back down to the live region and tail-lock re-engages, resuming autoscroll to follow new output
- **Footer visibility**: The pinned footer (input box and status line) remains visible while autoscrolling; live content is never hidden behind it

#### Human input is tracked, not a side-channel

Typing directly into a tile is powerful but creates a hazard: a hand-typed instruction ("skip the auth check") lives only in the terminal scrollback — invisible to the pipeline, the Work Tree, the audit trail, and the next agent. That makes human input an *untracked* channel that can silently contradict the tracked message bus.

To close this, direct typing is **mirrored into the message store** as a human-origin event:

- Keystrokes sent to an agent's process are also captured as a `human-input` message (`from: human, to: <role>`, with the text), appended to that agent's message log
- So the instruction becomes part of the same auditable record as agent-to-agent handoffs — it shows in the message view, survives respawn (the agent's auto-pickup sees it), and is visible to anyone reviewing what shaped the run
- A small "✎ human" marker on the tile and in the message view distinguishes human nudges from agent traffic
- This doesn't restrict what you can type — it just ensures nothing you tell an agent is invisible to the rest of the system. The capture is best-effort for raw keystrokes; a dedicated "send instruction" input box per tile (logged cleanly as one message) is the recommended primary path, with raw typing as the fallback

### Resizable Tiles

Tiles are not forced into an equal grid — you can give more screen to the agents you care about.

- Each tile has a **weight** in the layout; drag the divider between tiles to resize, exactly like split editors in VS Code
- Useful for watching one role closely (e.g. make the `specifier` tile large while shrinking `qa`) without losing visibility of the others
- Layout weights persist per workspace, so your preferred arrangement survives restarts
- A tile can be collapsed to a thin status strip (role name + liveness dot + heartbeat age) when you want it present but minimal
- "Reset layout" returns all tiles to equal weight

### Per-Tile Controls

Each tile has a small control row (hover or always-visible header):

| Control | Behavior |
|---|---|
| **⟳ Respawn** | Kills that one agent's process and relaunches it in the same worktree, without touching any other agent. The swarm keeps running. |
| **model ▾** | Dropdown of available backends/models (`claude`, `codex`, `copilot`, `grok`, …). Changing it respawns that single agent on the new backend on the fly. |
| **⏸ / ▶** | Pause or resume the individual agent (optional, v1.1) |

Respawn preserves the agent's worktree and branch state — only the running process is replaced. The new process re-reads its role prompt and constitution on launch, so any prompt edits made mid-run take effect on respawn.
- Tiles are **interactive** — the developer can type directly into any agent's session at any time, injecting guidance mid-run without stopping the swarm

### Top Bar Controls

| Control | Behavior |
|---|---|
| **target** | Path or GitHub URL of the target project. Persisted per workspace. |
| **pack selector** | Dropdown: forge analyzes the target and suggests a pack (2 / 4 / 7); user confirms or overrides |
| **▶ Run** | Triggers the swarm run |
| **⏹ Stop** | Signals the coordinator to stand down, then the orchestrator terminates all agent processes (coordinator last) |
| **Start Bridge** | Starts a local read-only HTTP server that projects swarm state via JSON endpoints and a real-time SSE event stream (opt-in; requires a running swarm) |
| **Stop Bridge** | Stops the bridge server |

### Read-Only Bridge (Phase 1)

The bridge is an **opt-in local HTTP server** that exposes the same on-disk swarm state the extension reads, via JSON endpoints and a real-time event stream. It is read-only, stateless, and localhost-only in this phase.

**When to use it:** Expose swarm state to a monitoring tool, script, or browser client running on your development machine. Later phases will add remote (off-LAN) access and control endpoints.

**Starting the bridge:**
- Run the VS Code command **SwarmForge: Start Bridge** (`swarmforge.startBridge`)
- The extension generates a one-time bearer token and starts the server on a localhost port (e.g. `http://127.0.0.1:9999`)
- The token is shown in an info message; save it for API requests

**Stopping the bridge:**
- Run the VS Code command **SwarmForge: Stop Bridge** (`swarmforge.stopBridge`)
- Or terminate the extension; the bridge shuts down automatically

**Security:**
- Every request requires a valid bearer token in the `Authorization` header: `Authorization: Bearer <token>`
- The token is generated per run and held only in the extension host environment — it never appears in the target repo or any commit
- Requests without a valid token receive a 401 Unauthorized response with no state disclosed
- The bridge listens on 127.0.0.1 only; it is not accessible over the network

**Available endpoints (Phase 1):**

| Endpoint | Response | Purpose |
|---|---|---|
| `GET /api/pipeline` | JSON: current stage per active parcel | Which role holds each ticket |
| `GET /api/agents` | JSON: per-agent status + heartbeat | Liveness, stall detection, "needs human" states |
| `GET /api/backlog` | JSON: active/paused/done items | Backlog folders and ticket metadata |
| `GET /api/runlog` | JSON: timeline of stage transitions and key events | Run history and audit trail |
| `GET /events` | Server-Sent Events (SSE) stream | Real-time updates when stage or agent state changes |
| `GET /metrics` | JSON: delivery-flow metrics (velocity, burndown, cycle time, forecasts, suite duration trend) | Trend/forecast data for monitoring dashboards or scripts |

`GET /metrics` is computed fresh on each request rather than folded into the ~1s SSE poll loop the other endpoints share — the underlying git-history walk is too expensive to recompute every tick.

**Example usage (cURL):**

```bash
# Start the bridge and save the token
TOKEN=$(grep "token:" ~/.swarmforge/current_run.env | cut -d' ' -f2)

# Query pipeline state
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:9999/api/pipeline

# Subscribe to the event stream
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:9999/events
```

**Stateless design:**
- The bridge holds no state; it is a pure projection of `.swarmforge/` and `backlog/` directories
- If the bridge dies or you stop it, the swarm continues unaffected
- Restarting the bridge serves current state again; no data is lost

### Backlog Pane

Below the tiled agent panel, the extension shows a collapsible Backlog section listing all active work items with live traceability:

- Each backlog row shows: ticket ID, title, and the role currently **holding** that parcel (the stage with the active handoff for that ticket)
- The holder column updates live as the parcel moves down the pipeline — tiles and backlog rows always show the same holder (same resolution source)
- For active tickets with no live holder — whether promoted-but-unrouted or whose parcel was already completed and dropped by a stage — the row shows **"queued"** instead of the static assigned_to field. Tile badges also do not appear for holder-less tickets, keeping both surfaces consistent
- Done items show their milestone; todo items show the intended assignee
- This live traceability helps you spot bottlenecks and know at a glance which stage is responsible for each ticket

#### Interactive Backlog Operations

You can interact with active backlog items directly from the panel:

- **Assign an item**: Click the assignee field for any active item and select a team member to assign or reassign it. The assignment is written immediately back to the target repo's backlog YAML file.
- **Mark done**: Click the action button on any active item to move it from the active backlog to the done folder, reflecting completion. The item is moved to `backlog/done/` (or `backlog/done/<milestone>/` if the item specifies a milestone), and the backlog view updates immediately.

These writes are atomic — the extension uses a temporary file + rename mechanism to ensure no partial writes occur if the process is interrupted.

### Metrics Pane

Beside the Backlog pane, the extension shows a collapsible Metrics section that monitors swarm health and performance:

- **Mean ticket time**: How long on average a ticket takes to move from backlog/active/ to backlog/done/. Displayed with the sample count (e.g., "mean 4h 12m over 23 tickets"). Derived from the target repo's backlog git history — no new data collection needed.
- **Per-agent busyness**: For each role, the fraction of elapsed run time spent processing handoffs. Computed from `dequeued_at` and `completed_at` headers in `.swarmforge/handoffs/inbox/completed/` handoff files, plus any open interval from an in-process task. Shows 0% for idle agents and agents with no history.
- **Retry count**: Total backward handoffs (messages where the sender sits later in the pipeline than the recipient — e.g., QA rejecting work back to coder). Displayed with per-ticket breakdown for tickets with retries, sorted by worst offenders.
- **Suite duration**: How long the test suite takes to run (averaged over recent runs). Displayed with the latest duration, rolling mean, and sample count. Warns when the latest duration exceeds either the configured threshold (default 120 seconds, configurable via `swarmforge.metrics.suiteWarnSeconds`) or 2x the rolling mean, flagging potential performance creep. Tracks durations from all test runs across the main checkout and every role worktree.
- **Chaser telemetry**: Per-role chase/nudge/dead-letter/respawn totals, plus a recent (7-day) chases+nudges daily rate — e.g. "coder 4 chases/2 nudges (0.86/day)". Answers "how many nudges did a role need this week?" durably, since the daemon's own sidecar counters are discarded once an item completes. Read from `handoffd.bb`'s `chaser-YYYY-MM.jsonl` telemetry log; a role or period with no chaser activity reads as zero, never an error.

The metrics pane folds and unfolds like the Backlog pane and refreshes on the panel's normal cadence — no additional polling loop is introduced.

#### Delivery Metrics (velocity, burndown, cycle time, forecasts)

A second metrics layer, derived purely from git history and the current `backlog/` folder state, computes delivery-flow trends:

- **Velocity**: closed-ticket count over a trailing window, with a trend vs. the prior window (e.g. "12 closed in trailing 7d (+3 vs prior)")
- **Burndown**: remaining-ticket count per milestone, reconstructed so the final point always matches the current backlog state
- **Cycle time**: median and p85 spec-to-close duration over the recent closed set
- **Forecasts**: p50/p85 completion date per open milestone, projected from trailing throughput and historical cycle-time distribution — dependency-aware, so a ticket's forecast date never precedes its `depends_on` tickets'
- **Suite duration trend**: the existing per-run suite duration (BL-078) expressed as a trend line; reports "no local data" gracefully rather than erroring

Available today via the `GET /metrics` bridge endpoint (see Remote Access & Phone App below) and the CLI (below) — both are fed by the same computation, so they always report the same numbers. Charting these trends in the panel's web UI is tracked separately (BL-211); this layer is computation/trend only for now.

#### Agent CLI

Every role can also run a headless command-line version of the same metrics:

```sh
node extension/out/tools/swarm-metrics.js
```

Runnable from the repo root or from any `.worktrees/<role>/` checkout. Prints a short plain-text summary — mean ticket time, one busyness line per role, retry total, suite duration with warnings, and a chaser telemetry line per role — followed by one line per delivery metric (velocity, burndown, cycle time, forecasts, suite duration trend) — and exits 0 with placeholder values on a fresh run. The CLI and panel/bridge are fed by the same underlying metrics computation modules, so they always report the same values.

#### Queue status CLI

A second headless, read-only CLI answers "is there actually pending work?" without mixing in the chaser's own operational sidecar files (`.chase.json`, `.nudge`), which used to dominate a raw directory listing and give a false impression of a busy queue:

```sh
node extension/out/tools/queue-status.js [--debug]
```

Runnable from the repo root or any `.worktrees/<role>/` checkout, same project-root resolution as `swarm-metrics.js`. By default, prints one line per role with only its real `.handoff` payload count (`inbox/new` + `inbox/in_process`) — sidecar files are not even listed, not just hidden. Pass `--debug` to additionally list each role's sidecar files, labeled by kind (`chase-sidecar`, `nudge-sidecar`, `other`).

---

## Inter-Agent Communication

Agents communicate through persisted YAML messages with explicit status tracking. This solves a real failure mode: agents fall asleep, and the sender needs to know whether a handoff was picked up — and chase it if not.

### Message store

One YAML file per message, kept with the swarm state — **not** committed to the target:

```
.swarmforge/messages/
  0001-architect-to-coder.yaml
  0002-coder-to-reviewer.yaml
  ...
```

(Lives alongside SwarmForge's existing `logs/agent_messages.log`, but structured and status-bearing.)

### Message schema

```yaml
id: 0002
from: coder
to: reviewer
subject: "feat-user-login: slice 3 ready for review"
body: |
  Implemented the login form validation.
  Branch: .worktrees/coder
  Files touched: src/auth/login.ts, src/auth/login.test.ts
status: sent          # sent | received | done
created_at: 2026-06-25T14:02:11Z
received_at: null
done_at: null
chase_count: 0
last_chased_at: null
```

### Status lifecycle

```
sent ──────► received ──────► done
  │             │
  │ (receiver   │ (receiver finishes
  │  acks /     │  the handed-off work
  │  reads it)  │  and marks done)
  │
  └─► sender polls: if still "sent" past timeout → chase
```

| Status | Set by | Meaning |
|---|---|---|
| `sent` | sender | Handoff written, receiver not yet acknowledged |
| `received` | receiver | Receiver has picked up the message and started |
| `done` | receiver | Handed-off work is complete |

### Chasing sleeping agents

Agents tend to go idle. The sender (or a lightweight monitor in the extension) watches its outgoing messages:

- If a message stays `sent` past a configurable timeout, the sender **chases**: re-notifies the receiver (the orchestrator writes a nudge to the receiver's inbox / re-prompts it), increments `chase_count`, updates `last_chased_at`
- Escalation: after N chases with no `received`, surface a warning on the receiver's tile (red border + "not responding") so the human can intervene — e.g., respawn that agent
- The monitor can also flag messages stuck in `received` (picked up but never completed) past a longer timeout

### UI surfacing

- Each tile shows a small badge: inbound message counts by status (e.g., `2 sent · 1 received`)
- A messages view (panel tab) lists every message with status, age, and chase count — so the human sees the whole conversation and spots stalls at a glance
- Stuck messages (`sent` and overdue) are highlighted

### Implementation notes

- Reading/writing messages is exposed to agents as helper commands on their PATH (part of the forge's reusable tool layer, `extension/src/tools/`): e.g. `send-handoff`, `ack-handoff`, `complete-handoff`
- The chase monitor runs in the extension host, polling the message store on an interval — no dependency added to the target

### Reliability (making it rock-solid)

The naive "edit a YAML field in place" approach has the classic distributed-messaging failure modes: partial writes, lost updates, duplicate processing, out-of-order delivery, and chasing dead agents. The hardened design:

**Atomic writes.** Never edit a message file in place. Write to a temp file and `rename()` it into place — `rename` is atomic on POSIX, so a reader never sees a half-written message. This alone eliminates the corrupt-parse class of bugs.

**Append-only event log, not mutable status.** Model each message as an immutable sequence of events rather than a record whose `status` field gets overwritten:

```yaml
# .swarmforge/messages/0002.log  (append-only, one event per line)
{id: 0002, seq: 1, from: coder, to: reviewer, event: created, at: 2026-06-25T14:02:11Z, schema: 1}
{id: 0002, seq: 2, by: reviewer, event: received, at: 2026-06-25T14:03:40Z}
{id: 0002, seq: 3, by: reviewer, event: done, at: 2026-06-25T14:09:02Z}
```

Current status = the last event. History is free, "who changed what when" is auditable, and the same-field write race disappears because nobody mutates — they only append.

**Stable id + idempotent receivers.** Every message has a stable `id`. Receivers record the ids they've handled, so a re-delivered message (e.g. from a chase) is a no-op, not duplicate work.

**Work-in-progress lease (not just delivery idempotency).** Delivery idempotency stops a message being *picked up* twice, but not a message being *worked* twice — the dangerous case is: a receiver is mid-work (status `received`), the watchdog respawns it for being slow, and the fresh process auto-picks-up the same message and starts again, while the old in-flight work may be orphaned mid-merge. Fix: a `received` event carries a **lease** — the claiming process's identity (`claimed_by: <role>@<pid/epoch>`). On (re)spawn, auto-pickup only resumes a `received` message if the lease is *stale* (its owning process is gone per the watchdog) or absent; a live lease means "someone is already on this," so the new process leaves it alone. Combined with the heartbeat-gated chase below, this guarantees exactly one live worker per message: the watchdog kills the old process *before* respawn, which invalidates the lease, so the fresh process can safely reclaim — no overlap, no orphan.

**Monotonic sequence numbers.** A per-sender `seq` lets a receiver detect gaps and reject out-of-order application (a `done` can't be processed before its `received`).

**Outbox as durable retry queue.** The sender writes to its outbox and treats a message as *unconfirmed* until the receiver appends an explicit `received` ack event. On respawn, an agent replays its unacked outbox — combined with receiver-side auto-pickup, no handoff is lost across a crash.

**Explicit dead-letter state.** After `maxChases` with no ack, the message transitions to `dead-letter` (a terminal event) and escalates to the human (red tile) — rather than chasing forever or rotting silently.

**Automatic recovery before escalation (implemented: `handoffRecovery.ts`).** A dead-lettered or stalled parcel is not immediately handed to the human: it is first re-delivered to its current live holder, with bounded retries, and only escalates to the needs-human tile state once retries are exhausted. Recovery never re-delivers into a busy recipient's in-flight work (the BL-109 busy-recipient bug), and redelivery resets the parcel's stale mtime and chase-count sidecar so the daemon's own chase clock doesn't immediately dead-letter it again on the next sweep (the chase-then-recover race). **Recovery owner:** the same extension-host watchdog timer that already drives `chaserMonitor`'s sweep, not any single pipeline agent — an agent process can exit and tear the swarm down around it (see Heartbeat & Watchdog above and BL-107), so recovery is owned by the supervised extension-host timer rather than becoming a new single point of failure.

**Schema version on every message.** `schema: 1` on the `created` event means a mid-project format change won't break in-flight messages.

**Heartbeat-gated chasing.** The chase monitor consults watchdog heartbeat state before chasing: if the receiver is *dead* (not just slow), escalate to **respawn first**, then let auto-pickup replay the pending message — don't shout at a corpse. This wires the comms layer and the watchdog together so recovery is one coordinated path, not two competing ones.

**Garbage collection.** Completed (`done`) message logs older than a run are archived/compacted so the message store doesn't grow unbounded across long sessions.

---

## Heartbeat & Watchdog

The extension host runs a watchdog that tracks the liveness of every agent independently of message status. Message chasing tells you a *handoff* stalled; the heartbeat tells you an *agent* stalled — even one with no pending messages.

### Heartbeat

The heartbeat signals *productive activity*, not mere process liveness. It's emitted by decorating the agent's tool calls: every tool invocation is wrapped so it emits a heartbeat on entry and on exit.

- Each tool call (file read/write, test run, lint, handoff send/ack, commit, etc.) fires a heartbeat through the wrapper
- The heartbeat writes a timestamp — plus the tool name and phase — to `.swarmforge/heartbeats/<role>`:

  ```yaml
  role: coder
  last_beat: 2026-06-25T14:07:33Z
  last_tool: write_file
  phase: exit            # entry | exit
  in_flight: false       # true between a tool's entry and exit
  beat_count: 412
  ```

- Because the signal is bound to tool calls, an agent that is genuinely working keeps beating, while a wedged agent — looping internally but making no tool calls — goes silent and trips the watchdog. This closes the "alive but unproductive" gap that a timer-based heartbeat can't catch.
- A long-running single tool (e.g. a slow test suite) is covered by `in_flight: true` set on entry: the watchdog treats an in-flight tool as alive even past the stale timeout, with a separate (longer) `inFlightTimeout` to catch a truly hung tool.

**Where the decorator lives:** the heartbeat wrapper is part of the forge's reusable tool layer (`extension/src/tools/`), so every tool the swarm uses is automatically instrumented. Agents don't opt in — they get heartbeats for free by using the standard tooling. No instrumentation leaks into the target.

### Watchdog (extension host)

A single monitor loop in the extension host, polling on an interval:

| Check | Trigger | Action |
|---|---|---|
| **Heartbeat stale** | No heartbeat from a role past `staleTimeout` and no tool in flight | Mark tile amber ("idle"), attempt a nudge (orchestrator re-prompts / writes to the agent's inbox) |
| **Tool hung** | A tool in flight (`in_flight: true`) past `inFlightTimeout` | Mark amber → red; surface the stuck tool name on the tile |
| **Heartbeat dead** | Still stale past `deadTimeout` after nudges | Mark tile red ("not responding"); optionally auto-respawn if enabled |
| **Process gone** | Backend PID for a role no longer exists | Mark red; auto-respawn if `autoRespawn` is on |
| **Message stuck** | (from comms layer) message overdue in `sent`/`received` | Chase, then escalate to tile warning |

### Auto-respawn (optional, configurable)

- When `autoRespawn` is enabled, a dead agent is respawned automatically in its existing worktree
- On relaunch the agent auto-picks-up its pending messages (see above), so recovery is seamless
- A per-role respawn cap (e.g., 3 within a window) prevents crash-loops — once exceeded, the watchdog stops and leaves the tile red for human intervention

### UI surfacing

- Tile border encodes liveness: green (alive), amber (idle/stale), red (dead/not responding)
- A heartbeat indicator (last-seen age) shown per tile
- The status bar shows aggregate health: e.g. `4 agents · 3 alive · 1 idle`

### Configuration

Heartbeat and watchdog timeouts are configured in the main settings block (see Extension Settings) — `intervalSeconds`, `staleTimeoutSeconds`, `deadTimeoutSeconds`, `inFlightTimeoutSeconds`, `autoRespawn`, and `maxRespawnsPerRole`.

### Why the extension host owns it

Agents are unreliable pollers — that's the whole problem. A single watchdog in the extension host (not in the agents) is the dependable observer: it sees heartbeats, PIDs, and message status together, and it's the one component guaranteed to stay awake.

### Per-role idle context clearing

To prevent context window exhaustion during long swarm runs, individual roles can be configured to clear their session context at idle boundaries. This is useful for roles that don't need cross-parcel context (e.g., hardener, documenter) to reduce token accumulation:

- **Per-role opt-in flag:** configured via an optional token on the `window` line in `swarmforge.conf` (e.g., `window hardener claude hardender idle-clear`). Absent means OFF; default for every role is disabled.
- **Trigger:** clearing occurs only after a role completes its current task/batch AND its queue returns NO_TASK (i.e., at the idle boundary, never mid-task or mid-batch) AND the role's context window reaches a minimum fullness threshold. The window fullness is measured by the backend's telemetry if available (exact token usage), or a deterministic proxy metric (pane history line count) otherwise. This prevents unnecessary clearing of roles that go idle with mostly-empty windows — saving context resets for moments when they matter cost-wise.
- **Fullness threshold:** `swarmforge.contextClear.fullnessThresholdPercent` (default 75%). Set to 0 to skip the fullness check and clear as soon as drained-idle boundaries are reached. When the backend does not report real context usage, the fullness indicator shows "proxy" in the Context Clear output channel so you know the gate ran on line-count estimation rather than exact tokens.
- **Action:** the launcher sends `/clear` + Enter, causing the role's session to reset. The fresh session receives the full role re-bootstrap (constitution, pipeline, role prompt) exactly as if it had just been respawned.
- **State preservation:** only session context is cleared; durable inbox/outbox state, in-process audit trails, and handoffs are completely unaffected
- **Safety:** clearing never interrupts in-flight work, pending human input, or graceful bounces. Roles with the flag disabled (most roles, including specifier and coordinator) continue as before with accumulating context.
- **Cost tradeoff:** enabled roles lose in-session short-term coherence between parcels, trading that for reduced token cost. Roles that need cross-parcel recall should keep the flag disabled.

This is safe because the protocol is already context-free between parcels — every handoff body says "re-read your role and constitution," and durable state (backlog, handoffs, messages) lives on disk.

### Cooldown-aware wake scheduling (rate-limit backoff)

When an agent reports hitting a rate limit and provides a reset time (e.g., "tokens available again at 2pm"), the extension automatically avoids waking that agent during the cooldown window and resumes normal operation once the cooldown expires:

- **Detection:** the extension listens for rate-limit signals from agents (reported through the monitoring/logging interface) that include a reset timestamp
- **Suppression:** while a role has an active cooldown window, the watchdog's chase/wake nudges for that role are suppressed — no pointless retry attempts during the quiet period
- **Automatic resume:** once the cooldown timestamp passes, normal chase and wake behavior resumes automatically
- **Visibility:** the tile's liveness indicator and diagnostics surface which roles are cooling down and when they'll resume, so the human understands why a seemingly-idle agent is intentionally quiet
- **Resilience:** cooldown state persists across extension restarts — if the extension reloads before cooldown expires, wake suppression still applies until the deadline
- **Isolation:** cooldown affects only the role that hit the limit; other agents continue normal chase/wake behavior uninterrupted

This prevents the "retry storm" where a rate-limited agent gets nudged repeatedly while unable to act, saving tokens and clearing the notification noise during the windowed recovery period.

## Per-Agent Lifecycle Control

A core capability: managing individual agents without disrupting the swarm.

### Respawn a single agent

- Kills only that agent's backend process; its worktree and branch are left intact
- Relaunches the configured backend in the same worktree
- The rest of the swarm continues uninterrupted
- Useful when one agent is stuck, looping, or has drifted

**Auto-pickup on launch:** when an agent (re)spawns, it scans the message store for messages addressed to it still in `sent` or `received` and resumes them automatically — so a respawned receiver picks up its pending handoffs without waiting to be chased again.

Respawn replaces the *process* itself — the orchestrator kills the old backend PID and re-issues the launch for that role in the same worktree.

### Change an agent's backend/model on the fly

- Pick a different backend or model from the tile's `backend ▾` dropdown
- The extension rewrites that one window's launch command in the in-memory config and respawns the agent
- No other agent is affected; the swarm-wide pack/role topology is otherwise unchanged
- Lets you, e.g., drop a struggling agent onto a stronger model for one tricky slice, then switch back (see Agent Backends)

### Implementation notes

- The extension tracks each role → (backend process/PID, worktree, current backend) mapping
- Respawn = send kill to the running backend PID, then re-issue the launch command (the same command the orchestrator uses at startup for that role)
- Model change = same as respawn, but with the launch command's backend argument swapped
- Because role prompts and constitution are re-read at launch, mid-run prompt edits in the forge propagate on the next respawn

---

## Email Notifications for Needs-Human Events

When an agent needs human input (a question, permission prompt, or approval gate), the extension can email you with the agent's request, including a link back to the swarm session. This is useful when you step away from the editor — you get notified remotely and can jump back to answer.

### Configuration

Email notifications are **off by default**. To enable:

1. Set `swarmforge.notify.email.to` to your email address
2. Set `RESEND_API_KEY` environment variable (or VS Code secret `swarmforge.resendApiKey`) with a valid [Resend](https://resend.com) API key
   - Resend is a lightweight transactional email service; free tier covers typical usage
   - The onboarding sender (`onboarding@resend.dev`) delivers only to account owners — use a verified domain address for production

Optional tuning:

- `swarmforge.notify.email.from` — sender address (default: `onboarding@resend.dev`)
- `swarmforge.notify.email.graceSeconds` — how long (seconds) a needs-human state must persist before the first email (default: 60)
- `swarmforge.notify.email.cooldownSeconds` — minimum time between emails for the same role (default: 600)

### When notifications fire

An email is sent when:
- An agent's needs-human state first persists for `graceSeconds` without being answered
- OR the agent remains needs-human for another `cooldownSeconds` after the previous email

A genuinely **stuck/wedged agent** (no progress despite chasing — see Heartbeat & Watchdog) is alerted independently of whether the tiled agent panel is open: this notifier runs on its own extension-host interval, not the panel's poll loop, so closing the panel while the swarm keeps running does not silence stuck-agent alerts. A **question or permission prompt** (the agent is waiting on live pane content) still requires the panel to have been open to be captured, since the panel's pane tailer is the only reader of that content. In the rare case where a role is a captured question AND later escalates to stuck in the same window, you may receive two separate emails instead of one merged one — a redundant alert, never a missed one.

### What the email contains

- **The agent's role** — which role is asking
- **The question or permission snippet** — the exact text the agent is waiting on (if captured)
- **A session link** — a direct link back to the swarm panel in VS Code, pre-opened
- **The run name/item** — which work item triggered the notification

This lets you read the request on your phone and decide whether to jump back to your desk to respond, or continue what you're doing.

---

## Agent Backends (Any `InteractiveProcess`)

The extension is **backend-agnostic**. It doesn't integrate with specific AI providers — it integrates with the **`InteractiveProcess` contract** (`onData`, `onExit`, `write`, `kill`). The orchestrator spawns each role behind that interface and doesn't care what's underneath.

### The contract

A backend is anything that satisfies `InteractiveProcess`:
- reads a role prompt (and the constitution) as its instructions,
- exposes a streamed output channel (`onData`) and accepts input (`write`),
- edits files in its working directory (the role's worktree).

Two concrete kinds satisfy this today:
- **External CLI backend** — a command run as a child process: **Copilot CLI, Claude Code, Codex, aider, or a user's own wrapper script.** A `child_process.spawn` pipe-backed adapter streams its output and forwards input. Each role maps to a configurable command string; the extension never hard-codes a provider.
- **In-process language-model backend** (`LanguageModelRoleRuntime`) — a self-built agent loop over the VS Code Language Model API (`vscode.lm`), for environments where no agent CLI is available or installable. It selects a model, streams assistant text through the same `onData`, and exposes worktree-scoped tools (`read_file`, `write_file`, `list_dir`, `run_command`) with a per-turn tool-call cap. No external agent process is required; agents run on the developer's model entitlement, in-process.

### How it threads through the rest of the design

- **Model/backend dropdown** (per tile): picking an option swaps the role's backend — a different CLI command, or the in-process runtime on a different model. "Switch model" and "switch backend" are the same operation — re-issue on respawn.
- **Respawn:** re-launches the configured backend in the existing worktree.
- **Heartbeat decorator:** lives in the reusable tool layer the backend calls, so instrumentation is backend-independent (any backend using the standard tools emits heartbeats for free).
- **Secrets/auth:** shrinks for any backend that manages its own auth out-of-band. Copilot CLI, Claude Code, and the `vscode.lm` runtime authenticate themselves; the extension never sees or injects those credentials. Only backends that need raw API keys require the secrets handling noted in Gaps.

### Copilot as one backend

Copilot is attractive from two angles: its CLI exposes **multiple models (Claude, GPT, others)** behind one login, and the `vscode.lm` API exposes Copilot models in-process without any CLI at all (the bootstrap's primary path in constrained environments). Either way it's one entry in the backend list, not a special integration. The same caveat as any metered backend applies: a multi-agent swarm running for hours is a heavy usage pattern, so check the chosen backend's rate limits and terms for programmatic/agentic use (ties into the cost/rate-limit gap).

### Mixed backends

Because backend is per-role, a swarm can run **heterogeneously** — e.g. a strong model for the architect, a cheaper/faster one for the cleaner — tuned per role or changed on the fly. The pipeline doesn't care which backend produced a handoff; it only sees branches and messages.

### Cost-aware backend selection

The extension can help bring cost down by suggesting the right backend/model/effort *per role* — but honestly scoped. The extension drives backends through owned process streams, not a metered API gateway; it generally **can't see token-level spend** from outside. So this is a **heuristic advisor working from configured price priors and outcome signals**, not a real-time cost meter.

### Measuring agent load (the data under the advice)

Cost advice is only as good as the load data under it. The raw material already exists — heartbeats, message timestamps, reroutes, QA results — so "who's busiest" is an aggregation, not new instrumentation.

**One caveat shapes the metric:** in a sequential pipeline only one role holds the parcel at a time, so "busiest *right now*" is just "whoever has the parcel" — useless. The signal that matters is **cumulative**, per role, across the run and across runs: where does work actually pile up?

Per-role measures:
- **Active time** — summed from tool-call heartbeats (the decorator already emits these), so it counts *productive* work, not time spent merely holding the parcel
- **Time-in-stage** — `received` → `done` span from the message store; how long the parcel sits at each role
- **Rework load** — reroutes *into* a role, and QA bounces traceable to its stage. The most cost-relevant signal: a role that generates rework is where a stronger model earns its price
- **Tool-call volume & respawns** — secondary intensity signals

How it drives the cost decision:
- **Bottleneck role** (high active time + time-in-stage) → first candidate to *upgrade*: spend where it speeds the critical path
- **Rework role** (high reroute-in / QA bounces) → cheap model is a false economy here; upgrade
- **Idle-but-expensive role** (low activity on a top tier) → obvious *downgrade*

This load profile is shown in the run artifacts / Work Tree (a simple per-role bar of active time + a rework count), so the human sees the same picture the advisor uses.


- A configured **price/capability table** per backend+model (cost tier, relative strength) — user-maintained, since only the user knows their plan/rates
- **Role demands:** which roles need reasoning muscle (architect, specifier) vs. which are more mechanical (cleaner, documenter)
- **Outcome signals it already collects:** the per-role load profile above (active time, time-in-stage, rework load) plus chase counts and respawns. A cheap model that keeps getting rerouted or fails QA is a *false economy* — the bounces cost more than a stronger model would have. This is the key insight: cost-effectiveness is measured by **work that passes the gates**, not per-call price.
- **Maturity of the solution** (the angle you raised): early/greenfield work with sparse tests benefits from stronger models (mistakes are expensive and uncaught); a mature codebase with dense tests and tight specs can lean on cheaper models, because the gates catch errors cheaply. So the recommended tier can *shift down* as the project hardens.

**Effort dial:** beyond model choice, where a backend exposes a reasoning-effort / thinking-budget setting, the extension can suggest lower effort for mechanical roles and higher for design-heavy ones — another lever independent of which model.

**Tiers of autonomy (deliberately conservative):**

| Tier | Behavior |
|---|---|
| **Suggest (default)** | Recommends a backend/model/effort per role at run start, with a one-line rationale; user accepts or overrides. Never changes anything silently. |
| **Adapt (opt-in)** | Within a run, if a role's cheap model bounces (reroute/QA fail past a threshold), suggests escalating *that role* to a stronger model on next respawn — surfaced as a prompt, not automatic. |
| **Auto (later, opt-in)** | Applies the escalation/de-escalation itself within user-set bounds (e.g. "never exceed tier 3", "budget cap $X/run"), logging each change. |

**Guardrails:** ties into the cost/rate-limit gap — a per-run budget cap that pauses the swarm is the hard backstop, independent of any suggestion logic. And because price data is user-configured, the extension never *assumes* it knows current rates; it presents its recommendation as advisory and points the user to verify.

A pragmatic default that needs no tuning: **start each role at a sensible tier (strong for architect/specifier, mid for coder, cheap for cleaner/documenter), then let outcome signals nudge suggestions over time.** Most of the savings come from not running everything on the top model, which this captures immediately.

### Swarm profiles

A **pack** defines pipeline topology (which roles exist). A **swarm profile** is a named, reusable launch preset: pack + backend + per-role model and effort tier. Profiles live under `swarmforge/profiles/` as a pair:

- `<id>.yaml` — metadata (`id`, `name`, `pack`, `backend`, `tier`, description)
- `<id>.conf` — the `swarmforge.conf` window lines passed to `./swarm`
- `<id>.prompt` *(optional)* — profile overlay read at agent startup (intake/routing rules for this tier)

Example: `cheap-copilot-seven-pack` runs the full seven-pack on GitHub Copilot CLI with mini/flash models. Its overlay tells the coordinator to **route pre-specced `backlog/paused/` and `backlog/active/` items directly to coder** — not the specifier — because spec work is too costly on cheap models. Select a profile via `SWARMFORGE_CONFIG=swarmforge/profiles/<id>.conf` or the matching VS Code launch configuration. The cost advisor (above) can suggest upgrading or downgrading profiles from outcome signals (QA bounces, reroutes).

---

## Pack Suggestion Logic

Before the user launches a run, the extension analyzes the target to recommend a pack size. Pack choice sets the *maximum* roster; the Dynamic Workflow section governs which roles are active per item.

1. Count open backlog items / feature files in the target (if present)
2. Estimate codebase size and complexity (file count, language mix)
3. Apply heuristic (all packs preserve pipeline order; smaller packs omit middle stages):
   - Trivial / single-file fix → **2-pack** (coder, cleaner) — Uncle Bob's quick backend flow
   - Moderate, needs specs → **4-pack** (specifier, coder, cleaner, architect)
   - Major work, full quality gates → **7-pack** (specifier, coder, cleaner, architect, documenter, QA + coordinator) — this extension's default
4. Present recommendation with one-line rationale in the UI
5. User accepts or manually selects a different pack from the dropdown

The pack shapes echo SwarmForge's well-known configurations (two-/four-/six-pack); the 7-pack is this extension's own variant (six-pack minus hardener, plus documenter). All packs are defined by this repo's role prompts and pack config — they are not fetched runnable branches.

---

## Pipeline, Roles & Integration Model

The swarm is a **sequential pipeline**: a work item visits each role in a fixed order, getting more formal and more verified at each stage. Code convergence is built into this order, not bolted on as a separate merge step.

### The 7-pack (this extension's default)

Built on Uncle Bob's six-pack, with two deviations: **hardener is dropped**, and a **documenter** is added (placed just before QA, so docs are verified too). Canonical six-pack is specifier → coder → cleaner → architect → hardener → QA → completion; this extension uses:

| # | Role | Responsibility |
|---|---|---|
| 1 | **specifier** | Turns user intent into accepted Gherkin specs + end-to-end QA procedures. Writes specs and governance only — no integration merges. Sole writer of governance text (constitution, role prompts, project/engineering prompts) — see Governance. |
| 2 | **coder** | Implements approved behavior slices with TDD, unit tests, generated acceptance tests. |
| 3 | **cleaner** | Behavior-preserving cleanup, coverage improvement, CRAP & DRY review, mutation-site scans. |
| 4 | **architect** | Reviews module structure, boundaries, dependency direction, property-test coverage. |
| 5 | **documenter** | Updates docs for humans: high-level docs plus a doc for the piece just developed. |
| 6 | **QA** | Converts the specifier's QA procedures into executable scripts, runs final UI verification, checks handoff consistency. As the last stage, it's the convergence point: broadcasts merge-up to worktree roles and notifies the **coordinator** to integrate on `main`. |

(The coordinator is the 7th role — it owns orchestration on `main` and performs mechanical integration after QA: merge to `main`, close the ticket, promote the next item, push.)

### The pipeline flow

```
specifier ──► coder ──► cleaner ──► architect ──► documenter ──► QA ──► coordinator (integrate)
```

Stage by stage:

1. **Specifier** writes the Gherkin and hands the parcel to the coder.
2. **Coder** merges the dev branch ("main" of the swarm) into its own branch, does TDD-style development, then hands to the cleaner when done.
3. **Cleaner** cleans up, then hands to the architect.
4. **Architect** reviews structure, then hands to the documenter.
5. **Documenter** updates the human-facing docs (high-level + the just-developed piece), then hands to QA.
6. **QA**, when done, **forces every pipeline worktree role to merge its own branch up to QA's verified commit** — this is the integration convergence point (see below) — then notifies the **coordinator** with the approved commit so the coordinator can merge to `main`, close the ticket, and promote the next backlog item.

Putting the documenter **before** QA means the docs are covered by QA's final verification pass, rather than landing after the swarm has already converged.

The workflow **must visit everyone** — the pipeline is the quality gate sequence, and skipping a stage means a gate didn't run.

### Branches & integration

- Each agent works in its own worktree, and **each worktree is its own branch**
- **`main`** (master worktree) is the integration branch — the coordinator merges QA-approved work here; the specifier works on master for spec/prompt files only, not feature integration
- The **coder pulls integrated state into its branch** at the start of its stage (via `merge_and_process` on handoffs), so it builds on the latest parcel state
- **QA is the convergence point:** as the final pipeline stage, when QA passes it broadcasts merge-up to every worktree role (`coder`, `cleaner`, `architect`, `hardender`, `documenter`) instructing each to merge QA's verified commit into its own branch — bringing the swarm to a single consistent, verified state before integration on `main`. The **coordinator** then merges that commit to `main`, moves the ticket to `done/`, promotes the next item, and pushes — keeping the costly specifier on specification work only
- Because work moves through one branch at a time in pipeline order (rather than many agents editing concurrently), file-level collisions are rare by construction — the sequence *is* the conflict-avoidance strategy

### Conflict resolution: the receiver owns it

- When an agent is told to merge another's branch in, **the receiver of the merge resolves any conflict** — the agent merging into its own worktree owns the resolution, since it has the most context on its own work
- If a receiver genuinely can't resolve, it escalates via the comms layer (a `to: human` message, or to the coordinator)

### Reroute: "smell something, send it back"

Any agent can **reroute the parcel** to a relevant agent if it spots a problem out of sequence — e.g. the architect smells a spec gap and sends it back to the specifier.

- Reroute is **point-to-point**: sender → the chosen agent, a targeted detour
- After the detour resolves, the pipeline **resumes its normal order** from where it was — the reroute doesn't restart or reorder the pipeline, it's an interruption that returns control to the regular sequence
- The guarantee that **everyone still gets visited** holds: a reroute is an extra visit, never a skip. The coordinator tracks visited stages so the normal order can resume correctly and no gate is bypassed
- Reroutes are inter-agent messages (`event: reroute`, with reason), so they ride the comms layer and show up in the Work Tree / message view

### Governance: emergent rules & the specifier's write authority

As the swarm works, rules emerge — a convention worth enforcing, a recurring mistake worth forbidding, a sharper instruction for a role. The model: **propose by many, commit by one.**

- **Any agent can propose a rule.** When an agent discovers something that should become a standing rule, it reports it to the **specifier** as a tracked message (`event: rule-proposal`, with the proposed change and rationale).
- **The specifier is the sole writer** of governance text: the constitution, any role prompt, and the project/engineering prompts. No other agent edits these — single-writer discipline applied to governance so prompts can't drift under concurrent edits.
- **The specifier triages** each proposal: accept (commit the edit), refine (reword first), or reject (with reason back to the proposer). Acceptance is an explicit, attributable commit.

**Where a committed rule lands depends on what it touches — and respects the forge/target boundary:**

| Rule scope | Written to | Effect |
|---|---|---|
| Generic role behavior / constitution article | **Forge** (role prompts, constitution) | The forge *learns across projects* — a rule earned on one target improves every future swarm |
| Project- or stack-specific rule | **Target** (`project.prompt` / `engineering.prompt`) | Travels with that app only; doesn't pollute the generic forge |

The specifier decides which bucket a rule belongs in — a genuinely generic lesson is promoted to the forge; a project quirk stays in the target. Emergent generic rules thus become the mechanism by which the forge improves over time, while target-specific rules stay local.

**Propagation:** a committed prompt/constitution change takes effect on each agent's next respawn (prompts and constitution are re-read at launch — see Per-Agent Lifecycle Control). After the specifier accepts a rule, affected agents pick it up when they next (re)spawn — no full-swarm restart needed.

**Auditability:** because proposals are messages and acceptances are commits, every rule has a trail — who proposed it, why, the specifier's decision, and the resulting diff — visible in the message view and in git history. Ties into the prompt-versioning gap: a PR can be traced to the exact governance text in force when it was produced.

### How it ties to inter-agent comms

Every handoff, the QA convergence broadcast, reroutes, and rule-proposals are all inter-agent messages with `received` / `done` acks. So the pipeline rides the same rock-solid messaging layer — chase nudges a stage that's gone quiet, and the sender sees `done` acks to confirm the parcel advanced.

### How it ties to dynamic workflow

Under right-sizing, a simple item may not need every stage — but **the pipeline order is preserved**; dormant roles are simply skipped *in order* (e.g. specifier → coder → documenter → QA for a small fix). The "must visit everyone" rule applies to the *active* pack for that item. QA and the documenter are the two stages most likely to always stay active, since they own verification and human-facing docs — and QA, as the final convergence stage, is where any subset still merges to a single verified state.

---

## Correctness & Failure Handling

The pipeline assumes forward progress. These are the cases where it doesn't, and how the swarm stays safe and honest rather than confidently shipping bad work.

### Reroute budget & cycle detection (no livelock)

Reroutes can loop: architect → specifier → coder → architect → … forever, burning money with no human aware. Bounds:

- **Per-item reroute budget.** Each work item has a max total reroutes (configurable). Each reroute decrements it.
- **Cycle detection.** The coordinator tracks the reroute graph for the item; a repeating cycle (A→B→A→B) is detected even before the budget is exhausted.
- **Escalation, not silent spin.** Hitting the budget or a detected cycle **pauses the item and raises a `to: human` gate** ("this item keeps bouncing between architect and specifier — here's the history; advise or take over"). The swarm never burns budget indefinitely on a ping-pong.
- Reroute counts and the bounce history are visible per item in the Work Tree, so a struggling item is obvious before it hits the cap.

### Item completion & the next-item loop

The pipeline defines "done with the *pipeline*" (QA converges worktree branches, coordinator integrates on `main`) but not "done with the *work item*" or what the swarm does next. Defined here:

- **Item-complete criteria:** QA convergence succeeded **and** the item's scenarios pass on the dev branch (completion = 100% measured post-convergence, per Work Tree). Only then is the item considered delivered.
- **What happens at item-complete (configurable run mode):**
  - **One-shot:** the run targets a single item → open the PR (per Swarm Lifecycle), stop.
  - **Drain-the-backlog:** the swarm pulls the next eligible backlog item (respecting priority and dependencies) and starts a fresh pipeline pass. Each item still produces its own dev branch + PR (or accumulates onto a shared dev branch — a run-mode choice).
- **Eligibility & dependencies:** an item is eligible only if its declared dependencies are already `done` (ties into the backlog dependency gap). The coordinator picks the highest-priority eligible item.
- **When the pipeline pass is *not* enough:** if QA fails to converge or scenarios don't reach 100% within the reroute budget, the item does **not** auto-complete — it escalates to a `to: human` gate rather than opening a PR for broken work.
- **Who decides "really done":** the human, at the PR. The swarm's "complete" means "passed its own gates"; the merge decision stays human (per Core Principles).

### Spot-checkability (the cost of being wrong)

A swarm that produces a *passing-tests-but-wrong* PR is worse than none — it launders bad work through green checkmarks, and the reviewer faces a large diff with social pressure to approve. The design fights this:

- **Small, traceable increments.** Because every commit references a scenario id (`[@scn-…]`) and the PR is organized by scenario, the human reviews *per scenario* — "here's the spec, here's the test, here's the diff that satisfies it" — not one undifferentiated blob.
- **A "review hotspots" signal.** The PR summary flags where to look hardest, derived from data already collected: scenarios that needed the most reroutes, stages with the most rework, files touched by multiple roles, and any scenario where tests were edited *after* they first passed (a tell for test-fitting). High-friction areas are where wrong-but-green is most likely.
- **Spec-to-test honesty check.** The documenter/QA stages surface scenarios whose tests are suspiciously thin relative to the spec (e.g. a rich Gherkin scenario with a near-empty assertion), so "green" can't hide a hollow test.
- **No auto-merge.** Reinforced: green checks gate *readiness for review*, never merge. The human is the correctness authority and is pointed at the riskiest parts rather than left to police everything equally.

### Failure & salvage ("the swarm made it worse")

Not every run should end in merge-or-discard. Partial salvage:

- **The dev branch is disposable, the work is not.** Because each role's contribution is on its own branch and convergence history is on the dev branch, rejecting the PR doesn't have to throw everything away.
- **Redo-from-stage.** The human (or the coordinator on escalation) can send the item back to a specific stage with a note — "architecture is wrong, redo from architect: don't use a global cache" — rather than restarting the whole pipeline. This is a human-initiated reroute, reusing the reroute machinery.
- **Checkpoint per stage.** Each stage handoff is a commit on that role's branch, so the swarm can reset an item to the last good stage boundary instead of losing the run.
- **Abandon cleanly.** If an item is a genuine write-off, its dev branch and worktrees for that item are dropped without affecting the target (nothing was ever committed to the target's real branch) or other items.
- **Learn from the failure.** A rejected PR's reason can be captured as a `rule-proposal` to the specifier (see Governance), so a class of mistake becomes a standing rule rather than recurring.

---

## Dynamic Workflow (Right-Sizing per Work Item)

A full 7-pack swarm shouldn't run all seven agents on a trivial backlog item. Rather than spawn and kill windows per item (expensive, and it disrupts the persistent tiles), roles go **dormant**: the full swarm launches once, but each work item activates only the roles it needs — always preserving pipeline order.

### How it works

- The swarm launches at its configured size (say, 6 roles) — all tiles present, all heartbeats running
- Each backlog item declares (or the coordinator infers) a **required role set** — its "active pack"
- Roles outside that set go **dormant** for the duration of that item: idle, not assigned work, tile dimmed
- When the next item needs them, they wake — no respawn, no window churn

So a 7-pack physically running can behave as a 2-pack for a simple item (e.g. just `coder` + `cleaner`), then expand for the next — but the active roles always run in pipeline order.

### Declaring the active pack

A backlog item can specify its workflow inline, or let the coordinator decide:

```yaml
# in the backlog item
id: BL-051
title: "Fix typo in footer"
workflow: [coder, reviewer]          # explicit minimal pack
```
```yaml
id: BL-052
title: "Add OAuth login"
workflow: auto                        # coordinator infers from complexity
```

**Auto inference heuristic** (coordinator) — selected roles always run in pipeline order:
- Trivial / single-file / no new behavior → `coder, cleaner, documenter`
- New behavior with acceptance criteria → `specifier, coder, cleaner, documenter, QA`
- Architectural change / cross-cutting → full 7-pack (add `architect`)

### Tile states under dynamic workflow

| State | Meaning | Tile appearance |
|---|---|---|
| **active** | role is in the current item's pack and working | full color, live |
| **dormant** | role exists but not needed for this item | dimmed, "dormant — not assigned" |
| **waking** | role just entered the active set | brief highlight as it picks up |

Dormant agents still emit heartbeats (they're alive, just idle), so the watchdog doesn't false-alarm — dormancy is a known, expected idle state distinct from "asleep."

### Why dormant beats spawn/kill

- Tiles stay stable — the human's layout and attention aren't disrupted item to item
- No cold-start cost when a role is needed again
- Worktrees persist, so a role that contributed earlier still has its branch context
- The coordinator can change the active pack mid-item if the work turns out bigger than expected (escalate by waking a role) or smaller (let one go dormant)

### Dormant branches must not go stale

There's a trap where dormancy and branch-per-worktree collide: a dormant role's branch sits frozen while the pipeline advances through other items. If it wakes three items later and is handed the convergence merge, it's diverged by everything that happened while it slept — the *worst* conflict case handed to the agent with the *least* context.

The fix is to keep a dormant branch current rather than frozen:

- **Rebase-on-wake.** When a role wakes, before it does any work its branch is fast-forwarded/rebased onto the current dev branch. It starts from today's integrated state, not the stale point where it went dormant — small mechanical merges instead of one giant divergent one.
- **Dev is the baseline, not peer branches.** A waking role syncs to `main` (the coordinator's integration branch, the single source of integrated truth), never to some other peer's in-flight branch — so there's one well-defined thing to catch up to.
- **Background catch-up (optional).** The extension can fast-forward dormant branches onto dev whenever dev advances, so "wake" is always cheap and a dormant branch is never more than one item behind. This is a pure fast-forward when the dormant branch has no unmerged commits of its own (the common case), so it's safe to automate.
- **Convergence only includes active roles.** The QA convergence step forces a merge across the *active* pack for the item, not dormant roles — a dormant role has no item-specific work to contribute, so it isn't part of that item's merge. It only needs to be current *before* it next becomes active, which rebase-on-wake guarantees.

Net effect: a role never wakes into a heavily-diverged tree, so "receiver resolves conflicts" stays a small, well-scoped job rather than the catastrophic case.

---

## Swarm Lifecycle

```
Extension clones target repo (or uses existing local clone)
        │
        ▼
Extension reads project.prompt + engineering.prompt from target clone
        │
        ▼
Extension suggests pack size → user confirms
        │
        ▼
Extension scaffolds swarm config inside the clone:
  - Copies forge's role prompts into .swarmforge/roles/
  - Copies forge's constitution articles
  - Writes the pack/role config from selected pack
  - Injects project.prompt + engineering.prompt as context
  - Creates the swarm dev branch (named after the work item: dev/<item-slug>)
  - Creates git worktrees under .worktrees/ (one per role; each worktree is its own branch)
  - Specifier's worktree tracks the dev branch (the integration point)
        │
        ▼
Developer can type into any agent tile at any time — each tile is a live terminal bound to that role's process stream
        │
        ▼
Orchestrator spawns one agent process per role (InteractiveProcess in each worktree)
        │
        ▼
Extension streams each process's output → tiled panel updates
        │
        ▼
Agents work in pipeline order on their own branches:
  specifier → coder → cleaner → architect → documenter → QA
  Coder merges received commits first; documenter updates docs before verification;
  QA convergence forces worktree branches to merge QA's; coordinator integrates on main
  → integrated state on main
        │
        ▼
Swarm completes work → coordinator signals done
        │
        ▼
Extension opens a PR FROM the swarm dev branch (dev/<item-slug>)
  INTO the target's main branch
  PR body: auto-generated summary from coordinator output
        │
        ▼
Human reviews and merges (or rejects)
```

---

## Graceful Bounce and Restart

When you need to restart the extension (e.g., to reload code changes, respawn agents, or fix a frozen UI), the extension performs a **graceful bounce** — it drains current work items first, so no in-flight work is lost.

### What happens during a graceful bounce

1. **Drain phase** — The extension signals all active agents to finish their current work item (reach a checkpoint) before shutting down
2. **Bounce phase** — Once all agents have completed their work items (or timeout after a configurable grace period), the extension restarts
3. **Resume phase** — On restart, agents automatically pick up any pending work from the message store and resume where they left off

### How to trigger a bounce

You can restart the extension in several ways:

- **Close the extension panel** — gracefully shuts down (drain-first)
- **Run `SwarmForge: Stop Swarm`** — signals a clean stop with drain
- **Close VS Code** — triggers graceful shutdown of all running work
- **Extension host crash** — extension recovers from on-disk state and resumes

Because work state lives on disk (.swarmforge/) rather than only in memory, restarting is safe: agents will pick up their pending work items and continue without losing progress. No manual recovery needed.

### Timeouts and hard kill

If the graceful drain phase takes longer than expected (e.g., an agent is hung), the extension will eventually force-stop it after a timeout. This is safe because of the per-stage checkpoints — no committed work is lost, and agents resume from their last successful handoff on restart.

---

## Traceability & Completion ("Work Tree")

A panel view that lets you follow one piece of work from the top-level requirement all the way down to the swarm's commits — and shows a rolled-up % completion at every level. Think of it as a Jira board collapsed into a single traceable tree.

### The hierarchy

Completion rolls **up** from the leaves. Each level's % is derived from its children, never set by hand:

```
Backlog item            (epic-level requirement)
  └─ Feature            (a .feature file in the target)
       └─ Scenario      (a Gherkin scenario / "Given-When-Then")
            └─ Work unit (the swarm's slice: branch + commits + tests)
```

A scenario is the natural unit of "done" — it's testable. So leaf completion is anchored to scenarios passing, and everything above is a rollup.

### How completion is computed

| Level | % complete = |
|---|---|
| **Scenario** | binary-ish: 0% (not started) → partial (code exists, tests failing) → 100% (its tests pass *on the dev branch*) |
| **Feature** | scenarios passing ÷ total scenarios in the feature |
| **Backlog item** | weighted rollup of its features (by scenario count, so a big feature counts more) |

Scenario state is read from concrete signals, not self-report:
- Does a branch/commit exist touching the scenario? → started
- Do the scenario's tests exist? → in progress
- Do they pass **on the dev branch** in the latest run? → done

**Where the tests are measured matters — and it's the dev branch, not an agent's branch.** A scenario can be green in QA's worktree but break once everyone converges; if completion were read from a single agent's branch it would be optimistic at exactly the wrong moment. So the authoritative % is computed against the **integrated dev branch after the QA convergence step**. Consequences, surfaced honestly in the UI:

- Before convergence, a scenario's green state on a working branch is shown as **provisional** (e.g. a hollow / hatched circle), not a solid 100%. It means "passing in progress," not "done and integrated."
- A scenario flips to solid 100% only when its tests pass on the dev branch post-convergence — the same point the PR is cut from, so the number the human sees matches what they'll review.
- This means completion is partly speculative mid-pipeline and only fully settles at convergence. That's the truthful picture: "done" = "integrated and green," not "one agent thinks it works."

### Linking the levels (traceability)

The links must survive even though the artifacts live in different places (backlog/features/docs in the target, work in the PR branch). Use lightweight tags:

- **Feature files** already map to backlog items via a header tag: `# Backlog: BL-042` at the top of the `.feature` file
- **Scenarios** carry a stable id via a Gherkin tag: `@scn-BL042-03`
- **Commits / PR** reference the scenario id in the message: `feat(login): valid creds [@scn-BL042-03]`

The extension builds the tree by parsing target `.feature` files (backlog + scenario tags) and matching commit/test references — so any node can be traced down to its commits and up to its backlog item.

### Tree view + color convention

A VS Code TreeView in the side panel. Each node shows a completion bar/dot using a red→amber→green ramp:

```
▾ ⬤ BL-042  User Login                         62%   🟠
  ▾ ⬤ feature: login.feature                   80%   🟢
    ├─ ⬤ @scn-BL042-01  valid credentials      100%  🟢
    ├─ ⬤ @scn-BL042-02  invalid password       100%  🟢
    └─ ⬤ @scn-BL042-03  account locked          40%  🟠
  ▾ ⬤ feature: session.feature                 30%   🔴
    ├─ ⬤ @scn-BL042-04  token refresh           60%  🟠
    └─ ⬤ @scn-BL042-05  logout clears session    0%  🔴
```

**Color ramp** (continuous, not just 3 buckets):
- 0% → red `#E5484D`
- ~50% → amber `#F5A524`
- 100% → green `#30A46C`
- interpolated in between, so 62% is a yellow-orange — the eye reads progress as a gradient, not a step

#### Coloured circle (recommended rendering)

A coloured circle to the left of each node, colour = ramp(%). This is the simplest, most readable option in a TreeView and not more complex to build — with one nuance worth knowing:

- VS Code's built-in `ThemeIcon` colours come from a **fixed theme palette**, so you can't get an arbitrary "62% orange" from a built-in icon. Two ways to handle it:
  - **Bucketed (cheapest):** snap to a small set of theme colours — red / orange / amber / yellow-green / green — and use `new ThemeIcon('circle-filled', new ThemeColor(...))`. Zero asset generation; ~5 buckets read fine at a glance.
  - **Continuous (slightly more work):** generate a tiny SVG circle per node filled with the exact ramp colour, set as the TreeItem `iconPath`. Caches trivially by rounding to whole-percent (101 possible icons). This gives the true gradient.
- Recommendation: ship **bucketed** for v1 (it's genuinely enough), with the continuous SVG path as a drop-in upgrade — the rest of the tree doesn't change.
- The numeric `%` still shows as right-aligned text (TreeItem `description`), so even colour-blind users get the exact value. The circle is reinforcement, not the only signal.

A filled-ring variant (circle whose arc fills clockwise to the %) is possible via the SVG path too, if you want fill *and* colour to both encode progress — but it's a nice-to-have, not v1.

### Interactions

- **Click a node** → reveals its source: scenario opens the `.feature` file at that line; work unit opens the commit/PR; backlog item opens the backlog entry
- **Hover** → tooltip with the breakdown (e.g., "3/5 scenarios passing · last run 4m ago")
- **Click a work-unit leaf** → jumps to the responsible agent's tile (ties the board to the live swarm)
- **Filter** → show only incomplete (<100%) nodes, to see what's left
- Live updates: as the swarm's tests pass, nodes recolor in real time off the same test-run signal the watchdog already collects

### Why anchor to scenarios

Tying completion to Gherkin scenarios passing means % completion is *earned by green tests*, not claimed by an agent. It can't drift optimistic — a scenario is 100% only when its tests actually pass. This dovetails with the QA stage, which turns the specifier's procedures into executable scripts: the board is effectively a live view of the acceptance suite.

---

## Backlog Sync (Two-Way)

The backlog flows both directions: the human edits items (adds work, reprioritizes, refines acceptance criteria) and the swarm updates them (marks progress, links commits, flags blockers). To keep that safe with two writers, follow a single-source-of-truth-with-merge model.

### Source of truth

- The backlog lives as files **in the target repo** (e.g. `backlog/BL-042.yaml` or a single `backlog.yaml`) — it travels with the app, versioned in git like everything else
- It is *the* source of truth; the extension never keeps a separate authoritative copy. The extension reads it into the Work Tree and writes changes back to the same files

### What each side owns (field-level ownership)

To avoid clobbering, human and swarm own different fields of the same item:

| Field | Owner | Notes |
|---|---|---|
| `title`, `description`, `priority`, `acceptance` | **Human** | The swarm reads but never overwrites these |
| `workflow_pin` | **Human** | Optional. If set (e.g. `[coder, cleaner]` or `full`), it's an authoritative override the coordinator must honor. Empty = defer to the coordinator. |
| `workflow_resolved` | **Swarm** (coordinator) | The active pack the coordinator actually chose for this item. Written by the swarm, read by the human. |
| `status` (`todo / in-progress / review / done`) | **Swarm** | Driven by actual work + test state |
| `linked_commits`, `linked_pr`, `completion_pct` | **Swarm** | Derived, never hand-edited |
| `blockers`, `notes_from_swarm` | **Swarm** | How the swarm reports back up |

Because ownership is partitioned by field, a human editing `priority` and the swarm editing `status` on the same item don't collide. The earlier "workflow owned by human *or* coordinator" was itself a shared-write hazard — it's split into two single-owner fields: the human's optional `workflow_pin` (an input/override) and the swarm's `workflow_resolved` (the chosen output). One writer each; the coordinator reads the pin and records its resolution separately.

### Sync mechanics

- **Read:** extension loads backlog files on run start and watches them for human edits during a run (file watcher) — so re-prioritizing mid-run is picked up
- **Write:** the swarm writes its owned fields back through a helper (`update-backlog <id> --status ... --pct ...`), which does a field-scoped merge rather than a whole-file overwrite
- **Conflict policy:** field-level ownership makes most conflicts impossible; for the rare same-field race, last-write-wins with the change recorded in the item's history, and human-owned fields always win over swarm writes to the same field
- **Commit:** backlog changes are committed on the swarm's PR branch alongside the code, so backlog state and the work that changed it land together and are reviewable in the same PR

### Reflected in the Work Tree

The Work Tree reads `status` and `completion_pct` straight from the synced backlog, so the tree, the board colours, and the backlog file never disagree — they're the same data.

---

## Artifacts: Where Things Live

| Artifact | Lives in |
|---|---|
| Backlog items | Target repo (source of truth; synced both ways — see Backlog Sync) |
| Feature files (Gherkin / specs) | Target repo |
| Documentation | Target repo |
| `project.prompt` | Target repo |
| `engineering.prompt` | Target repo |
| Generic role prompts | Forge repo |
| Constitution articles | Forge repo |
| Extension source | Forge repo |
| Reusable tools built by swarm | Forge repo (`extension/src/tools/`) |
| Pack/role config (generated) | Clone — not committed to target main |
| Worktrees | `.worktrees/` inside clone — not committed to target main |
| PR branch + commits | Target repo (via PR) |

---

## Reusable Tools (Forge Codebase)

As the swarm builds up tools during runs, the reusable ones are promoted into the forge's `extension/src/tools/` directory. These are general-purpose, never target-specific:

- **File tools** — read, write, search, diff files across worktrees
- **Test runner tools** — invoke test suites and parse results back to agents
- **Lint tools** — run static analysis, surface errors in agent context
- **Handoff helpers** — messaging between agent roles (wrapping SwarmForge's built-in scripts)

Domain-specific code generated for a target stays in the target's PR branch and is never promoted to the forge.

---

## Commands (Command Palette)

| Command | Action |
|---|---|
| `SwarmForge: Open Panel` | Opens the tiled agent UI |
| `SwarmForge: Set Target Project` | Prompts for path or GitHub URL |
| `SwarmForge: Run Swarm` | Triggers a run with current settings |
| `SwarmForge: Stop Swarm` | Stops all agents |
| `SwarmForge: View Last PR` | Opens the most recently created PR in browser |
| `SwarmForge: Open Work Tree` | Opens the traceability tree with rolled-up completion |
| `SwarmForge: Reset Tile Layout` | Returns all tiles to equal weight |
| `SwarmForge: Respawn Agent` | Pick a role and respawn just that agent |
| `SwarmForge: Change Agent Model` | Pick a role and a new backend; respawns that agent on it |
| `SwarmForge: Answer Gate` | Respond to a pending `to: human` gate (also actionable from a notification / mobile) |
| `SwarmForge: Redo Item From Stage` | Send the current item back to a chosen stage with a note (human-initiated reroute) |
| `SwarmForge: Initialize Target` | Scaffolds `project.prompt` + `engineering.prompt` in the target repo and commits them, so they travel with the repo when the swarm clones it |
| `SwarmForge: Set Resend API Key` | Store your Resend API key in VS Code's encrypted SecretStorage (for email notifications). Uses masked input and never echoes the key. |
| `SwarmForge: Clear Resend API Key` | Remove the stored Resend API key from VS Code's encrypted storage. |

---

## Extension Settings (`settings.json`)

```json
{
  "swarmforge.targetPath": "/path/to/target-project",
  "swarmforge.defaultPack": "auto",         // "auto" | "two-pack" | "four-pack" | "seven-pack"
  "swarmforge.gitRemote": "origin",
  "swarmforge.prBaseBranch": "main",
  "swarmforge.autoOpenPR": true,

  "swarmforge.heartbeat.intervalSeconds": 15,
  "swarmforge.heartbeat.staleTimeoutSeconds": 60,
  "swarmforge.heartbeat.deadTimeoutSeconds": 180,
  "swarmforge.heartbeat.inFlightTimeoutSeconds": 600,
  "swarmforge.watchdog.autoRespawn": false,
  "swarmforge.watchdog.maxRespawnsPerRole": 3,

  "swarmforge.comms.chaseTimeoutSeconds": 90,
  "swarmforge.comms.maxChases": 3,

  "swarmforge.pipeline.maxReroutesPerItem": 6,
  "swarmforge.run.mode": "one-shot",          // "one-shot" | "drain-backlog"
  "swarmforge.cost.perRunBudget": null,        // e.g. 25.00 to pause the swarm at $25/run; null = no cap
  "swarmforge.cost.escalateOnReroute": "suggest",  // "off" | "suggest" | "adapt" | "auto"

  "swarmforge.notify.email.to": "",            // recipient email (leave empty to disable; also requires RESEND_API_KEY)
  "swarmforge.notify.email.from": "onboarding@resend.dev",  // sender address (use verified domain for production)
  "swarmforge.notify.email.graceSeconds": 60,  // how long needs-human must persist before email sent
  "swarmforge.notify.email.cooldownSeconds": 600  // min time between notifications per role
}
```

---

## `project.prompt` and `engineering.prompt` — Contracts

These are the only files the swarm reads from the target. Their format is intentionally simple (plain text), so the target has no schema dependency on the forge.

### `project.prompt` (target repo)
```
# Project
<what this project does and why>

# Goals for this swarm run
<what you want built or fixed — updated before each run>

# Constraints
<anything the swarm must not touch or break>
```

### `engineering.prompt` (target repo)
```
# Tech Stack
<languages, frameworks, runtimes>

# Conventions
<naming, folder structure, testing approach>

# Architecture rules
<patterns to follow, anti-patterns to avoid>
```

The `Initialize Target` command scaffolds these with sensible defaults so the developer only fills in the blanks.

---

## Named Runs

Every swarm run is named after the backlog item it delivers. This makes the full history of swarm work traceable and meaningful.

- The developer names the run when triggering it (or the extension pulls the item name from a backlog file if one exists in the target)
- The run name becomes the swarm dev branch and PR source: `dev/<item-slug>`
- The PR title and body reference the item name
- The extension maintains a local run history log (stored in the forge, not the target):

```
runs.log (forge-local)
─────────────────────────────────────────────────────
2026-06-20  feat-user-login        7-pack  PR#42  merged
2026-06-21  fix-payment-timeout    2-pack  PR#43  open
2026-06-25  feat-export-csv        7-pack  PR#44  open
```

The `View Last PR` command uses this log to know which PR to open. A future `SwarmForge: Run History` panel can surface the full log.

---

## Remote Access & Phone App (Optional Bridge)

The swarm cannot run on a phone — it's the orchestrator's agent processes, git worktrees, multiple model backends, and a filesystem clone, none of which exist on mobile. So the phone is a **remote control and observability client**, and the heavy lifting stays on the dev machine. This is the thin-client, fat-host pattern.

### Avoiding complexity: the filesystem is already the decoupling

Before reaching for a daemon, note how much the on-disk state already decouples for free. The swarm's *state* lives on disk: the message store (`.swarmforge/messages/`), heartbeats, worktrees/branches, and the run log. The VS Code extension is, for the most part, *reading those files and streaming each agent process's output*. So any client — the extension, a bridge, a phone — can reconstruct the full picture from disk without talking to any other client.

**Persistence across restarts: implemented via detached processes and re-discovery.** Agent processes run under the SwarmForge tmux server, detached from the VS Code extension host. When you close or reload the editor:
- The swarm and its agents keep running in tmux, unaffected by the extension's lifecycle
- On relaunch with a live swarm: the extension re-discovers it via `isSwarmReady()` and tiles automatically reconnect to the agents' output streams — no agent restarts, no in-flight work lost
- On cold relaunch (no live tmux session but prior `.swarmforge/` state on disk): the extension offers "Resume?" — resume from the last per-stage checkpoint rather than starting over

This is **no different from the tmux design** — the swarm lives independently of any UI frontend. The extension is purely an observer and control surface reading the same on-disk state. What's always free is observational decoupling: any client reads the same `.swarmforge/` files without coordination overhead.

The discipline that keeps complexity flat: **the filesystem stays the single source of truth.** No component (extension, bridge, or phone) holds authoritative state; they all read `.swarmforge/` and issue commands through the same orchestrator/helper calls the agents already use.

### Two tiers, one architecture

| Tier | When | What it is | Added complexity |
|---|---|---|---|
| **1 — desktop only (v1)** | Default | Extension reads `.swarmforge/` files + streams tmux panes headlessly (`SWARMFORGE_TERMINAL=none`). Handoff phase 1 uses direct tmux injection (`SWARMFORGE_SKIP_DAEMON=1`); phase 2 adds `handoffd`. | ~none — filesystem is source of truth |
| **2 — remote (later)** | Opt-in, for phone | A thin bridge that *projects* the same on-disk state over an authenticated tunnel, plus a few control endpoints | a process + a wire protocol + auth — but no new state model |

The phone case is the *only* thing that actually needs a network service, because a phone can't read your laptop's filesystem or reach the host's orchestrator remotely — something must expose that. The bridge does exactly that and nothing more: it reads the same files the extension reads and forwards commands as the same orchestrator/helper calls. Tier 1 and Tier 2 are therefore the *same* architecture with an optional projection bolted on — not two designs, and crucially **no state-sync problem**, since there's only ever one source of truth on disk.

### The remote bridge (Tier 2)

```
        ┌─────────────────────────────────────────┐
        │   agent processes + .swarmforge/  (on disk)   │  ← single source of truth
        └───────┬─────────────────────────┬────────┘
                │ reads files / streams    │ reads files
                │                          │
        ┌───────▼──────────┐      ┌────────▼─────────────┐
        │  VS Code extension│      │  Remote bridge (opt) │
        │   (Tier 1, always)│      │  projects state +    │
        └───────────────────┘      │  control endpoints   │
                                    └────────┬─────────────┘
                                             │ authenticated tunnel
                                    ┌────────▼─────────────┐
                                    │  Phone app           │
                                    │  (monitor + nudge)    │
                                    └──────────────────────┘
```

The bridge exposes:

- **A read projection** — pipeline stage, per-agent status/heartbeat, completion %, run log — all derived from the same on-disk state, pushed over an event stream (WebSocket/SSE)
- **A small control surface** — answer a `to: human` gate, respawn an agent, stop the swarm, switch a model — each implemented as the same helper-script call the extension would make locally
- **Auth + tunnel** — token-based; opt-in and encrypted (see the remote-access security gap)

It deliberately does *not* hold or cache authoritative state, run its own watchdog, or duplicate logic. If it dies, the swarm is unaffected and the desktop extension carries on — because neither depends on it.

### What the phone app is good for

The phone is not where you'd read full agent transcripts or resolve a merge — it's for **awareness and light steering** while away from the desk:

- **Glanceable status:** which stage the parcel is at, per-agent liveness dots, run completion %
- **Push notifications** (the mobile-native win): "PR ready for review," "agent dead-lettered," "agent is asking you a question," "run finished/failed"
- **Light controls:** approve/answer a `to: human` gate, respawn a stuck agent, pause/stop the swarm, switch a model — all of which are single taps and don't need a big screen
- **The Work Tree** in collapsed form: backlog → feature → scenario with the same red→green completion circles, so you can see what's done from anywhere
- **Tap a tile** to see that agent's recent output (tailed, not the full scrollback) and type a one-line nudge

### What stays desktop-only

- Full terminal interaction / long typing into an agent
- Merge-conflict resolution review
- Diff/PR review (better on desktop, though the phone can *open* the PR in GitHub's app)
- Tile layout / resizing

### How it reuses what's already specced

Everything the phone shows already exists as on-disk state: heartbeats, message store with statuses, completion %, pipeline stage, run log. The phone is a thin projection of that — no new backend concepts, just a second client surface reading the same files (via the bridge) plus an event stream.

### Human approval gates over mobile

This pairs naturally with the `to: human` gate (see Correctness & Failure Handling): when an agent blocks to ask a question, it writes the gate to the message store; the bridge sees it and pushes to whatever remote client is connected (the desktop extension sees it directly). Answering from your phone unblocks the pipeline without going back to the desk — arguably the single most valuable mobile feature, since a blocked swarm otherwise sits idle until you return.

### Chat adapter (Signal / Telegram / WhatsApp / Teams) — human channel only

Instead of (or alongside) a custom phone app, the bridge can expose a **chat adapter**: a bot in a messaging app becomes the human's remote channel. This is attractive because the platform already solved delivery, identity, encryption, and a UI that's already on your phone — no push infra or custom app to build.

**Hard boundary: the chat app is a human-facing projection, never the agent coordination bus.** Agents continue to talk *only* through the on-disk message store (with its append-only log, leases, sequencing, chase, dead-letter). Routing agent-to-agent traffic through a consumer chat API would trade those hard-won guarantees for an unreliable network dependency in the core path — explicitly out of scope. The adapter holds no state; it projects store events outward and turns human replies into `human-input` / gate-answer messages.

```
message store  ──►  bridge  ──►  chat adapter  ──►  Signal/Telegram/etc.
   (truth)        (projects)     (human only)         (you, on your phone)
```

**Per-run thread as activity feed.** Each run gets one thread/conversation; the bot narrates stage transitions, gates, dead-letters, and the final PR link. A scrollable, human-readable log of the run on your phone — and the place gates are asked and answered.

**What the human can do from chat:** receive notifications, answer a `to: human` gate (reply to the prompt), and issue a few simple controls (stop, respawn a named role) as commands. Anything needing a real UI — diff review, merge resolution, tile layout — stays desktop.

**Platform trade-offs (pick per context):**

| Platform | Verdict |
|---|---|
| **Telegram** | Easiest real bot API — free, instant, unprompted messages fine. Best path of least resistance. |
| **Signal** | Best privacy, but no official bot API (`signal-cli`, unofficial). Workable, gray-area. |
| **WhatsApp** | Official Cloud API exists but built for business→customer: approval, per-conversation cost, 24-hour-window rules make unprompted pings awkward. Heavier than it looks. |
| **Teams** | Right choice *only* in a corporate/Teams context; first-class bots but heavyweight setup (Azure app registration). Overkill for a solo dev. |

The adapter is one bridge option among the remote tier (Tier 2) — entirely optional, and the same security/threat-model gap applies (what a chat reply is authorized to trigger, how the bot authenticates the human).

---

## Gaps & Things Still Missing

A scan of what the spec doesn't yet cover, roughly in priority order. Not all are v1, but each is a real decision waiting to be made. (Several earlier gaps — untracked human input, completion-measurement point, reroute livelock, item-completion loop, workflow field-ownership, salvage/rollback, and the `to: human` gate mechanism — are now addressed in the body and removed from this list.)

### Likely needed for a usable v1

- **Secrets & auth.** Backends that manage their own auth (Copilot CLI, Claude Code) need nothing from the extension — it never sees those credentials. The open question is narrower: backends that need raw API keys, plus the GitHub token for pushing branches / opening PRs. Where do those live and how are they kept out of the clone and out of commits? (Likely: extension-host environment, never written into the worktree.)
- **Cost & rate-limit controls.** Multiple agents on paid models running for hours. Need per-run token/cost tracking, a budget cap that pauses the swarm, and backoff handling when a backend rate-limits. Surfaced per-tile and as a run total. (The reroute budget and `to: human` escalation in Correctness are the per-item backstop; this is the per-run/$ backstop.)
- **`to: human` gate UX.** The mechanism is specced (a message type, surfaced on desktop + mobile, blocks the item). What's left is the interaction detail: how a gate is presented, how options are offered, timeout behavior if the human never answers, and whether a gate can be delegated/snoozed.

### Important but can follow

- **Remote-access security.** The phone tunnel needs a real threat model: token rotation, scope of what a remote client can do (read-only vs control), revoking a lost device, and whether control actions (respawn, model change, stop) require a stronger auth step than viewing. Off-LAN relay choice (self-hosted vs hosted) is a decision with privacy implications, since agent output could traverse it.
- **Observability / run artifacts.** A durable run log, transcript export, and the ability to inspect a finished run after the fact (what each agent did, decisions made). Useful for debugging a bad PR.
- **Test/lint command discovery.** Completion tracking assumes the extension can run the target's tests *on the dev branch*. How does it learn the test command — from `engineering.prompt`, auto-detected, or configured? Same for lint.
- **Multiple concurrent backlog items.** The next-item loop (see Correctness) defaults to one item at a time. Whether the swarm can work several in parallel (more worktrees, parallel dev branches) is a later question affecting branch/PR strategy.
- **Backlog item dependencies.** Eligibility now respects dependencies (see Correctness), but the *authoring* of dependencies and their visualization in the Work Tree (blocked badges, ordering) still needs detail.
- **Constitution / prompt versioning.** Partly addressed by the Governance model (rule changes are attributable commits, so a PR traces to the governance text in force). Remaining: pinning the exact prompt/constitution commit-hash *per run* in the run log, and deciding whether mid-run governance changes apply immediately (on respawn) or are staged to the next item boundary for consistency across agents in a run.

### Smaller / polish

- **Desktop/VS Code notifications.** Integrated notifications when a run finishes, a PR is ready, or an agent dead-letters — so the human isn't babysitting the panel. (Email notifications for needs-human events are now implemented; mobile push covered by the phone app.)
- **Onboarding for a fresh target.** First-run experience: `Initialize Target` exists, but a guided "this repo has no swarm files, set it up?" flow would help.
- **Diff review inside the extension.** Reviewing the PR without leaving VS Code.
- **Accessibility.** Color is not the only completion signal (the `%` text covers this), but keyboard nav of tiles and tree, and screen-reader labels, need a pass.
- **Telemetry (opt-in).** Anonymous metrics on swarm effectiveness — items completed, chase rates, respawn frequency — to tune heuristics.

---

## Out of Scope (v1)

- The swarm writing back to its own tool library autonomously (tool promotion is manual/human-curated in v1)
- Multi-target support in a single run
- Auto-merge on green CI (human reviews all PRs)
- Extension marketplace publication (internal use first)
- (Windows is now first-class — supporting it natively is why the extension owns orchestration instead of depending on tmux. No longer out of scope.)
