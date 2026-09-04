#!/usr/bin/env bash
# BL-1162: shared root-scoped swarmforge crontab line detection and filtering.
# Sourced by install/uninstall helpers — not executed directly.
set -euo pipefail

swarmforge_cron_freshness_marker() {
  local root="$1"
  printf '# swarmforge-BL-675-freshness-check root=[%s]' "$root"
}

swarmforge_cron_operator_schedule_marker() {
  local root="$1"
  printf '# swarmforge-operator-schedule root=[%s]' "$root"
}

swarmforge_cron_line_belongs_to_root() {
  local line="$1" root="$2"
  local freshness_marker operator_marker
  freshness_marker="$(swarmforge_cron_freshness_marker "$root")"
  operator_marker="$(swarmforge_cron_operator_schedule_marker "$root")"

  # BL-1382: ownership is the MARKERS THE SWARM ITSELF WROTE, and nothing
  # else. The three path clauses that used to sit below this comment -
  # "$root/.swarmforge/operator/", "$root/start-swarm.sh",
  # "$root/stop-swarm.sh" - claimed any line that merely NAMED a script under
  # the root, so a schedule the human installed by hand read as the swarm's to
  # remove. Overnight on 2026-09-04 that erased three hand-installed shift
  # lines from the live crontab; the 09:00 weekday start was 40 minutes from
  # being missed when it was caught. The BL-1162 intent was to sweep the
  # LEGACY presets, which are themselves hand-installed files naming operator
  # scripts by path and carrying no marker - so to this predicate "the human
  # installed it" and "a legacy preset installed it" were the same line.
  #
  # Human ruling, 2026-09-04 (SUP-17 14:13:07Z, option 1): marker-only
  # ownership EVERYWHERE - stop, install and reconcile touch only marked
  # lines, and an unmarked line naming the root is reported, never swept.
  # `swarmforge_cron_line_names_root` below is what reports it.
  [[ "$line" == *"$freshness_marker"* ]] && return 0
  [[ "$line" == *"$operator_marker"* ]] && return 0
  # The root ends the marker or is followed by whitespace. A bare substring
  # match makes root /a claim /a-sibling's block: found by BL-1382's
  # invariant-1 property test, whose sibling root is DERIVED from the root so
  # the two always share a prefix. Multi-root isolation (BL-783/BL-1162) is
  # what this protects; the other markers are already bounded, by `]` on the
  # two `root=[...]` forms and by the trailing space on FRESHNESS_ROOT.
  [[ "$line" == *"# swarmforge-shift-schedule-begin $root" ]] && return 0
  [[ "$line" == *"# swarmforge-shift-schedule-begin $root "* ]] && return 0
  [[ "$line" == *"# swarmforge-shift-schedule-end $root" ]] && return 0
  [[ "$line" == *"# swarmforge-shift-schedule-end $root "* ]] && return 0
  # The freshness line's own signature: the swarm writes this env assignment
  # itself, so it is a marker in every sense but the comment syntax.
  [[ "$line" == *"FRESHNESS_ROOT=$root "* ]] && return 0
  return 1
}

# BL-1382: a line that NAMES this root but carries none of the swarm's
# markers. Not the swarm's to remove - the swarm says it is leaving it alone,
# so a human who expected the old sweep sees why their line survived rather
# than wondering whether the tool noticed it at all.
swarmforge_cron_line_names_root() {
  local line="$1" root="$2"
  swarmforge_cron_line_belongs_to_root "$line" "$root" && return 1
  [[ "$line" == *"$root/"* ]] && return 0
  return 1
}

# Prints one "left in place" report per unmarked line naming the root. Reads
# the crontab text on stdin; prints nothing when every line is either the
# swarm's own or unrelated to this root.
swarmforge_cron_report_unmarked() {
  local root="$1" label="${2:-left in place}"
  local line
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "${line//[[:space:]]/}" ]] && continue
    if swarmforge_cron_line_names_root "$line" "$root"; then
      printf '%s (no swarmforge marker for this root): %s\n' "$label" "$line"
    fi
  done
}

swarmforge_cron_filter_out_root() {
  local root="$1"
  local line
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ -z "${line//[[:space:]]/}" ]]; then
      continue
    fi
    if swarmforge_cron_line_belongs_to_root "$line" "$root"; then
      continue
    fi
    printf '%s\n' "$line"
  done
}

swarmforge_cron_root_has_lines() {
  local root="$1" existing="${2:-}"
  local line
  while IFS= read -r line || [[ -n "$line" ]]; do
    if swarmforge_cron_line_belongs_to_root "$line" "$root"; then
      return 0
    fi
  done <<< "$existing"
  return 1
}
