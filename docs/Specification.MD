# SwarmForge VS Code Extension — Specification

**Last Updated:** July 13, 2026 (BL-346)

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

**Platform.** macOS and Linux only — tmux, the process substrate the extension drives (see the doc/code note above, BL-095), has no native Windows implementation. A Windows-hosted swarm runs via WSL2 (a real Linux userland), never natively (BL-091).

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
- The info message shows both a ready-to-open URL with the token embedded (`http://127.0.0.1:<port>/?token=<token>`, for the holistic web UI below) and the raw token for `Authorization: Bearer` API requests

**Stopping the bridge:**
- Run the VS Code command **SwarmForge: Stop Bridge** (`swarmforge.stopBridge`)
- Or terminate the extension; the bridge shuts down automatically

**Security:**
- Every request requires a valid bearer token in the `Authorization` header: `Authorization: Bearer <token>`
- Exception: the root HTML page (below) additionally accepts the token via a `?token=` query parameter, since a plain browser navigation cannot attach a header — scoped narrowly to that one route; every JSON/SSE endpoint stays header-only
- The token is generated per run and held only in the extension host environment — it never appears in the target repo or any commit
- Requests without a valid token receive a 401 Unauthorized response with no state disclosed
- The bridge listens on 127.0.0.1 only; it is not accessible over the network

**Available endpoints (Phase 1):**

| Endpoint | Response | Purpose |
|---|---|---|
| `GET /` | HTML: the holistic dev-state web UI (see below) | A single-page, self-contained live view of the swarm |
| `GET /pipeline` | JSON: current stage per active parcel | Which role holds each ticket |
| `GET /agents` | JSON: per-agent status + heartbeat | Liveness, stall detection, "needs human" states |
| `GET /backlog` | JSON: active/paused/done items | Backlog folders and ticket metadata |
| `GET /runlog` | JSON: timeline of stage transitions and key events | Run history and audit trail |
| `GET /events` | Server-Sent Events (SSE) stream | Real-time updates when stage or agent state changes |
| `GET /metrics` | JSON: delivery-flow metrics (velocity, burndown, cycle time, forecasts, suite duration trend) | Trend/forecast data for monitoring dashboards or scripts |
| `GET /cost-telemetry` | JSON: per-role token/cost usage by day, cost attributed per ticket, and resource (RSS/CPU) trends | Token spend and resource usage for monitoring dashboards or scripts |
| `GET /holistic` | JSON: the projection backing the `/` page — swarm assignments, done-by-milestone, recent activity | The web UI's own data source; also usable directly by scripts |
| `GET /stage-dwell` | JSON: per-stage queue-wait/processing dwell (median/p90/max), bottleneck stage, trend vs. prior window | The coordinator's swarm-optimizer instrument; also usable directly by scripts |
| `GET /burn-rate` | JSON: per-role live token burn rate (tokens/hr) | Live "how fast is each agent burning tokens right now" meter, beyond BL-100's daily aggregates |

`GET /metrics`, `GET /cost-telemetry`, `GET /holistic`, `GET /stage-dwell`, and `GET /burn-rate` are all computed fresh on each request rather than folded into the ~1s SSE poll loop the other endpoints share — the underlying git-history walk and handoff-state/transcript reads are too expensive to recompute every tick.

**Holistic dev-state web UI:** Opening the bridge's root URL (`http://127.0.0.1:<port>/?token=<token>`) in any browser — desktop or phone, as long as it can reach the dev machine — serves a single self-contained page (inline CSS/JS, no external fetch or CDN, no localStorage/sessionStorage) showing the backlog board, per-swarm panel, pipeline flow, and recent activity, live-updated over the same `/events` SSE stream the rest of the bridge uses. It is read-only, exactly like every other bridge surface. A ticket's `swarm:` field (defaulting to `primary` when absent, per BL-090) determines whether it's shown as a live-tracked local ticket or labeled remote/last-synced. The page also has a **Metrics section** charting the delivery metrics above — a dependency-free inline SVG bar chart for velocity and for each milestone's burndown, plus text readouts for cycle time and forecasts — fetched once per page load/reconnect from `GET /metrics` (presentation only; no metric computation happens client-side) and re-rendered from the already-fetched data on each live update rather than re-fetching every tick.

**Per-agent burn-rate meter (BL-273):** a **Burn rate** section shows one row per pipeline role with its current tokens/hr — the live counterpart to BL-100's daily aggregates and BL-213's daily sidecar, neither of which is a live rate. `extension/src/metrics/burnRate.ts` sums each role's total tokens (input + output + cache creation + cache read, reusing `transcriptUsage.ts`'s `readTranscriptUsage` feed) whose transcript timestamp falls in a rolling recent window (default 15 minutes) ending at `nowMs`, then extrapolates to an hourly rate; an idle role with no usage in the window reads a real `0`, never omitted. `GET /burn-rate` (token-gated like every other holistic route) serves the per-role payload, and the page fetches it alongside `/holistic` and `/metrics` on load/reconnect (same on-demand posture, not re-fetched every SSE tick). This surface deliberately stays on the LIVE holistic UI, never the static backlog-dashboard PWA — a live rate is machine-local telemetry, not reproducible from git state at a SHA (see the PWA-vs-holistic-UI boundary rule in `local-engineering.prompt`) — and reaching it from a phone still rides the same not-yet-built tunnel/remote-access gap that parks BL-257 slices 3-4 and BL-265 slice 2; BL-273 builds the meter correctly on the live surface, not a workaround.

**Example usage (cURL):**

