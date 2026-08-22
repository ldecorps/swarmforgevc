#!/usr/bin/env bash
# Install official static tmux >= 3.7 into ~/.local/bin (no root).
# Fixes WSL segfaults from Ubuntu tmux 3.4 — see
# docs/how-to/BL-tmux-wsl-segfault-upgrade.md
set -euo pipefail

PREFIX="${HOME}/.local"
BIN="${PREFIX}/bin"
VER="${TMUX_INSTALL_VERSION:-3.7b}"
URL="${TMUX_INSTALL_URL:-https://github.com/tmux/tmux-builds/releases/download/v${VER}/tmux-${VER}-x86_64.tar.gz}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$BIN"
curl -fsSL -o "$TMP/tmux.tgz" "$URL"
tar -xzf "$TMP/tmux.tgz" -C "$TMP"
# tarball layout: tmux-<ver>/tmux or bare tmux
SRC="$(find "$TMP" -type f -name tmux | head -1)"
if [[ -z "$SRC" || ! -x "$SRC" && ! -f "$SRC" ]]; then
  echo "install_tmux_wsl: could not find tmux binary in $URL" >&2
  exit 1
fi
install -m 755 "$SRC" "${BIN}/tmux"
echo "Installed: $("${BIN}/tmux" -V) -> ${BIN}/tmux"
echo "Put ${BIN} first on PATH, then bounce the swarm control plane (kill-server + ./swarm ensure)."
