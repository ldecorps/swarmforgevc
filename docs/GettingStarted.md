# Getting Started with SwarmForge VC

> **Owner:** the documenter role keeps this guide current as part of its
> normal docs pass whenever a parcel changes commands, settings, or flow
> (BL-074).

SwarmForge VC is a VS Code extension that drives and observes SwarmForge
(Uncle Bob's tmux-based multi-agent orchestration tool). It launches a swarm
against any target project, shows every agent working in live terminal tiles
inside the editor, and ends with a pull request to review — without leaving
VS Code. It does not replace SwarmForge; think of it as a window onto what
SwarmForge already does. For the full product vision and roadmap, see
[Specification.MD](Specification.MD).

## 1. Install

Prerequisites:

- **tmux** — SwarmForge's process substrate. macOS and Linux only; this
  extension does not support Windows.
- **A SwarmForge-enabled target project** — a repo that already has SwarmForge
  set up (a `./swarm` wrapper and `swarmforge/` config). Setting SwarmForge
  itself up in a target repo is outside this extension's scope; see
  SwarmForge's own docs for that step.
- **Node.js** — to build the extension from source.

There is no packaged VSIX yet, so build and load it from source:

```sh
git clone https://github.com/ldecorps/swarmforgevc.git
cd swarmforgevc/extension
npm install
npm run compile
```

Open the `extension/` folder in VS Code and press **F5** (Run Extension) to
launch an Extension Development Host with SwarmForge VC loaded.

## 2. Point it at a target and initialize

In the Extension Development Host window:

1. Run **SwarmForge: Set Target Project** (`swarmforge.setTarget`) and pick
   the target repo's folder.
2. Run **SwarmForge: Initialize Target** (`swarmforge.initializeTarget`).
   This scaffolds and commits `project.prompt` and `engineering.prompt` into
   the target repo so they travel with it — the swarm reads these to know
   what to build.

## 3. Run and watch

1. Run **SwarmForge: Launch Swarm** (`swarmforge.launchSwarm`) to shell out
   to the target's `./swarm` wrapper and start the agents.
2. The extension automatically opens the tiled agent panel when the swarm
   launches. If you close the panel, run **SwarmForge: Open Panel**
   (`swarmforge.openPanel`) to reopen it — one live terminal tile per role,
   tailing that role's tmux pane in real time.
3. Click into any tile and type to nudge that agent directly.

**Persistence across restarts:** If you reload or close VS Code while the swarm is running, the agents keep working in tmux. When you relaunch, the extension automatically reconnects to the live swarm without restarting agents — no work is lost. F5 / Extension Development Host does **not** cold-launch a swarm; use **Launch Swarm** explicitly for a new run. If the swarm is no longer running but you have prior state on disk, the extension offers to resume from the last checkpoint.

See `docs/specs/headless-reattach-doctrine.md` for the full reattach vs launch decision table.

To stop the swarm cleanly at any point, run **SwarmForge: Stop Swarm**
(`swarmforge.stopSwarm`).

## 4. Get your PR

When the swarm finishes, run **SwarmForge: Open Pull Request**
(`swarmforge.openPR`) to open a pull request from the swarm's dev branch into
the target's main branch. Review and merge it in GitHub like any other PR.

## Troubleshooting: Bring the swarm to a known-good state

If the swarm is stuck, unresponsive, or you need to restart a component (the
extension host, individual agents, or the daemon), use the recovery command:

```sh
./swarm ensure
```

This idempotent command checks and repairs:
1. **Extension host** — Is VS Code with the SwarmForge extension running?
2. **Agent panes** — Is each configured agent pane present in tmux with a live process?
3. **Daemon** — Is the handoff daemon running?

For each component, it reports one of:
- **HEALTHY** — No repair needed.
- **FIXED** — It repaired the component and names what it did (e.g., "started
  extension", "respawned coder pane", "restarted daemon").
- **FAILED** — It attempted repair but failed; check the error details.

On an already-healthy swarm, `./swarm ensure` is a fast no-op that changes
nothing. A failed repair of one component does not stop the remaining checks —
they all run and are reported together.

Exit with status 0 if all components are healthy; non-zero if anything could
not be brought to health.

---

For pipeline stages, watchdogs, hardening tooling, the full command and
settings reference, and the roadmap beyond this MVP, see
[Specification.MD](Specification.MD).
