# BL-101: Headless Secondary Swarms on a Raspberry Pi or VPS

**Turns an always-on headless Linux box into a fire-and-forget secondary
swarm ("throughput brick"): boots into a working swarm unattended, resumes
after a reboot with no human action, and needs nothing but outbound network
access.**

This extends [BL-091's WSL2 bring-up](BL-091-wsl2-second-swarm-bringup.md) —
read that first for the shared concepts (secondary mode, the shared backlog,
BL-092's wake-up bridge). This runbook covers what's specific to unattended
headless hardware: systemd instead of a human-attended terminal, pinned
substrate installs, headless `claude` auth, and a tighter security posture
(the VPS target is internet-facing).

Two reference targets, one recipe:
- **Raspberry Pi 5**, ARM64, **8GB RAM minimum**, **NVMe or USB-SSD storage
  required** — SD cards are excluded here for durability and speed under a
  swarm's sustained git/filesystem churn.
- **A VPS**, x86_64, **4GB+ RAM** for a full 7-role pack (drop roles for a
  smaller instance — see "Scaling down" below).

## 1. Prerequisites

- SSH access to the box already working (key-only auth — see "Security
  posture" below; this runbook does not set up SSH itself).
- A non-root user to run the swarm as (do not provision as root).
- A repo-scoped git credential (deploy key or fine-grained PAT) — see
  "Repo-scoped credentials only" below. Set this up **before** running the
  provisioning script; it needs the clone URL.
- This box's own unique `swarm_name` decided (e.g. `pi5`, `vps-hetzner1`) —
  every swarm sharing the backlog needs a distinct one (BL-090
  multi-swarm-06 rejects a duplicate).

## 2. Automated provisioning

```sh
git clone <this repo, via a throwaway/bootstrap credential or from an
  existing checkout you scp over> ~/swarmforgevc-bootstrap
~/swarmforgevc-bootstrap/swarmforge/deploy/provision_secondary_host.sh \
  <swarm-name> <repo-scoped-clone-url> [project-root]
```

`provision_secondary_host.sh` (script-tested logic; see
`swarmforge/scripts/test/test_generate_secondary_conf.sh` and
`test_generate_systemd_units.sh` for the parts that are pure generation, not
hardware install) does, in order:

1. Installs base packages (`tmux`, `git`, `curl`, `python3`) and `gh` via its
   official signed apt repo.
2. Installs **pinned** substrate from `swarmforge.lock.json`'s
   `secondary_host_substrate` section — babashka, Node.js, and the `claude`
   CLI, each at an exact version, never a floating `latest` URL. Bumping a
   pin is a human commit to that file (engineering.prompt's pin rule),
   applied by re-running this script.
3. Writes `~/.claude/settings.json` with `DISABLE_AUTOUPDATER=1` — a
   headless box must not silently self-update `claude` mid-operation; its
   version only moves when a human bumps the pin and re-runs provisioning.
4. Clones the repo (using the repo-scoped credential you set up in step 1
   above) to `project-root` (default `~/swarmforgevc`).
5. Generates this box's own secondary-mode conf
   (`generate_secondary_conf.sh <swarm-name>` — substitutes only the
   `swarm_name` line into the shared `packs/second-swarm.conf` template,
   validated the same way that template itself is, by sourcing the real
   `swarmforge.sh` parser) and its systemd unit
   (`generate_systemd_units.sh`), then enables the unit (`systemctl enable`)
   so it starts on every future boot.
6. Generates and enables a **second** systemd unit (BL-304,
   `generate_systemd_units.sh ... --unit=operator`) supervising the
   Operator runtime (`operator_runtime.bb`) itself — previously nothing
   restarted it after a crash, OOM, or reboot, leaving the Operator
   permanently dead until a human intervened. Like the swarm unit,
   `Restart=always` with `StartLimitIntervalSec=0` (systemd's own
   start-rate-limit disabled) means a crash burst never parks it in a
   permanent failed state, and `WantedBy=multi-user.target` brings it back
   after a reboot. It shares the same `EnvironmentFile=` as the swarm unit
   (see step 3 below), and is enabled + started immediately by the
   provisioning script — it retries harmlessly until authentication (step
   3) is in place.

The script prints the remaining **manual** steps at the end (repeated below
with detail).

## 3. Manual step: authenticate `claude`

Two options, matching what BL-091's own pack already assumes
(`--remote-control` on every role window):

**Option A — one-time interactive login (keeps Remote Control working):**
```sh
claude
```
This opens an auth URL — the box itself has no browser, but the URL can be
completed from **any** device (your phone, your laptop). This is a one-time
step; subsequent operation needs no further interaction, and the swarm's
existing `--remote-control` flags in `packs/second-swarm.conf` keep working
(mobile monitoring, per BL-073's Remote Control setup).

**Option B — a scoped, fully-scriptable token (drops Remote Control):**
```sh
claude setup-token   # prints a one-year OAuth token; requires Pro/Max/Team/Enterprise
```
Write it to `/etc/swarmforge/<swarm-name>.env` (created, empty, root-owned,
mode 600 by the provisioning script) — **not** the shell profile: a systemd
service starts with a clean environment and never sources it, so an export
there would never reach the swarm process. The generated unit's
`EnvironmentFile=-/etc/swarmforge/<swarm-name>.env` is what actually feeds
this to the swarm — the same file backs the Operator unit's
`EnvironmentFile=` too (step 6 above), so restart both to pick up a new
token:
```sh
echo "CLAUDE_CODE_OAUTH_TOKEN=<the printed token>" | sudo tee /etc/swarmforge/<swarm-name>.env >/dev/null
sudo systemctl restart swarmforge-<swarm-name>.service            # picks up the new env
sudo systemctl restart swarmforge-operator-<swarm-name>.service   # same env, operator side
```
`CLAUDE_CODE_OAUTH_TOKEN` is scoped to inference only and **cannot** open a
Remote Control session — use this only if you don't need mobile monitoring
of this particular box, and drop `--remote-control <name>` from its conf's
`window` lines if you go this route (an unused flag there is a stale
reference, not a functional problem, but keep it accurate).

## 4. Manual step: register the GitHub Actions self-hosted runner (BL-092)

Follow BL-091's own section 6 verbatim for the workflow-wiring half
(`second-swarm-wakeup.yml`, the `SECOND_SWARM_CHECKOUT_PATH` variable, the
`SECOND_SWARM_NAME` match). The runner install itself uses **its own**
installer and systemd unit:

```sh
# from the runner download+config commands GitHub's UI generates for you:
./config.sh --url <repo-url> --token <registration-token> --labels <swarm-name>
sudo ./svc.sh install
sudo ./svc.sh start
```

Pin the runner version per `swarmforge.lock.json`'s
`secondary_host_substrate.github_actions_runner` entry when downloading the
tarball GitHub's UI links to. Unlike the other substrate pins, GitHub
enforces a **mandatory** upgrade window (self-hosted runners must update
within 30 days of each new release, 2026 policy) — this pin needs a
recurring human bump, not a set-and-forget one; re-check it periodically.

`./svc.sh install` generates and enables the runner's own systemd unit —
deliberately not hand-authored here, so it never drifts from upstream's own
service definition as that project changes.

## 5. Start the swarm

```sh
sudo systemctl start swarmforge-<swarm-name>.service
```

Every later boot starts it automatically (`systemctl enable`, already done
by the provisioning script). Verify:

```sh
systemctl status swarmforge-<swarm-name>.service
tmux -S <socket path>  # or: tmux attach, if attaching directly on the box
```

## 6. Security posture

- **Outbound only.** The provisioning script opens no inbound port. The only
  inbound service on either reference target is SSH, key-only (password
  auth off — `PasswordAuthentication no` in `sshd_config`, a standard
  hardening step this runbook assumes you already apply as part of getting
  SSH access in the first place). Verify with `ss -tlnp` (or `sudo ss
  -tlnp` for full detail) after provisioning: nothing but `sshd` should
  appear.
- **Repo-scoped credentials only.** The git credential this box clones and
  pushes with must grant access to **this repository only** — a
  fine-grained GitHub PAT scoped to the one repo, or a deploy key
  (read/write) added to the repo's own deploy-key list. Never a broad
  account-wide token. Secrets (this credential, the GitHub Actions
  runner's registration token once consumed, `CLAUDE_CODE_OAUTH_TOKEN` if
  using Option B above) live in the unit's environment or root-owned files
  — never inside the repo clone itself (nothing under `project-root` should
  contain a secret; `git status` in the clone should never show a
  credential file as untracked).

## 7. Reboot resilience

The systemd unit (`Type=oneshot`, `RemainAfterExit=yes`) both starts the
swarm on boot and tears it down cleanly via the existing `./swarm-kill` path
on `systemctl stop` (or shutdown) — never a bespoke stop mechanism. Durable
queue state (the git-tracked backlog plus each role's on-disk mailbox) is
what makes a reboot loss-free: a parcel mid-flight when power is lost is
sitting in a role's `inbox/new` or `inbox/in_process` exactly where it was,
and that role's pane picks it back up once the swarm relaunches — no
in-memory state to lose.

To rehearse this: `sudo systemctl reboot` the box while a role is actively
mid-parcel, then confirm after boot that `systemctl status
swarmforge-<swarm-name>.service` reports active and the same parcel is still
visible in that role's mailbox (nothing archived/dropped by the reboot
itself).

## 8. Scaling down (smaller VPS instances)

The full pack (`packs/second-swarm.conf`) runs the whole pipeline minus
coordinator (specifier, coder, cleaner, architect, hardener, documenter, QA)
— seven agent panes. On a VPS with less than ~4GB RAM, drop `window` lines
for roles you don't need running continuously (e.g. `documenter`,
`architect`) rather than lowering every role's resource footprint equally;
the coordinator's cross-swarm orthogonality rule (BL-090) still applies
regardless of which roles a given secondary swarm runs.

## 9. Throughput-aware assignment

Small hosts (Pi 5 especially) run CPU-bound gates — the full test suite,
mutation testing — **2-4x slower** than a full-size machine; API-bound
stages (an agent's own LLM calls) run at essentially full speed regardless
of host. The coordinator's assignment guidance already accounts for this
(see `swarmforge/roles/coordinator.prompt`'s Swarm Optimizer section) —
prefer routing mutation-heavy/hardener-long tickets to the fastest swarm and
ordinary parcels to bricks like this one. Guidance, not a hard rule;
assignment stays the coordinator's call.

## 10. Verification checklist (before calling a box's bring-up done)

Mirrors this ticket's own acceptance scenarios — hardware walkthroughs, not
something a unit test can exercise:

- [ ] `systemctl status swarmforge-<swarm-name>.service` and the Actions
      runner's own service both report enabled + active after a fresh boot,
      with no manual step taken.
- [ ] The box appears as a registered secondary: its specifier picks up a
      ticket assigned to its `swarm_name` without the operator touching it.
- [ ] Rebooting mid-parcel (section 7) is loss-free.
- [ ] `ss -tlnp` shows no inbound listener besides `sshd`.
- [ ] The git credential in use is repo-scoped (check the credential's own
      GitHub permissions page), and `git status` in the clone shows no
      untracked secret file.
- [ ] One full parcel (assignment → pipeline → QA → push to shared `main`)
      has completed successfully on **each** reference target — once on the
      Pi, once on the VPS — before considering BL-101 itself done.

## If something breaks specifically on headless hardware

If the swarm substrate turns out to be broken on Pi/VPS hardware in a way
this runbook's steps don't route around, that's a genuine substrate bug —
file it as its own ticket with the root cause (same policy as BL-091's own
"if something breaks" section), rather than patching around it here.
