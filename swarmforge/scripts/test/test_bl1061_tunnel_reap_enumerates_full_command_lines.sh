#!/usr/bin/env bash
# BL-1061: tunnel_ownership_lib.sh's reap edge enumerates candidates with
# `pgrep -fl -- "run $name"` and feeds the result to tunnel_decide_orphans,
# which looks for a `run <name>` token pair in the text after the pid.
#
# `-f` makes pgrep MATCH on the full command line. `-l` decides what it
# PRINTS, and the two userlands disagree: BSD/macOS pgrep prints the full
# argument list, procps-ng (Linux) prints only the process NAME. So on Linux
# the lib feeds tunnel_decide_orphans lines shaped "12345 bash" - which
# contain no `run <name>` pair, match nothing, and reap nothing. The reap has
# never worked on a GNU userland, which is why orphaned fixture tunnels
# accumulate on this host.
#
# Same class as BL-1058's `mktemp -t`: authored on macOS, silently inert on
# Linux. `ps -o pid=,args=` is POSIX and prints the full command line on both.
#
# Every fixture here uses a per-run unique tunnel name. NEVER the production
# name: this file runs the REAL reap, which signals whatever it selects, and
# a fixture bound to the operator's tunnel name would make this test able to
# kill production transport.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LIB="$SCRIPT_DIR/../tunnel_ownership_lib.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

# FILES, not arrays. spawn_fake is invoked as `$(spawn_fake ...)`, and `$(...)`
# forks: an array appended to inside that subshell lives only in the
# subshell's copy of memory and is gone when it exits, so every fixture
# process and directory registered that way leaked. This is BL-801's finding
# in lib/tmp_cleanup.sh, rediscovered here the hard way - the first version of
# this file left eight `sleep 300` processes alive on the host. A file
# survives a fork the way a shell variable never can.
BL1061_REG="$(mktemp)"
BL1061_DIRREG="$(mktemp)"
cleanup() {
  local p d
  while IFS= read -r p; do
    [ -n "$p" ] && kill -KILL "$p" 2>/dev/null
  done < "$BL1061_REG"
  while IFS= read -r d; do
    [ -n "$d" ] && rm -rf -- "$d"
  done < "$BL1061_DIRREG"
  rm -f "$BL1061_REG" "$BL1061_DIRREG"
}
trap cleanup EXIT

uniq_name() { printf 'bl1061-test-%s-%s-%s\n' "$$" "$1" "$RANDOM"; }

# A harmless stand-in whose command line has the same shape a real cloudflared
# invocation has: "... run <name>".
spawn_fake() {
  local name="$1" dir pid
  dir="$(cd "$(mktemp -d)" && pwd -P)"
  printf '%s\n' "$dir" >> "$BL1061_DIRREG"
  printf '#!/usr/bin/env bash\nsleep 300\n' > "$dir/cloudflared"
  chmod +x "$dir/cloudflared"
  pid="$(bash -c '"$1" tunnel --config "$2/config.yml" --no-autoupdate run "$3" >/dev/null 2>&1 & echo $!' \
    _ "$dir/cloudflared" "$dir" "$name")"
  printf '%s\n' "$pid" >> "$BL1061_REG"
  # Wait for the command line to be readable, so the reap below is never
  # racing exec rather than testing the enumeration.
  local i
  for i in $(seq 1 30); do
    kill -0 "$pid" 2>/dev/null && break
    sleep 0.05
  done
  printf '%s\n' "$pid"
}

alive() { kill -0 "$1" 2>/dev/null; }

REG="$(cd "$(mktemp -d)" && pwd -P)"; printf '%s\n' "$REG" >> "$BL1061_DIRREG"
export SWARMFORGE_TUNNEL_REGISTRY_DIR="$REG"

# ═══════════════════════════════════════════════════════════════════════════
# (a) THE DEFECT: an unregistered process serving the name is an orphan and
#     must be reaped. This is what silently no-ops on a GNU userland.
# ═══════════════════════════════════════════════════════════════════════════

NAME_A="$(uniq_name a)"
PID_A="$(spawn_fake "$NAME_A")"
alive "$PID_A" || fail "a: the fixture process did not start - the case would prove nothing"
bash "$LIB" reap-orphans "$NAME_A" '' >/dev/null 2>&1
sleep 0.5
alive "$PID_A" && fail "a: an unregistered process serving the name survived the reap - the enumeration found nothing to reap"
pass "a: an unregistered process serving the tunnel name is reaped"

# ═══════════════════════════════════════════════════════════════════════════
# (b) The registered owner survives, and a second process under the same name
#     does not. This is the production behaviour and must not change.
# ═══════════════════════════════════════════════════════════════════════════

NAME_B="$(uniq_name b)"
PID_OWNER="$(spawn_fake "$NAME_B")"
PID_ORPHAN="$(spawn_fake "$NAME_B")"
bash "$LIB" record-owner "$NAME_B" "$PID_OWNER" '/irrelevant/root' >/dev/null 2>&1
bash "$LIB" reap-orphans "$NAME_B" '' >/dev/null 2>&1
sleep 0.5
alive "$PID_OWNER" || fail "b: the registered owner was reaped"
alive "$PID_ORPHAN" && fail "b: a second process under the same name survived the reap"
pass "b: the registered owner survives and the duplicate under the same name is reaped"

# ═══════════════════════════════════════════════════════════════════════════
# (c) A process serving a DIFFERENT name is never touched - including the
#     near-miss suffix case the lib's own comment calls out. This is the half
#     that keeps a reap from reaching the operator's real tunnel.
# ═══════════════════════════════════════════════════════════════════════════

NAME_C="$(uniq_name c)"
PID_TARGET="$(spawn_fake "$NAME_C")"
PID_SUFFIX="$(spawn_fake "${NAME_C}-staging")"
PID_OTHER="$(spawn_fake "$(uniq_name c-bystander)")"
bash "$LIB" reap-orphans "$NAME_C" '' >/dev/null 2>&1
sleep 0.5
alive "$PID_TARGET" && fail "c: the target orphan survived"
alive "$PID_SUFFIX" || fail "c: a near-miss suffixed name (${NAME_C}-staging) was reaped by a reap scoped to $NAME_C"
alive "$PID_OTHER" || fail "c: an unrelated tunnel name was reaped"
pass "c: a reap touches only the exact name, never a suffix or an unrelated tunnel"

# ═══════════════════════════════════════════════════════════════════════════
# (d) The local pid FILE protects its process even when it serves the name.
#     reap-orphans' second argument is a pid file, not a pid - the production
#     contract, and the shape stop_ancillary_services.sh passes.
# ═══════════════════════════════════════════════════════════════════════════

NAME_D="$(uniq_name d)"
PID_PROT="$(spawn_fake "$NAME_D")"
PID_FILE="$REG/local-$NAME_D.pid"
printf '%s\n' "$PID_PROT" > "$PID_FILE"
bash "$LIB" reap-orphans "$NAME_D" "$PID_FILE" >/dev/null 2>&1
sleep 0.5
alive "$PID_PROT" || fail "d: the process named by the local pid file was reaped"
pass "d: the process named by the local pid file is never signalled"

echo "ALL PASS: BL-1061 tunnel reap enumerates full command lines"
