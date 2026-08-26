#!/usr/bin/env bash
# BL-874: BSD/macOS `date` has no `-d` flag at all, so GNU relative-time
# syntax (`date -d "2 hours ago"`, `touch -d "-5 minutes"`) errors outright
# on stock macOS userland. BSD computes the same offset via a per-unit
# flag letter instead (`date -v-2H`). Both forms reduce to the same
# `touch -t` timestamp, so the actual mtime write is one portable call -
# mirrors portable_stat_lib.sh's try-BSD-then-GNU shape, and
# test_handoffd_supervisor.sh:172's already-working `touch -t` precedent.
#
# Every caller under swarmforge/scripts/test that needs to backdate a
# fixture's mtime goes through portable_touch_relative below - see
# specs/pipeline/steps/lib/portableTimeGuard.js for the standing guard that
# keeps it that way.

# amount unit -> a touch -t "YYYYMMDDhhmm.ss" stamp for "amount unit ago",
# tried on BSD first (the common case on this host), falling back to GNU.
portable_relative_touch_stamp() {
  local amount="$1" unit="$2" bsd_letter stamp
  case "$unit" in
    second*|sec*) bsd_letter=S ;;
    minute*|min*) bsd_letter=M ;;
    hour*|hr*)    bsd_letter=H ;;
    *)
      echo "portable_relative_touch_stamp: unsupported unit '$unit' (want seconds/minutes/hours)" >&2
      return 1
      ;;
  esac

  if stamp="$(date -v-"${amount}${bsd_letter}" "+%Y%m%d%H%M.%S" 2>/dev/null)"; then
    printf '%s\n' "$stamp"
  else
    date -d "${amount} ${unit} ago" "+%Y%m%d%H%M.%S"
  fi
}

# portable_touch_relative <amount> <unit> <file...>
# Sets every given file's mtime to "amount unit ago" (e.g. `2 hours`,
# `90 seconds`), computed once and applied to all files together so
# multiple files backdated "at the same past instant" truly share one
# timestamp rather than drifting across separate `date` calls.
portable_touch_relative() {
  local amount="$1" unit="$2" stamp
  shift 2
  stamp="$(portable_relative_touch_stamp "$amount" "$unit")" || return 1
  touch -t "$stamp" "$@"
}
