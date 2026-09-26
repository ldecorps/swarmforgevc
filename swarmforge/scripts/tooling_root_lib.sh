#!/usr/bin/env bash
# BL-1757: shared entrypoint-resolution helper for launch_front_desk.sh and
# start_cursor_bridge.sh - the pattern launch_onboarder.sh/
# launch_negotiation_relay.sh already use for their own SWARM_REPO_ROOT, one
# source so the two launchers cannot drift on it (BL-897).
#
# A target project's own `swarm` wrapper runs its own copy of
# swarmforge/scripts with ROOT=<target>, and only the swarmforgevc checkout
# that builds this extension has a compiled extension/out. `config
# tooling_root <absolute-path>` in a target's pack conf names the
# swarmforgevc checkout to read compiled entrypoints from instead - the
# SERVED root argument passed to the bridge/bot processes always stays the
# target, never the tooling root (invariant 2).

# tooling_root_resolve <target-root>
#   Prints the resolved tooling root's absolute path on stdout, or nothing
#   (exit 0, empty stdout) when none is configured - callers then resolve
#   entrypoints under <target-root> alone, exactly as before this ticket
#   (invariant 1).
#
#   Resolution order:
#     1. SWARMFORGE_TOOLING_ROOT, already exported by the launching
#        swarmforge.sh process.
#     2. Otherwise, the target's own tracked swarmforge/swarmforge.conf,
#        read directly for its own `config tooling_root <path>` line - a
#        relaunch path (front_desk_supervisor.bb, babysitterd, `swarm
#        ensure`) may not inherit the original launch's environment, so this
#        must be able to re-derive the same answer from the target root
#        alone.
tooling_root_resolve() {
  local target_root="$1"

  if [[ -n "${SWARMFORGE_TOOLING_ROOT:-}" ]]; then
    printf '%s\n' "$SWARMFORGE_TOOLING_ROOT"
    return 0
  fi

  local conf_path="$target_root/swarmforge/swarmforge.conf" line
  [[ -f "$conf_path" ]] || return 0

  line="$(grep -E '^[[:space:]]*config[[:space:]]+tooling_root[[:space:]]+' "$conf_path" | tail -n 1 || true)"
  [[ -n "$line" ]] || return 0

  printf '%s\n' "$line" | sed -E 's/^[[:space:]]*config[[:space:]]+tooling_root[[:space:]]+//; s/[[:space:]]+$//'
}

# tooling_root_preferred_entrypoint <resolved-tooling-root> <target-root> <relative-path>
#   Pure: the entrypoint path a launcher should print/use - under the
#   tooling root when one resolved, otherwise under the target itself
#   (rule 2, "otherwise ... as today"). Never checks existence; dry-run mode
#   prints this unconditionally, exactly as it always has.
tooling_root_preferred_entrypoint() {
  local tooling_root="$1" target_root="$2" relative="$3"
  printf '%s/extension/out/%s\n' "${tooling_root:-$target_root}" "$relative"
}

# tooling_root_require_entrypoint <resolved-tooling-root> <target-root> <relative-path> <error-prefix>
#   Resolves an entrypoint that must actually exist before a real (non-dry-
#   run) launch proceeds. Prints the resolved, EXISTING path on stdout and
#   returns 0 on success. On failure, prints nothing to stdout, writes an
#   error to stderr, and returns 1 - the caller does `|| exit 1`.
#
#   No tooling root configured: checks only the target's own path and, on
#   failure, prints byte-identical wording to every pre-BL-1757 caller
#   ("$error_prefix: $path (run npm run compile in extension/)") - invariant 1.
#
#   A tooling root IS configured: checks it first; if the entrypoint is not
#   there, falls back to the target's own path (a target that has since
#   grown its own build still works); only when NEITHER has it does it
#   refuse, naming both paths it looked in (scenario 04).
tooling_root_require_entrypoint() {
  local tooling_root="$1" target_root="$2" relative="$3" error_prefix="$4"
  local preferred fallback

  preferred="$(tooling_root_preferred_entrypoint "$tooling_root" "$target_root" "$relative")"
  if [[ -f "$preferred" ]]; then
    printf '%s\n' "$preferred"
    return 0
  fi

  if [[ -z "$tooling_root" ]]; then
    echo "$error_prefix: $preferred (run npm run compile in extension/)" >&2
    return 1
  fi

  fallback="$target_root/extension/out/$relative"
  if [[ -f "$fallback" ]]; then
    printf '%s\n' "$fallback"
    return 0
  fi

  echo "$error_prefix in either $preferred or $fallback (run npm run compile in extension/)" >&2
  return 1
}
