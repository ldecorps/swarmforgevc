#!/usr/bin/env bash
# BL-1279: refuse to run a fixture's checks when the bb subprocess under test
# cannot possibly load.
#
# The four front-desk supervisor fixtures each hand-listed six of the
# supervisor's eight load-file dependencies, so every bb subprocess died at
# load - and only THREE of the eight checks in one of them noticed. The other
# five reported OK, because a process that never started also exits non-zero,
# also writes no pid file, and also writes no received-env.json: a crash
# satisfies a negative assertion by accident. That is the hazard this guard
# closes, and it outlives the copy-list defect - a future load-file edge that
# somehow escapes derivation must still fail loudly rather than quietly turn
# five assertions into tautologies.
#
# The check is the entry point's transitive load-file closure, computed from
# the real source tree by the same Babashka CLI copy_bb_closure derives from,
# asserted present in the fixture root. A load PROBE is not available:
# front_desk_supervisor.bb calls (-main) at its tail unconditionally, so
# loading it runs it.
#
# Usage, immediately after the fixture root is populated and BEFORE the first
# check:
#   source "$SCRIPT_DIR/lib/bb_fixture_load_guard.sh"
#   assert_bb_closure_present "$SRC" "$d" front_desk_supervisor.bb

assert_bb_closure_present() {
  local src="${1:?assert_bb_closure_present: src scripts dir}"
  local fixture="${2:?assert_bb_closure_present: fixture dir}"
  local entry="${3:?assert_bb_closure_present: entry point}"

  local cli="$src/bb_load_closure_cli.bb"
  if [[ ! -f "$cli" ]]; then
    printf 'FAIL - %s\n' "bb fixture load guard: missing $cli, cannot compute the closure of $entry" >&2
    exit 1
  fi

  local closure
  if ! closure="$(bb "$cli" "$src" "$entry")"; then
    printf 'FAIL - %s\n' "bb fixture load guard: could not compute the load-file closure of $entry" >&2
    exit 1
  fi

  local dep missing=()
  while read -r dep; do
    [[ -n "$dep" ]] || continue
    [[ -f "$fixture/$dep" ]] || missing+=("$dep")
  done <<< "$closure"

  # `${arr[@]+...}` because stock macOS bash 3.2 treats an empty array as unset
  # under `set -u` (BL-801).
  if [[ ${#missing[@]} -gt 0 ]]; then
    printf 'FAIL - %s\n' \
      "bb fixture load guard: $entry cannot load in $fixture - missing from its closure: ${missing[*]+${missing[*]}}" >&2
    printf '%s\n' 'no check was run: a subprocess that never starts satisfies negative assertions by accident' >&2
    exit 1
  fi
}
