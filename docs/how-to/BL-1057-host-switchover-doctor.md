# Host switchover doctor — the post-move checklist

Run this right after moving the swarm to a new machine or a new path.

```bash
bb swarmforge/scripts/host_switchover_doctor.bb
```

Exit `0` means every host-pinned location describes this host. Any other exit
means at least one of them does not, and the report says which.

## Why it exists

When this swarm moved from a Mac to WSL2 on 2026-08-22 the daemons and tmux
sessions came up fine. What did not come across was the configuration that is
host-pinned *by design* — local editor settings, `$HOME`-rooted credential and
registry directories, machine-local env files. None of that is inside any
daemon's restart path, so nothing reported it:

- `extension/.vscode/settings.json` still targeted
  `/Users/ldecorps/projects/swarmforgevc`. Found only because someone happened
  to open that workspace.
- `bubble.musicalsifu.com` served a live Cloudflare **Error 1033** — the named
  tunnel had never been registered on the new host. Found only because a real
  user-facing surface broke and a human noticed.

The doctor is the command that would have said both, in one run, in the first
minute after the move.

## What it reports

One line per declared location, each with exactly one verdict:

| Verdict | Meaning |
|---|---|
| `OK` | present, readable, and describing this host and repo root |
| `STALE` | present, but naming a repo root that is not this one — the report quotes the value it found |
| `MISSING` | a host-pinned registration the forge needs is absent entirely |
| `BLOCKED` | the check could not be run (unreadable, permission denied). Never omitted, never counted as OK |

Every non-`OK` finding names both the concrete path at fault and the
remediation step for it, so nothing in the report is a problem you cannot act
on.

The declared inventory today:

| Location | What is checked |
|---|---|
| `.vscode/settings.json` | `swarmforge.targetPath` / `swarmforge.configPath` describe this repo root |
| `extension/.vscode/settings.json` | `swarmforge.targetPath` describes this repo root |
| `~/.swarmforge/tunnels/operator-root` | present, and names this repo root |
| `~/.cloudflared/cert.pem` | present and readable |
| `~/.cloudflared/config.yml` | present and readable |
| `~/.cloudflared/<tunnel-id>.json` | tunnel credentials present |
| `.swarmforge/operator/named-tunnel.env` | present and readable |

`bb swarmforge/scripts/host_switchover_doctor.bb --inventory` prints that
inventory as JSON — it is data in one place, so adding a location later is a
one-row change.

## It never repairs

The doctor only ever reports. That is a durable property, not a limitation of
a first slice: a diagnostic you can safely run on a half-migrated host is worth
more than one that might rewrite config while you are still working out what
moved. Any future repair capability will be a **separate command**, never a
`--fix` flag on this one.

Registering the named tunnel in particular is a deliberate human action — it
needs an interactive browser login and a considered registration of this host
as the tunnel operator root. The doctor tells you to do it and points you at
[the named-tunnel runbook](named-tunnel-bubble-musicalsifu.md); it does not do
it for you.

## Options

| Flag | Effect |
|---|---|
| `<repo-root>` | check that checkout instead of the one this script lives in |
| `--json` | machine-readable report on stdout |
| `--inventory` | print the declared inventory and exit 0 |

Run from any per-role worktree, the doctor checks the forge's **main**
checkout: a worktree is not a separate forge, and the host-pinned config points
at the forge's own root.

For tests, both `$HOME`-rooted bases are env seams —
`SWARMFORGE_TUNNEL_REGISTRY_DIR` (the one `tunnel_ownership_lib.sh` already
established) and `SWARMFORGE_CLOUDFLARED_DIR` — so a fixture never reads the
real `$HOME`.
