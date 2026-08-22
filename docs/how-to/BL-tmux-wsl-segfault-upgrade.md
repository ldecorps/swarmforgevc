# WSL tmux control-plane segfault — upgrade to ≥ 3.7

## Problem

On WSL with Ubuntu’s packaged **tmux 3.4**, the control-plane server can
SIGSEGV (`segfault at 208` in dmesg). That maps to a NULL-window deref in
`resize.c` when `WINDOW_SIZE_MANUAL` is set. Upstream fixed it in commit
`6234d79` (“Do not set manual size if no window”), shipped in **tmux ≥ 3.7**.

After the crash, daemons stay up while `./swarm status` reports
`control-plane-missing`. Babysitter can `./swarm ensure`, but if PATH still
starts the old 3.4 binary, the new server will crash again.

## Fix (no root required)

Install the official static **3.7b** binary onto `~/.local/bin` (already
preferred by babysitterd and by `./swarm ensure` / launch via
`prefer_local_tmux_bin` in `swarmforge.sh`):

```bash
# BL-1069: the installer verifies the download before it installs anything,
# so it needs the digest you expect. Take the sha256 from the release page:
TMUX_INSTALL_SHA256=<sha256 from the release page> \
  bash swarmforge/scripts/install_tmux_wsl.sh
# It refuses BY NAME - and leaves nothing at ~/.local/bin/tmux - when the
# host architecture has no published build, or the download fails its digest.
#
# or manually:
mkdir -p ~/.local/bin
curl -fsSL -o /tmp/tmux-3.7b.tar.gz \
  https://github.com/tmux/tmux-builds/releases/download/v3.7b/tmux-3.7b-x86_64.tar.gz
tar -xzf /tmp/tmux-3.7b.tar.gz -C /tmp
install -m 755 /tmp/tmux-3.7b/tmux ~/.local/bin/tmux
~/.local/bin/tmux -V   # expect: tmux 3.7b
```

Then **bounce the live control plane** so the *server* is 3.7b (a client
upgrade alone leaves an existing 3.4 server running):

```bash
export PATH="$HOME/.local/bin:$PATH"
SOCK="$(cat .swarmforge/tmux-socket)"
tmux -S "$SOCK" kill-server || true
./swarm ensure
tmux -S "$(cat .swarmforge/tmux-socket)" display-message -p '#{version}'
# expect: 3.7b (not 3.4)
```

`./swarm ensure` and full launch also set `focus-events off` as a soft
mitigation; it does **not** replace the version upgrade, which is the only
thing that actually protects this host.

They no longer set `window-size largest`. It read as a second mitigation and
was never one: `resize-window` sets `window-size` to `manual` *in the window
options* (tmux(1)), and the extension's tiling panel resizes every role
window, so a window option beat the server global on exactly the windows the
swarm runs in (BL-1075).

## Verify

```bash
readlink "/proc/$(pgrep -n -f 'tmux: server.*swarmforgevc/.swarmforge/tmux')/exe"
# expect: .../home/.../.local/bin/tmux
./swarm status
```
