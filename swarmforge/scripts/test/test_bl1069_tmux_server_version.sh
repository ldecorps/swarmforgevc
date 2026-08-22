#!/usr/bin/env bash
# BL-1069: the swarm judges its tmux by the SERVER it is actually running.
#
# Ubuntu's tmux 3.4 SIGSEGVs in resize.c on a NULL window (fault at 0x208);
# the upstream guard lands in 3.7. The incident state is the one that matters
# and the one a client-side check cannot see: the tmux on PATH was ALREADY
# 3.7b while `#{version}` on the swarm socket still answered 3.4, because the
# server predated the install.
#
# Every case here drives the REAL functions out of swarmforge.sh under
# `zsh -f` (no rcs: ~/.zshenv re-exports real credentials over fixture values
# on this host, and a launcher probe leaked a live key that way on 2026-08-22
# - nothing in this file prints an environment dump either way). The tmux
# these functions call is a fake on PATH that answers the version the case is
# about, so no real tmux server is ever started.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SWARMFORGE_SH="$SCRIPT_DIR/../swarmforge.sh"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

FAILURES=0
pass() { echo "  ok   - $1"; }
fail() { echo "  FAIL - $1"; FAILURES=$((FAILURES + 1)); }
check() { if [ "$2" = "$3" ]; then pass "$1"; else fail "$1 (expected '$3', got '$2')"; fi; }

# BL-971: removed on both the pass and the throw path, never only at the end.
BL1069_ROOTS=()
bl1069_cleanup() {
  local d
  for d in ${BL1069_ROOTS[@]+"${BL1069_ROOTS[@]}"}; do
    [ -n "$d" ] && rm -rf -- "$d"
  done
}
trap bl1069_cleanup EXIT

mkroot() {
  local d
  d="$(mktemp -d "${TMPDIR:-/tmp}/bl1069.XXXXXX")"
  BL1069_ROOTS+=("$d")
  printf '%s\n' "$d"
}

# A tmux that reports <version> as a client (`-V`) and, when a server version
# is given, as a server (`display-message -p '#{version}'`). "none" means the
# server does not answer, which is what a dead or absent plane looks like.
write_fake_tmux() {
  local path="$1" client_version="$2" server_version="$3"
  # /bin/sh by absolute path, and only shell builtins inside: the preference
  # cases below narrow PATH to almost nothing, and a fake that needed `env`
  # or `bash` found on PATH would fail for a reason the test is not about.
  cat > "$path" <<FAKE
#!/bin/sh
if [ "\${1:-}" = "-V" ]; then
  echo "tmux ${client_version}"
  exit 0
fi
if [ "\${3:-}" = "display-message" ]; then
  if [ "${server_version}" = "none" ]; then
    exit 1
  fi
  echo "${server_version}"
  exit 0
fi
exit 0
FAKE
  chmod +x "$path"
}

# Runs one snippet with swarmforge.sh sourced, under zsh -f, with FAKE_BIN
# first on PATH. stdout and stderr come back together: the warning is a
# stderr line and the assertions are about whether it appears at all.
run_sourced() {
  local fake_bin="$1" snippet="$2"
  PATH="$fake_bin:$PATH" zsh -f -c "
    source '$SWARMFORGE_SH' '$REPO_ROOT' >/dev/null 2>&1 || true
    $snippet
  " 2>&1
}

echo "BL-1069: version parsing"
KEY_ROOT="$(mkroot)"
write_fake_tmux "$KEY_ROOT/tmux" "3.7b" "none"
chmod +x "$KEY_ROOT/tmux"
out="$(run_sourced "$KEY_ROOT" 'tmux_version_key "tmux 3.4"')"
check "a client string parses to a sortable key" "$out" "003.004."
out="$(run_sourced "$KEY_ROOT" 'tmux_version_key "3.7b"')"
check "a bare server string parses, suffix and all" "$out" "003.007.b"
out="$(run_sourced "$KEY_ROOT" 'tmux_version_key "not a version" >/dev/null 2>&1 && echo PARSED || echo UNPARSEABLE')"
check "an unreadable version is UNPARSEABLE, never a number" "$out" "UNPARSEABLE"
out="$(run_sourced "$KEY_ROOT" 'tmux_version_lt "3.4" "3.7" && echo LT || echo GE')"
check "3.4 is below 3.7" "$out" "LT"
out="$(run_sourced "$KEY_ROOT" 'tmux_version_lt "3.7b" "3.7" && echo LT || echo GE')"
check "3.7b is NOT below 3.7 - the letter suffix is a later release, not an older one" "$out" "GE"
out="$(run_sourced "$KEY_ROOT" 'tmux_version_lt "wat" "3.7" && echo LT || echo GE')"
check "an unreadable version is never reported as too old" "$out" "GE"

