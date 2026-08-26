# Bootstrap brief: SwarmForge VC extension (substrate-first — headless swarm before tiles)

You are building a Visual Studio Code extension called **SwarmForge VC**. Your job is
to get a real multi-agent swarm running and proven **headlessly** first — as a plain
Node program with no VS Code, no webview, no extension host — and only *then* wrap that
working substrate in live tiles. Build the minimum to reach each of the two checkpoints
below, in order, and stop at the second.

This ordering is deliberate and is the whole point of this revision. The hard,
load-bearing part of this product is the **substrate**: spawning agents, wiring their
output streams, setting up worktrees, and passing a handoff between two agents over the
filesystem. The UI is just a window onto that substrate. Earlier bootstrap attempts were
UI-first and paid for it — time went into fussy VS Code chrome while the part that
decides whether the concept works was still unproven. So: prove the substrate in a tight,
fast, terminal-only test loop, then put tiles on top of a thing you already trust.

## What the extension is

A visual front-end and orchestrator for a multi-agent coding swarm. It lets a developer
launch a swarm of AI agents against a target project and watch every agent work in live
terminal tiles inside VS Code, each in its own git worktree. The extension is a
**standalone orchestrator** — inspired by Uncle Bob's SwarmForge, but it does not run,
drive, or depend on SwarmForge or tmux. It spawns and manages the agent processes itself.
This is a deliberate choice driven by a native-Windows requirement: tmux does not exist on
native Windows, so the extension owns process orchestration directly.

An agent's backend can be either an **external CLI coding tool** (Claude Code, Codex,
Copilot CLI, etc.) **or** — when no CLI is available or allowed — an **in-process agent
loop** driven by the VS Code Language Model API (`vscode.lm`). See "Backends" below; both
sit behind one `InteractiveProcess` abstraction so nothing above the substrate cares which
is in use.

## Why two checkpoints, not one

The old brief had a single dogfood point: "launch + tiles." That bundled the risky part
(does a real swarm actually run?) with the fussy part (does the webview render?) into one
milestone, and front-loaded the fussy part. We split it:

- **Checkpoint A — Headless swarm (the real finish line of this brief's hard work).**
  The orchestrator can spawn agents in worktrees and pass a real handoff between two of
  them over the filesystem message bus — proven entirely from a CLI, no VS Code involved.
- **Checkpoint B — Tiles on top (the dogfood handoff).** A webview renders one live tile
  per agent over the *same* orchestrator, each interactive. When this works, point the
  extension at its own repo and take over from there.

Reach A, prove it, **stop and say so**. Then build B. Reach B, announce the dogfood point,
**stop**.

---

## Checkpoint A — Headless swarm

Everything here is a plain Node/TypeScript program run from a terminal. **No webview, no
extension host, no F5.** You should be able to `node` your way through all of it in a tight
loop. This is where the substrate gets proven.

### A-build order

1. **Orchestrator core + `InteractiveProcess` seam.** Define the one abstraction the
   whole system rests on: `InteractiveProcess` with `onData`, `onExit`, `write`, `kill`.
   Everything above the substrate (later: tiles, input forwarding, the message bus
   watcher) talks only to this interface, never to a concrete backend.
2. **Shell backend (`child_process.spawn`).** Implement the simplest concrete
   `InteractiveProcess`: a pipe-backed adapter over `child_process.spawn`. Prove it by
   spawning a trivial process (an echo or a shell), streaming its output back through
   `onData`, and sending it input through `write`. This is the substrate's "hello world."
3. **Worktree setup.** Given a target repo path, the orchestrator creates one git
   worktree per role under `.worktrees/`, each on its own branch. Prove it creates,
   lists, and tears down worktrees cleanly. No agents yet — just the directory/branch
   choreography.
4. **Filesystem message bus (the load-bearing primitive).** Implement read/write of
   handoff messages as files under `.swarmforge/messages/` (one file per message; atomic
   write via temp-file + `rename`). A message carries at least `from`, `to`, `subject`,
   `body`, `status`. Prove a message written by one process is readable by another.
5. **Two-agent handoff, headless.** Wire two backend processes in two worktrees and pass
   **one real handoff** between them through the message bus: agent A writes a handoff to
   B's inbox, B picks it up (prompt-polling is fine here — orchestrator-notify is a later
   concern), B acts and writes back. Run the whole thing from a single CLI command and
   watch it happen in terminal output / on disk.
