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

**Persistence across restarts:** If you reload or close VS Code while the swarm is running, the agents keep working in tmux. When you relaunch, the extension automatically reconnects to the live swarm without prompting — no work is lost. If the swarm is no longer running but you have prior state on disk, the extension offers to resume from the last checkpoint.

To stop the swarm cleanly at any point, run **SwarmForge: Stop Swarm**
(`swarmforge.stopSwarm`).

## 4. Get your PR

When the swarm finishes, run **SwarmForge: Open Pull Request**
(`swarmforge.openPR`) to open a pull request from the swarm's dev branch into
the target's main branch. Review and merge it in GitHub like any other PR.

---

For pipeline stages, watchdogs, hardening tooling, the full command and
settings reference, and the roadmap beyond this MVP, see
[Specification.MD](Specification.MD).
