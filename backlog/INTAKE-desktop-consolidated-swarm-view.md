# INTAKE: Desktop-grade consolidated swarm view (Windows VS Code + one tiled window)

**Raised by:** the human (ldecorps), 2026-07-13/14: "would it be possible to
run the extension on the Windows VS Code? and have the tmux panes nicely
attached on 1 consolidated window?"
**Relayed via:** the Claude Code session, at the human's request ("go").
Human-raised; the relay is transport.

## The ask, split into its two halves

### 1. The extension in desktop VS Code on Windows

Expected to already work via VS Code remoting (Remote-WSL "Open Folder in
WSL", or Remote-Tunnels into the existing `swarmforge-ops` tunnel): the
extension is a workspace extension, so its extension host runs INSIDE WSL
next to tmux, the socket and the daemons, while the UI is native Windows —
architecturally identical to the vscode.dev tunnel already in daily use.

What this slice should actually deliver is VERIFICATION, not code:
- open the repo via Remote-WSL in desktop VS Code, exercise the panel
  (tiles stream, input mirroring works, launch/stop/bounce commands run);
- fix whatever small assumptions break (candidates: hardcoded absolute
  paths, `extensionKind` if the extension ever gets a UI-side split,
  anything that shells out expecting an interactive login shell);
- document the setup in docs/GettingStarted.md (a Windows-host section).

### 2. One consolidated window of real tmux panes

A baseline now exists: `swarmforge/scripts/swarm_dashboard.sh` (added with
this intake) builds a disposable, VIEWER-ONLY tiled window — one read-only
nested attach per live role session, on its own dashboard socket. Verified
against a fake swarm: tiles stream live, titles carry role names, and
killing the dashboard server provably leaves the role sessions untouched.

The slice this intake asks the specifier to weigh:
- an extension command ("SwarmForge: Open Role Grid") that opens one VS Code
  integrated terminal per live role, split into a grid, each running the
  same read-only attach — the desktop-native flavor of the same viewer;
- and/or first-class treatment of the existing panel as THE consolidated
  view (it already streams tiles with input mirroring; if it feels worse
  than raw tmux, that is a UX gap to name and fix, not new plumbing).

## The design rule both halves must honor (load-bearing)

The consolidated thing is a VIEWER, never the owner. Roles stay in separate
sessions on the swarm socket so the supervisor and BL-324's parking can
kill/respawn/park each independently. No merging sessions, no join-pane, no
writable attach by default. swarm_dashboard.sh encodes this posture
(separate socket, attach -r, rebuild-from-live-list); the extension flavor
must too.

## Adjacent

- BL-351 (boot units) + swarmforge/deploy/windows/: the same "the human
  lives on Windows" reality this intake serves.
- The parked-vs-dead visibility gap noted in
  backlog/evidence/incident-20260713-quiet-swarm-postmortem.md: a role
  grid/panel that VISIBLY distinguishes "parked by routing" from "dead"
  would resolve it and belongs in whichever slice touches the view.
