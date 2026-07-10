# SwarmForge VS Code Extension — Milestone Roadmap

**Last Updated:** July 2, 2026

A phased plan from a true MVP to the full spec. The guiding principle: **each milestone is independently useful and shippable** — you could stop after any one and have something worth running. Later milestones add reach, reliability, and intelligence, but the core value (drive a disciplined swarm from VS Code, get a reviewable PR) lands in the MVP.

The slicing follows the spec's own seams: the filesystem is the source of truth, the swarm runs as orchestrator-spawned agent processes (the extension is a **standalone orchestrator**, not a driver of SwarmForge or tmux), and everything else is a projection or a control surface over that. So the MVP is "a good window onto a swarm the extension itself runs," and each later milestone is an additive layer that doesn't re-architect what came before.

---

## Guiding cuts

Three decisions shape the whole roadmap:

1. **Substrate before UI before automate.** The riskiest, load-bearing part is the substrate — spawning agents, wiring their streams, worktrees, and the filesystem message bus. Prove that **headlessly** first (a CLI program, no VS Code), then put tiles over a substrate you already trust, then layer reliability and autonomous optimization on last. This front-loads the real risk and back-loads the polish. (See the bootstrap brief's two-checkpoint structure: headless swarm → tiles.)
2. **Desktop-only until the core is proven.** No daemon, no remote, no chat until the single-machine experience is solid — the spec already shows the filesystem gives "survives the editor" for free, so remote is genuinely deferrable.
3. **Own the orchestrator, keep it thin.** The extension spawns and manages agent processes itself (standalone — no SwarmForge, no tmux). But the orchestrator does process management *only*; pipeline sequencing, merge, routing, and convergence live in the coordinator role and the message bus, never in the process manager.

---

## M0 — Walking Skeleton (pre-MVP, internal)

**Goal:** prove the riskiest part — that the orchestrator can actually run a swarm — with the thinnest possible slice, and prove it **headlessly** before any UI exists. Not shipped; it's the spike that de-risks everything. This milestone maps directly to **Checkpoint A** in the bootstrap brief.

The inversion from the old plan: the risk was never "can VS Code render a tile" — webviews are well-trodden. The risk is the substrate: spawning agents, owning their streams, worktree choreography, and passing a real handoff over the filesystem. So M0 builds and proves all of that as a plain Node/TypeScript program you run from a terminal — no extension host, no webview, no F5 — in a tight, fast test loop.

### Setup: standalone orchestrator, no fork, no tmux

The extension is a **standalone orchestrator** (see the spec's "Relationship to SwarmForge"). It does not fetch, vendor, shell out to, or depend on SwarmForge or tmux. Reproducibility comes from this extension's own versioned code, not from pinning an upstream SHA. M0 establishes the substrate concretely:

1. **Stand up a throwaway target** — a tiny repo with `project.prompt` + `engineering.prompt`, so the orchestrator is driving a real (if trivial) swarm against a real working tree.
2. **Drive everything from a CLI** — a single `node` entry point launches the swarm; you watch it in stdout and on disk.

### Substrate surface to validate (the actual de-risking)

Tick each — these are the seams the whole spec depends on. Built and proven from a terminal, in order:

- [ ] **`InteractiveProcess` seam** — the one abstraction everything rests on: `onData`, `onExit`, `write`, `kill`. Nothing above the substrate talks to a concrete backend, only to this.
- [ ] **Shell backend** — a `child_process.spawn` pipe-backed `InteractiveProcess`; spawn a trivial process, stream its output through `onData`, send input through `write`. The substrate's "hello world."
- [ ] **Worktree setup** — create one git worktree per role under `.worktrees/`, each on its own branch; list and tear down cleanly.
- [ ] **Filesystem message bus** — read/write handoff messages as files under `.swarmforge/messages/`, atomic write via temp-file + `rename`. A message written by one process is readable by another. (This is the *primitive* — file read/write + rename — not routing logic, which stays out of scope.)
- [ ] **Two-agent handoff, headless** — wire two backend processes in two worktrees and pass one real handoff between them through the bus: A writes to B's inbox, B picks it up (prompt-polling is fine), B acts and writes back.
- [ ] **Language-model backend** — `LanguageModelRoleRuntime`: a self-built agent loop over `vscode.lm.selectChatModels({ vendor: 'copilot' })`, streaming through the same `onData`, exposing worktree-scoped tools (`read_file`, `write_file`, `list_dir`, `run_command`) with a 100-tool-call-per-turn cap. (`vscode.lm` needs an extension-host handle, so this is the one piece exercised via a thin host harness; its loop logic is unit-tested in isolation so the rest of the substrate stays CLI-provable.)
- [ ] **Lifecycle signals** — detect swarm start, an agent finishing, and exit from observable on-disk state.

**Exit:** from a terminal with no VS Code open, one command spawns two agents in their own worktrees, one hands a real parcel to the other through the message bus, the receiver acts on it, and you see the whole exchange in stdout and on disk. You now have a **trustworthy substrate** — and the tiles in M1 are a thin view over it, not the place you discover the substrate is broken.

---

## M1 — MVP: The Observable Swarm 🎯

**Goal:** the smallest thing a developer would actually use daily. Drive a real swarm against a target, watch all agents, get a PR at the end. Mostly observation + the essential controls. This milestone maps to **Checkpoint B** (tiles on top) plus the run/PR loop — it puts a UI over the M0 orchestrator and adds the work-delivery path.

**In:**
- **Target selection** — point at a local repo (path); `Initialize Target` scaffolds + commits `project.prompt` and `engineering.prompt`
- **Tiled panel** — one live, interactive terminal tile per agent role (the core UI), one tile per orchestrator-spawned process; click in and type to any agent
- **Run / Stop** — launch the swarm (fixed pack, e.g. the 7-pack or whatever branch the user configures), stop it
- **Pipeline awareness** — show which stage holds the parcel, read from the message store
- **PR at the end** — when the swarm converges, open a PR from the dev branch into the target's main; human reviews in GitHub
- **Named runs** — branch + PR named after the work item; a local run log

**Explicitly out (deferred, and fine to defer):**
- No dynamic right-sizing (run the whole configured pack every time)
- No watchdog/heartbeat/chase yet — rely on the human watching tiles (the orchestrator just keeps processes alive; no automated recovery yet)
- No cost logic, no work tree %, no backlog sync, no remote/chat
- No per-tile respawn/model-switch yet

**Why this is the right MVP:** it delivers the headline promise — *run a disciplined multi-agent swarm against any project from VS Code and get a reviewable PR* — with the interactive tiles that are the product's face. Everything cut is an enhancement, not a prerequisite. A developer can be productive with exactly this.

**Exit:** a developer selects a repo, runs the swarm, watches and occasionally nudges agents, and merges the resulting PR — without leaving VS Code.

---

## M2 — Reliability Layer

**Goal:** stop relying on the human to babysit tiles. Make the swarm survive its own failure modes.

- **Hardened inter-agent comms** — append-only event log, atomic writes, stable ids, sequence numbers, work-in-progress lease
- **Heartbeat (tool-call decorated)** + **watchdog** in the extension host — tiles go amber/red on stall
- **Chase** for sleeping agents, **dead-letter** escalation, **heartbeat-gated chasing**
- **Per-agent lifecycle** — respawn a single agent; auto-pickup of pending messages on (re)spawn (with lease check)
- **Tracked human input** — typing into a tile is mirrored into the message store

**Why here:** the MVP works when things go right; M2 is what makes it trustworthy when an agent falls asleep or crashes — the difference between a demo and a tool. It's also a prerequisite for any unattended or remote operation later.

**Exit:** you can leave a run unattended for a while; stalls are visibly flagged and recoverable without restarting the swarm.

---

## M3 — Traceability & Right-Sizing

**Goal:** see *what's actually done*, and stop wasting agents on trivial items.

- **Work Tree** — backlog → feature → scenario → work unit, with rolled-up completion measured on the dev branch post-convergence; provisional vs. solid states; coloured-circle rendering (bucketed first)
- **Traceability tags** — `# Backlog:`, `@scn-…`, commit references; click-through to source and to the responsible tile
- **Dynamic workflow** — dormant roles, per-item active pack (pinned or coordinator-inferred), rebase-on-wake so dormant branches don't go stale
- **Reroute** — point-to-point detours with budget + cycle detection → `to: human` gate on livelock
- **Item completion & next-item loop** — item-complete criteria; one-shot vs. drain-backlog run modes; dependency-aware eligibility

**Why here:** needs the reliable comms/heartbeat from M2 (completion %, reroute tracking, and dormancy all read from that layer). This is where the tool starts to feel *intelligent* about the work rather than just executing it.

**Exit:** the swarm can chew a backlog item-by-item, you can watch true completion roll up, and small items run lean.

---

## M4 — Governance & Backlog Sync

**Goal:** close the loop so the system improves and the backlog stays honest.

- **Backlog sync (two-way)** — field-level ownership (incl. the split `workflow_pin` / `workflow_resolved`), field-scoped merge, changes ride the PR branch
- **Governance** — emergent `rule-proposal` messages to the specifier; specifier as sole writer of constitution/prompts; forge-vs-target rule placement (cross-project learning); audit trail
- **Failure & salvage** — redo-from-stage, per-stage checkpoints, clean abandon, capture rejection reason as a rule-proposal

**Why here:** governance and salvage depend on the pipeline, reroute, and backlog machinery from M3 being in place. This milestone is what makes the forge get *better over time* rather than just repeating.

**Exit:** rules earned on one project improve future swarms; the backlog reflects reality both ways; failed runs are salvageable.

---

## M5 — Cost Intelligence & Backend Flexibility

**Goal:** spend less per delivered item, and run any agent.

- **Backend abstraction** — formalize the `InteractiveProcess` launch contract; per-tile **backend/model switch on the fly**; mixed backends per role. The in-process `vscode.lm` backend already exists from M0; this milestone adds **external CLI backends** (Claude Code, Codex, Copilot CLI — the latter offering multi-model behind one auth) as alternative `InteractiveProcess` implementations, and generalizes model selection beyond the bootstrap's single `copilot` vendor.
- **Load measurement** — per-role active time, time-in-stage, rework load, surfaced in the Work Tree
- **Cost-aware selection** — Suggest tier first (per-role recommendations + rationale), then opt-in Adapt; per-run budget cap as the backstop
- **Effort dial** where backends expose it

**Why here:** cost intelligence is built on the load signals (M2 heartbeats + M3 reroute/rework data), so it can only be as good as those layers. Deliberately late because it's an optimization, not a foundation — and the "just don't run everything on the top model" default captures most savings cheaply even before the smart logic.

**Exit:** the extension recommends a sensible per-role backend mix and won't blow a budget.

---

## M6 — Remote & Chat (Optional Bridge)

**Goal:** monitor and unblock the swarm from anywhere.

- **Tier-2 bridge** — projects the same on-disk state over an authenticated tunnel; read projection + small control surface; holds no authoritative state
- **Phone app or chat adapter** — glanceable status, push notifications, **answer `to: human` gates remotely** (the headline remote feature), simple controls
- **Chat adapter** (Telegram easiest; Signal/WhatsApp/Teams per context) — human channel only, per-run thread as activity feed; agents never coordinate through it
- **Remote security** — threat model: token rotation, read-only vs. control scope, device revocation, stronger auth for control actions

**Why last:** it's the only piece that genuinely needs new networked infrastructure, and the spec shows it's cleanly deferrable (the filesystem already decouples the swarm from the UI). Everything it exposes already exists as state by M5; the bridge is a projection, not a re-architecture. Answering gates from your phone is the standout payoff and a natural capstone.

**Exit:** you can be away from the desk, get pinged when the swarm needs you, and unblock it from your phone.

---

## Cross-cutting (every milestone)

These don't get their own milestone; they're applied continuously:

- **macOS/Linux only** — tmux (SwarmForge's process substrate) has no native Windows implementation; a Windows-hosted swarm runs via WSL2 (a real Linux userland), never natively (BL-091)
- **Secrets handling** — keep tokens/keys in the extension host, never in the worktree or commits (lightweight from M1, formalized as backends multiply in M5)
- **Accessibility** — completion never color-only; keyboard nav; screen-reader labels
- **Observability** — durable run log and transcript export, growing as features land

---

## Self-Hosting / Dogfood Path

The north star: **the extension builds itself.** Because the extension *is* the tool for driving a swarm, this is a bootstrap relay with a clear handoff point, not a paradox.

### Phase 0 — bootstrapping the substrate (no swarm yet)

There is no extension and no swarm to drive it, so the first slice — the M0 headless substrate — is built by hand or by a **single capable agent** in a tight loop, not by a pack. This is deliberate: until the orchestrator and message bus exist, there is no pipeline to coordinate, and the work (cohesive backend TypeScript) doesn't benefit from handoffs. One agent building a CLI-testable substrate is leaner and avoids coordination machinery that isn't plumbed yet.

- **What gets built:** the M0 / Checkpoint-A substrate — `InteractiveProcess` seam, shell backend, worktree setup, filesystem message bus, two-agent handoff, the `vscode.lm` runtime — all provable from a terminal.
- **You watch progress in the terminal and on disk** — there are no tiles yet, and nothing to show them with. That's the point of proving the substrate headlessly: the test loop is `node`, not F5.
- **The extension repo is the eventual target,** but during Phase 0 you're mostly writing the orchestrator directly; the swarm-builds-itself loop doesn't start until tiles exist.

### The dogfood handoff (at tiles, not before)

The moment M1 can (a) run the swarm over the M0 orchestrator and (b) render live tiles, point it at **its own repo** and switch from watching in the terminal to watching in your own tiles. This is M1's exit criterion applied reflexively — and it's the milestone that matters most for momentum.

From this point on, **every further feature is the extension building itself.** M2 reliability, M3 work tree, and beyond are all dogfooded: you feel each missing capability because you're running real swarm work on the half-built tool. That's the best possible pressure-test — the tool's gaps become your lived pain, prioritized automatically. This is also where a real role pack starts to earn its keep, since now there's a pipeline to coordinate.

### A subtlety: forge and target temporarily collapse

During bootstrap the extension repo is *both* the forge (it holds the extension code + generic prompts) *and* the target the swarm operates on. That momentarily collapses the forge/target separation the spec is careful about. This is fine for bootstrapping, but keep it conscious so it doesn't leak into the design: once the extension is stable you point it at *other* targets and the separation reasserts. Don't bake the "repo is its own target" assumption into anything structural.

### Sequence summary

| Stage | Who builds | You watch in | Builds |
|---|---|---|---|
| Phase 0 | single agent / by hand | terminal + disk | M0 (headless substrate) |
| M1 build | single agent / by hand | terminal, then tiles | M1 (tiles + run/PR) |
| **Handoff** | — | — | *M1 complete: switch to self-hosting* |
| M2 onward | the extension, on itself (real pack) | its own tiles | M2 → M6 |

---

## At a glance

| Milestone | Theme | Headline capability | Depends on |
|---|---|---|---|
| **M0** | Walking skeleton | Run a headless two-agent swarm from a CLI | — |
| **M1 (MVP)** | Observable swarm | Run a swarm, watch all agents, get a PR | M0 |
| **M2** | Reliability | Survives stalls/crashes unattended | M1 |
| **M3** | Traceability & right-sizing | True completion %, lean small items, backlog loop | M2 |
| **M4** | Governance & sync | Self-improving rules, honest backlog, salvage | M3 |
| **M5** | Cost & backends | Per-role backend mix, budget-aware | M2, M3 |
| **M6** | Remote & chat | Unblock from your phone | M5 |

**If you build nothing past M1, you still have a useful product.** Everything after is reach, trust, and economy — in that order.
