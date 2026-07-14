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

- **tmux** — SwarmForge's process substrate. macOS and Linux only. On
  Windows, run this extension through Remote-WSL — see
  [Windows (via Remote-WSL)](#windows-via-remote-wsl) below; tmux does not
  run natively on Windows, and this extension does not support running the
  host there directly.
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

### Windows (via Remote-WSL)

This extension is a **workspace extension** (see `package.json`'s absent
`extensionKind`, which VS Code defaults to workspace-preferred for a real
`main`-entry extension like this one): its host process runs next to
wherever tmux, the swarm socket, and `.swarmforge/` actually live, not
necessarily next to the UI. SwarmForge depends on tmux, which does not run
on Windows — so on a Windows machine, run this extension through
**Remote-WSL**, the same "UI on Windows, host inside Linux" split desktop
VS Code already uses for any WSL-based project. This is architecturally
identical to the vscode.dev tunnel already in daily use for this repo.

1. Install [WSL](https://learn.microsoft.com/windows/wsl/install) and a
   Linux distribution, then install tmux, Node.js, and this repo's other
   prerequisites **inside WSL** (not on the Windows side — a Windows-side
   install of these tools is never seen by the extension host).
2. Install the **Remote - WSL** extension in your Windows desktop VS Code.
3. Open the repo from inside WSL: run `code .` from a WSL shell, or from
   Windows VS Code run **WSL: Reopen Folder in WSL** (or **WSL: Connect to
   WSL**, then open the folder) from the Command Palette.
4. Confirm the remote indicator in VS Code's bottom-left corner reads
   **WSL: `<distro name>`**. That indicator is the property that matters:
   it means the extension host is running inside WSL, beside tmux and the
   swarm, not on the Windows side where it could not reach either.
5. From here, follow [Point it at a target and initialize](#2-point-it-at-a-target-and-initialize)
   onward exactly as written — every command and step works identically
   once you are remoted into WSL.

Running the extension natively on Windows (outside WSL) is not supported:
tmux cannot run there, and this extension does not attempt to bridge that
gap.

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
4. The panel shows a **handoff transport health** banner ("⚠ handoff
   transport degraded" / "✖ handoff transport DOWN") when parcels are not
   actually being delivered — a dead-lettered or stalled parcel, or a missed
   periodic canary round-trip. This reflects DELIVERY health, not just
   whether the daemon process is alive: it can fire even while the daemon
   itself heartbeats healthy. No banner means transport is healthy.

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
- **FAILED** — It attempted repair but failed; check the error details. When the failure can be classified, the line also names a stable category in brackets (`auth`, `unavailable`, `protocol`, `timeout`, `launch-failed`, or `unknown`) alongside the raw detail — e.g. `agent:coder: FAILED [launch-failed] (no tmux socket found for this project root)` — so you can tell at a glance whether it's a credentials problem, a backend outage, or something else, without parsing provider-specific prose.

On an already-healthy swarm, `./swarm ensure` is a fast no-op that changes
nothing. A failed repair of one component does not stop the remaining checks —
they all run and are reported together.

Exit with status 0 if all components are healthy; non-zero if anything could
not be brought to health.

---

For pipeline stages, watchdogs, hardening tooling, the full command and
settings reference, and the roadmap beyond this MVP, see
[Specification.MD](Specification.MD). Plugging the swarm into a
**new/greenfield** project? See
[Onboarding a New Project](Onboarding-New-Project.md), which covers the
acceptance contract that drives what the swarm builds.
