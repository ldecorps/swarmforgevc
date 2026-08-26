#!/usr/bin/env bash
# BL-1124: shared-repo canary for the property-suite lane.
# Source from check_property_suite_drift.sh; also usable standalone.
#
# Snapshot + assert keep fixtures from renaming/advancing live refs or
# flipping core.bare. Recovery helper refuses reset-to-origin when ahead.

set -euo pipefail

bl1124_git() {
  local root="$1"
  shift
  git -C "$root" "$@"
}

# Prints: bare<TAB>head_ref<TAB>head_sha
bl1124_snapshot() {
  local root="$1"
  local bare head_ref head_sha
  bare="$(bl1124_git "$root" config --get --bool core.bare 2>/dev/null || echo false)"
  head_ref="$(bl1124_git "$root" symbolic-ref -q HEAD 2>/dev/null || echo detached)"
  head_sha="$(bl1124_git "$root" rev-parse HEAD 2>/dev/null || echo missing)"
  printf '%s\t%s\t%s\n' "$bare" "$head_ref" "$head_sha"
}

bl1124_assert_not_bare() {
  local root="$1"
  local bare
  # Reuse snapshot's bare field (same git probe as bl1124_snapshot).
  bare="$(bl1124_snapshot "$root" | cut -f1)"
  if [[ "$bare" == "true" ]]; then
    echo "BL-1124: shared checkout core.bare=true after property suite — refusing" >&2
    return 1
  fi
  return 0
}

# Args: root before_snapshot_line
bl1124_assert_unchanged() {
  local root="$1"
  local before="$2"
  local after
  bl1124_assert_not_bare "$root" || return 1
  after="$(bl1124_snapshot "$root")"
  if [[ "$after" != "$before" ]]; then
    echo "BL-1124: shared repo refs/bare changed during property suite" >&2
    echo "  before: $before" >&2
    echo "  after:  $after" >&2
    return 1
  fi
  return 0
}

# Refuse recovery that would discard local commits ahead of origin/main.
# Exit 0 = safe to reset (not ahead). Exit 1 = refuse (ahead or unknown).
bl1124_refuse_reset_when_ahead() {
  local root="$1"
  local ahead
  if ! bl1124_git "$root" rev-parse --verify -q origin/main >/dev/null; then
    echo "BL-1124: origin/main missing — refuse reset-to-origin recovery" >&2
    return 1
  fi
  ahead="$(bl1124_git "$root" rev-list --count origin/main..HEAD 2>/dev/null || echo 0)"
  if [[ "$ahead" -gt 0 ]]; then
    echo "BL-1124: local HEAD is $ahead commit(s) ahead of origin/main — refuse reset --hard origin/main; restore pre-incident tip from reflog instead" >&2
    return 1
  fi
  return 0
}

# Refuse seeding a fixture into a live swarm checkout (would rm -rf / rename).
bl1124_refuse_live_fixture_dest() {
  local dest="$1"
  local probe
  [[ -n "$dest" ]] || return 1
  probe="$(cd "$dest" 2>/dev/null && pwd -P)" || return 0
  if [[ -f "$probe/swarmforge/scripts/handoffd.bb" ]] || [[ -f "$probe/swarmforge/constitution.md" ]]; then
    echo "BL-1124: fixture dest resolves to a live swarmforge checkout ($probe) — refuse" >&2
    return 1
  fi
  return 0
}
