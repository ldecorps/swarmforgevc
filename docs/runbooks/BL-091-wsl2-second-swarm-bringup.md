# BL-091: Bringing Up a Second Swarm on Windows via WSL2

**Runs a full second pipeline (specifier → coder → cleaner → architect →
hardener → documenter → QA) on a Windows machine, coordinated with your
primary swarm entirely through git.**

Native Windows is out of scope — SwarmForge's process substrate is tmux, which
has no native Windows port. "Windows support" means: you sit at the Windows
box, and the swarm runs inside WSL2 (a real Linux userland). The VS Code
extension is **not** part of this bring-up — watch the remote swarm from the
remote box's own editor or plain `tmux attach`, the same as any headless
launch.

This second swarm always launches in **secondary mode** (BL-090): no
coordinator window, no triage/promotion authority. It only works tickets your
primary machine's coordinator has already assigned to it (a ticket's `swarm:`
field), and pushes QA-approved merges straight to the shared `main` like any
other swarm.

## 1. Prerequisites (inside WSL2)

Install a Linux distro under WSL2 (Ubuntu is the reference target; any distro
with these packages works identically since none of this depends on
distro-specific tooling):

- **tmux** — the process substrate.
- **babashka (`bb`)** — runs every `swarmforge/scripts/*.bb` handoff/queue
  script.
- **git** — the cross-machine coordination transport; this bring-up has none
  other.
- **gh** (GitHub CLI) — used for opening/merging pull requests.
- **claude** (Claude Code CLI) — the agent runtime each role pane runs.

Verify each is on `PATH` before continuing:

```sh
tmux -V && bb --version && git --version && gh --version && claude --version
```

## 2. Clone location: inside the WSL2 filesystem, never `/mnt/c`

