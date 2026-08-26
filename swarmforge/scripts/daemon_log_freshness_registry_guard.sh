#!/bin/sh
# BL-784: fail closed when a long-running supervisor lacks a freshness conf row,
# or when a *_supervisor.bb script exists that this guard cannot classify.
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
CONF=${FRESHNESS_CONF:-"$SCRIPT_DIR/daemon_log_freshness.conf"}
REQUIRED=${FRESHNESS_REQUIRED:-"$SCRIPT_DIR/daemon_log_freshness_required.conf"}

fail() {
  printf 'FRESHNESS_REGISTRY_GUARD: %s\n' "$1" >&2
  exit 1
}

conf_names() {
  awk -F'|' '
    /^[[:space:]]*#/ { next }
    /^[[:space:]]*$/ { next }
    { print $1 }
  ' "$CONF"
}

required_names() {
  awk '
    /^[[:space:]]*#/ { next }
    /^[[:space:]]*$/ { next }
    { print $1 }
  ' "$REQUIRED"
}

if [ ! -r "$CONF" ]; then
  fail "missing or unreadable conf: $CONF"
fi
if [ ! -r "$REQUIRED" ]; then
  fail "missing or unreadable required registry: $REQUIRED"
fi

CONF_LIST=$(mktemp)
REQ_LIST=$(mktemp)
trap 'rm -f "$CONF_LIST" "$REQ_LIST"' EXIT
conf_names > "$CONF_LIST"
required_names > "$REQ_LIST"

while IFS= read -r name; do
  [ -z "$name" ] && continue
  if ! grep -qx "$name" "$CONF_LIST"; then
    fail "daemon '$name' has no row in $(basename "$CONF")"
  fi
done < "$REQ_LIST"

for script in "$SCRIPT_DIR"/*_supervisor.bb; do
  [ -f "$script" ] || continue
  base=$(basename "$script" .bb)
  if ! grep -qx "$base" "$CONF_LIST"; then
    fail "unclassified supervisor script '$base' — add a conf row or remove the start path"
  fi
done

exit 0
