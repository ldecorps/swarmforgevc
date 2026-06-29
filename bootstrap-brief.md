# Bootstrap brief: SwarmForge VC extension (build to the dogfood point)

You are building a Visual Studio Code extension called **SwarmForge VC**. Your job
is to get it working just far enough that the developer can use the extension
itself to drive all further development. Build the minimum to reach that point,
then stop.

## What the extension is

A visual front-end for **SwarmForge** (Uncle Bob's tmux-based multi-agent coding
tool). It lets a developer launch a SwarmForge swarm against a target project and
watch every agent work in live terminal tiles inside VS Code, instead of in raw
tmux. The extension drives an unmodified, separately-installed SwarmForge - it
does not replace or reimplement it.

## The one goal: reach the dogfood point

The dogfood point is when the extension can do BOTH of these, even roughly:

1. **Launch** a SwarmForge swarm against a target repo (by shelling out to
   SwarmForge's `./swarm` wrapper).
2. **Show live tiles** - a panel with one terminal tile per agent, each tailing
   that agent's tmux pane in real time, and each interactive so the developer can
   click in and type to the agent.

When both work, the developer can point the extension at its own repo and take
over from there. That is the finish line for this brief. **Stop when you reach it**
and clearly say so.

## Build order

1. **Scaffold** a standard VS Code extension in TypeScript (package.json manifest,
   activation, contributed commands). Verify it loads in the Extension Development
   Host (F5).
2. **Prove the tmux link**: add a command that runs `tmux ls` from the extension
   host and shows the result. This confirms the extension can shell to tmux - the
   foundation everything rests on.
3. **Target + launch**: a command to set a target repo path, and a command to
   launch the swarm against it via `./swarm`. Confirm the tmux sessions come up.
4. **One live tile**: render a webview panel that tails ONE agent's tmux pane live.
5. **All tiles + input**: one tile per agent role; make each tile interactive
   (forward typed keystrokes back into the agent's pane). Sending input into a
   pane is the fiddliest part - get it working reliably on macOS/Linux.
6. **Dogfood point reached** - announce it, and stop.

Anything beyond this (Stop command polish, pull-request generation, pipeline
status, named runs, reliability, cost, remote) is OUT of scope for this brief.
Do not build it. The extension will build those itself afterwards.

## Tech and rules

- **TypeScript**, standard VS Code Extension API (works in Cursor too - do not use
  anything Cursor-specific). macOS/Linux only; SwarmForge needs tmux.
- **Two layers - do not confuse them**: the tiles are TypeScript/webview *views*;
  tmux is the *process substrate* that runs the agents. The tile renders output and
  forwards input; tmux (via SwarmForge) runs the agents underneath. DO NOT spawn
  agent processes directly from TypeScript to avoid tmux - that means reimplementing
  SwarmForge and is wrong. If a task starts to feel like building process
  orchestration, stop - you have crossed the line.
- **Integrate, do not fork**: SwarmForge is a pinned, unmodified, separately
  installed dependency. Never copy its source in. Interact with it only by:
  launching `./swarm`, reading its state under `.swarmforge/` (including
  `.swarmforge/tmux-socket`), and attaching to its tmux sessions/panes.
- **Extension host vs webview** are separate contexts that talk only by message
  passing (postMessage). The host owns all I/O (tmux, files, git); the webview is
  presentation plus input forwarded to the host. Do not share state directly.
- **No browser storage** (no localStorage/sessionStorage) in the webview - keep UI
  state in memory or persist via the extension host.

## Definition of done

The developer can: open the extension, set a target repo, launch a swarm, and watch
all agents working in live interactive tiles inside VS Code. At that moment, output
a clear message that the dogfood point is reached, and stop.
