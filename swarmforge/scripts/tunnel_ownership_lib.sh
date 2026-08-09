#!/usr/bin/env bash
# BL-857: host-level ownership registry for the named ("production")
# cloudflared tunnel.
#
# Root cause this replaces: launch_resident_spy_tunnel.sh and
# stop_ancillary_services.sh used to track the tunnel with exactly one
# pidfile, root-relative ($ROOT/.swarmforge/operator/...). A sandbox runs
# with its own $ROOT, so its pidfile lands inside its own temp tree, where
# the live stop path (reading only ITS OWN root's pidfile) can never look -
# and once that tree is deleted, the only record of the pid is gone while
# the process keeps running, still bound to the production tunnel name.
#
# Fix: two durable, HOST-level records (default under
# $HOME/.swarmforge/tunnels - override via SWARMFORGE_TUNNEL_REGISTRY_DIR
# for tests, so a fixture's registry never depends on a $HOME that happens
# to coincide with a $ROOT the test is about to delete):
#   operator-root   - the one root allowed to bind a named tunnel, written
#                      once (like ~/.swarmforge/fleet/primary/root -
#                      fleet_telegram_creds_lib.bb's ensure-primary-root-
#                      recorded! - moving it is a deliberate human edit of
#                      the file, never something a later launch overwrites
#                      automatically).
#   <name>.owner    - "<pid> <root>" for whichever process most recently
#                      started serving tunnel <name>. Overwritten on every
#                      successful launch (unlike operator-root, "who owns
#                      this name right now" always reflects the latest
#                      launch).
#
# Dual-purpose file, same posture as stop_ancillary_services.sh: sourced
# for its functions by launch_resident_spy_tunnel.sh /
# setup_bubble_named_tunnel.sh / stop_ancillary_services.sh, or invoked
# directly as a small CLI so non-bash callers (JS step handlers, property
# tests) can drive the same registry writes without duplicating the file
# format. No `set -euo pipefail` at file scope for the same reason
# stop_ancillary_services.sh has none: a sourced library must never change
# the calling shell's options.
#
# Deliberately plain text, no jq/python - mirrors the primary-root
# convention above rather than inventing a JSON schema for a two-field
# record, and keeps this dependency-free for callers that only need bash.

tunnel_registry_dir() {
  printf '%s\n' "${SWARMFORGE_TUNNEL_REGISTRY_DIR:-${HOME:-}/.swarmforge/tunnels}"
}

# Resolve to an absolute, symlink-free path when the directory still
# exists; otherwise fall back to a slash-trimmed literal - a root
# comparison against a since-deleted sandbox tree (Invariant 2) must still
# compare correctly even though `cd` can no longer resolve it.
_tunnel_normalize_root() {
  local root="$1"
  if [[ -d "$root" ]]; then
    (cd "$root" && pwd)
  else
    local trimmed="${root%/}"
    printf '%s\n' "${trimmed:-/}"
  fi
}

_tunnel_atomic_write() {
  local file="$1" content="$2" dir tmp
  dir="$(dirname "$file")"
  mkdir -p "$dir"
  tmp="$dir/.$(basename "$file").tmp.$$"
  printf '%s' "$content" > "$tmp"
  mv -f "$tmp" "$file"
}

tunnel_operator_root_file() {
  printf '%s\n' "$(tunnel_registry_dir)/operator-root"
}

tunnel_read_operator_root() {
  local f
  f="$(tunnel_operator_root_file)"
  [[ -f "$f" ]] && cat "$f" || true
}

# Write-once: a no-op whenever a record already exists, whatever root it
# names. Moving the operator root is a deliberate human edit of the file,
# never something a launch does automatically (the same footgun BL-622
# closed for the primary-swarm Telegram creds: the FIRST caller must not
# get to silently self-appoint).
tunnel_register_operator_root() {
  local root existing
  root="$(_tunnel_normalize_root "$1")"
  existing="$(tunnel_read_operator_root)"
  [[ -n "$existing" ]] && return 0
  _tunnel_atomic_write "$(tunnel_operator_root_file)" "$root"
}

tunnel_is_operator_root() {
  local candidate recorded
  candidate="$(_tunnel_normalize_root "$1")"
  recorded="$(tunnel_read_operator_root)"
  [[ -n "$recorded" && "$recorded" == "$candidate" ]]
}

tunnel_owner_file() {
  local name="$1"
  printf '%s\n' "$(tunnel_registry_dir)/${name}.owner"
}

tunnel_record_owner() {
  local name="$1" pid="$2" root="$3"
  _tunnel_atomic_write "$(tunnel_owner_file "$name")" "$pid $root"
}

tunnel_read_owner_pid() {
  local name="$1" f pid rest
  f="$(tunnel_owner_file "$name")"
  [[ -f "$f" ]] || return 0
  read -r pid rest < "$f" 2>/dev/null || true
  printf '%s\n' "${pid:-}"
}