6. **Language-model backend (`LanguageModelRoleRuntime`).** Add the second concrete
   `InteractiveProcess` for a role whose backend is **not** `shell`: a self-built agent
   loop (`src/agent/LanguageModelRoleRuntime.ts`) that
   - selects a Copilot model via `vscode.lm.selectChatModels({ vendor: 'copilot' })`
     (with retry while Copilot registers / consent is granted),
   - streams assistant text through the same `onData`,
   - exposes worktree-scoped tools the model can call: `read_file`, `write_file`,
     `list_dir`, and `run_command` (for `git` and the handoff scripts),
   - runs up to **100 tool calls per turn** (a safety cap, not a model limit).

   > Note: `vscode.lm` requires an extension host to obtain the model handle, so this one
   > runtime can't be exercised by a bare `node` script the way steps 1–5 can. Keep its
   > *logic* (the agent loop, tool dispatch, the 100-call cap) in a plain module unit-
   > tested in isolation, and drive a thin extension-host test harness only for the
   > `selectChatModels` handle. Do **not** let this pull the rest of the substrate into
   > the extension host — steps 1–5 stay headless and CLI-testable.
7. **Checkpoint A reached** — the swarm runs and hands off, proven from a CLI. Announce it
   and stop. Do not start the webview yet.

### A-definition of done

From a terminal, with no VS Code open: run one command, and two agents spawn in their own
worktrees, one hands a real parcel to the other through the message bus, the receiver acts
on it, and you can see the whole exchange in stdout and on disk. Output a clear message
that **Checkpoint A (headless swarm) is reached**, and stop.

---

## Checkpoint B — Tiles on top (dogfood handoff)

Only start this once A is solid. Tiles are now a *thin view* over an orchestrator you
already trust — that is the entire payoff of doing A first.

### B-build order

1. **Scaffold the VS Code extension** in TypeScript (package.json manifest, activation,
   contributed commands). Verify it loads in the Extension Development Host (F5). The
   orchestrator from A is imported as-is — the extension is a *host* for it, not a rewrite.
2. **One live tile.** Render a webview panel that subscribes to ONE agent's
   `InteractiveProcess.onData` and renders its output live. No input yet.
3. **All tiles + input.** One tile per agent role; make each tile interactive — forward
   typed keystrokes back into the agent's process via `write()`. Sending input reliably is
   the fiddliest UI behavior — test Enter, Ctrl-C, and paste on Windows + macOS + Linux.
4. **Dogfood handoff reached** — the developer can open the extension, set a target repo,
   launch the swarm, and watch all agents working in live interactive tiles. Announce the
   dogfood point, point the extension at its own repo, and stop.

### B-definition of done

The developer can: open the extension, set a target repo, launch a swarm (one process per
role in its own worktree, over the Checkpoint-A orchestrator), and watch all agents working
in live interactive tiles inside VS Code. At that moment, output a clear message that the
dogfood point is reached, and stop.

---

## Out of scope (both checkpoints)

Stop-command polish, pull-request generation, pipeline-stage display, named runs,
reliability/watchdog/heartbeat, cost logic, remote/mobile, orchestrator-notify (prompt-
polling is fine for the bootstrap), the full role pack. Do not build these. The extension
will build them itself afterwards, dogfooded.

---

## Backends

A backend is anything that satisfies the `InteractiveProcess` contract (`onData`,
`onExit`, `write`, `kill`):

- **`shell` backend** — `child_process.spawn` pipe-backed adapter. The orchestrator
  streams its output and forwards input directly. Used for trivial/proof processes and any
  CLI agent tool.
- **Language-model backend** — `LanguageModelRoleRuntime`, the in-process agent loop over
  `vscode.lm` described in A-step 6. No external agent CLI is required or asserted on PATH;
  agents run entirely on the developer's Copilot entitlement, in-process.

> The `vendor: 'copilot'` selection is a **bootstrap-only assumption**, justified by the
> network-constrained environment below. The backend layer is provider-agnostic by design;
> do not let single-vendor selection calcify into the abstraction. (Same discipline as the
> "repo is its own target" collapse during bootstrap — keep it conscious so it doesn't leak
> into the structure.)

