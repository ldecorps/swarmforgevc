#!/usr/bin/env bash
# BL-1247 acceptance driver: invokes the REAL handoffd.bb (never a
# reimplementation) via its --reconcile-sweep-once one-shot flag (same
# posture as --sweep-once/--chase-sweep-once), against a real fixture repo
# with local main genuinely diverged two ways from a real origin remote -
# a local commit origin lacks, and an origin commit local lacks.
#
# Usage: bl1247ReconcileSweepKillSwitchCli.sh <mode> [param]
#   matrix <on|off|absent|unreadable>  - scenario 01
#   main-unmoved                        - scenario 02 (switch off)
#   skip-log                            - scenario 03 (switch off)
#   toggle-without-restart              - scenario 04
# Prints one JSON line.

set -uo pipefail

MODE="$1"
PARAM="${2:-}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
HANDOFFD="$SCRIPT_DIR/swarmforge/scripts/handoffd.bb"

ROOT="$(mktemp -d)"
cleanup() { rm -rf "$ROOT"; }
trap cleanup EXIT

# ── origin (bare) + local clone, genuinely diverged two ways ──────────────
ORIGIN="$ROOT/origin.git"
git init -q --bare -b main "$ORIGIN"

LOCAL="$ROOT/local"
git clone -q "$ORIGIN" "$LOCAL"
git -C "$LOCAL" config user.email t@t
git -C "$LOCAL" config user.name t
git -C "$LOCAL" config commit.gpgsign false
git -C "$LOCAL" commit -q --allow-empty -m seed
git -C "$LOCAL" push -q origin main

# origin advances (a commit local does not have)
ORIGIN_CLONE="$ROOT/origin-side"
git clone -q "$ORIGIN" "$ORIGIN_CLONE"
git -C "$ORIGIN_CLONE" config user.email t@t
git -C "$ORIGIN_CLONE" config user.name t
git -C "$ORIGIN_CLONE" config commit.gpgsign false
git -C "$ORIGIN_CLONE" commit -q --allow-empty -m "origin-side progress"
git -C "$ORIGIN_CLONE" push -q origin main

# local advances independently (a commit origin does not have) -
# committed work, exactly what a reset-to-origin would destroy.
echo "committed work" > "$LOCAL/local-work.txt"
git -C "$LOCAL" add local-work.txt
git -C "$LOCAL" commit -q -m "local committed work"
LOCAL_TIP_BEFORE="$(git -C "$LOCAL" rev-parse HEAD)"

mkdir -p "$LOCAL/.swarmforge/daemon"
touch "$LOCAL/.swarmforge/tmux-socket"
printf 'coder\tcoder\t%s\tswarmforge-coder\tCoder\tclaude\ttask\n' "$LOCAL" > "$LOCAL/.swarmforge/roles.tsv"

set_switch() {
  local value="$1"
  mkdir -p "$LOCAL/swarmforge"
  case "$value" in
    on) echo "config master_main_reconcile_enabled true" > "$LOCAL/swarmforge/swarmforge.conf" ;;
    off) echo "config master_main_reconcile_enabled false" > "$LOCAL/swarmforge/swarmforge.conf" ;;
    absent) rm -f "$LOCAL/swarmforge/swarmforge.conf" ;;
    unreadable)
      echo "config master_main_reconcile_enabled true" > "$LOCAL/swarmforge/swarmforge.conf"
      chmod 000 "$LOCAL/swarmforge/swarmforge.conf"
      ;;
  esac
}

run_tick() {
  (cd "$LOCAL" && SWARMFORGE_ALLOW_TMP_DAEMON=1 timeout 15 bb "$HANDOFFD" "$LOCAL" --reconcile-sweep-once) >/dev/null 2>&1
}

log_tail() {
  tail -5 "$LOCAL/.swarmforge/daemon/"*.log 2>/dev/null
}

case "$MODE" in
  matrix)
    set_switch "$PARAM"
    run_tick
    LOG="$(log_tail)"
    RAN=false
    echo "$LOG" | grep -q "master-main-reconcile skipped-disabled" || RAN=true
    printf '{"ran":%s,"log":%s}\n' "$RAN" "$(bb -e '(println (cheshire.core/generate-string (slurp *in*)))' <<<"$LOG")"
    ;;

  main-unmoved)
    set_switch "off"
    run_tick
    run_tick
    LOCAL_TIP_AFTER="$(git -C "$LOCAL" rev-parse HEAD)"
    UNMOVED=false; [[ "$LOCAL_TIP_AFTER" == "$LOCAL_TIP_BEFORE" ]] && UNMOVED=true
    REACHABLE=false
    git -C "$LOCAL" merge-base --is-ancestor "$LOCAL_TIP_BEFORE" HEAD 2>/dev/null && REACHABLE=true
    printf '{"unmoved":%s,"reachable":%s}\n' "$UNMOVED" "$REACHABLE"
    ;;

  skip-log)
    set_switch "off"
    run_tick
    LOG="$(log_tail)"
    printf '{"log":%s}\n' "$(bb -e '(println (cheshire.core/generate-string (slurp *in*)))' <<<"$LOG")"
    ;;

  toggle-without-restart)
    set_switch "on"
    run_tick
    LOG1="$(log_tail)"
    RAN1=false
    echo "$LOG1" | grep -q "master-main-reconcile skipped-disabled" || RAN1=true
    set_switch "off"
    run_tick
    LOG2="$(log_tail)"
    RAN2=false
    echo "$LOG2" | grep -q "master-main-reconcile skipped-disabled" || RAN2=true
    printf '{"ranWhenOn":%s,"ranWhenOff":%s}\n' "$RAN1" "$RAN2"
    ;;

  *)
    echo "unknown mode: $MODE" >&2
    exit 2
    ;;
esac
