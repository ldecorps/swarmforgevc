# SwarmForge VS Code Extension — Milestone Roadmap

A phased plan from a true MVP to the full spec. The guiding principle: **each milestone is independently useful and shippable** — you could stop after any one and have something worth running. Later milestones add reach, reliability, and intelligence, but the core value (drive a disciplined swarm from VS Code, get a reviewable PR) lands in the MVP.

The slicing follows the spec's own seams: the filesystem is the source of truth, the swarm runs in tmux, and everything else is a projection or a control surface over that. So the MVP is "a good window onto what SwarmForge already does," and each later milestone is an additive layer that doesn't re-architect what came before.

---

## Guiding cuts

Three decisions shape the whole roadmap:

1. **Read before write before automate.** Early milestones mostly *observe* (read `.swarmforge/` state, tail tmux). Control comes next. Autonomous optimization comes last. This front-loads value and back-loads risk.
2. **Desktop-only until the core is proven.** No daemon, no remote, no chat until the single-machine experience is solid — the spec already shows the filesystem gives "survives the editor" for free, so remote is genuinely deferrable.
3. **Lean on SwarmForge, don't reinvent it.** The MVP launches and reads Uncle Bob's existing swarm; the extension's own additions (hardened comms, watchdog, work tree) layer on only where they earn their place.

---

## M0 — Walking Skeleton (pre-MVP, internal)

**Goal:** prove the riskiest integration end to end with the thinnest possible slice. Not shipped; it's the spike that de-risks everything.

- Launch a SwarmForge swarm (existing `./swarm`) against a target from a VS Code command
- Open **one** webview tile that tails **one** agent's tmux pane (read-only)
- Confirm the extension can read `.swarmforge/` state files and attach to tmux panes reliably across OSes

**Why first:** the entire architecture rests on "VS Code can observe and attach to tmux + read swarm state." If that's fragile, everything else is built on sand. Find out now, in days, not after building UI.

### Setup: integrate, don't fork

SwarmForge is a **pinned, unmodified dependency** (see the spec's "Relationship to SwarmForge"). M0 establishes that relationship concretely:

1. **Pin a version.** Fetch a runnable branch the way SwarmForge's own docs prescribe (e.g. `BRANCH=six-pack curl -L .../${BRANCH}.tar.gz | tar -xz`), and record the exact version/commit. Do **not** commit SwarmForge's source into the extension repo — vendor it at a known path or fetch at setup.
2. **Stand up a throwaway target** — a tiny repo with `project.prompt` + `engineering.prompt`, so you're driving a real (if trivial) swarm.
3. **Launch from VS Code** — shell out to `./swarm` and confirm the tmux sessions come up.

### Integration surface to validate (the actual de-risking)

Tick each — these are the seams the whole spec depends on. Any that fails is either a workaround or a candidate upstream PR (add it to the "things SwarmForge doesn't expose that I need" list):

- [ ] **Launch** — start a swarm against an arbitrary target path from the extension
- [ ] **tmux discovery** — find SwarmForge's project-specific tmux socket (`.swarmforge/tmux-socket`) and enumerate its sessions/windows/panes
- [ ] **Pane attach/tail** — stream one pane's output into a webview live, cross-platform (macOS + Linux)
- [ ] **Pane input** — send keystrokes *into* a pane (needed for interactive tiles in M1)
- [ ] **State read** — parse `.swarmforge/` message/log files to know which stage holds the parcel
- [ ] **Config read** — read `swarmforge.conf` to learn the role/window topology (so tiles map to roles)
- [ ] **Lifecycle signals** — detect swarm start, completion/convergence, and exit from observable state
- [ ] **Heartbeat hook question** — determine whether tool-call heartbeats (M2) can be achieved by wrapping the backend launch command, or whether an upstream hook is needed

**Exit:** you can start a swarm and watch an agent work, from inside VS Code — and you have a concrete answer to "is the integration surface sufficient, or do I need upstream changes?"

---

## M1 — MVP: The Observable Swarm 🎯

**Goal:** the smallest thing a developer would actually use daily. Drive a real swarm against a target, watch all agents, get a PR at the end. Mostly observation + the essential controls.

**In:**
- **Target selection** — point at a local repo (path); `Initialize Target` scaffolds + commits `project.prompt` and `engineering.prompt`
- **Tiled panel** — one live, interactive terminal tile per agent role (the core UI), mirroring the tmux layout; click in and type to any agent
- **Run / Stop** — launch the swarm (fixed pack, e.g. the 7-pack or whatever branch the user configures), stop it
- **Pipeline awareness** — show which stage holds the parcel, read from the message store
- **PR at the end** — when the swarm converges, open a PR from the dev branch into the target's main; human reviews in GitHub
- **Named runs** — branch + PR named after the work item; a local run log

**Explicitly out (deferred, and fine to defer):**
- No dynamic right-sizing (run the whole configured pack every time)
- No watchdog/heartbeat/chase yet — rely on SwarmForge's native behavior + the human watching tiles
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

- **Backend abstraction** — formalize the launch-command contract; per-tile **backend/model switch on the fly**; mixed backends per role; Copilot CLI as one backend (multi-model behind one auth)
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

- **Cross-platform** (macOS/Linux; Windows is out-of-scope per the spec's tmux dependency)
- **Secrets handling** — keep tokens/keys in the extension host, never in the worktree or commits (lightweight from M1, formalized as backends multiply in M5)
- **Accessibility** — completion never color-only; keyboard nav; screen-reader labels
- **Observability** — durable run log and transcript export, growing as features land

---

## At a glance

| Milestone | Theme | Headline capability | Depends on |
|---|---|---|---|
| **M0** | Walking skeleton | Watch one agent from VS Code | — |
| **M1 (MVP)** | Observable swarm | Run a swarm, watch all agents, get a PR | M0 |
| **M2** | Reliability | Survives stalls/crashes unattended | M1 |
| **M3** | Traceability & right-sizing | True completion %, lean small items, backlog loop | M2 |
| **M4** | Governance & sync | Self-improving rules, honest backlog, salvage | M3 |
| **M5** | Cost & backends | Per-role backend mix, budget-aware | M2, M3 |
| **M6** | Remote & chat | Unblock from your phone | M5 |

**If you build nothing past M1, you still have a useful product.** Everything after is reach, trust, and economy — in that order.
