#!/bin/sh
# BL-785: durable per-daemon "stopped on purpose" record.
#
# Shared by the stop paths (write), the start paths (clear/re-arm), and the
# BL-675 freshness checker (read). A plain file under
# .swarmforge/daemon/freshness-stopped/ so the deliberate/not verdict is
# readable with every bb/node/swarm process dead (BL-675 share-no-fate) -
# never a query to a live process, socket, or daemon status endpoint.
#
# One marker file per daemon name, so a pipeline-only stop (which leaves
# babysitterd running) marks only handoffd, never suppressing a daemon its
# own stop path did not touch.
#
# POSIX sh only - sourced from both the POSIX checker script and bash stop/
# start scripts.

freshness_stopped_dir() {
  # $1=root
  printf '%s/.swarmforge/daemon/freshness-stopped' "$1"
}

freshness_stopped_marker() {
  # $1=root $2=daemon-name
  printf '%s/%s.stopped' "$(freshness_stopped_dir "$1")" "$2"
}

freshness_mark_stopped() {
  # $1=root $2=daemon-name — idempotent; always leaves the marker present.
  _fsm_root=$1
  _fsm_name=$2
  _fsm_dir=$(freshness_stopped_dir "$_fsm_root")
  mkdir -p "$_fsm_dir"
  printf '%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$_fsm_dir/$_fsm_name.stopped"
}

freshness_clear_stopped() {
  # $1=root $2=daemon-name — idempotent; always leaves the marker absent
  # (re-arms watching). Never fails if the marker was already absent.
  rm -f "$(freshness_stopped_marker "$1" "$2")"
}

freshness_is_stopped() {
  # $1=root $2=daemon-name — true (exit 0) iff a deliberate-stop marker
  # exists for that daemon. File-existence only; asks no live process.
  [ -f "$(freshness_stopped_marker "$1" "$2")" ]
}
