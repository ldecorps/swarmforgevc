# INTAKE 2026-08-22 — a specific command to restart/rebootstrap after a host switchover

**Raised by:** human, 2026-08-22, in the coordinator's live pane, after moving
this swarm's host from Mac to WSL2 (`/home/carillon/swarmforgevc`, previously
`/Users/ldecorps/projects/swarmforgevc`).

## Operator directives (verbatim, per Article 5.3)

> we have just switched over from mac to WSL

> maybe there is some house keeping to do ?

> maybe we need a specific command to restart after a switch over

## Context the coordinator gathered while triaging this

- The swarm was already relaunched on the new host before this session started
  (all 8 tmux role sessions created today at 13:36 UTC; `handoffd` /
  `handoffd_supervisor` alive with `/home/carillon/swarmforgevc` in their
  argv). No daemons were dead or stuck on the old host's paths.
- The root `.vscode/settings.json` had already been hand-updated for the new
  host (`swarmforge.targetPath`, `swarmforge.configPath` now point at
  `/home/carillon/swarmforgevc`).
- `extension/.vscode/settings.json` (the separate extension-dev workspace)
  had **not** been updated and still pointed `swarmforge.targetPath` at the
  old Mac path `/Users/ldecorps/projects/swarmforgevc`. The coordinator fixed
  this one file by hand as a stopgap (plain local-settings edit, not a code
  change) since it blocks the extension dev workspace from targeting the
  right repo — but this is exactly the kind of step a real switchover
  procedure should have caught automatically.
- `swarmforge/swarmforge.conf` itself carries no per-host paths (it's already
  portable). `.swarmforge/tmux/*.sock` matched the live tmux server fine.
- Prior related work: BL-789 (`mac-host-switch-freshness-bridge-adopt`,
  shipped, `backlog/done/M8/`) hardened the freshness cron and bridge
  supervisor against host quirks (missing interpreter under cron PATH,
  restart spam, port-adoption races) — but that is about daemons
  **surviving** a switch that already happened silently, not a **procedure a
  human runs** right after moving hosts to make sure everything (local
  editor settings, target paths, env vars, credentials, secrets, whatever
  else is host-pinned) is consistent again.
- BL-1029 (paused, `human_approval: approved`, defect/medium) reasons
  explicitly about host-path-dependent severity (install path containing an
  apostrophe). Its assessment still holds under the new WSL path
  (`/home/carillon/swarmforgevc` — no apostrophe) but is a live example of
  behavior whose correctness depends on which host/path the forge runs from.

## What's being asked (not a spec — the specifier's call)

A discoverable, single command/checklist (e.g. `./swarm doctor` or a
`switchover.sh`) a human can run right after moving the swarm to a new
machine/path, that at minimum:
- Detects and flags any local, host-pinned settings/config that still
  reference the old path (the extension/.vscode/settings.json case above is
  a concrete instance of the general problem).
- Confirms/repairs whatever else is host-pinned: secrets/env vars available
  in the new shell, tmux socket path, and any other daemon prerequisites.
- Is distinct from and does not duplicate BL-789's *daemon-level* resilience
  work — this is about the *human's* post-move checklist, not another
  cron/daemon hardening pass.

Whether this becomes a small standalone script, a `./swarm` subcommand, or
gets folded into onboarding/bounce tooling is a specifier design call.

## Update 2026-08-22 ~12:47 UTC — live casualty found: Bubble named tunnel down

Human reported (screenshot): `bubble.musicalsifu.com` serves Cloudflare
**Error 1033** (Tunnel error — no connector reaching the edge for that
hostname). Coordinator diagnosis:

- A `cloudflared` process IS running on this WSL host (pid alive), but it is
  the **anonymous quick tunnel** (`cloudflared tunnel --url
  http://127.0.0.1:8765 --no-autoupdate`, would only ever produce a
  `*.trycloudflare.com` URL) — not the **named tunnel** that
  `bubble.musicalsifu.com` is DNS-routed to.
- `~/.cloudflared/` (cert.pem, config.yml, tunnel credentials) does not exist
  on this host at all.
- `~/.swarmforge/tunnels/` (the BL-857 host-level tunnel-ownership registry,
  `swarmforge-bubble.operator-root` etc.) does not exist on this host either
  — this WSL host has never registered as the named-tunnel operator root.
  `.swarmforge/operator/named-tunnel.env` is also absent.
- This is a clean, first-time-on-this-host state, not corruption — per
  `docs/how-to/named-tunnel-bubble-musicalsifu.md`, registering the operator
  root is "a deliberate human edit," and creating the named tunnel needs an
  interactive `cloudflared tunnel login` (browser). The coordinator can't
  complete either step unattended, so this was handed back to the human as a
  short command sequence rather than acted on directly.
- This is the single most concrete instance of the general gap this intake
  is about: a host-pinned credential/registration directory that the
  switchover silently left behind, with no automated detection until a real
  user-facing surface broke.

Evidence: `docs/how-to/named-tunnel-bubble-musicalsifu.md` (full runbook),
`swarmforge/scripts/setup_bubble_named_tunnel.sh`,
`swarmforge/scripts/launch_resident_spy_tunnel.sh`,
`swarmforge/scripts/tunnel_ownership_lib.sh`.

---

## Disposition (specifier, 2026-08-22)

Drained to **BL-1057**
(`backlog/paused/BL-1057-the-doctor-names-what-a-host-move-left-behind.yaml`,
`type: feature`, epic `swarm-reliability`/BL-539 — recorded on that tracker's
`decomposes_into`). The whole intake went to that one ticket (1:1); all three
verbatim operator directives are preserved in its `notes:` per Article 5.3.

Two design calls narrow what the intake asked for, so the ticket carries
`human_approval: pending` with both stated in `approval_context`:

- **Detect only, no repair.** Of the two real casualties this switchover
  produced, the stale `extension/.vscode/settings.json` target path is a
  one-line rewrite, while the Bubble named tunnel needs an interactive browser
  login plus a deliberate human operator-root registration that no script may
  do unattended. Speccing repair alongside detection would have minted a ticket
  that is mostly detection wearing a repair label. Guided repair for the
  mechanically fixable subset is a follow-up if the human wants it.
- **Standalone script, not a `./swarm doctor` subcommand.** The intake left the
  form to the specifier. A subcommand means editing the fork's `swarmforge.sh`,
  and a `doctor` verb already sits inside BL-554's `root-capability-commands`
  epic, itself blocked on an unrelated human ruling. Standalone now, foldable
  into that verb later — BL-1057's `notes:` says so explicitly, so the verb
  calls this command rather than reimplementing it.

The live Bubble Error 1033 is **not** ticketed separately: its remediation is
the interactive `cloudflared tunnel login` sequence the coordinator already
handed back to the human. It is carried in BL-1057 as the motivating evidence
and as the ticket's `qa_e2e:` verification target, since this host's three
tunnel locations are still absent and are exactly the MISSING findings the
doctor must produce.

Not scoped, recorded in BL-1057's `notes:` for a later ticket: the root
`.vscode/settings.json` is tracked in git and carries host paths, so every host
move dirties a tracked file.
