#!/usr/bin/env bash
# Install an official static tmux >= 3.7 into ~/.local/bin (no root).
#
# Fixes WSL control-plane segfaults from Ubuntu tmux 3.4 (resize.c NULL
# window, fault at offset 0x208) - see
# docs/how-to/BL-tmux-wsl-segfault-upgrade.md.
#
# BL-1069 (stamp-off of the landed hotfix): this either produces a VERIFIED
# tmux or refuses by name. The original landed version curled a floating
# version to an x86_64-only URL with no checksum and no architecture branch,
# so on an unsupported machine it downloaded whatever the URL happened to
# return, and on any machine it installed whatever came back. Three things
# changed and nothing else:
#
#   1. The architecture is resolved against a table of builds that actually
#      exist; a host outside it is refused by name rather than pointed at a
#      URL that will 404 or, worse, at a build for another machine.
#   2. The download is verified against an expected sha256 before anything
#      is installed, so a refusal leaves nothing behind at ~/.local/bin/tmux.
#   3. The "did we find a binary" guard says what it meant. The landed test
#      read `[[ -z "$SRC" || ! -x "$SRC" && ! -f "$SRC" ]]`; inside `[[ ]]`
#      `&&` binds tighter than `||`, so it meant `-z || (!-x && !-f)`, and
#      since `find -type f` already guarantees `-f` the second clause could
#      never fire. The whole test was `-z "$SRC"`.
#
# Dual-purpose, the same posture as tunnel_ownership_lib.sh: run directly, or
# sourced by a test for its functions. No `set -e` at file scope for that
# reason - a sourced library must never change the calling shell's options.
# The run guard at the bottom sets it for the real run.

# Pinned, never floating (engineering.prompt, Startup Tools). Overridable for
# a deliberate one-off, but bumping the default is a human commit.
TMUX_INSTALL_DEFAULT_VERSION="3.7b"

# BL-971: the scratch root is removed on EVERY exit path, not only when the
# run reaches its last line. tmux_install_main removes it itself on both the
# success and the refusal path; the EXIT trap in the run guard at the bottom
# catches a signal or a `set -e` abort. The trap is installed ONLY on the
# executed path - a sourced library must never install one in the calling
# shell.
TMUX_INSTALL_TMPDIR=""

tmux_install_cleanup() {
  if [[ -n "${TMUX_INSTALL_TMPDIR:-}" ]]; then
    rm -rf -- "$TMUX_INSTALL_TMPDIR"
    TMUX_INSTALL_TMPDIR=""
  fi
}

tmux_install_refuse() {
  echo "install_tmux_wsl: refusing - $*" >&2
  return 1
}

# The host architectures with a published static build, and what the release
# names them. Data, so adding one is a row rather than a new code path.
tmux_install_arch_slug() {
  case "${1:-}" in
    x86_64|amd64) printf '%s\n' 'x86_64' ;;
    *) return 1 ;;
  esac
}

# Published digests, keyed "<version>:<arch>". EMPTY BY DESIGN: a digest is a
# pin, and pinning is a human commit, never an agent action. Until a human
# adds the entry they verified themselves, the caller supplies
# TMUX_INSTALL_SHA256 - and with neither, this script refuses rather than
# installing something nobody checked.
tmux_install_known_sha256() {
  case "${1:-}" in
    # 3.7b:x86_64) printf '%s\n' '<sha256 a human verified>' ;;
    *) return 1 ;;
  esac
}

tmux_install_expected_sha256() {
  if [[ -n "${TMUX_INSTALL_SHA256:-}" ]]; then
    printf '%s\n' "${TMUX_INSTALL_SHA256}"
    return 0
  fi
  tmux_install_known_sha256 "${1:-}:${2:-}"
}

tmux_install_sha256_of() {
  local file="${1:-}"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$file" | awk '{print $1}'
  else
    return 1
  fi
}

# Everything between the download and the install. Split out so the caller
# below can remove the scratch directory on every exit path without this
# function having to carry a trap of its own.
tmux_install_fetch_and_place() {
  local tmp="${1:-}" url="${2:-}" expected="${3:-}" bin="${4:-}"
  local src actual

  curl -fsSL -o "$tmp/tmux.tgz" "$url" \
    || { tmux_install_refuse "the download failed: $url"; return 1; }

  actual="$(tmux_install_sha256_of "$tmp/tmux.tgz")" \
    || { tmux_install_refuse "no sha256 tool is available to verify the download"; return 1; }
  if [[ "$actual" != "$expected" ]]; then
    tmux_install_refuse "the downloaded build fails its digest: expected ${expected}, got ${actual}"
    return 1
  fi

  tar -xzf "$tmp/tmux.tgz" -C "$tmp" \
    || { tmux_install_refuse "the downloaded build could not be unpacked: $url"; return 1; }

  # tarball layout: tmux-<ver>/tmux, or a bare tmux
  src="$(find "$tmp" -type f -name tmux | head -1)"
  if [[ -z "$src" || ! -f "$src" ]]; then
    tmux_install_refuse "the downloaded build contains no tmux binary: $url"
    return 1
  fi

  # Nothing above this line has touched $bin, so every refusal leaves the
  # host exactly as it found it.
  mkdir -p "$bin"
  install -m 755 "$src" "${bin}/tmux" \
    || { tmux_install_refuse "could not install into ${bin}"; return 1; }
  echo "Installed: $("${bin}/tmux" -V 2>/dev/null || echo 'tmux (version unreadable)') -> ${bin}/tmux"
  echo "Put ${bin} first on PATH, then bounce the swarm control plane (kill-server + ./swarm ensure)."
}

tmux_install_main() {
  local bin version machine arch url expected tmp status
  bin="${HOME}/.local/bin"
  version="${TMUX_INSTALL_VERSION:-$TMUX_INSTALL_DEFAULT_VERSION}"

  machine="$(uname -m 2>/dev/null || printf 'unknown\n')"
  if ! arch="$(tmux_install_arch_slug "$machine")"; then
    tmux_install_refuse "the host architecture has no build: no published static tmux for '${machine}'"
    return 1
  fi

  url="${TMUX_INSTALL_URL:-https://github.com/tmux/tmux-builds/releases/download/v${version}/tmux-${version}-${arch}.tar.gz}"

  if ! expected="$(tmux_install_expected_sha256 "$version" "$arch")"; then
    tmux_install_refuse "no published digest for tmux ${version} on ${arch}; set TMUX_INSTALL_SHA256 to the digest you verified"
    return 1
  fi

  TMUX_INSTALL_TMPDIR="$(mktemp -d "${TMPDIR:-/tmp}/tmux-install.XXXXXX")"
  tmp="$TMUX_INSTALL_TMPDIR"
  status=0
  tmux_install_fetch_and_place "$tmp" "$url" "$expected" "$bin" || status=$?
  tmux_install_cleanup
  return "$status"
}

if [[ "${BASH_SOURCE[0]:-$0}" == "$0" ]]; then
  set -euo pipefail
  trap tmux_install_cleanup EXIT
  tmux_install_main "$@"
fi