> `run_command` is a real subprocess (git, handoff scripts), so "in-process, no CLI" means
> "no external *agent* CLI" — not "no subprocesses at all." Give `run_command` an allowlist
> rather than a wide-open `exec`, and keep the 100-tool-call cap per-turn; together they are
> the only governor on a loop that can now invoke commands.

---

## Tech and rules

- **TypeScript**, standard VS Code Extension API (works in Cursor too — do not use anything
  Cursor-specific). **Cross-platform: native Windows, macOS, and Linux** — the process
  backend is the same API on all three; write to it, not to any one OS.
- **The process backend is the substrate.** Spawn each agent through the orchestrator's
  process backend and own its output stream directly. Do **not** use
  `vscode.window.createTerminal` for agents — it gives a UI terminal you can't reliably tail
  or capture, and you need the stream for both the tile and the message bus. Keep `node-pty`
  only as an *optional* PTY proof if you want one; the real path is `child_process.spawn`
  and the `vscode.lm` runtime, neither of which needs it.
- **Substrate stays headless-testable.** Checkpoint A must be exercisable from a bare
  terminal. The only thing allowed to require the extension host is the `vscode.lm` model
  handle (A-step 6) — and its surrounding logic is unit-tested in isolation so even that is
  mostly CLI-provable. If you find yourself needing F5 to test worktrees, spawning, or the
  message bus, you've coupled the substrate to the UI — back it out.
- **Two layers — do not confuse them.** The tiles are TypeScript/webview *views*; the
  process backend is the *substrate* that runs the agents. Spawning the agent processes from
  TypeScript **is the intended design here** — that is what the orchestrator is for.
- **Keep the orchestrator thin.** Its job is process management only: spawn, stream, input,
  kill/respawn, worktree setup. Do **NOT** build pipeline sequencing, merge logic, message
  *routing*, or convergence into it — that machinery is out of scope for this brief, and
  when built later it lives in a separate coordinator / message-bus layer, not in the process
  manager. (The message *bus* in A-step 4 is just file read/write + atomic rename — the
  primitive, not the routing logic. Writing and reading message files is in scope; deciding
  who-goes-next is not.) If a task in *this* brief starts to feel like building coordination
  logic, stop — you've gone past the checkpoint.
- **Standalone, no SwarmForge, no tmux.** Do not fetch, vendor, shell out to, or depend on
  SwarmForge or tmux in any way. There is no `./swarm` wrapper and no tmux socket. The
  extension's own orchestrator is the only thing that launches agents.
- **State on disk.** Swarm state (worktrees, messages, later heartbeats) lives under
  `.swarmforge/` and `.worktrees/` in the target clone — on-disk files are the source of
  truth, kept out of the target's committed history. This is what makes Checkpoint A
  observable on disk and what later lets the UI be a pure projection.
- **Extension host vs webview** (Checkpoint B only) are separate contexts that talk only by
  message passing (postMessage). The host owns all I/O (process spawning, files, git); the
  webview is presentation plus input forwarded to the host. Do not share state directly.
- **No browser storage** (no localStorage/sessionStorage) in the webview — keep UI state in
  memory or persist via the extension host.

---

## Network-constrained environments (e.g., Lloyds Banking Group)

The extension's npm dependencies may be blocked by corporate network policies, and no agent
CLI may be installable — which is *why* the `vscode.lm` in-process backend is the primary
path rather than a convenience. If `npm install` hangs or fails with registry errors, use
the following workaround to get a working TypeScript build immediately without waiting on
npm. Run from the repo root:

```
Set-Location "swarmforge-vscode/extension"
New-Item -ItemType Directory -Path "node_modules" -Force | Out-Null
Copy-Item "C:\Program Files\Microsoft VS Code\resources\app\extensions\node_modules\typescript" `
  -Destination "node_modules" -Recurse -Force
node compile.js
```

This reuses the TypeScript that ships inside VS Code itself, so a build is possible even with
the npm registry unreachable.

---

## A note on the bootstrap agent itself

For building *this* extension's backend, one capable agent in a tight loop is leaner than a
full pack — there's no pipeline to coordinate yet, and the work (backend TypeScript) is
cohesive. The pack earns its keep once there's a real pipeline to run. So drive the
Checkpoint-A work with a single agent; reserve multi-role swarms for after the dogfood
handoff, when the extension is building its own later milestones.
