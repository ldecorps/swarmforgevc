#!/usr/bin/env bash
# BL-359: installs and enables the operator-runtime and front-desk systemd
# units on THIS (primary/dogfood) host - the deliverable that makes the
# standing Operator conversation surface (BL-346) survive a crash, an OOM
# kill, or a reboot instead of needing a human to notice and relaunch it by
# hand. Verified on this host before this ticket: operator_runtime.bb and
# front_desk_supervisor.bb were both orphaned `nohup` children of
# start_operator_runtime.sh with PPID 1 - nothing supervised either, and a
# WSL restart took the whole conversation surface down for good.
#
# generate_systemd_units.sh already renders BOTH units correctly (BL-304
# operator, BL-351 front-desk; BL-366 fixed both so they can actually
# start at all - absolute ExecStart, StartLimitIntervalSec in [Unit]). Its
# only existing caller was provision_secondary_host.sh, a DIFFERENT host's
# from-scratch bootstrap that installs just the operator unit and never
# front-desk at all - a generated-but-never-installed unit is, in that
# script's own runbook's words, "exactly as dark as no unit at all" (the
# epic-runtime-wiring rule firing again). This is the missing PRIMARY-host
# installer: reuses the SAME generator, never duplicates its unit-content
# logic.
#
# Idempotent and safely re-runnable: `systemctl enable`/`enable --now`
# against an already-enabled/running unit is a systemd-level no-op, and
# `install -d`/`touch`/`chmod` are naturally idempotent too - re-running
# this script (e.g. after a code update) is always safe.
#
# Usage: provision_primary_host.sh <project-root> [pack-name] [linux-user]
#   pack-name    default: swarmforge.conf's own `config swarm_name` line,
#                falling back to "primary" (swarmforge.sh's own default)
#                when absent - the same name a single-swarm host already
#                runs under.
#   linux-user   default: $(whoami)
#
# Env:
#   PROVISION_PRIMARY_DRYRUN=1  print the install/enable commands this
#                               script would run instead of running them -
#                               no sudo, no real systemd state change. The
#                               unit files ARE still generated for real
#                               (to a /tmp path; that step needs no root
#                               and mutates no installed system state) -
#                               the seam a test drives to prove which
#                               units and unit names it would act on.

set -euo pipefail

USAGE="Usage: provision_primary_host.sh <project-root> [pack-name] [linux-user]"
PROJECT_ROOT="${1:?$USAGE}"

if [[ "$PROJECT_ROOT" != /* ]]; then
  echo "provision_primary_host.sh: project-root must be an absolute path, got: $PROJECT_ROOT" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GENERATOR="$SCRIPT_DIR/generate_systemd_units.sh"

default_pack_name() {
  local conf="$PROJECT_ROOT/swarmforge/swarmforge.conf"
  if [[ -f "$conf" ]]; then
    awk '$1 == "config" && $2 == "swarm_name" { print $3; exit }' "$conf"
  fi
}

PACK_NAME="${2:-}"
if [[ -z "$PACK_NAME" ]]; then
  PACK_NAME="$(default_pack_name)"
fi
PACK_NAME="${PACK_NAME:-primary}"
LINUX_USER="${3:-$(whoami)}"

run() {
  if [[ "${PROVISION_PRIMARY_DRYRUN:-}" == "1" ]]; then
    printf 'DRYRUN:'
    printf ' %q' "$@"
    printf '\n'
  else
    "$@"
  fi
}

OPERATOR_UNIT_NAME="swarmforge-operator-${PACK_NAME}.service"
FRONT_DESK_UNIT_NAME="swarmforge-front-desk-${PACK_NAME}.service"
OPERATOR_UNIT_TMP="/tmp/${OPERATOR_UNIT_NAME}"
FRONT_DESK_UNIT_TMP="/tmp/${FRONT_DESK_UNIT_NAME}"

"$GENERATOR" "$PROJECT_ROOT" "$PACK_NAME" "$LINUX_USER" "$OPERATOR_UNIT_TMP" --unit=operator
"$GENERATOR" "$PROJECT_ROOT" "$PACK_NAME" "$LINUX_USER" "$FRONT_DESK_UNIT_TMP" --unit=front-desk

run sudo mv "$OPERATOR_UNIT_TMP" "/etc/systemd/system/${OPERATOR_UNIT_NAME}"
run sudo mv "$FRONT_DESK_UNIT_TMP" "/etc/systemd/system/${FRONT_DESK_UNIT_NAME}"

# Same per-pack secrets file both generated units' EnvironmentFile=-
# already tolerates being absent (the leading '-') - pre-creating it
# root-owned/600 here just matches provision_secondary_host.sh's own
# precedent so a later manual secret-write needs no extra setup step.
run sudo install -d -m 0755 /etc/swarmforge
run sudo touch "/etc/swarmforge/${PACK_NAME}.env"
run sudo chmod 600 "/etc/swarmforge/${PACK_NAME}.env"

run sudo systemctl daemon-reload
run sudo systemctl enable --now "$OPERATOR_UNIT_NAME"
run sudo systemctl enable --now "$FRONT_DESK_UNIT_NAME"

echo "provision_primary_host.sh: ${OPERATOR_UNIT_NAME} and ${FRONT_DESK_UNIT_NAME} installed and enabled (Restart=always, boot-persistent)."