```bash
# Start the bridge and save the token
TOKEN=$(grep "token:" ~/.swarmforge/current_run.env | cut -d' ' -f2)

# Query pipeline state
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:9999/pipeline

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
- **Burndown**: remaining-ticket count per milestone, reconstructed so the final point always matches the current backlog state, alongside each milestone's forecast ETA (reusing the same per-milestone forecast below — no parallel ETA model) and an overall "all remaining work" ETA (the latest/max p50 across every open ticket's own forecast). A milestone with no computable forecast shows "no ETA yet" rather than a fabricated date.
- **Cycle time**: median and p85 spec-to-close duration over the recent closed set
- **Forecasts**: p50/p85 completion date per open milestone, projected from trailing throughput and historical cycle-time distribution — dependency-aware, so a ticket's forecast date never precedes its `depends_on` tickets'
- **Suite duration trend**: the existing per-run suite duration (BL-078) expressed as a trend line; reports "no local data" gracefully rather than erroring

Available via the `GET /metrics` bridge endpoint (see Remote Access & Phone App below), the CLI (below), and charted directly in the holistic dev-state web UI's Metrics section (below) — all three are fed by the same computation, so they always report the same numbers.

**Regression flag (BL-252):** the holistic UI's suite-duration readout (`bridge/holisticUiHtml.ts`'s `renderSuiteDurationReadout`) and the daily briefing (`swarmforge/scripts/briefing_email_lib.bb`) both show the latest duration, its trend direction, and — when set — a regression flag, applying the same amber warn treatment used elsewhere in the UI. Both surfaces read the ONE existing BL-078 warn computation in `swarmMetrics.ts` (`latest > warnThresholdMs` OR `latest > 2x` the baseline mean) rather than a second, re-derived threshold, so they can never disagree; with no local duration records, both show a no-data state rather than an error or a fabricated value.

**Suite duration on the static PWA, via committed sidecar (BL-290).** Machine-local suite-duration records can't ride the git-SHA-reproducible `backlog.json` projection directly, so this reuses the same committed-sidecar pattern BL-213/BL-272 already established for cost & health: `emit-cost-health-sidecar.ts` (BL-272's headless CLI) also snapshots the suite-duration trend into the same committed `docs/briefings/<date>.json` carrier — no second commit path. `buildBacklogDashboard` folds that trend into `backlog.json`'s `metrics.suiteDurationTrend` from the latest committed sidecar, exactly like `costHealth`, so a given SHA's `backlog.json` carries whatever was committed at or before it (git-reproducible, never a live read). `pwa/app.js` renders it mirroring `renderSuiteDurationReadout`: latest duration + trend arrow, the same regression mark when warn is set, and a no-data readout with no live/host fetch when there's no local data — the static PWA still reads only `backlog.json`, never a bridge endpoint.

#### Cost & Resource Telemetry

A third telemetry layer tracks token spend and per-role resource usage:

- **Cost telemetry**: per-role token usage (input/output, plus cache-read and cache-creation tokens at their own rates) parsed from the Claude Code transcript files under `~/.claude/projects/`, priced against a versioned per-model USD/MTok table, and rolled up by day. Usage is also attributed per ticket (from the role's handoff holding windows), with an explicit "unattributed" bucket for usage that falls outside every known holding window — never silently dropped.
- **Resource usage**: per-role RSS and CPU trends, sampled periodically and bucketed hourly.

Both are available via the `GET /cost-telemetry` bridge endpoint and the CLI (below). Two scenarios from the ticket's own scope — a rolled-up cost briefing paragraph, and surfacing cost telemetry through the phone/Action bridge — are deferred pending infrastructure (BL-099/BL-097) that doesn't exist yet. **The resource-usage sampler is wired into the real swarm lifecycle (BL-264):** `extension/src/swarm/resourceSamplerActivation.ts`'s `resolvePanePid` composes the existing tmux discovery chain (`readTmuxSocket` → `getPaneBaseIndex` → `resolveAgentPaneTarget` → `getPanePid`, the same chain `PaneTailer` already uses — no second discovery mechanism) to resolve each role's pid fresh on every sampler tick (never cached, so a respawned pane's new pid is picked up automatically), and `buildSampledRoles` maps each discovered role into the `SampledRole` shape `startResourceSampler` expects. `extension.ts` starts the sampler (holding its interval handle in the same module-level-state convention as `currentChaserMonitor`) after every launch-success/reattach call site, and stops it in `stopSwarm`/`stopSwarmCompletely`/`deactivate()` alongside the existing chaser-monitor stop — no leaked interval past teardown. This is wiring only: the sampler module, its telemetry format, and every reader (cost sidecar, bridge, CLI) are unchanged — a live swarm's "Resource usage" line now shows real RSS/CPU samples instead of no-samples-yet.

#### Agent CLI

Every role can also run a headless command-line version of the same metrics:

```sh
node extension/out/tools/swarm-metrics.js
```

Runnable from the repo root or from any `.worktrees/<role>/` checkout. Prints a short plain-text summary — mean ticket time, one busyness line per role, retry total, suite duration with warnings, and a chaser telemetry line per role — followed by one line per delivery metric (velocity, burndown, cycle time, forecasts, suite duration trend), then a cost telemetry line and a resource usage line, each one role-summary per role — and exits 0 with placeholder values on a fresh run. The CLI and panel/bridge are fed by the same underlying metrics computation modules, so they always report the same values.

When roles are configured on more than one agent/provider brand (`swarmforge.conf`'s `window` lines), the summary also prints a **"By provider"** line — the same chase/nudge telemetry as the per-role line, grouped by provider brand instead, so you can compare which brand is slower, failing, or idling more without reading per-role detail. Omitted entirely (not printed empty) when every role shares one provider or no provider roster can be derived.

#### Queue status CLI

A second headless, read-only CLI answers "is there actually pending work?" without mixing in the chaser's own operational sidecar files (`.chase.json`, `.nudge`), which used to dominate a raw directory listing and give a false impression of a busy queue:

```sh
node extension/out/tools/queue-status.js [--debug]
```

Runnable from the repo root or any `.worktrees/<role>/` checkout, same project-root resolution as `swarm-metrics.js`. By default, prints one line per role reporting its `inbox/new` and `inbox/in_process` counts SEPARATELY, not flattened into one combined figure (BL-323): a genuinely idle role reads `no work pending`, a role with fresh mail reads `N new pending` (plus an `in_process` suffix if any), and — the case a combined count used to hide — a role whose `new/` is empty but `in_process/` holds an orphaned claim reads `work claimed by nobody`, distinct from true idle. Sidecar files are not even listed by default, not just hidden. Pass `--debug` to additionally list each role's sidecar files, labeled by kind (`chase-sidecar`, `nudge-sidecar`, `other`).

#### Stage-dwell & bottleneck report CLI

A third headless CLI is the coordinator's swarm-optimizer instrument: per-stage queue-wait and processing dwell (median/p90/max, with IQR-based outlier honesty so one wedged parcel can't masquerade as a capacity problem), the bottleneck stage and its multiple over the next slowest stage, and a trend vs. the prior window:

```sh
node extension/out/tools/stage-dwell-report.js [--hours N] [--json]
```

Runnable from the repo root or any `.worktrees/<role>/` checkout, same project-root resolution as `swarm-metrics.js`. Defaults to a 24-hour window; pass `--hours` to change it and `--json` for machine-readable output. Reads every pipeline role's completed handoffs (never the coordinator, which sits outside the forward chain), including batch directories a batch role's `done_with_current_batch.sh` moves completed batches into. Fed by the same computation as the bridge's `GET /stage-dwell` endpoint, so the CLI and bridge always report the same numbers.

#### Routing break-even report CLI (BL-343)

A fourth headless CLI answers the question the dynamic-routing epic (auto-hibernate, routing manifest, quiet-period gate, per-role park/unpark) exists to answer: does parking idle roles actually save money?

```sh
node extension/out/tools/park-cycle-report.js
```

Runnable from the repo root or any `.worktrees/<role>/` checkout, same project-root resolution as `swarm-metrics.js`. Read-only and headless. It pairs every REAL park/unpark event logged by `role_lifecycle_cli.bb` (`.swarmforge/role-lifecycle/park-cycle-log.jsonl` — one line per real park or unpark, an aborted park that never actually removed a role from service is never logged) into complete cycles, then measures each cycle's real cold-start cost and idle-burn saving from the role's own transcript token usage — never an estimate derived from prompt size. For each role with at least one complete cycle it reports the break-even idle duration (the point below which parking that role is a net loss); `routingSavesMoney` is `null`, not `false`, whenever zero real cycles exist yet, so an unmeasured state is never misreported as a measured negative. Until a role has actually been parked and unparked in production, the report is honestly empty — that is expected, not a bug, and is not tuned away.

#### Standing rule violation report CLI (BL-337)

A Babashka CLI answers a direct question about the constitution itself: how often has a standing engineering rule actually been breached since it was written?

```sh
bb swarmforge/scripts/standing_rule_violations_cli.bb <project-root> report
bb swarmforge/scripts/standing_rule_violations_cli.bb <project-root> for-ticket <BL-NNN>
```

`report` scans every top-level rule (a `- ` bullet or `N. ` numbered item, with its wrapped continuation lines) in every `swarmforge/constitution/articles/*.prompt` and `swarmforge/roles/*.prompt` file, and prints each rule's cited `BL-NNN` ticket ids alongside a total citation count across all rules. `for-ticket <BL-NNN>` answers "how many times was this specific ticket cited as a violation" directly. Both derive purely from the committed text of the constitution/role files — no new bookkeeping, no git history walk — so a rule added tomorrow, anywhere in those files, is counted with no code change. A rule's numerically-smallest citation is treated as that rule's own origin (the incident that prompted writing it), never counted as a violation of it; every other citation is a real recorded violation since the rule landed. A `(source: ..., BL-NNN)` citation credits authorship, not a violation, and is excluded. A rule with zero violations is still reported, with a count of zero, never omitted — an all-zero result is a claim to verify, not the assumed answer.

The daily briefing email's `:standing-rule-violations-line` section (`swarmforge/scripts/handoffd.bb`, composed the same way as every other optional briefing line) surfaces the `report` total on every send, e.g. `Standing-rule violations: 38 cited recurrence(s) across 458 rule(s) since they landed (top: "..." x3, "..." x3, "..." x3)`.

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
- On relaunch the agent auto-picks-up its pending messages (see above), so recovery is seamless — including a parcel the prior (killed) process had already claimed into its own `inbox/in_process/` but never finished: every respawn path (auto-respawn, a manual restart, the chase daemon's own respawn, or a fresh swarm launch) converges on one generated launch script that checks the role's `in_process/` queue first and explicitly instructs the fresh agent to resume it, rather than relying on the agent to notice unprompted (BL-323 — a real ~4-hour stall where an orphaned `in_process` claim survived two relaunches before a human manually nudged it by name)
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

When an agent reports hitting a rate limit and provides a reset time (e.g., "tokens available again at 2pm"), the swarm automatically avoids waking that agent during the cooldown window and resumes normal operation once the cooldown expires. Detection and enforcement are split across two components that share one state file, `.swarmforge/rate-limit-cooldown.json`:

- **Detection (extension host):** the same pane tailer that already watches for session URLs (`swarmPanel.ts`'s `setupTailer`) scans for a usage/rate-limit line naming a reset time and records the cooldown to the shared file via `cooldownScheduler`'s `parseResetTime`/`recordCooldown`
- **Suppression + resume (handoff daemon):** `handoffd.bb`'s live chase sweep (`chase_sweep_lib.bb`) reads that same file each cycle — a cooling-down role is skipped entirely (no chase/nudge/wake); once past the reset time it is woken exactly once and marked woken, so it does not re-trigger the next cycle
- **Automatic resume:** once the cooldown timestamp passes, normal chase and wake behavior resumes automatically
- **Resilience:** cooldown state persists on disk — an extension reload or daemon restart before cooldown expires does not lose the suppression window
- **Isolation:** cooldown affects only the role that hit the limit; other agents continue normal chase/wake behavior uninterrupted

This prevents the "retry storm" where a rate-limited agent gets nudged repeatedly while unable to act, saving tokens and clearing the notification noise during the windowed recovery period.

### Mutation-run progress (long hardening passes)

A Stryker mutation pass can run for hours with no visible signal beyond an
opaque spinner. A durable, structured progress file closes that gap
independently of the heartbeat mechanism above:

- Every mutation run writes `.swarmforge/mutation-progress/<role>.json`,
  refreshed as mutants are tested and finalized (`status: "done"`) when the
  run completes: `{file, tested, total, percent, survived, timedOut,
  elapsed_s, eta_s, updated_at, status}`.
- The file is plain JSON — readable with `cat` at any time, with no
  dependency on the extension or webview being healthy.
- `updated_at` staying fresh distinguishes a progressing run from a hung
  one, the same distinction the heartbeat makes for agents in general.
- Written via a Stryker reporter plugin (`mutation-progress`, alongside the
  built-in `clear-text`/`progress` reporters in
  `extension/stryker.config.json`) that taps Stryker's own reporter
  lifecycle rather than re-implementing its progress/ETA math.

## Per-Agent Lifecycle Control

A core capability: managing individual agents without disrupting the swarm.

### Respawn a single agent

- Kills only that agent's backend process; its worktree and branch are left intact
- Relaunches the configured backend in the same worktree
- The rest of the swarm continues uninterrupted
- Useful when one agent is stuck, looping, or has drifted

**Auto-pickup on launch:** when an agent (re)spawns, it scans the message store for messages addressed to it still in `sent` or `received` and resumes them automatically — so a respawned receiver picks up its pending handoffs without waiting to be chased again.

Respawn replaces the *process* itself — the orchestrator kills the old backend PID and re-issues the launch for that role in the same worktree.

### Change an agent's model on the fly (BL-235, M5 — Claude-backed roles only)

**Landed slice:** a per-tile model dropdown, shown only for Claude-backed roles, lets you pick a different model for that one role. The extension rewrites that role's `.swarmforge/launch/<role>.claude-settings.json` `model` field in place (every other field untouched) and respawns just that role's pane via the existing single-agent respawn — no other agent is affected, `swarmforge.conf` and the launch script itself are never touched, and the swap is gone on the next fresh swarm launch (the settings file is regenerated then). Because role prompts and the constitution are re-read at launch, the respawned agent picks up the new model and resumes its in-process work normally. The dropdown's model catalog is the same versioned list `pricingTable.ts` uses for cost estimation — one list, not a second copy that could drift.

**Deferred (not yet built):** switching a role to a *different backend* (e.g. Claude → Codex, or to an in-process `vscode.lm` runtime) — see the note below and Agent Backends. That needs a TypeScript launch-command builder porting `swarmforge.sh`'s per-agent-CLI case-statement (five different CLIs' exact flags, including a documented past secrets-handling incident), which does not exist yet; a same-agent model switch needed none of that porting, so it shipped first as the safe narrow slice.

> **Doc-accuracy note:** the "Agent Backends" section below describes a `vscode.lm` in-process runtime and a backend-agnostic `InteractiveProcess` abstraction as already-built. As of BL-235, that TypeScript-side abstraction and runtime do not exist in `extension/src` — `vscode.lm` appears nowhere in the codebase outside this aspirational prose. Only Claude-backed model switching (above) is real today; treat the rest of "Agent Backends" as the target design, not shipped behavior, until a future ticket lands it.

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

**Effort dial (BL-236, M5, Suggest tier — Claude-backed roles only):** beyond model choice, a reasoning-effort lever independent of which model. At run start, each role gets a per-role effort suggestion (`low`/`medium`/`high`/`xhigh`) with a one-line rationale — higher (`xhigh`) for design-heavy roles (specifier, architect), a neutral `high` for coder/hardener, lower (`medium`) for mechanical roles (cleaner, documenter, QA, coordinator). Suggestions are purely advisory: nothing changes until the operator explicitly sets a role's dial. Setting a role's effort rewrites that role's Claude settings-file `effortLevel` field in place and respawns just that role via the same in-memory, `swarmforge.conf`-untouched mechanism BL-235 uses for model switching (same landed-slice caveat: a role on a non-Claude backend has no effort setting to show, per Agent Backends' current true scope). The Adapt/Auto tiers below remain unbuilt — this is Suggest only.

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

### Co-change coupling tool (automating the architect's Feathers check)

The architect's logical-coupling check — Michael Feathers' co-change technique: files that repeatedly change together in the same commit are coupled even with no static import between them — used to be a manual "eyeball `git log`" instruction (BL-255). `node extension/out/tools/co-change-report.js <changed-file> [<changed-file> ...]` (source: `extension/src/tools/co-change-report.ts`, analysis in `extension/src/quality/coChange.ts`) makes it a real, repeatable, deterministic tool: given the parcel's changed files, it ranks every other file by co-change frequency across git history and flags any pair at or above a tunable threshold (`--min-frequency`, `--min-group-size`, `--window`; defaults 3/2/full-history) as suspected coupling — stable ordering, so the report diffs cleanly run to run. File-level only (method-level coupling is a possible later slice) and temporal-only. The tool only informs; it never auto-bounces — the architect still makes the pass/send-back judgment on what it reports. The history query and changed-file arguments are resolved against the repo root regardless of the invoker's cwd (BL-268 fix): run from a subdirectory, `git log --name-status`'s per-commit listing is otherwise filtered to that subtree, which silently hides every cross-directory co-changer — exactly the coupling the tool exists to surface — so a subdirectory invocation now reports identically to a repo-root one.

The complementary STATIC lens — dependency direction / boundary rules — is BL-259's **gated dependency-rule checker**, a hard gate rather than an advisory report: `node extension/out/tools/dependency-gate.js [<changed-file> ...]` (source: `extension/src/tools/dependency-gate.ts`, ruleset: `extension/.dependency-cruiser.cjs`, shelling to a pinned `dependency-cruiser`) enforces this project's dependency rules as machine-checkable forbidden edges — `no-io-from-policy`, `view-not-import-host-io`, `no-process-spawn-from-view`, `core-not-vscode-api`, and `acyclic` (no dependency cycles) — exiting non-zero on any violation, with a deterministic, diffable report naming each offending edge and its rule. `no-webview-storage` (no `localStorage`/`sessionStorage` in webview code) is NOT a `dependency-cruiser` import-graph rule — a bare global-identifier reference like `localStorage.setItem(...)` has no import edge for a static analyzer to see — so `dependencyGate.ts` adds its own comment-and-string-aware text scan for the two storage globals over the scoped files, reported through the same violation shape as the import-graph rules. Unlike the co-change tool, ANY reported violation here is a hard fail: the architect bounces the parcel to the coder with the specific edge and rule name rather than forwarding it. Run with no file arguments for a full-repo scan (`src`/`media`) instead of the per-parcel changed-files scan.

### Swarm-compliance battery (qualifying a candidate model/backend)

Before adopting a new agent model or backend (e.g. evaluating Grok or Mistral for a role), `swarmforge/scripts/compliance_battery.bb` is a repeatable exercise that decides whether it's "swarm compliant" — i.e. can actually follow this project's protocol, not just produce plausible code. It drives the real helper scripts (`swarm_handoff.bb`, `ready_for_next.bb`/`done_with_current.bb`, the specifier/QA gates, the coordinator's depth-cap logic) against a scratch git worktree, rather than re-implementing any check logic — the same "pure lib + thin CLI" split as `swarm_ensure.bb`. Each check emits one scorecard entry (pass/fail/human-verdict-pending); judgment competencies that no script can read from a transcript (asks-when-blocked, startup-reread, constitution-adherence) surface as a short human rubric instead. `compliance_battery.bb scorecard <model-name> <entries-json-file>` aggregates all entries into one overall verdict. Provider-agnostic by design — it also runs against this project's own reference Claude configuration and must show a clean pass.

### Recruiter (scouting cheap/free models for role fit) — complete: discovery, auto-acquire, qualify, rank + recommend, wired end-to-end

A follow-on to the compliance battery above: out-of-band tooling (no worktree, no mailbox, no `swarmforge.conf` window line — parcels never flow through it) that hunts for cheap/free model plans, qualifies each one through the compliance battery, and recommends the best-value model per role. All four slices are landed — **slice 1 (discovery + candidate report)**, **slice 2 (auto-acquire access)**, **slice 3 (qualify via the compliance battery)**, **slice 4 (rank + recommend)** — plus the orchestrator/CLI that chains them into one runnable tool (below).

`node out/tools/recruiter-discover.js <candidates-file>` (source: `extension/src/tools/recruiter-discover.ts`) reads an operator-maintained JSON candidates file — a reviewable, versioned artifact, the same posture as the i18n jargon preserve-list, rather than this tool scraping live sites itself — and prints a candidate report to stdout: each candidate's `model`, `provider`, `planCost` (`amountUsd` + `unit`: `free` or `monthly`), and `signupPath` (`url` + `automation`: `automatable`, `payment-wall`, `captcha-wall`, or `manual-tos-wall`). The read is behind an injectable `DiscoverySource` seam (`extension/src/recruiter/discoverySource.ts`) so a smarter crawler-backed source can fill the same seam later without touching the report/CLI code that consumes it; a missing candidates file reads as an empty report, not an error.

`acquireAccess` (`extension/src/recruiter/acquire.ts`) takes a discovered candidate and either signs it up or escalates: an `automatable` `signupPath` is signed up via an injectable `SignupSource` seam and the returned key is handed straight to the host secret store — the raw key never appears in the returned `AcquireOutcome` (only an `'acquired'`/`'escalated'` status), so it can never leak into a printed report, a log, or a committed file. Any candidate whose `signupPath.automation` already names a `payment-wall`, `captcha-wall`, or `manual-tos-wall` (classified at discovery time) is never attempted — it escalates to a human immediately rather than trying to automate past the wall. The host secret store (`extension/src/recruiter/secretStore.ts`'s `createFileSecretStore`) writes acquired keys to a JSON file keyed by `<provider>:<model>` (re-acquiring the same candidate overwrites its own entry rather than duplicating one) and structurally REJECTS — throws, rather than merely documenting the rule — any secrets-file path that resolves inside the invoking working directory (`process.cwd()` by default), so a key can never land in the target repo or a commit by construction, not just by caller convention.

`qualifyCandidate` (`extension/src/recruiter/qualify.ts`) drives an acquired candidate through a representative trial task per swarm role via an injectable `RoleTrialRunner` seam, gates each trial's output through the real swarm-compliance battery above (`createComplianceBatteryGate`, `extension/src/recruiter/complianceBatteryGate.ts`, which shells out to `compliance_battery.bb` — no hand-simulated check logic, every verdict comes from the actual script), and records the aggregated per-role `BatteryScorecard`. Qualify only runs the battery and records what it says; it never filters or judges candidates itself — that is the (not yet built) ranking slice's job.

`rankForRole` (`extension/src/recruiter/rank.ts`) is a pure function over slice 3's already-scored candidates — no battery invocation, no I/O, never a second scoring pass — that excludes any candidate whose scorecard isn't `swarm-compliant`, then orders the rest by capability (passing battery-entry count) with plan cost breaking ties, and names the top entry as the role's `recommended` pick against the current model shown as `reference`. `suggestConfChange` (`extension/src/recruiter/recommend.ts`) turns a role's leaderboard into a suggested `swarmforge.conf --model <name>` line — recommend-only, per the operator's ADOPTION decision. This module deliberately imports neither `fs` nor `child_process`, so "the recruiter never mutates `swarmforge.conf` or bounces the swarm" holds structurally rather than by convention; a source-inspection test guards against the file ever gaining that capability.

Each slice above landed as an individually-tested, individually-correct function, but nothing chained them together end-to-end until a QA bounce (`ddc0d351ed` — "no orchestrator/report-writer ties slices 1-4 together") flagged that the ticket's own scope named a "report writer" that didn't exist: an operator had no way to get a per-role recommendation without hand-writing a script against the internal functions. `runRecruiter` (`extension/src/recruiter/orchestrator.ts`) is that missing piece — pure composition, no new business logic — that discovers candidates, acquires/escalates each one, qualifies the acquired ones via the battery, groups scored candidates by the swarm roles their battery entries were trialled for (derived from each entry's `<role>-gate` competency key, not a second role-reporting path), and ranks + recommends per role.

`node out/tools/recruiter-run.js <candidates-file> <signup-keys-file> <role-trials-file> <secrets-file> <current-models-file>` (source: `extension/src/tools/recruiter-run.ts`) is the recruiter's actual end-to-end entry point: it wires the orchestrator to the real file-backed `DiscoverySource`, `SignupSource`, `SecretStore`, `RoleTrialRunner`, and `createComplianceBatteryGate`, then prints the combined `RecruiterReport` (each role's leaderboard + suggested config line, plus the list of escalated candidates) as JSON to stdout — a thin presenter over `orchestrator.ts`, same posture as `recruiter-discover.ts`. A human still applies any suggested `swarmforge.conf --model` change; the recruiter never mutates `swarmforge.conf` or bounces the swarm itself.

#### Model bake-off (BL-250, companion to the recruiter above) — complete: curated roster, cost-tier labels, own end-to-end CLI

A companion to the recruiter, not a fork of it: instead of an operator-maintained "here's what I found" candidates file, the bake-off enumerates the WHOLE agent-capable model roster across a fixed three-provider set (Anthropic/Claude, Mistral, OpenAI/GPT), so every accessible chat-capable model gets tested, not a hand-picked subset. It reuses the recruiter's acquire/secret-store, battery-orchestration, best-value ranker, and report writer unchanged — this ticket adds only the roster source, a cost-tier label, and its own CLI wiring.

`createFileRosterSource` (`extension/src/recruiter/rosterSource.ts`) reads an operator-maintained JSON catalog file — same "reviewable, versioned artifact" posture as `discoverySource.ts` rather than calling each provider's live models API directly — and returns a `DiscoverySource`-compatible candidate list, excluding any non-chat endpoint (embeddings, image, audio, moderation), which cannot act as a swarm agent regardless of what the catalog lists. `labelCostTier` (`extension/src/recruiter/costTierLabel.ts`) is a pure, additive label over a candidate's existing `planCost` — `'paid-only'` or `'free/eval-tier'` — for the report; it never touches `rank.ts` or `recommend.ts`, which stay unchanged from BL-233 per this ticket's reuse-not-fork scope.

`node out/tools/bakeoff-run.js <catalog-file> <signup-keys-file> <role-trials-file> <secrets-file> <current-models-file>` (source: `extension/src/tools/bakeoff-run.ts`) is the bake-off's own end-to-end entry point — an architect bounce caught that `recruiter-run.ts` is hardwired to `createFileDiscoverySource`, which neither attaches a cost tier nor filters non-chat endpoints, so feeding a bake-off catalog through the recruiter's own CLI would silently produce wrong output. `bakeoff-run.ts` instead wires `createFileRosterSource` through the same real orchestrator/secret-store/battery (`runRecruiterWithFileAdapters`, `extension/src/recruiter/runRecruiterFromFiles.ts` — the file-adapter wiring shared by both CLIs) and prints the report with every ranked and escalated candidate labeled by cost tier — a thin presenter, no other derivation logic, same posture as `recruiter-run.ts`.

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
| 6 | **QA** | Converts the specifier's QA procedures into executable scripts, runs final UI verification, checks handoff consistency. As the last stage, it's the convergence point: broadcasts merge-up to worktree roles, then lands the approved commit on `main` itself and pushes origin (BL-247 — QA is the integration point) before notifying the **coordinator**. |

(The coordinator is the 7th role — it owns orchestration on `main` but performs no git merge or push after QA; its post-approval job is backlog bookkeeping only: move the ticket to `done/`, promote the next item (BL-247).)

### The pipeline flow

```
specifier ──► coder ──► cleaner ──► architect ──► documenter ──► QA (integrate) ──► coordinator (bookkeep)
```

Stage by stage:

1. **Specifier** writes the Gherkin and hands the parcel to the coder.
2. **Coder** merges the dev branch ("main" of the swarm) into its own branch, does TDD-style development, then hands to the cleaner when done.
3. **Cleaner** cleans up, then hands to the architect.
4. **Architect** reviews structure, then hands to the documenter.
5. **Documenter** updates the human-facing docs (high-level + the just-developed piece), then hands to QA.
6. **QA**, when done, **forces every pipeline worktree role to merge its own branch up to QA's verified commit** — this is the integration convergence point (see below) — then **lands that approved commit on `main` itself and pushes origin** (closing the GitHub issue for a `GH-`-seeded ticket), and notifies the **coordinator** with the approved commit so the coordinator can move the ticket to `done/` and promote the next backlog item (BL-247: the coordinator runs no git merge or push).

Putting the documenter **before** QA means the docs are covered by QA's final verification pass, rather than landing after the swarm has already converged.

The workflow **must visit everyone** — the pipeline is the quality gate sequence, and skipping a stage means a gate didn't run.

### Branches & integration

- Each agent works in its own worktree, and **each worktree is its own branch**
- **`main`** (master worktree) is the integration branch — **QA** lands QA-approved work here itself and pushes origin (BL-247); the specifier works on master for spec/prompt files only, not feature integration
- The **coder pulls integrated state into its branch** at the start of its stage (via `merge_and_process` on handoffs), so it builds on the latest parcel state
- **QA is the convergence point:** as the final pipeline stage, when QA passes it broadcasts merge-up to every worktree role (`coder`, `cleaner`, `architect`, `hardender`, `documenter`) instructing each to merge QA's verified commit into its own branch — bringing the swarm to a single consistent, verified state — then **QA itself** merges that commit to `main` and pushes origin, before notifying the **coordinator**. The coordinator's only post-approval job is backlog bookkeeping: move the ticket to `done/`, promote the next item — it runs no git merge or push (BL-247), keeping the costly specifier on specification work only
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

The pipeline defines "done with the *pipeline*" (QA converges worktree branches and integrates on `main` itself; the coordinator only bookkeeps the backlog — BL-247) but not "done with the *work item*" or what the swarm does next. Defined here:

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
- **Dev is the baseline, not peer branches.** A waking role syncs to `main` (the integration branch QA lands approved work on — BL-247 — the single source of integrated truth), never to some other peer's in-flight branch — so there's one well-defined thing to catch up to.
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
  QA convergence forces worktree branches to merge QA's; QA integrates on main itself and pushes; coordinator bookkeeps the backlog only (BL-247)
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

### Bounce-sentinel watcher resilience

The extension watches a bounce sentinel file to detect and act on a bounce request. If that watch is unexpectedly lost (e.g. `.swarmforge/` is removed and recreated out from under it) it automatically re-establishes, with a capped, backed-off retry budget rather than retrying forever against a persistent failure (such as the host's inotify watch limit being exhausted). A transient loss shows a warning notification; if the retry budget is exhausted, an error notification tells you the sentinel is no longer being watched and to reload the window or bounce the swarm to re-establish it manually.

### A swarm is a composite node (BL-244, Baton fleet epic)

Every node in the (still-emerging) Baton fleet model answers the same four calls, whether it's a single agent, a whole swarm, or a fleet of swarms — the console never inspects agents directly, only the layer immediately below it (fleet → coordinator → agents): `identity()` (name, project, and node kind: `agent`/`swarm`/`fleet`), `status()` (`idle`/`queued`/`active`/`blocked`/`converging`/`done`/`degraded`, plus the terminal `"stopped (coordinator lost)"` added by BL-245 below), `health()` (`expected_panes`/`live_panes`/`coordinator_alive`), and `children()` (one node per pack agent, each answering the same interface). `extension/src/swarm/compositeNode.ts`'s `createSwarmNode` computes a swarm's rollup by reading existing on-disk state only (`.swarmforge/handoffs/`, `backlog/active/`) — no new authoritative store — with a swarm's own `status()` rolling up its agents' individual statuses (e.g. any agent `blocked` makes the swarm `blocked`, and a stopped swarm's own terminal status is never silently hidden as merely `idle`). It is read both by the coordinator-loss recovery logic below and by the fleet console (BL-246, further below).

### Unexpected coordinator loss: bounded respawn, then graceful stop (BL-245)

The graceful bounce above is a *sanctioned* restart the human (or the bounce procedure) requests — it never applies to the coordinator exiting on its own, which is forbidden (BL-107: the coordinator's pane exiting tears down the whole swarm). BL-245 covers the other case: the coordinator pane dies *unexpectedly* (a crash, not a deliberate exit). Losing the coordinator is not a mode the swarm keeps running in — it either recovers or ends the run cleanly:

1. **Bounded respawn.** On an unexpected coordinator-pane death, the extension attempts a capped number of respawns with backoff (`extension/src/swarm/coordinatorLossTrigger.ts`'s `handleCoordinatorDeadEvent`, wired to `PaneTailer`'s `onDead` callback in `swarmPanel.ts`) — in-flight worker agents keep running throughout. `respawnCoordinator` reuses `tmuxClient.ts`'s single-pane `respawnAgent` (never the full-swarm `bouncer.ts`, which would also kill in-flight workers).
2. **Recovery.** If a respawn succeeds within the cap, the coordinator re-reads swarm state from durable `.swarmforge/` state (never in-memory state) and status returns to normal — no in-flight worker state is lost.
3. **Graceful stop on exhaustion.** If every respawn attempt fails up to the cap, the swarm stops gracefully instead of continuing degraded: intake freezes (no new work promoted), each in-flight parcel finishes its current stage and commits (reusing the existing bounce-drain pattern), then `swarmStopper.ts`'s `stopSwarmCompletely` tears down `handoffd` and every role session — no orphaned processes.
4. **Terminal status.** After the stop, the swarm's composite-node `status()` (see the composite-node rollup above) reports the terminal `"stopped (coordinator lost)"` — the fleet console surfaces this so a human can decide whether to relaunch; the swarm never auto-restarts itself.

`extension/src/swarm/coordinatorLossRecovery.ts` holds the pure respawn-cap/quiesce decision logic; `coordinatorLossTrigger.ts` is the real live call site wiring it to production dependencies. This closes an earlier architect bounce ("engine has no live caller") — the recovery engine was fully built and tested before anything in the running extension actually invoked it.

### The fleet is a composite of swarms (BL-246, Baton fleet epic, @poc slice)

"Two swarms, two projects, one console" — the fleet console composes several swarm `CompositeNode`s (BL-244) through the exact same `identity()`/`status()`/`health()`/`children()` interface a swarm already uses to roll up its own agents, so a fleet of one swarm renders through the identical path as a fleet of many, with no special-case single-swarm code. `createFleetNode` (`extension/src/swarm/fleetNode.ts`) reuses `compositeNode.ts`'s `rollupStatus` unchanged for the fleet's own status rollup, and sums `health()` across its member swarms.

`node out/tools/fleet-console.js <fleet-config-file>` (source: `extension/src/tools/fleet-console.ts`) reads a JSON array of swarm registrations (`name`, `project`, `targetPath`, optional `coordinatorAddress`) — each `targetPath` is that swarm's own project root with its own `.swarmforge/roles.tsv`, independent of this tool's own working directory — builds one `createSwarmNode` per registration, and prints the fleet's rolled-up identity/status/health plus each member swarm's own identity/status/health as JSON. This @poc slice's transport is **poll**: refreshing means running the CLI again; there is no subscription/push state (true push is deferred to a later milestone, per the ticket's own scope). Session liveness is read from the same heartbeat-based check `coordinatorLossTrigger.ts` already established for headless liveness (not a live tmux query, so a headless multi-project console can read it without a VS Code dependency); "needs human" (`isBlocked`) has no on-disk signal today and always reads `false` at this slice.

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
| Mutation-run progress (`.swarmforge/mutation-progress/<role>.json`) | Clone — not committed, not target main |

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
| `SwarmForge: Set Telegram Bot Token` | Store the Telegram bot token (from [@BotFather](https://t.me/BotFather)) in SecretStorage (BL-239). Masked input. |
| `SwarmForge: Clear Telegram Bot Token` | Remove the stored Telegram bot token. |
| `SwarmForge: Set Telegram Chat Id` | Store the authorized Telegram chat id the adapter will narrate to and accept gate replies from. |
| `SwarmForge: Clear Telegram Chat Id` | Remove the stored Telegram chat id. |

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

These, plus the onboarding scope contract below (BL-262), are the only files the swarm reads from the target. `project.prompt`/`engineering.prompt` are intentionally simple plain text; the onboarding contract below is structured YAML plus a generated legible view, so the target still has no forge-schema dependency on anything but that one small shape.

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

### The onboarding scope contract (BL-262, slice 1) — survey, propose, agree, fail-closed gate

A separate, higher-level contract sits above these two files and above the per-ticket acceptance contract (`docs/Onboarding-New-Project.md`'s section 3): the overall mandate for what the swarm will and will not do on a target, which the swarm surveys and proposes and the operator must agree before any ticket for that target dispatches. `proposeContractFromSurvey` (`extension/src/onboarding/contractSurvey.ts`) is a pure function mapping already-gathered `RepoSurveyFacts` (languages, layout, README, seed vision, initial backlog — the survey itself is swarm/agent behavior, not this function's job) into a `ProposedContract` (scope, out-of-scope, boundaries, initial-backlog summary, `agreement: proposed`). `node extension/out/tools/propose-onboarding-contract.js <target-repo-path> <survey-facts-json-path>` runs it and scaffolds + commits the hybrid artifact into the target via `initializeTargetContract` (`extension/src/config/targetBootstrap.ts`, generalized from the same idempotent plan/write/commit seam `initializeTargetRepo` already uses): `.swarmforge/contract.yaml` is the structured source, `CONTRACT.md` a generated legible view rendered from the same source so the two can never diverge (`extension/src/onboarding/contractView.ts`). The operator flips `agreement` to `agreed` once satisfied (or back to `pending` to re-open scope and re-hold the gate). Before every promotion of a paused ticket into `backlog/active/`, the coordinator runs `node extension/out/tools/onboarding-contract-gate.js <target-repo-path>` (`swarmforge/roles/coordinator.prompt`'s Onboarding Contract Gate section); `evaluateBuildStartGate` (`extension/src/onboarding/buildStartGate.ts`) is fail-closed — only `agreed` allows dispatch, and missing/malformed/`proposed`/`pending` all hold with a reason, never a default-allow (BL-099 missing-data posture), so a target with no contract yet simply reads as `missing` until surveyed and proposed. This does not replace or duplicate per-ticket `human_approval` — it gates whether any ticket can start, not what each ticket contains. Slice 1 (this) ships survey → propose → single agree/hold.

**The iterative negotiate loop (BL-344).** A single-round proposal is a take-it-or-edit-it-yourself, not a negotiation, so `negotiate-onboarding-contract.js` adds the request-changes → revise → re-propose loop on top of slice 1's own artifact and gate, unchanged: `node extension/out/tools/negotiate-onboarding-contract.js <target-repo-path> object "<objection text>"` revises the committed contract IN RESPONSE to the operator's own words (`reviseContractFromObjection`, `extension/src/onboarding/contractNegotiation.ts` — keyword-driven: "remove/exclude X" moves a matching scope entry to out-of-scope, "add/include X" adds a new scope entry carrying the operator's own text, anything else is recorded as a new boundary, so the objection is always reflected somewhere, never silently dropped), commits the revision, and appends a durable round record (`{round, objection, changedFields}`) to `.swarmforge/onboarding-negotiation.jsonl`. `node extension/out/tools/negotiate-onboarding-contract.js <target-repo-path> approve` flips `agreement` to `agreed` and commits — the first programmatic way to agree; previously the only path was the hand-edit described above. The loop is bounded at `DEFAULT_MAX_NEGOTIATION_ROUNDS` (5): an objection attempted after the budget is exhausted is refused and ends the negotiation without approving anything, while approval remains valid at any point up to and including immediately after the last round in budget (state is reconstructed fresh from the contract's own `agreement` field, the round log, and an explicit terminal marker on each separate invocation, since rounds can be hours apart). The build-start gate is unchanged — a revision is still just `agreement: proposed`, so it holds through every round exactly as in the single-round case.

**Generated target prompts (BL-269, child slice of the BL-262 family).** The same survey that proposes the contract also proposes real content for the two files immediately above — `proposePromptsFromSurvey` (`extension/src/onboarding/promptProposal.ts`) maps the identical `RepoSurveyFacts` into a `ProposedPrompts` (`project.prompt`/`engineering.prompt` text, mirroring those files' own section headers, populated from the seed vision/initial backlog and the surveyed languages/layout/README rather than `Initialize Target`'s generic angle-bracket placeholder). These two files ride the SAME agreement marker as the contract — one agreement, whole artifact set: `initializeTargetPrompts` (`extension/src/config/targetBootstrap.ts`) checks the contract's `evaluateBuildStartGate` decision and withholds both files (writes nothing, `withheld: true`) while it's `hold` (proposed/pending/missing/malformed), releasing them for commit only once `allow` (agreed). `node extension/out/tools/propose-onboarding-prompts.js <target-repo-path> <survey-facts-json-path>` is safe to re-run at any point in the negotiation — a no-op until agreement, the actual write+commit once agreed.

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

### Backlog Dashboard PWA (implemented — no dev machine, bridge, or tunnel needed)

A third, already-built option sidesteps Tier 2's tunnel/auth requirement entirely for read-only backlog visibility: `.github/workflows/backlog-dashboard.yml` runs on every push to `main` that touches `backlog/`, `docs/`, `specs/features/`, or the metrics/backlog-parsing/docs-generation code, generates two versioned JSON artifacts — `backlog.json` (schema: `docs/backlog-dashboard-schema.md`) and `docs-tree.json` (schema: `docs/docs-tree-schema.md`) — via `node out/tools/generate-backlog-dashboard.js` and `generate-docs-tree.js`, and publishes both to GitHub Pages alongside a small installable PWA (`pwa/`). Because it's static and served from Pages, it's reachable from any browser — including a phone, from anywhere — with **no dev machine running, no bridge started, no tunnel or token**. The dashboard shows the active/paused backlog board, done tickets grouped by milestone, and the same velocity/burndown/cycle-time/forecast numbers the `swarm-metrics` CLI and the bridge's `GET /metrics` report at that commit (never re-derived, so the three surfaces always agree). The burndown renders as a **classic sprint burndown line chart** (BL-287) — a solid "Remaining" polyline through each milestone's daily remaining-ticket count plus a dotted "Ideal" line from the first observed count straight down to zero at the latest observed date (the projection carries no milestone deadline, so the observed span stands in for a target end date), with date/count axis labels, light gridlines, and a legend — replacing the bar chart the burndown previously shared with the velocity chart (which is unchanged); still dependency-free inline SVG, no charting library. A client-side **filter/search bar** (BL-257 slice 1) over the already-fetched `backlog.json` combines a text query, status, and priority filter with AND; a filter matching nothing shows a localized empty state. A read-only **"needs human approval" list** (BL-251) shows every live (active + paused) ticket whose structured `human_approval` backlog field (`swarmforge/backlog-schema.md`) is `pending` — id and title only, no approve/reject control from the phone; approving still happens as it does today. The same daily briefing email carries an equivalent section. Both surfaces derive the list from the ONE `human_approval` field, never by re-parsing the free-text `# HUMAN APPROVAL: ...` comment some tickets still also carry, so they can't disagree; with nothing pending, both show an explicit empty state rather than blank or erroring. A one-time, idempotent backfill seeded the field on pre-existing live items from their legacy approval comments. Tapping a needs-approval entry drills into that ticket's **description and acceptance scenarios** (BL-266) — read-only, no approve/reject affordance — cross-referenced by ticket id from the same `docs-tree.json` the documentation drill-down explorer below already fetches (BL-117 already carries every ticket's description and resolved Gherkin scenarios there for every status), so the phone never shows a version of the ticket different from what the swarm actually builds against; no new store or second Gherkin parser. A **Listen** control speaks the description + scenarios aloud via the browser's on-device `window.speechSynthesis` (no network, no server, no storage — stays inside the static-PWA boundary), toggling between a "Start listening"/"Stop listening" label and matching `aria-label`. The PWA also has a read-only **documentation drill-down explorer**: vision docs (Specification, Roadmap, GettingStarted, both diagrams) → milestone → ticket → Gherkin scenario, with breadcrumb navigation and no *edit* surface anywhere — a ticket's full-detail view carries the same **Listen** control (BL-293), reused as-is: activating it reads the ticket's description followed by every one of its scenarios aloud on-device, covering the whole spec at the ticket level (not a separate per-scenario control) — resolving each ticket's acceptance criteria whether it's the pre-BL-111 inline-Gherkin form or the post-BL-111 `specs/features/*.feature` reference form transparently. Each ticket carries a whole-ticket **implemented vs not-yet** flag (BL-253) derived once from its backlog folder (`done/` → implemented; `active/`/`paused/` → not-yet) so the tree data and every consumer agree, with no duplicated status-derivation logic on the PWA side; not-yet tickets grey visually (a `.not-yet-implemented` CSS class) but stay fully expandable, and their Gherkin remains refinable through the existing BL-150 recertification flow (which was already structurally status-blind, confirmed rather than changed). Each ticket's docs-explorer view also shows a **timeline** (BL-257 slice 2) of its `specDateIso`/`closeDateIso` stages in order, sourced from the same git-derived ticket lifecycle events `docs-tree.json` generation already computes elsewhere — fully git-reproducible, unlike a richer per-role holding-window breakdown that would need live `.swarmforge/` mailbox state this static artifact's generation pipeline doesn't have. (BL-257's other two candidate slices — a changed-since-last-visit highlight, and live briefing-metric trends in the PWA — are parked as a `.feature.draft`: both need live, bridge-connected data the static, zero-connectivity PWA cannot reach, and BL-252 already settled that machine-local live metrics belong on the holistic UI/briefing, not `backlog.json`/the PWA; flagged back to the specifier rather than built onto the wrong surface.) A **full-text search box** (BL-254) filters the drill-down tree client-side by any ticket's title, description, or Gherkin scenario text (case-insensitive substring match) — no new search endpoint or index, it filters the same `docs-tree.json` the PWA already fetched. `filterDocsTree` (`extension/src/docs/docsTree.ts`) is the pure filter: matching a ticket keeps it (and prunes its milestone down to matching tickets only), and a blank/whitespace-only query returns the tree unchanged. `pwa/app.js` hand-mirrors this same filter logic in the browser (the PWA is an unbundled script with no access to the compiled TS module — kept in sync by hand, the same posture as BL-249's `PREFERENCES_CACHE_NAME`) and wires it to a single, statically-placed search input so typing never loses focus across re-renders. Both artifacts are offline-capable (the service worker caches the static shell cache-first and each JSON artifact network-first-with-cache-fallback, so an offline open still renders the last-fetched data with its own "as of `<generatedAtIso>`" honesty indicator) and installable as a home-screen PWA. The generating Action is not a required check — a failure is visible in GitHub Actions but never gates the pipeline.

The shell cache's name (`CACHE_NAME` in `pwa/sw.js`) is a content hash of the shell assets (`SHELL_ASSETS`), stamped into the served `sw.js` at deploy time by the "Stamp PWA cache name" step (`extension/src/tools/stamp-pwa-cache-name.ts`, run over `_site/` after the PWA static assets are copied in) — BL-249. A deploy that changes any shell asset yields a different `CACHE_NAME`, so the activate handler's existing purge-old-cache-on-change logic actually fires and returning users get the update; a byte-identical shell yields the same `CACHE_NAME`, so an unchanged shell is never force-re-downloaded. `pwa/sw.js` itself keeps a placeholder constant — only the served, stamped copy under `_site/` differs per deploy.

The dashboard also has a **Cost & Health card**, shown whenever a `docs/briefings/<date>.json` sidecar has been committed (hidden entirely otherwise). The daily briefing flow (BL-099: a once-a-day nudge into the coordinator's pane, whose composed `docs/briefings/<date>.md` gets emailed) now also emits this machine-readable JSON sidecar alongside it — per-agent token/cost totals, the top-5 most expensive tickets, spec-vs-close flow balance, reliability event counts, and resource anomalies, each carrying a trend. `backlog.json` folds in the most recently committed sidecar verbatim (see `costHealth` in `docs/backlog-dashboard-schema.md`) — every figure on the card traces to that sidecar; the PWA never computes or invents a number.

**Headless morning generation trigger (BL-258):** BL-099's nudge above depends on the VS Code host's own once-a-day timer — a swarm running fully headless (no VS Code host) never gets the briefing GENERATED, so BL-214's daemon send path has nothing to send. `swarmforge/scripts/briefing_generation_schedule_lib.bb` adds a host-independent morning trigger in the same daemon that already handles the send: at/after a configured UTC time (`swarmforge.conf`'s `briefing_morning_time_utc`, default `08:00`) on any day whose `docs/briefings/<date>.md` doesn't yet exist, it sends the coordinator the identical BL-099 nudge prose. The file's own presence is the idempotency gate (the same signal BL-214's send path already keys off), so this composes safely with the VS Code host timer if both are present — whichever writes the file first silences every later check from either trigger. This only adds the generation trigger; BL-099's content and BL-214's send path are unchanged.

**Headless cost & health sidecar emission (BL-272):** the Cost & Health card above was previously populated only by the VS Code host's own `onBriefingDue` handler calling BL-213's `computeCostHealthSidecar -> writeCostHealthSidecar -> commitCostHealthSidecar` in-process — a swarm running fully headless never emitted `docs/briefings/<date>.json`, so the briefing's Cost & Health section and the phone card were silently absent on every headless day. `extension/src/tools/emit-cost-health-sidecar.ts` is a thin headless CLI (`out/tools/emit-cost-health-sidecar.js`) that runs the identical compute → write → commit path outside the extension host; `briefing_generation_schedule_lib.bb`'s `generate-briefing-if-due!` (the BL-258 trigger above) now invokes it via an injected `:emit-sidecar!` adapter — `handoffd.bb`'s `emit-cost-health-sidecar!` shells the CLI out — wrapped in a `try/catch` that mirrors the host's own best-effort posture, so a sidecar emission failure never suppresses the briefing-generation nudge. Idempotency is unchanged: `commitCostHealthSidecar` already fails closed on a no-op `git commit`, so re-running the emitter for an already-committed day makes no duplicate commit.

**Briefing enrichment (BL-256):** the briefing composes optional sections, each an independent, droppable slice reusing existing telemetry rather than re-deriving it — `briefing_email_lib.bb`'s `send-unsent-briefings!` threads content through a `:suite-duration-line` (BL-252), `:needs-approval-section` (BL-251), `:merged-blocked-digest`, `:stage-dwell-section`, and `:chase-trend-section` in order, each independently appending its own block or leaving content untouched if unavailable — a missing section never breaks or silently drops the rest. Landed sections: a **what-merged/what's-blocked digest** (`extension/src/metrics/briefingDigest.ts`) listing tickets closed since the last briefing and tickets a role has held open past a threshold (12h default) with no existing stall flag reused or invented beyond this explicit one; a **per-stage dwell/throughput** line reusing BL-102's existing `stage-dwell-report.ts`; and a **QA-bounce/chase trend** line (`extension/src/tools/chase-trend-line.ts`) reporting chase/nudge/dead-letter counts and their trend direction over two adjacent 7-day windows, reusing BL-098's chaser telemetry and the same `computeTrend` every other briefing trend uses. **PWA deep links** (`extension/src/metrics/pwaDeepLinks.ts`) turn a briefing item into a one-tap link into its PWA view (`#ticket=<id>` / `#approval=<id>` hash routes) when the optional `swarmforge.conf` key `pwa_base_url` is configured — absent config degrades to no link, never a broken or fabricated URL. The "generous extras" slice (per-role resource use, cost-per-stage, forecast-ETA change call-outs) has not landed yet.

**Not-done ticket count (BL-263):** both the PWA backlog dashboard and the daily briefing show a single "not done" total — every live ticket (`board.active.length + board.paused.length`), excluding `done`. `computeNotDoneCount` (`extension/src/metrics/backlogDashboard.ts`) is the one pure derivation; `buildBacklogDashboard` emits it as `backlog.json`'s `notDoneCount` field (schema: `docs/backlog-dashboard-schema.md`), which `pwa/app.js` renders verbatim (localized label via `pwa/locales.js`) and which `extension/src/tools/not-done-count-line.ts` — a CLI `briefing_email_lib.bb` shells out to, wired as the `:not-done-count-line` optional adapter alongside BL-256/BL-258/BL-260's — composes into the briefing as the same number, so the two surfaces can never disagree. Zero (every ticket done) renders like any other count, never a blank/error state.

**Rendered architecture diagrams inline (BL-260):** the morning briefing email now shows the project's architecture diagrams as viewable images in the body, not just a link to their Mermaid source. `extension/src/diagrams/mermaidRender.ts` renders `docs/diagrams/architecture.mmd` and `docs/diagrams/swarm-flow.mmd` to PNG entirely locally and deterministically — `beautiful-mermaid` (a pure-JS/TS Mermaid renderer, elkjs layout, no DOM/browser) lays out the SVG and `@resvg/resvg-js` rasterizes it, chosen over `@mermaid-js/mermaid-cli` specifically because `mmdc` needs a downloaded, spawned headless Chromium that this project's own build/CI environment can't support. Both packages are pinned in `extension/package.json`. Because `beautiful-mermaid`'s SVG paints via CSS `var()`/`color-mix()` custom properties meant for a live browser cascade, `flattenMermaidThemeVars` resolves every variable to a literal color and strips the generated `<style>` block (which otherwise pulls a Google Fonts `@import` — an external network reference the reproducibility/privacy constraint (BL-252 spirit) forbids) before handing the SVG to the static rasterizer; identical source and theme produce byte-identical PNG bytes across separate process runs, verified empirically, so no diagram is ever rendered by or shipped to an external service. `extension/src/tools/render-briefing-diagrams.ts` is the CLI Babashka shells out to (it has no way to import compiled TS/npm packages): it prints `[{name, base64}, ...]` for the two maintained diagrams, and any failure — a missing dependency, an unparseable `.mmd`, a not-yet-compiled checkout — degrades to nil rather than throwing. On the Babashka side, `briefing_email_lib.bb`'s `build-diagram-section` turns that payload into an optional `:diagram-section` adapter for `send-unsent-briefings!`: when diagrams rendered, it supplies an HTML body plus a plaintext note pointing a non-HTML client at `docs/diagrams/` in the repo; when rendering is unavailable, the email still sends with a clear no-diagram plaintext note instead of failing. `daemon_alarm_lib.bb`'s `send-alarm-email!`/`send-configured-email!` and `handoffd.bb`'s `send-configured-briefing-email!` each grew a new optional-html arity (the html-less arity is unchanged, so every pre-BL-260 caller/test keeps its exact prior behavior).

**Fixed: cid inline attachments, not data-URI images (BL-286).** BL-260 originally embedded each diagram as an inline `<img src="data:image/png;base64,...">` — Gmail and most webmail clients block data-URI image sources, so every diagram rendered broken/blank in the human's actual client. `build-diagram-section` now emits `<img src="cid:<content-id>">` per diagram and returns the image bytes as attachment descriptors (`{:filename :content-id :base64}`) alongside the HTML, rather than inlining them into the markup; `send-unsent-briefings!` threads those through to `:send-email!`, and `daemon_alarm_lib.bb`'s `default-post!`/`send-alarm-email!` include them in the Resend JSON body as `:attachments` (`{:filename :content :content_id}`, the RFC 2392 inline-attachment shape Gmail actually renders) — each `content_id` matches exactly one `cid:` reference in the HTML. Fully backward compatible: absent diagrams (or any pre-BL-260 caller, including the BL-144 death alarm) produce the identical prior payload with no `:attachments` key.

**Bilingual French/English, N-language design (board titles):** The dashboard has a visible locale toggle cycling through whatever locales are configured (`window.LOCALES`' own keys). English is always the first-launch default regardless of browser locale; switching re-renders every already-fetched section instantly from cached data — no reload, no re-fetch — and the choice persists across visits via the Cache Storage API (never `localStorage`), in a dedicated `PREFERENCES_CACHE_NAME` cache kept permanently static and distinct from the shell's per-deploy `CACHE_NAME` — sw.js's activate handler explicitly exempts it from the shell-invalidation purge above, so a shell-changing deploy never wipes a returning user's saved locale (BL-249 hardener bounce; before this exemption, the purge deleted any cache key that wasn't the current `CACHE_NAME`, which would have wiped preferences the moment `CACHE_NAME` started actually changing). Board ticket titles carry a per-configured-target-locale `titleTranslations` map on `backlog.json` (BL-230, schema doc above), keyed by locale code against `extension/src/i18n/targetLocales.ts`'s `TARGET_LOCALES` (French (`fr`) is the first delivered target) — adding a target locale is a config-and-rebuild operation, no per-language code change. Vision doc markdown, ticket description, and Gherkin scenario text (`docs-tree.json`) still carry BL-118's original fixed additive `*Fr`/`*FrUntranslated` sibling pair; generalizing them to the same N-locale map is a planned follow-on slice. Both mechanisms share the same build-time translation pass: a CI-run pass (a DeepL adapter, with a null/pass-through fallback — publishing never fails or blocks on translation) whose content-hash-and-locale-keyed cache is committed to `docs/i18n/translation-cache.json` so an unchanged string is never re-translated and builds stay reproducible. Jargon tokens (ticket ids, pipeline role names, the product name — the reviewable preserve-list in `extension/src/i18n/jargonPreserve.ts`) are wrapped before each engine call and unwrapped after, so they survive translation verbatim rather than being machine-translated themselves. An `*Untranslated: true` flag (or, for board titles, an entry's own `untranslated: true`) marks a field that's still showing English because translation was unavailable or failed for it. The PWA itself now surfaces this: whenever a rendered `*Fr` field's paired `*Untranslated` flag is true — ticket title, vision-doc content, ticket description, or Gherkin scenario text (BL-261) — a localized "translation unavailable" notice renders alongside the English fallback, so it is never presented as a genuine French translation; a genuine translation shows no indicator. (Before BL-261, `pwa/app.js` read the `*Fr` fields unconditionally and never checked the paired flag, so a failed translation silently looked like a real one — the flags existed and were correctly published on `docs-tree.json` the whole time, this was a rendering-layer gap only.) A locale with no entry at all falls back to the source text. Gherkin scenario text always shows the canonical English by default in either locale (the binding acceptance contract), with the translated rendering one tap away. Operationally: the Action needs an `MT_API_KEY` secret (DeepL) to actually translate — configured as a GitHub Actions secret, never in the client bundle or the repo.

**Font size:** The dashboard defaults to a large 28px root font size (phone-readable out of the box, since every view sizes text in `rem` relative to it) with A-/A+ buttons in the chrome, alongside the locale toggle, stepping it by 2px within a 16-40px clamp — applied instantly with no reload. The choice persists the same way as the locale preference: the same dedicated, purge-exempt `PREFERENCES_CACHE_NAME` cache (never `localStorage`), falling back to the 28px default on a missing or out-of-range stored value.

**Collapsible sections (BL-291):** each top-level dashboard section (backlog board, velocity, burndown, cycle time, cost & health, documentation explorer, recertification, etc.) has a keyboard-operable header control that collapses/expands its body, `aria-expanded` kept in sync at creation and on every toggle. Each section's open/collapsed state persists independently across reloads on the same `PREFERENCES_CACHE_NAME` mechanism as the locale and font-size preferences — keyed by the section's stable `data-i18n` heading key, never DOM order (which drifts as sections like Cost & Health show/hide based on data availability) — so a returning visitor sees the layout they left, and a first-ever visit defaults every section open.

**Gherkin scenario recertification (receiver, inbound address, and serverless handler now built — the remaining routing is an operator go-live step):** A third published artifact, `recert-batch.json`, drip-feeds one oldest-reviewed-first Gherkin scenario at a time (only scenarios carrying a BL-111 stable `# TICKET-ID slug` tag are trackable; untagged ones are excluded, never mistracked under a position that could shift) into a "Recertify a scenario" section of the PWA. Reviewing from the phone offers three outcomes, each composing a `mailto:` link since the PWA is fully static with no live backend to call: **Confirm** (still accurate — just advances the scenario's last-reviewed timestamp), **Update** (propose new scenario text), and **Delete** (gated behind an explicit in-app confirmation screen before any send link exists). Confirm applies directly since it changes no content; Update/Delete are real contract changes and land as durable, one-per-change proposals for specifier review — the same pattern `rule_proposal` already uses — via a Resend Inbound webhook (BL-217). The shown scenario also carries the BL-266 **Listen** control (BL-271) — reused unchanged, not reimplemented — reading the scenario's name then its Gherkin text aloud via on-device `speechSynthesis`; it appears only while a scenario is present and is omitted once nothing needs recertification. Above the scenario, a **"BL-### — title"** line (BL-280) shows which backlog item the scenario belongs to — `recertifiableScenariosFrom` (`extension/src/docs/recertification.ts`) now carries the ticket's title (and French title, when set) alongside the existing `ticketId` on each `RecertifiableScenario`, an additive field so `recert-batch.json` stays git-SHA-reproducible. When a title is resolvable the line is a tap-through link into the ticket's full detail, reusing the docs explorer's own in-page navigation (`navButton` → `{level: 'ticket'}` → `renderDocsTicket`, the same mechanism BL-256's deep-link scheme already uses — no new routing) and its existing locale fallback (French title under the `fr` locale, else English); a scenario with no resolvable ticket shows the bare id with no link and no error.

The webhook's core (`extension/src/notify/recertInboundWebhook.ts`) is platform-agnostic: it verifies the Resend/Svix signature and rejects a stale/replayed timestamp (outside a 300-second freshness window), so neither an unauthenticated nor a captured-and-replayed request can ever create a proposal; it then checks the sender against a configured allowlist (BL-248 — see below) before parsing the phone-composed email with BL-150's existing `parseRecertEmail`, and commits exactly one proposal per change to `backlog/recert-inbox/<scenarioId>-<timestamp>.json` via GitHub's Contents API (`recertProposalRepoCommit.ts`) — the serverless function has no filesystem access to a running host's `.swarmforge/`. A host-side bridge (`extension/src/tools/bridge-recert-proposals.ts`) ingests those committed files into BL-150's existing durable review queue (`.swarmforge/recert_proposals/<month>.jsonl`), closing the loop into the specifier's normal recertification review. A malformed but validly-signed, allowlisted email produces no proposal and is logged rather than crashing. The signing secret and the repo-write credential live only in the function/host environment — never in the repo — and the repo-write credential is minimally scoped; proposals are never auto-applied, so specifier review remains the gate even for a malformed proposal.

**Sender allowlist (BL-248).** Signature verification only proves Resend delivered the request — it says nothing about *who* sent the original email. `HandleInboundEmailWebhookDeps` now carries a `senderAllowlist: string[]` (sourced from the serverless function's own environment, the same deployment-agnostic posture as the signing `secret` — the core cannot read this host's `.swarmforge/`), checked case-insensitively against the inbound `data.from` field, after signature/freshness auth and before the email is even parsed for a recert outcome. **Fail-closed by design:** an empty or missing allowlist rejects every sender (403 "sender not allowed") rather than accepting anything signed, since an allowlist that fails open is not a control. It is not mirrored into `swarmforge.conf` (left as an operator-set deployment env var, not built into the repo config).

**Serverless deployment handler (BL-288).** `api/recert-webhook.js` is a thin Vercel Node function (`vercel.json` at the repo root) that wraps `recertInboundWebhook.ts`'s core end to end: it extracts the `svix-id`/`svix-timestamp`/`svix-signature` headers and the RAW request body — with the platform's automatic JSON body parsing disabled, since Svix signature verification checks the exact bytes and a re-serialized body silently breaks it — assembles `HandleInboundEmailWebhookDeps` entirely from the deployment environment (signing secret, the BL-248 sender allowlist, GitHub owner/repo/branch/token for `commitProposal`), calls `handleInboundEmailWebhook`, and maps its `{status, body}` onto the platform HTTP response. The wrapper is intentionally thin and unit-tested for wiring only (raw-body correctness, header extraction, env-to-deps assembly, response mapping) — the core's own behavior stays covered by its existing BL-217/BL-248 tests. This closes the "code built, last-mile go-live never done" gap the same shape as the BL-272 cost-health sidecar: `backlog/recert-inbox/` never existed and zero proposals ever committed because the wrapper simply didn't exist yet, not because of a misconfiguration.

The PWA's inbound address (`recertEmailTo`, config-injected from `swarmforge.conf`'s `recert_email_to` — never a hardcoded placeholder) is now a real, Resend-managed receiving address (BL-223), replacing the old `.invalid`-TLD placeholder (RFC 2606 — guaranteed non-deliverable) that stood in before BL-217's receiver existed. Still open (operator go-live, not a build gap — see `docs/runbooks/BL-223-recert-inbound-address-golive.md`): deploying `api/recert-webhook.js` to Vercel, setting its environment secrets, and routing the Resend Inbound webhook at the deployed endpoint. Applying an *accepted* update/delete proposal back into its `.feature` file also has no tool yet (out of scope for BL-217; tracked under BL-150 + the existing `rule_proposal` flow).

**Telegram announces a waiting recert batch and deep-links into the PWA (BL-339) — notify only, verdicts still given in the PWA.** The human asked whether recert feedback could be done via Telegram; the answer he chose was notify-and-deep-link, not in-thread verdicts: recert stays a batch review activity in the PWA (where the UI already works), and Telegram's job is only to tell him work is waiting and take him straight to it. A standalone CLI (`extension/src/tools/notify-recert-batch.ts`) computes the real waiting batch via the same `computeRecertBatch` the PWA itself renders (never a second derivation), decides whether to announce (`decideRecertAnnouncement`, `extension/src/notify/recertBatchNotifier.ts`), and sends one Telegram message naming the batch count plus a `#recert=1` deep link (`buildRecertDeepLink`, `extension/src/metrics/pwaDeepLinks.ts`) — reusing the same BL-256 deep-link scheme the docs explorer already uses, not a second link mechanism. `pwa/app.js` now parses that `#recert=1` hash route and scrolls the recert section into view on load, so the link actually lands on the work. Anti-spam tracks the waiting batch's own scenario-id set rather than a boolean: because `selectForRecertification` always returns up to the batch size from the whole recertifiable pool (marking one scenario reviewed just reorders the pool, it never empties), a same-outstanding-batch tick never re-announces, while a genuinely different batch — even the same size — does. The armed state is written only on confirmed Telegram delivery, never on a bare send attempt (the BL-333/BL-345 "arm on delivery" rule, reapplied). Wired into `handoffd.bb`'s existing chase-sweep cadence as its own `recert-notify-sweep!` adapter (same shape as the other `*-sweep!` Babashka-to-Node adapters in that file) — a disposable, independent CLI, deliberately not routed through the live, currently-running Telegram Front Desk Bot process, so it can never destabilize that connection. Out of scope, deliberately: no verdict can be typed into Telegram and accepted — `confirmScenario`'s only caller anywhere in `extension/src` remains the existing inbound-email path (BL-223); this CLI never references it.

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
- **A small control surface — narrower than originally scoped here, by deliberate operator posture (BL-240, 2026-07-10):** the ONLY write route the bridge exposes is answering a captured `to: human` gate (`POST /gate-answer {role, answer}`), authenticated, dispatched through the exact same tmux send-keys call the extension uses when the operator types into a tile locally, and refused for any role that isn't currently showing a captured gate. Respawn-an-agent, stop-the-swarm, and switch-a-model remain future work on this surface, not yet implemented — a client cannot do them remotely today.
- **`GET /gates` — the pending-gate list (BL-265 slice 1).** A read-scoped route listing every role currently showing a captured `to: human` gate (role + question snippet); a role with no pending gate is simply absent, and nothing gated returns an empty list, never an error. `filterPendingGates` (`extension/src/bridge/gateSnapshot.ts`) narrows `computeRoleGateStatesLive`'s per-role snapshot (built for the Telegram narrator, BL-239, which needs the full gated/not-gated set to detect a resolved transition) down to only the gated entries. This closes gap #10's missing read half — the write half (`POST /gate-answer` above) already existed; a client still needs a UI to actually view and answer from, which is slice 2 (holistic UI, `extension/src/bridge/holisticUiHtml.ts`, parked as `specs/features/BL-265-holistic-gate-answer-view.slice-2-ui.feature.draft` until built) — deliberately NOT the static backlog-dashboard PWA, which has no live bridge connection, token, or write path (see the PWA-vs-holistic-UI boundary rule in `local-engineering.prompt`).
- **Auth + tunnel** — token-based; opt-in and encrypted (see the remote-access security gap)

It deliberately does *not* hold or cache authoritative state, run its own watchdog, or duplicate logic. If it dies, the swarm is unaffected and the desktop extension carries on — because neither depends on it.

### What the phone app is good for

The phone is not where you'd read full agent transcripts or resolve a merge — it's for **awareness and light steering** while away from the desk:

- **Glanceable status:** which stage the parcel is at, per-agent liveness dots, run completion %
- **Push notifications** (the mobile-native win): "PR ready for review," "agent dead-lettered," "agent is asking you a question," "run finished/failed"
- **Light controls:** approve/answer a `to: human` gate — the one control the bridge's write path supports today (BL-240); respawn a stuck agent, pause/stop the swarm, and switch a model are envisioned as future single-tap additions to this surface, not yet built
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

**What the human can do from chat:** receive notifications, and answer a `to: human` gate by replying to its prompt message. That reply-to-a-gate-prompt is the adapter's *only* inbound surface, by construction, not by a command deny-list — there is no command parser at all, so a bare `/stop`, `/respawn coder`, an unprompted message, or a reply to anything other than a currently-pending gate prompt is never honored. Anything needing a real UI — diff review, merge resolution, tile layout, or a stop/respawn control — stays desktop (or the bridge's own gate-answer-only write path, BL-240).

**Platform trade-offs (pick per context):**

| Platform | Verdict |
|---|---|
| **Telegram** | Easiest real bot API — free, instant, unprompted messages fine. Best path of least resistance. **Landed (BL-239)** — see Implementation below. |
| **Signal** | Best privacy, but no official bot API (`signal-cli`, unofficial). Workable, gray-area. Not built. |
| **WhatsApp** | Official Cloud API exists but built for business→customer: approval, per-conversation cost, 24-hour-window rules make unprompted pings awkward. Heavier than it looks. Not built. |
| **Teams** | Right choice *only* in a corporate/Teams context; first-class bots but heavyweight setup (Azure app registration). Overkill for a solo dev. Not built. |

**Implementation (Telegram, BL-239).** Entirely optional (Tier 2): a no-op unless both a bot token and an authorized chat id are configured. Setup: message [@BotFather](https://t.me/BotFather) to create a bot and get a token, then run `SwarmForge: Set Telegram Bot Token` and `SwarmForge: Set Telegram Chat Id` (masked input, stored in VS Code `SecretStorage`; `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` environment variables take precedence if set, same resolution order as the Resend key). Once both are configured, a narration sweep runs every 2 seconds (stage transitions, new gates, new dead-letters, the PR link — never re-announcing something already told to the human) and an inbound poll runs every 3 seconds (Telegram's `getUpdates` long-poll). Only messages from the one authorized chat id are ever considered, closing the door on a stranger messaging the bot. The adapter is stopped alongside the swarm and restarted whenever the target/token/chat id changes. Bounded-retry (3 attempts, capped exponential backoff) applies to sends; a permanently-failed send is logged to the "SwarmForge: Telegram" output channel rather than retried forever.

The adapter is one bridge option among the remote tier (Tier 2) — entirely optional, and the same security/threat-model gap applies (what a chat reply is authorized to trigger, how the bot authenticates the human).

**Operator front desk: per-subject Telegram topics over the bridge (BL-281).** Beyond the per-run narration thread above, the **Operator** — a role that runs outside the swarm's build pipeline as the human-facing front desk, on its own tmux session/socket — can host each discussion subject as its own Telegram **forum topic**, mapped one-to-one to a `SUP-###` thread (reusing BL-275's thread store), so parallel discussions never bleed context: a disposable Operator wake for one `SUP-###` reloads only that subject's transcript, never another topic's. The path is asynchronous, mediated entirely by the bridge — never a direct or synchronous call between Telegram and the Operator runtime:

```
Telegram  ◄──►  Front Desk Bot (bridge client)  ──POST /telegram-inbound──►  bridgeServer  ──event──►  Operator runtime  ──►  disposable Operator LLM
                        ▲                                                         │
                        └──────────────────── SSE reply relay ◄────────────────────┘
```

`extension/src/tools/telegram-front-desk-bot.ts` is a thin adapter (its pure decision logic lives in `telegramFrontDeskBotCore.ts`, testable with fixture updates and no live Telegram) that owns Telegram entirely: it filters inbound updates to the one authorized principal, demuxes each by its `message_thread_id` against its own persisted `{topic: SUP-###}` map, and `POST`s an already-resolved `{subjectId, channel, text}` to the bridge's new `POST /telegram-inbound` route — the bridge itself never sees raw Telegram specifics. That route (control-auth-gated exactly like the existing `POST /gate-answer`) appends the message to the `SUP-###` thread and enqueues a per-subject Operator event, then responds immediately without waiting for a reply — ingestion and reply are decoupled, never a synchronous RPC. The disposable Operator, woken for that `SUP-###`, loads only that subject's transcript, and its reply is appended to `.swarmforge/operator/telegram-reply-outbox.jsonl` (`operator_reply.bb`); the bridge relays each new outbox entry over its existing SSE stream, and the bot posts it back into the same topic. A principal message with no subject mapped yet **auto-opens** one (BL-294) rather than being dropped: a private DM (no `message_thread_id`) opens/reuses a single default subject, and a message on a not-yet-mapped topic opens a subject for that topic and records the mapping — either way, only one subject ever opens per context, and every later message there reuses it; a non-principal message still opens nothing. This means the front desk works over a plain DM with no group setup at all — the one-time **Topics supergroup** setup below is required only for the full per-subject-topic experience, not to start talking to it at all. **One-time human setup (not automated, only needed for per-subject topics):** create a Telegram **supergroup with Topics enabled** and add the bot as an admin with the "Manage Topics" permission — creating a forum topic requires this; a regular chat or a group without Topics enabled cannot host per-subject threads.

**Thread lifecycle (BL-276).** Each `SUP-###` thread carries a status (open / resolved / closed). The Operator **never closes a thread of its own will** — only an explicit human confirmation resolves one (`resolve-thread` in `support_lib.bb`); there is no autonomous or 3-strike close. When a thread has gone idle for a day or more, counted from the human's own last message in it (never the Operator's own replies), the Operator may post one gentle nudge into that thread's topic over the same reply path BL-281 already uses — never a second nudge until the human replies again, and any reply resets the idle clock. No email path exists for this nudge; it is Telegram-topic only.

**Proactive notify (BL-284).** The Operator can also ping a subject's topic unsolicited — with no inbound message first — when something about that subject changes, over the same reply-outbox → SSE → bot egress the idle nudge above already proves out (`operator_notify.bb`'s decision is a pure, adapter-injected function mirroring the idle-nudge decision; the runtime appends via the existing `append-to-reply-outbox!`). A notice for one subject is routed only into that subject's own topic, never another's, and a status change that doesn't actually concern the human produces no notice — the desk stays quiet rather than spamming. This slice routes only to a subject's own existing topic; a general/ops topic for subject-less swarm-wide notices, and folding BL-239's run-narration into topics, are deferred (BL-239's per-run narration thread keeps working unchanged in the meantime).

**Long-term memory (BL-282).** Beyond a subject's own per-thread transcript, the Operator keeps a separate, runtime-owned long-term memory store of durable, generalizable facts distilled from past conversations (`operator_memory_lib.bb` over `operator_memory_store.bb`, modeled on BL-275's thread-store split) — proposed by the disposable Operator, appended and deduplicated idempotently. Every wake reloads these durable facts alongside that subject's own transcript, so the Operator's replies stay contextually consistent across separate runs and restarts. The no-cross-subject-bleed guarantee (BL-281) still holds: only distilled, generalizable facts ever enter this store — a subject's raw private transcript is never written into it, so waking for one subject never surfaces another subject's conversation detail. This MVP loads every durable fact on each wake; relevance-ranked retrieval is deferred.

**Decide + Status (BL-285).** From a subject's topic, the Operator can also answer a status question or relay a gate approval, replying into that same topic over the same egress. A status question is answered from the live projection it actually concerns — `backlog.json` for ticket/backlog state, the Operator's own `status.json` for swarm liveness, the BL-265 gate view for "what's gated" — never fabricated: an answer not present in a projection is reported as unknown, not guessed. An approval goes through the existing BL-240 gate-answer write path only (no second write surface): with exactly one currently-pending gate it answers that gate and confirms in the topic; with zero pending gates it answers nothing and says there's nothing to approve; with more than one pending gate it answers nothing and asks in-topic which gate is meant — the Operator never fabricates an approval or answers a gate that isn't actually pending.

**Clarifying questions with a bounded await (BL-306).** The disposable Operator is stateless across runs — it acts once and exits — so "ask a question, then wait for the answer" splits between the LLM and the always-alive runtime: when a decision only the human can make comes up, the Operator may (distinct from its existing fire-and-forget notify/escalate) post ONE specific clarifying question into the front-desk `SUP-###` thread over the same egress as any other Operator message, and the runtime records a runtime-owned awaiting-answer state (`.swarmforge/operator/awaiting-answer.json`: the question, the thread, when asked) so it is never re-posted while pending. A human reply in that same thread is delivered to the next woken Operator as the paired answer, and the awaiting state clears. If no reply arrives within a bounded window, the runtime escalates the question exactly once ("[still needed] ...") then drops the awaiting state — never an endless re-ask, and the Operator never fabricates an answer on timeout. A pending question gates only that one decision: emergencies (agent exits, the swarm going down, a provider event) are still handled normally while a question waits. This MVP supports one pending question at a time and asks only in the `SUP-###` thread, never a `BL-###` topic.

**Coordinator handoff (BL-283) — the front desk's final slice.** When a subject's discussion becomes actionable, the Operator files an intake to the coordinator the same way any human-sourced intake arrives (`.swarmforge/operator/INTAKE-<slug>.md` referencing the `SUP-###`, plus a coordinator note) and the thread records the resulting `BL-###` link — but the Operator only *proposes*: it never specs, promotes, creates, or closes the ticket itself, and the resulting `BL-###` carries `source: SUP-###` so the two stay connected. Thereafter, whenever the linked ticket's backlog status changes, the Operator posts the new status into that subject's topic over the same BL-284 proactive-notice pipe (no second notice path) — quiet when nothing changed, and a status notice for one subject never reaches another's topic. This closes the loop the BL-274 front-desk epic was built for: Talk (BL-281) + Lifecycle (BL-276) + Memory (BL-282) + Notify (BL-284) + Decide/Status (BL-285) + Coordinator handoff (BL-283).

**Concierge: one Telegram topic per BL-### work item (BL-295/BL-296/BL-297).** Additive to the `SUP-###` subject topics above, not a replacement: a `SUP-###` thread stays for open-ended pre-ticket discussion, and separately, each `BL-###` work item now gets its own Telegram topic for its own progress updates. The swarm itself stays completely Telegram-unaware — it emits a typed, Telegram-agnostic event stream (`extension/src/events/swarmEventStream.ts`: `TaskStarted`, `NeedsApproval`, `TaskCompleted`, extensible; every event carries `{type, backlogId, payload}` and nothing Telegram-shaped, generalizing BL-239's per-role narration diff into a per-ticket one) — and a separate **Concierge** (`extension/src/concierge/topicRouter.ts`) consumes that stream and routes each event into the item's own topic: the first event for a `BL-###` with no topic yet creates one named "BL-### - \<title\>" and persists the `backlog_id → telegram_topic_id` mapping (machine-local, gitignored); every later event for that item reuses the same topic. Every send carries a topic id — a hard contract, never the main group chat — and if a topic can't be created (no Topics-enabled supergroup, or a plain DM), the event is skipped and logged rather than falling back to the main chat. This reuses the same one-time supergroup-with-Topics setup as the `SUP-###` topics above; no second setup step. A completion summary + close are a later slice.

**Fixed: a new topic opened with a bare "TaskStarted: BL-XXX" line (BL-322).** `diffTaskStarted` minted its event with an empty payload, so — since the topic title already carries the ticket title — the message body added nothing at all. Rather than add a new schema field, the summary is derived from what every ticket YAML already has on disk: title → what it is, the first paragraph of `notes` → what it solves, the first `acceptance.steps` entry → how it works (`backlogReader.ts` now reads `notes` as a known field and the first entry of the modern nested `acceptance: {steps: [...]}` schema, in both its strict and lenient-fallback parse paths). `topicRouter.ts` composes and truncates the rendered message — each field capped at 300 characters, the whole message capped at 1000, well under Telegram's real 4096-character limit — verified against a real ~40-line ticket notes block (BL-316's own) rendering at 583 characters, truncated safely. A ticket missing `notes` or `acceptance.steps` still opens cleanly, falling back to the bare title line rather than an empty or malformed message; `TaskCompleted` and `NeedsApproval` rendering are unchanged.

Inbound is symmetric (BL-298): the Front Desk Bot's inbound decision now also resolves a reply's topic against `topicRouter.ts`'s inverse `backlogForTopic` lookup — a principal's reply in a `BL-###` topic routes to the Operator as context tagged with that backlog id and touches no `SUP-###` thread at all, while a reply in a `SUP-###` subject topic keeps behaving exactly as before (appended to that subject's thread, no regression); a non-principal reply still reaches neither.

On completion (BL-299), a `TaskCompleted` event posts a completion summary naming the item into its still-open topic, then **closes** the topic (Telegram's `closeForumTopic`, net-new on `telegramClient.ts`, mirroring `createForumTopic`) — read-only, history preserved, never deleted, since deleting would destroy the summary just posted; order matters, since a closed topic can no longer receive a post. A non-completion (progress) event still just posts and leaves the topic open; a completion event for an item with no topic is a no-op (posts nothing, closes nothing).

**Runtime wiring (BL-300) — the Concierge is now live.** BL-296 through BL-299 were pure, tested-but-dark modules with no live caller; BL-300 turns them on. The Front Desk Bot process (`telegram-front-desk-bot.ts`, which already runs the inbound long-poll and the bridge-SSE reply relay under one `Promise.all`) gains a third, outbound tick loop: on a configurable interval it builds a live snapshot, runs it through `deriveSwarmEvents` → `routeEvent` per derived event (looking up each item's title from the same snapshot), and persists the `backlogId → topicId` mapping to `.swarmforge/operator/backlog-topic-map.json` via a new writer (`recordTopicId`) — the missing piece that also unblocks BL-298's inbound BL-### reply routing, which reads that same file. Dedup is now durable, not just in-memory: the prior snapshot and already-emitted event set persist under `.swarmforge/operator/`, so an event routed before a restart is never routed again after one.

`TaskStarted`/`TaskCompleted` come from backlog folders alone (BL-300); `NeedsApproval` (BL-301) extends the same tick's snapshot with live tmux-pane gate state (`computeRoleGateStatesLive`, gracefully all-not-gated when no tmux socket exists) and an inverted role→ticket map (each role's currently-held ticket, from its open holding window), so a role newly awaiting a human decision posts into the `BL-###` topic of whatever it's currently holding — a gated role holding nothing is dropped, never mis-routed to the wrong ticket. A failed send holds that role's gate transition back in the persisted snapshot rather than dropping it, so the next tick retries rather than permanently losing the notice (the same retry symmetry BL-300 already applies to `TaskStarted`/`TaskCompleted`). This completes the BL-295 Concierge epic's full event set.

**Fixed: the human-in-the-loop was decorative in a `BL-###` topic (BL-325).** A real failure: a `NeedsApproval` notice landed, the human asked "what do I need to approve?", got no answer, and the ticket completed anyway — unblocked by an external Operator working blind, not by the human's reply. Three independent gaps, all shipped together as one loop (fixing any one alone would have left it open): (1) the gate's question snippet was captured by `computeRoleGateStatesLive` but discarded by `readGates` before it ever reached the Telegram message — the human saw only a ticket id, never what was being asked; the snippet now survives the whole path (`readGates` → `GateSignal` → `diffNeedsApproval` → `messageTextForEvent`) into the actual notice. (2) A reply typed into a `BL-###` topic was already resolving correctly (`backlogForTopic` → `TELEGRAM_BL_TOPIC_MESSAGE`) but the event had exactly one producer and zero consumers — recorded, never read. `operator_runtime.bb`'s new `bl-topic-approval-sweep!` now consumes it every tick, shelling straight into BL-285's existing `operator-decide.js approve` relay (reused, not duplicated) *before* that tick's pending-count is even read, so the answer reaches the gated pane in the same tick it arrives, never deferred behind an LLM Operator launch. (3) The reply/notify egress accepted only a `SUP-###` thread target, so even the Operator had no supported way to post into a `BL-###` topic; `resolveReplyTopicId` now falls back to the backlog→topic map so a reply keyed by `backlogId` routes into that item's own topic, while `SUP-###` resolution keeps its exact prior priority and behavior unchanged. **Bounce fix:** the first build reused BL-285's original count-based gate selector (0/1/2+ pending → nothing/answer/ask-which) for in-topic replies too — safe (never answers the wrong gate) but degraded exactly when it mattered: with two or more gates pending anywhere in the roster, a reply typed into ticket A's own topic got "which gate do you mean?" instead of directly answering A's, since the selector discarded the topic's own `backlogId` and just counted. `selectGateDecisionForTicket` (`operatorDecideStatus.ts`) now resolves the gate via that `backlogId` through the same role→ticket mapping BL-301's outbound routing already uses, applied in reverse — falling back to the original count-based selector only when the reply's thread doesn't resolve to a currently-gated role (a `SUP-###` thread, which never carries a `backlogId`, or a ticket with no pending gate of its own), so `SUP-###` behavior is completely unchanged.

**A `BL-###` topic's content is now serialised into the repo — the topic becomes a disposable projection, not the source of truth (BL-329).** Before this, a `BL-###` topic's messages existed only inside Telegram: the swarm's own outbound messages (task-started, needs-approval, completion) were never recorded anywhere, and the human's inbound messages landed only in `.swarmforge/operator/events.jsonl` — gitignored local runtime state, not a per-topic record. Deleting a topic destroyed its content outright. `extension/src/concierge/blTopicStore.ts` now keeps a durable, ordered, per-ticket record at `backlog/topics/<ticketId>.json`: `{seq, ts, author, type: 'inbound'|'outbound', text}` per message, mirroring `support_thread_store.bb`'s own shape rather than inventing a second mechanism. `appendMessage` writes atomically (tmp+rename, via the existing `atomicWrite`) and then git-commits just that one file (`commitTopicRecord`, built on the new shared `gitCommitScopedFile.ts#commitScopedFile` also used by the cost-health sidecar) — scoped so no other in-flight uncommitted work in the worktree is swept in, and fail-open so a commit error (including "nothing to commit") never blocks the write itself. `telegram-front-desk-bot.ts` calls `appendMessage` on every inbound human message and every outbound swarm send into a `BL-###` topic, so the record grows live. Past history is not abandoned: `extension/src/tools/backfill-bl-topic-store.ts` (run as `node backfill-bl-topic-store.js <project-root>`) replays `events.jsonl`'s `TELEGRAM_BL_TOPIC_MESSAGE` records into each ticket's store. Recreating a topic from its record (BL-332) and safe deletion (BL-331) build on this but are not yet built.

**Running headless (BL-292).** All six slices above were built, but nothing actually ran them outside a manually-started VS Code host — `startBridge` (`bridgeServer.ts`) was only invoked by the `swarmforge.startBridge` command, and the Front Desk Bot poller had no launcher at all, so the human's exported Telegram credentials reached nothing. A supervised headless launcher (`swarmforge/scripts/launch_front_desk.sh` + `front_desk_supervisor.bb`, mirroring `handoffd_supervisor.bb`'s bounded-restart-with-backoff and `launch_operator.sh`'s idempotent pid-guard) now brings up both: a thin CLI entrypoint (`extension/src/tools/start-bridge-headless.ts`) starts the bridge headless on a fixed port with a provisioned control token, and the Front Desk Bot is launched against it with the same token — the bridge comes up first, since the bot authenticates against it. No tunnel is needed for the front desk itself: the bot polls Telegram outbound and talks to the bridge over localhost; the front desk is now fully headless-capable. (Making the holistic UI itself reachable from a phone still needs an external tunnel — a separate, not-yet-built follow-on; this launcher serves the holistic UI headless only as a byproduct.)

**Reply egress is at-least-once, not at-most-once (BL-320).** The SSE reply relay in the diagram above (`bridgeServer.ts`'s `relayNewReplyOutboxEntries`) previously advanced its cursor the moment an outbox entry was *written* to the SSE socket, not when the bot actually received it — a dropped connection mid-relay (the real, observed undici `"terminated"` failure, same class as BL-302's inbound-poll crash) silently ate the reply, and the cursor lived only in memory, so a bridge restart forgot everything already relayed. This is the human's primary channel to the swarm when everything else is parked, so a silently dropped reply looked exactly like "the swarm ignored me" — the failure the whole front-desk epic (BL-274) exists to eliminate. The cursor is now ack-driven and persisted (`replyRelayCursor.ts`, `.swarmforge/operator/telegram-reply-relay-cursor.json`): `operator_reply.bb` stamps each outbox line with a UUID id, the bridge exposes `POST /reply-ack`, and `ackedIndex` only advances when the ack matches the entry actually sitting at the cursor — a stale or out-of-order ack leaves it unchanged rather than corrupting it forward. Every `/events` connection (fresh or reconnected) replays every still-unacked entry against a fresh read of the persisted cursor, so a bridge restart resumes from genuinely-delivered position; the bot tracks `seenId`s across its own reconnects so a redelivered-but-already-sent entry is re-acked, never re-posted to Telegram. `telegram-front-desk-bot.ts`'s `subscribeReplies` now wraps the SSE connection in its own retry-forever, capped-backoff reconnect loop (reusing BL-302's backoff helpers) so a dropped socket or failed ack triggers a real replay, not just the outer whole-process restart net.

**A restricted front-desk Operator answers the human even mid-attended-session (BL-334, fixes BL-333's alarm).** The single-Operator guard (`operator-running?`, keyed on one tmux session) was built to stop two Operators taking conflicting actions on the swarm — but an attended (interactive) Operator, told never to exit while the human is mid-conversation, permanently holds that one slot, so no disposable Operator was ever spawned to read the front desk: inbound Telegram messages queued unread for as long as the attended session ran (two days, once). The fix admits a SECOND Operator (`should-launch-front-desk-operator?`) that exists only to serve the front desk, eligible exactly when the full Operator is running (mutually exclusive with the full Operator's own launch decision by construction, both reading the same `full-operator-running?` fact within one tick) and gated by its own liveness guard (`front-desk-operator-running?`, its own tmux socket/pid file — never the full Operator's) so it never double-launches while one run is still in flight. It claims only `TELEGRAM_TOPIC_MESSAGE` events, into its own inflight file, never the events the full Operator has authority over, and both Operators' liveness is reported in one atomic `status.json` write (the front-desk Operator's state nested under `:front_desk`) so neither can overwrite the other's report. The restriction is structural, not a prompt instruction: the front-desk Operator launches headless as `claude -p --tools ""` — every tool removed from the session, no `--dangerously-skip-permissions`, no `--remote-control` — with all context it could need inlined into one self-contained one-shot prompt, and only its captured text completion (never a tool call it makes itself) reaches the trusted runtime, which alone performs the actual reply-outbox/thread-transcript write. This does not change attended mode's longevity — the human's interactive session is not cut short to serve the front desk — and BL-333's own front-desk-starvation alarm (an internal `status.json` signal, not user-facing) stays in place as the safety net for whatever this misses.

**A standing Operator topic — one always-there front door to the restricted Operator (BL-346).** The human's own request during a 2026-07-13 swarm-recovery incident: a persistent, pinned Telegram topic that IS the Operator's home, so he never has to hunt for the right `SUP-###` thread or wait for one to exist. `decideEnsureOperatorTopicAction` (`extension/src/tools/telegramFrontDeskBotCore.ts`) is the reserved-subject twin of the existing BL-topic router's `decideTopicAction`: reuse the topic already bound to a stable, reserved `OPERATOR_SUBJECT_ID` constant, or `create` if no binding exists yet. `ensureOperatorTopic` (`telegram-front-desk-bot.ts`) calls the existing `createForumTopic` once if that binding is absent and writes it into the same `telegram-topic-map.json` the `SUP-###` routing already reads — called once in `main()`, **before** any of the bot's polling loops start, so no inbound message can ever reach the loop before the binding exists. This closes the auto-adopt trap the ticket exists to prevent: without a pre-bound reservation, the first message into a freshly-created "Operator" topic would silently be adopted as just another disposable `SUP-N` issue thread by the existing `open-for-topic` branch, exactly as happened to three earlier hand-made topics. A message in the reserved topic reaches the restricted, `--tools ""` front-desk Operator (BL-334's boundary, completely untouched — this ticket's diff touches zero `.bb` files) as a standing conversation, reusing BL-281's transcript + long-term-memory prompt seam unchanged; the reply lands back in the same topic via the existing reply-outbox → SSE → `resolveReplyTopicId` egress. A failed topic create degrades quietly (logged, never thrown) and never blocks ordinary `SUP-###`/`BL-###` routing; the next restart retries, since the map still lacks the binding. Out of scope, deliberately: detecting that a *recorded* topic id was deleted in Telegram (no send-failure detector for that exists yet — the same missing machinery BL-332's recreate-topic-from-record will need) and mirroring `operator.log` activity into the topic (the human confirmed conversation-only scope).

**The starvation alarm now arms on delivery, not on attempt (BL-345).** BL-333's alarm previously persisted `:armed?` — and so suppressed every further alarm for the whole starvation episode — *before* the alarm email was even sent, discarding `send-configured-email!`'s own success/failure result; a transient send failure at the exact tick starvation crossed the threshold silently swallowed the alarm for days (the second occurrence of this defect class in this library, after BL-215). `operator_lib.bb` replaces the old attempt-based decision with three pure functions: `classify-delivery-result` (delivered / terminal-misconfig / transient-failure, folding a test fixture's forced result into terminal so it is never mistaken for a real failure), `starvation-alarm-should-attempt?` (gates each tick on armed?/starving?/backoff-due), and `next-starvation-alarm-state` (arms on delivered or terminal-misconfig, retries a transient failure with a bounded, backed-off attempt count, and arms *and* logs loudly once the cap is reached). `operator_runtime.bb`'s `starvation-alarm-sweep!` now actually consults the send's result through those functions, configurable via `OPERATOR_ALARM_MAX_ATTEMPTS` (default 5), `OPERATOR_ALARM_BACKOFF_BASE_MS` (default 60000) and `OPERATOR_ALARM_BACKOFF_MAX_MS` (default 1800000). On exhausting the retry cap the escalation channel *is* the broken email, so the loud log line and `status.json` are the only remaining signals — accepted rather than worked around with a second notifier. A misconfigured channel (no recipient, no API key) is warned about once and never retried, since retrying a misconfiguration can never succeed.

**A closed ticket can still be invisible to the human — verify against his real surface, not a test (BL-335).** Three tickets (BL-260, BL-252/BL-290, BL-286) were done, merged and closed, yet the human reported each feature missing after the fix that was supposed to deliver it. Investigating each against the surface he actually looks at (the real briefing email, the real deployed PWA — never a local render or a passing test) found all three were **stale-build complaints**: the daemon process serving him had been running pre-fix compiled code, not that the fixes were broken or unwired. Two were email-side (the daemon's own `RESEND_API_KEY` was absent for its entire history until a `2026-07-11T11:13:43Z` restart, so several already-merged fixes hadn't reached a live send yet); the PWA half of the diagram request was neither stale nor broken — it was **never in scope** (BL-260 shipped the email side only) and is raised as a separate feature request rather than silently built or dropped here. While verifying, this surfaced a live, reproducible gap in BL-328's own build-freshness tool: `build_freshness_cli.bb`'s `run-sync!` only triggered `recompile-extension!` when the **`:front-desk`** group (bridge/bot) was stale, but `handoffd.bb` and `operator_runtime.bb` themselves shell out to compiled `extension/out/tools/*.js` CLIs (`render-briefing-diagrams.js`, `suite-duration-line.js`, `emit-cost-health-sidecar.js`, `operator-decide.js`, and others) — so a `:handoffd`- or `:operator`-only staleness left the shared `extension/out/` directory stale forever, since those groups' restarts (`restart-handoffd-group!`/`restart-operator-group!`) only respawn the Babashka process and never recompile. `node-stale?` now triggers a recompile on **any** staleness, not just `:front-desk` — cheap when unneeded, and the only way to never silently miss a case again.

---

## Gaps & Things Still Missing

A scan of what the spec doesn't yet cover, roughly in priority order. Not all are v1, but each is a real decision waiting to be made. (Several earlier gaps — untracked human input, completion-measurement point, reroute livelock, item-completion loop, workflow field-ownership, salvage/rollback, and the `to: human` gate mechanism — are now addressed in the body and removed from this list.)

### Likely needed for a usable v1

- **Secrets & auth.** Backends that manage their own auth (Copilot CLI, Claude Code) need nothing from the extension — it never sees those credentials. The open question is narrower: backends that need raw API keys, plus the GitHub token for pushing branches / opening PRs. Where do those live and how are they kept out of the clone and out of commits? (Likely: extension-host environment, never written into the worktree.)
- **Cost & rate-limit controls.** Multiple agents on paid models running for hours. Need per-run token/cost tracking, a budget cap that pauses the swarm, and backoff handling when a backend rate-limits. Surfaced per-tile and as a run total. (The reroute budget and `to: human` escalation in Correctness are the per-item backstop; this is the per-run/$ backstop.)
- **`to: human` gate UX.** The mechanism is specced (a message type, surfaced on desktop + mobile, blocks the item). What's left is the interaction detail: how a gate is presented, how options are offered, timeout behavior if the human never answers, and whether a gate can be delegated/snoozed.

### Important but can follow

- **Remote-access security (BL-241 landed: rotation, revocation, read-vs-control scope + step-up).** The bridge's auth layer is now a persisted device registry (`extension/src/bridge/deviceRegistry.ts` + `deviceRegistryStore.ts`, stored in VS Code `SecretStorage` only — never the target repo or a commit), replacing the original single static bearer token. Per device: a base token grants read access (rotatable — the old token stops working, the new one doesn't, other devices are unaffected) and revocation removes just that device's access. Control actions (currently just BL-240's gate-answer route) require a genuine step-up: a control-scoped device carries a *separate* control token and must present it via an `X-Control-Token` header alongside its bearer token; a read-scoped device has no control token and can never satisfy this. Not yet built: the bootstrap "Start Bridge" command still mints one bootstrap token that satisfies control by presenting itself twice, rather than provisioning distinct devices per client — per-device registration/rotation/revocation exists as a host-side module surface (`BridgeHandle`'s `registerDevice`/`revokeDevice`/`rotateToken`/`getRegistry`) but has no dedicated command/UI yet. Off-LAN relay choice (self-hosted vs hosted) remains an open decision with privacy implications, since agent output could traverse it — unresolved by this hardening pass.
- **Observability / run artifacts.** A durable run log, transcript export, and the ability to inspect a finished run after the fact (what each agent did, decisions made). Useful for debugging a bad PR.
- **Test/lint command discovery.** Completion tracking assumes the extension can run the target's tests *on the dev branch*. How does it learn the test command — from `engineering.prompt`, auto-detected, or configured? Same for lint.
- **Multiple concurrent backlog items.** The next-item loop (see Correctness) defaults to one item at a time. Whether the swarm can work several in parallel (more worktrees, parallel dev branches) is a later question affecting branch/PR strategy.
- **Backlog item dependencies.** Eligibility now respects dependencies (see Correctness), but the *authoring* of dependencies and their visualization in the Work Tree (blocked badges, ordering) still needs detail.
- **Constitution / prompt versioning.** Partly addressed by the Governance model (rule changes are attributable commits, so a PR traces to the governance text in force). Remaining: pinning the exact prompt/constitution commit-hash *per run* in the run log, and deciding whether mid-run governance changes apply immediately (on respawn) or are staged to the next item boundary for consistency across agents in a run.

### Smaller / polish

- **Desktop/VS Code notifications.** Integrated notifications when a run finishes, a PR is ready, or an agent dead-letters — so the human isn't babysitting the panel. (Email notifications for needs-human events are now implemented; mobile push covered by the phone app.)
- **Onboarding for a fresh target.** First-run experience: `Initialize Target` exists, but a guided "this repo has no swarm files, set it up?" flow would help.
- **Diff review inside the extension.** Reviewing the PR without leaving VS Code.
- **Accessibility (BL-238 pass landed).** Tile headers, work-tree rows, collapse toggles, and the recert PWA controls are now keyboard-operable (`tabindex`, `role="button"`, Enter/Space handlers, visible `:focus-visible` rings) and screen-reader-labelled (`aria-label`/`aria-expanded` on tiles, dropdowns, buttons, and tree rows; `role="log"` on the live output pane, deliberately without `aria-live` since a continuously-streaming transcript would announce every update). Liveness/completion status now also carries a text badge (Dead/Needs human/Stalled/Working) alongside its existing color cue, so it is never color-only. Additive only — no behavior changed. Remaining: this pass covers the existing markup/controls at the time it landed; any new interactive control added later needs the same treatment, and a full assistive-technology walkthrough (vs. the markup/DOM-level checks QA ran) is still open.
- **Telemetry (opt-in).** Anonymous metrics on swarm effectiveness — items completed, chase rates, respawn frequency — to tune heuristics.

---

## Out of Scope (v1)

- The swarm writing back to its own tool library autonomously (tool promotion is manual/human-curated in v1)
- Multi-target support in a single run
- Auto-merge on green CI (human reviews all PRs)
- Extension marketplace publication (internal use first)
- Native Windows (tmux has no native Windows port; a Windows-hosted swarm runs via WSL2 instead — BL-091)