Clone the repo somewhere under the WSL2 Linux filesystem itself (e.g.
`~/code/`), **not** under `/mnt/c/...`. `/mnt/c` is Windows' NTFS mounted
through the 9p protocol: file I/O there is dramatically slower than native
ext4, and filesystem-watch events (used throughout the handoff daemon's
delivery loop and the extension's own file watchers) do not reliably cross
that boundary. Confirm your clone isn't on a drvfs mount:

```sh
df -T . | awk 'NR==2 {print $2}'   # must print ext4 (or similar), never drvfs
```

```sh
mkdir -p ~/code && cd ~/code
git clone <your-fork-or-repo-url> swarmforgevc
cd swarmforgevc
```

## 3. Configure the second swarm

Use the ready-made pack at `swarmforge/packs/second-swarm.conf` — the full
pipeline minus coordinator, `swarm_name second`, `swarm_mode secondary
primary`:

```sh
cat swarmforge/packs/second-swarm.conf
```

If your primary machine already assigns tickets under a different
`swarm_name`, or your primary swarm's own `config swarm_name` isn't the
default `primary`, edit the two `config` lines at the top of the pack to
match before launching — the name only has to match what the primary
coordinator's promotion step assigns tickets to (see `swarmforge/scripts/
test/test_second_swarm_pack.sh` for what a valid pack must satisfy).

## 4. Launch

```sh
SWARMFORGE_TERMINAL=none ./swarm ~/code/swarmforgevc --pack second-swarm
```

`SWARMFORGE_TERMINAL=none` runs headless (no terminal-emulator window
spawned) — attach directly with `tmux attach` when you want to watch, or run
`./swarm ensure ~/code/swarmforgevc` at any point to check/repair the swarm
without relaunching.

On a successful launch:
- Every configured role (specifier, coder, cleaner, architect, hardener,
  documenter, QA) comes up with a live agent pane — **no coordinator pane**.
- The handoff daemon delivers parcels between those panes exactly as on a
  primary swarm; only the coordinator/promotion role is absent.
- The launch fails fast (before any pane starts) if the conf is malformed —
  e.g. `swarm_mode secondary` naming no primary, or a `window coordinator`
  line present at all (BL-243: the coordinator is always auto-provisioned,
  never conf-declared, in every mode — not only under secondary mode as
  before). Fix the conf and relaunch; nothing
  partially starts.

BL-215: this headless daemon reads `RESEND_API_KEY` from its own process
environment (never VS Code SecretStorage, which a headless launch has no
access to) — export it in the same shell/session before running `./swarm`,
or in whatever launcher/systemd unit starts it, if you want the BL-144
daemon-death alarm or BL-214 briefing email to actually send. A
`notify_email_to` configured in `swarmforge.conf` with no `RESEND_API_KEY`
in the daemon's env no longer fails silently: it logs a loud warning naming
`RESEND_API_KEY` to `.swarmforge/daemon/handoffd-supervisor.log`.

## 5. Working the shared backlog

BL-090 wired the shared-backlog convention (a ticket's `swarm:` field); BL-092
(below) wires the automatic wake-up itself. Without it, pull regularly
(`git pull`) so the second swarm's specifier sees newly assigned tickets.

Once pulled, the second swarm's specifier only routes tickets whose `swarm:`
field names it — it ignores every ticket assigned elsewhere, and the
coordinator's cross-swarm orthogonality rule already prevents two swarms
picking up overlapping scope at once (BL-090 multi-swarm-03/04). QA-approved
merges push to the shared `main` with the same fetch/re-merge/retry
discipline as a primary swarm's specifier — a push race is retried, never
force-pushed, never silently dropped (BL-090 multi-swarm-05).

## 6. Automatic wake-up on relevant pushes (BL-092)

Replaces the manual/periodic `git pull` above with an event-driven nudge,
using GitHub itself as the notification bus - no inbound ports, tunnels, or
firewall changes on either machine, since a self-hosted runner holds an
outbound long-poll connection to GitHub.

**Register a self-hosted runner from inside this same WSL2 environment:**

1. In the repo's GitHub settings, add a new self-hosted runner and follow
   GitHub's own generated registration commands (`config.sh` +
   `run.sh`/`svc.sh`) inside this WSL2 shell - the runner process lives
   alongside the swarm on the same Linux userland.
2. Give it the label `second-swarm` (in addition to GitHub's defaults) -
   `.github/workflows/second-swarm-wakeup.yml` targets exactly that label,
   so the workflow only ever runs on this machine.
3. Set the repository (or environment) variable
   `SECOND_SWARM_CHECKOUT_PATH` to this swarm's persistent clone path from
   step 2 above (e.g. `/home/you/code/swarmforgevc` - never `/mnt/c`). Not
   a secret: a plain local path, safe as a `vars.*` value.
4. If this swarm's own `swarmforge.conf`/pack sets a `swarm_name` other
   than the default `second`, update `SECOND_SWARM_NAME` in the workflow
   YAML to match - it only has to equal what the primary coordinator's
   promotion step assigns tickets to.

On a relevant push to `main` (one that touches `backlog/active/` or
`backlog/paused/`), the workflow syncs this checkout (fast-forward only)
and, only if a changed item is actually assigned to this swarm, wakes the
specifier pane via this swarm's own tmux socket - the identical wake
handoffd.bb's own daemon sends locally. A push that only concerns another
swarm's assignments never wakes this one.

**Fallback for a GitHub/Actions outage:** schedule
`swarmforge/scripts/remote_wakeup_periodic_pull.sh <checkout-path>` as a
slow crontab entry (every 10-15 minutes is plenty) so the local checkout
never goes stale for long even without the instant nudge - every role
(the specifier included) already runs its own idle self-check
(`ready_for_next.sh`) once idle past its own timeout, so a fresh checkout
alone is enough for newly assigned work to surface on its own:

```sh
crontab -e
# add:
*/10 * * * * /home/you/code/swarmforgevc/swarmforge/scripts/remote_wakeup_periodic_pull.sh /home/you/code/swarmforgevc
```

## 7. Stop

```sh
./swarm ensure ~/code/swarmforgevc   # check/repair without relaunching
```

Kill the swarm the same way as any other SwarmForge instance — see
`docs/GettingStarted.md`'s troubleshooting section for the general recovery
command; there is nothing WSL2-specific about stopping a swarm once it's up.

## If something breaks specifically under WSL2

If the swarm substrate itself (`./swarm`, tmux, `handoffd`, the queue
helpers, worktree setup) turns out to be broken under WSL2 in a way this
runbook's steps don't route around, that's a genuine substrate bug, not a
bring-up gap — file it as its own ticket with the root cause, rather than
patching around it here. The substrate is meant to run unmodified inside
WSL2's real Linux userland.