tunnel_clear_owner() {
  local name="$1"
  rm -f "$(tunnel_owner_file "$name")"
}

# ── Pure orphan decision (Invariants 1 & 3) ─────────────────────────────
#
# Reads candidate lines from stdin, shaped "<pid> <command...>" (pgrep -fl's
# own format - the caller decides how to obtain that list; this function
# never calls pgrep or kill itself, so a unit test can feed it fabricated
# lines without touching any real process - the ticket's "process list and
# the kill as injected edges" constraint). Prints the pids that ARE
# orphans: their command line names <name> as the argument immediately
# following a "run" token (never a bare substring match - "run
# swarmforge-bubble-staging" must never match "swarmforge-bubble"), and the
# pid is not in the space-separated PROTECTED pid list.
tunnel_decide_orphans() {
  local name="$1"
  shift
  local protected=" $* "
  local pid rest
  while read -r pid rest; do
    [[ -n "$pid" ]] || continue
    local matched=0 prev="" word
    for word in $rest; do
      if [[ "$prev" == "run" && "$word" == "$name" ]]; then
        matched=1
        break
      fi
      prev="$word"
    done
    [[ "$matched" -eq 1 ]] || continue
    case "$protected" in
      *" $pid "*) continue ;;
    esac
    printf '%s\n' "$pid"
  done
}

# ── Real edge: enumerate + kill (used by stop_ancillary_services.sh) ────

# Narrowed to candidates whose command line contains "run <name>" as a
# substring - defense in depth on top of tunnel_decide_orphans' own exact
# word-boundary check below, so a broad host-wide 'cloudflared' scan is
# never the only thing standing between this function and an unrelated
# live tunnel (e.g. the real operator instance itself, if this ever runs
# against anything other than the name it was scoped to reap).
_tunnel_live_process_lines() {
  local name="$1"
  pgrep -fl -- "run $name" 2>/dev/null || true
}

_tunnel_signal_pid() {
  local pid="$1"
  kill -TERM "$pid" 2>/dev/null || true
  sleep 0.3
  kill -0 "$pid" 2>/dev/null && kill -KILL "$pid" 2>/dev/null || true
}

# Reaps every live process bound to tunnel <name> that is neither this
# root's own local pidfile ($2, optional - protects the operator's own
# in-flight tunnel even if the host registry below is momentarily stale)
# nor the host registry's current live owner. A registry entry whose pid
# has already exited claims nothing (Invariant/stale-ownership-record-05) -
# it is simply excluded from the protected set, never treated as blocking
# the reap.
tunnel_reap_orphans() {
  local name="$1" local_pid_file="${2:-}"
  local protected_pids=()

  if [[ -n "$local_pid_file" && -f "$local_pid_file" ]]; then
    local p
    p="$(tr -d '[:space:]' < "$local_pid_file" 2>/dev/null || true)"
    if [[ "$p" =~ ^[0-9]+$ ]] && kill -0 "$p" 2>/dev/null; then
      protected_pids+=("$p")
    fi
  fi

  local reg_pid
  reg_pid="$(tunnel_read_owner_pid "$name")"
  if [[ -n "$reg_pid" ]] && kill -0 "$reg_pid" 2>/dev/null; then
    protected_pids+=("$reg_pid")
  fi

  local orphan
  while read -r orphan; do
    [[ -n "$orphan" ]] || continue
    _tunnel_signal_pid "$orphan"
  done < <(_tunnel_live_process_lines "$name" | tunnel_decide_orphans "$name" ${protected_pids[@]+"${protected_pids[@]}"})
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  set -euo pipefail
  cmd="${1:-}"
  shift || true
  case "$cmd" in
    register-operator-root) tunnel_register_operator_root "${1:?usage: register-operator-root <root>}" ;;
    is-operator-root) tunnel_is_operator_root "${1:?usage: is-operator-root <root>}" ;;
    read-operator-root) tunnel_read_operator_root ;;
    record-owner) tunnel_record_owner "${1:?usage: record-owner <name> <pid> <root>}" "${2:?pid}" "${3:?root}" ;;
    read-owner-pid) tunnel_read_owner_pid "${1:?usage: read-owner-pid <name>}" ;;
    clear-owner) tunnel_clear_owner "${1:?usage: clear-owner <name>}" ;;
    reap-orphans) tunnel_reap_orphans "${1:?usage: reap-orphans <name> [local-pid-file]}" "${2:-}" ;;
    decide-orphans)
      name="${1:?usage: decide-orphans <name> [protected-pid ...]}"
      shift
      tunnel_decide_orphans "$name" "$@"
      ;;
    *)
      echo "tunnel_ownership_lib: unknown subcommand '$cmd'" >&2
      echo "usage: tunnel_ownership_lib.sh <register-operator-root|is-operator-root|read-operator-root|record-owner|read-owner-pid|clear-owner|reap-orphans|decide-orphans> [...]" >&2
      exit 1
      ;;
  esac
fi
