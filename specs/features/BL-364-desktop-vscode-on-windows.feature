Feature: A developer on Windows runs the extension in desktop VS Code, with its host next to the swarm

# BL-364: the human asked whether the extension can run on the Windows desktop VS Code. It is
# expected to already work through VS Code remoting (Remote-WSL, or the Remote-Tunnel already in
# daily use): the extension is a WORKSPACE extension, so its extension host runs INSIDE WSL next to
# tmux, the swarm socket and the daemons, while only the UI is native Windows — architecturally the
# same shape as the vscode.dev tunnel already used every day.
#
# So the deliverable is VERIFICATION and DOCUMENTATION, not new plumbing: prove the panel, the
# tiles, input mirroring and the launch/stop/bounce commands work in that configuration, fix the
# small assumptions that break, and write the Windows-host setup down where a developer will find
# it. The load-bearing property is WHERE the extension host lands: if it were ever to run on the
# Windows side, it would be severed from tmux, the socket and `.swarmforge/` — the whole substrate.
# The scenarios below pin the automatable half; the human-in-the-loop half (tiles actually stream,
# typing into a tile actually reaches the agent) is the ticket's e2e QA procedure.

# BL-364 desktop-vscode-on-windows-01
Scenario: The extension host runs beside the swarm, never on the UI side
  Given a developer whose VS Code UI runs on Windows and whose repo lives in WSL
  When the extension is loaded
  Then its extension host runs where the swarm and its tmux socket live

# BL-364 desktop-vscode-on-windows-02
Scenario: A Windows developer is told how to set this up
  Given the Getting Started guide
  When a developer on Windows reads it
  Then it tells him how to open the repo with the extension host in WSL

# BL-364 desktop-vscode-on-windows-03
Scenario: The documented setup keeps naming things that really exist
  Given the Getting Started guide
  When it is checked against the repo
  Then every command and path its Windows setup names exists

# BL-364 desktop-vscode-on-windows-04
Scenario: Nothing in the extension's host path assumes one developer's machine
  Given the extension's host-side launch path
  When it resolves the places it reads and the programs it runs
  Then it depends on no hardcoded absolute path outside the workspace
  And it assumes no macOS-only program
