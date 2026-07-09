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
  line present under secondary mode. Fix the conf and relaunch; nothing
  partially starts.

## 5. Working the shared backlog

Nothing here is automatic yet beyond what BL-090 already wired: pull
regularly (`git pull` on the primary machine's promotions and your own
specifier's routing decisions) so the second swarm's specifier sees newly
assigned tickets. (Automatic wake-on-new-mail across machines is BL-092;
until then, a periodic/manual `git pull` is expected.)

Once pulled, the second swarm's specifier only routes tickets whose `swarm:`
field names it — it ignores every ticket assigned elsewhere, and the
coordinator's cross-swarm orthogonality rule already prevents two swarms
picking up overlapping scope at once (BL-090 multi-swarm-03/04). QA-approved
merges push to the shared `main` with the same fetch/re-merge/retry
discipline as a primary swarm's specifier — a push race is retried, never
force-pushed, never silently dropped (BL-090 multi-swarm-05).

## 6. Stop

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
