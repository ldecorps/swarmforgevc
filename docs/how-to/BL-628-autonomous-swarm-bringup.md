# BL-628: Bare-Host Bootstrap for an Autonomous Swarm

**Takes a fresh, always-on Linux box to a headless AUTONOMOUS swarm — its own
coordinator, its own backlog, its own target repo, its own Telegram front-desk
channel — in one documented path.**

This is the autonomous sibling of
[BL-101's secondary bring-up](BL-101-pi-vps-secondary-swarm-bringup.md): read
that first for the shared bare-host mechanics (systemd instead of a
human-attended terminal, pinned substrate installs, headless `claude` auth,
internet-facing security posture). Everything in BL-101's sections 1, 3, 6 and
7 (prerequisites, `claude` auth, security posture, reboot resilience) applies
here unchanged. This runbook covers only what's specific to the **autonomous**
shape.

## Why a separate script, not a flag

`provision_secondary_host.sh` (BL-101) does the whole bare-host bootstrap —
packages, pinned substrate, the clone, headless auth — but hardcodes the
**secondary** shape: a swarm that works only tickets a primary coordinator
assigned it, never promotes, never assigns, and is refused a coordinator
window at launch. `provision_primary_host.sh` (BL-359) produces the units an
autonomous box needs but assumes the host is already set up. Neither composes
into "new project on an idle VPS" on its own.

`provision_autonomous_host.sh` is a **separate script**, not a flag on
`provision_secondary_host.sh` — that script's own bytes are untouched by this
work, so the secondary shape stays byte-identical by construction. The
shape-agnostic bootstrap steps (packages, pinned substrate,
`DISABLE_AUTOUPDATER`, clone) live in a shared library
(`swarmforge/deploy/lib/host_bootstrap.sh`) both provisioners reuse; only conf
generation and the enabled unit set differ between them. Every unit either
path installs still comes from the one existing generator
(`generate_systemd_units.sh`) — neither provisioner authors unit content of
its own.

## 1. Prerequisites

Same as BL-101 section 1: working SSH access, a non-root user, a repo-scoped
git credential (deploy key or fine-grained PAT) set up before you run the
script, and this box's own unique `swarm_name`.

## 2. Automated provisioning

```sh
git clone <this repo, via a throwaway/bootstrap credential or an existing
  checkout you scp over> ~/swarmforgevc-bootstrap
~/swarmforgevc-bootstrap/swarmforge/deploy/provision_autonomous_host.sh \
  <swarm-name> <repo-scoped-clone-url> [project-root]
```

`provision_autonomous_host.sh` does, in order:

1. **Validates `<swarm-name>` first**, before any package or substrate step —
   a refused name (already claimed by a live swarm unit on this host, or the
   placeholder name `autonomous` shipped in `packs/autonomous-swarm.conf`
   itself) leaves the host completely untouched.
2. Installs base packages and `gh`, then the pinned substrate (babashka,
   Node.js, the `claude` CLI) from `swarmforge.lock.json` — identical steps to
   BL-101's own, via the shared `lib/host_bootstrap.sh`.
3. Writes `DISABLE_AUTOUPDATER=1` into `~/.claude/settings.json`.
4. Clones the repo to `project-root` (default `~/swarmforgevc`).
5. Generates this box's own **autonomous**-mode conf
   (`generate_autonomous_conf.sh <swarm-name>` — substitutes only the
   `swarm_name` line into the shared `packs/autonomous-swarm.conf` template).
   Unlike the secondary conf, this template carries **no** `config swarm_mode`
   line at all: `swarmforge.sh`'s own default is already `autonomous` (a
   coordinator window at launch, promotes/assigns from its own backlog).
6. Generates and installs **three** systemd units via the existing
   `generate_systemd_units.sh` — the swarm unit, the operator unit, and,
   unlike the secondary path, a **front-desk unit** (its own Telegram
   channel). `provision_secondary_host.sh` never installs a front-desk unit at
   all; BL-359 called that omission "exactly as dark as no unit at all," and
   for an autonomous swarm it is not optional. The operator and front-desk
   units are enabled **and started** immediately (they retry harmlessly until
   the manual credential steps below are in place); the swarm unit is enabled
   but not started until `claude` auth exists.

### Dry-run mode

`PROVISION_AUTONOMOUS_DRYRUN=1` gates every real host mutation — package
install, file write, unit enable — behind a printed `DRYRUN:` line instead of
performing it: no `sudo`, no download, no clone, no systemd state change.
Conf/unit *rendering* itself is never gated (it writes to a scratch path,
needs no root, and mutates no installed state) — that's the seam an operator
inspects to see exactly what a real run would do before committing to it on
an internet-facing box.

## 3. Manual steps

The script prints these at the end; detail below.

1. **Authenticate `claude` once** — same two options as BL-101 section 3
   (interactive `claude` login completed from any device's browser, or `claude
   setup-token` written to `/etc/swarmforge/<swarm-name>.env`, never a shell
   profile).
2. **Give this box its own Telegram bot token** (BL-622) into the same
   `/etc/swarmforge/<swarm-name>.env` file, alongside the `claude` token — a
   second swarm that inherited the primary's token would steal its messages.
3. **Register the GitHub Actions self-hosted runner** for this box's
   architecture, using the runner project's own installer and systemd unit
   (`./config.sh ... && sudo ./svc.sh install && sudo ./svc.sh start`) — same
   as BL-101 section 4.
4. **Run the onboarding ceremony before starting this box's swarm.** The
   survey/propose/negotiate/gate sequence (see
   [Onboarding a New Project](../tutorials/Onboarding-New-Project.md) section
   2) runs on the **primary box**, against this project's **repository URL**
   — never on the remote autonomous box itself. That ceremony commits the
   agreed contract and the generated `project.prompt`/`engineering.prompt`
   into the target repo on the primary box; when this remote box clones that
   repo (step 4 of automated provisioning above), it **pulls the committed
   contract and prompts** as part of the clone. The contract is **never negotiated on the remote box** —
   by the time its swarm starts, negotiation is already settled and travels
   with the repo.
5. **Start the swarm for the first time:**
   ```sh
   sudo systemctl start swarmforge-<swarm-name>.service
   ```
   Every later boot starts it automatically (already enabled by the
   provisioning script).

## 4. Verifying the split changed nothing for the secondary shape

Invariant 2 of this ticket is that nothing the autonomous path adds changes
what `provision_secondary_host.sh` does. Re-run BL-101's own existing tests
(`test_generate_secondary_conf.sh`, `test_generate_systemd_units.sh`) unchanged
after pulling this work — a diff in their output is a regression, not an
expected side effect.

## 5. Security posture and reboot resilience

Identical to BL-101 sections 6 and 7: outbound-only, repo-scoped credentials
only, and the same `Type=oneshot`/`RemainAfterExit=yes` systemd shape backing
loss-free reboot recovery via durable queue state. The front-desk unit here
follows the same `Restart=always`/`StartLimitIntervalSec=0` shape BL-101's own
front-desk unit (section 7) uses — it is installed automatically by this
script rather than as a separate manual step, since an autonomous swarm's
Telegram channel is part of its bring-up, not an add-on.

## If something breaks specifically on this path

If the autonomous shape breaks in a way this runbook's steps don't route
around, file it as its own ticket with the root cause — same policy as
BL-101's own "if something breaks" section.