echo "BL-1069: the verdict reads the server, not the client"
# The incident pairing first: a client that is already fine in front of a
# server that is not. The landed hotfix was silent here.
verdict_for() {
  local client="$1" server="$2" root out
  root="$(mkroot)"
  write_fake_tmux "$root/tmux" "$client" "$server"
  out="$(run_sourced "$root" "warn_if_tmux_too_old '/fake/socket'")"
  case "$out" in
    *WARN*) printf 'warned\n' ;;
    *) printf 'silent\n' ;;
  esac
}
check "client 3.7b in front of a 3.4 SERVER warns (the incident state)" "$(verdict_for 3.7b 3.4)" "warned"
check "client 3.4 in front of a 3.4 server warns" "$(verdict_for 3.4 3.4)" "warned"
check "no server answering falls back to a 3.4 client and warns" "$(verdict_for 3.4 none)" "warned"
check "a 3.7b server is silent" "$(verdict_for 3.7b 3.7b)" "silent"
check "no server answering and a 3.7b client is silent" "$(verdict_for 3.7b none)" "silent"

WARN_ROOT="$(mkroot)"
write_fake_tmux "$WARN_ROOT/tmux" "3.7b" "3.4"
warn_text="$(run_sourced "$WARN_ROOT" "warn_if_tmux_too_old '/fake/socket'")"
case "$warn_text" in
  *"the control-plane server"*) pass "the warning says it measured the server" ;;
  *) fail "the warning does not name what it measured: $warn_text" ;;
esac
case "$warn_text" in
  *3.4*) pass "the warning quotes the version it measured" ;;
  *) fail "the warning does not quote the measured version: $warn_text" ;;
esac
case "$warn_text" in
  *3.7b*) fail "the warning quotes the CLIENT version, which is not what it measured: $warn_text" ;;
  *) pass "the warning does not quote the client version it did not measure" ;;
esac

echo "BL-1069: preferring a tmux never lowers the version in use"
# `command -v tmux` after the call is the observable: which binary a client
# started now would be.
chosen_for() {
  local local_version="$1" path_version="$2" root home path_bin sandbox out
  root="$(mkroot)"
  home="$root/home"
  path_bin="$root/path-bin"
  # A "none" row means NO tmux anywhere on PATH, which the host's own
  # /usr/bin/tmux would otherwise quietly satisfy. PATH is therefore narrowed
  # to the fixture plus the one external tool these functions use, AFTER
  # swarmforge.sh has been sourced with the real PATH.
  sandbox="$root/sandbox-bin"
  mkdir -p "$home/.local/bin" "$path_bin" "$sandbox"
  ln -sf "$(command -v sed)" "$sandbox/sed"
  [ "$local_version" = "absent" ] || write_fake_tmux "$home/.local/bin/tmux" "$local_version" "none"
  [ "$path_version" = "none" ] || write_fake_tmux "$path_bin/tmux" "$path_version" "none"
  out="$(HOME="$home" zsh -f -c "
    source '$SWARMFORGE_SH' '$REPO_ROOT' >/dev/null 2>&1 || true
    PATH='$path_bin:$sandbox'
    prefer_local_tmux_bin
    command -v tmux 2>/dev/null || echo NONE
  " 2>/dev/null)"
  case "$out" in
    "$home/.local/bin/tmux") printf 'local\n' ;;
    "$path_bin/tmux") printf 'path\n' ;;
    *) printf 'none\n' ;;
  esac
}
check "a newer local build is preferred over an older one on PATH" "$(chosen_for 3.7b 3.4)" "local"
check "an OLDER local build never displaces a newer one on PATH" "$(chosen_for 3.4 3.7b)" "path"
check "a local build with nothing else on PATH is preferred" "$(chosen_for 3.7b none)" "local"
check "no local build leaves PATH alone" "$(chosen_for absent 3.7b)" "path"

echo "BL-1069: hardening is soft"
# A tmux that rejects every set-option, exactly as an older build would.
HARDEN_ROOT="$(mkroot)"
cat > "$HARDEN_ROOT/tmux" <<'FAKE'
#!/bin/sh
for arg in "$@"; do
  if [ "$arg" = "set-option" ]; then
    echo "unknown option" >&2
    exit 1
  fi
done
exit 0
FAKE
chmod +x "$HARDEN_ROOT/tmux"
out="$(PATH="$HARDEN_ROOT:$PATH" zsh -f -c "
  source '$SWARMFORGE_SH' '$REPO_ROOT' >/dev/null 2>&1 || true
  set -e
  TMUX_SOCKET='/fake/socket'
  harden_tmux_server
  echo SURVIVED
" 2>/dev/null)"
check "a tmux that rejects every stability knob never fails the caller" "$out" "SURVIVED"

# And a dead plane is a no-op, not an error.
DEAD_ROOT="$(mkroot)"
cat > "$DEAD_ROOT/tmux" <<'FAKE'
#!/bin/sh
exit 1
FAKE
chmod +x "$DEAD_ROOT/tmux"
out="$(PATH="$DEAD_ROOT:$PATH" zsh -f -c "
  source '$SWARMFORGE_SH' '$REPO_ROOT' >/dev/null 2>&1 || true
  set -e
  TMUX_SOCKET='/fake/socket'
  harden_tmux_server
  echo SURVIVED
" 2>/dev/null)"
check "a plane that is not up is a no-op, not a failure" "$out" "SURVIVED"

if [ "$FAILURES" -eq 0 ]; then
  echo "test_bl1069_tmux_server_version: ALL TESTS PASSED"
  exit 0
fi
echo "test_bl1069_tmux_server_version: $FAILURES FAILURE(S)"
exit 1
