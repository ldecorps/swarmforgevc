#!/usr/bin/env bash
# BL-973: copy a bb entry point and its ENTIRE transitive load-file closure
# into a fixture's scripts dir, computed from source rather than listed by hand.
#
# Five fixtures used to name those dependencies by hand with nothing gating
# them, and the lists drifted three times - BL-911 added prompt_engine_lib.bb
# to handoff_lib.bb's closure, BL-967 added daemon_cycle_guard_lib.bb, BL-1029
# added shell_quote_lib.bb. Each drift produced a bb stack trace naming a file
# no test mentions, and one of the reds sat unnoticed on main for days.
#
# Shell fixtures cannot require the JS closure helper
# (specs/pipeline/steps/lib/operatorRuntimeBbClosure.js), so this shells to its
# Babashka twin. The two are held to the same answer by
# bb_load_closure_agreement_test_runner.bb (BL-897).
#
# Usage:
#   source "$SCRIPT_DIR/lib/bb_closure_copy.sh"
#   copy_bb_closure "$SRC_SCRIPTS_DIR" "$DEST_DIR" done_with_current_task.bb [more.bb ...]
#
# Several entry points may be given: a fixture sometimes needs a sibling script
# its subject SHELLS to rather than load-files, which no walk from the subject
# alone would reach. Naming that sibling is a decision worth writing down; its
# transitive dependencies are a consequence and are computed.
#
# Prints nothing on success. Returns non-zero, naming the entry point, if a
# closure cannot be computed - a fixture that silently copied nothing would
# fail much later and much less legibly.

copy_bb_closure() {
  local src="${1:?copy_bb_closure: src scripts dir}"
  local dest="${2:?copy_bb_closure: dest dir}"
  shift 2
  if [[ $# -eq 0 ]]; then
    echo "copy_bb_closure: at least one entry point is required" >&2
    return 1
  fi

  local cli="$src/bb_load_closure_cli.bb"
  if [[ ! -f "$cli" ]]; then
    echo "copy_bb_closure: missing $cli - cannot derive the copy list" >&2
    return 1
  fi

  mkdir -p "$dest"
  local entry out dep
  for entry in "$@"; do
    if ! out="$(bb "$cli" "$src" "$entry")"; then
      echo "copy_bb_closure: could not compute the load-file closure of $entry" >&2
      return 1
    fi
    while read -r dep; do
      [[ -n "$dep" ]] || continue
      # A closure member that is not on disk is reported by the CLI so a
      # caller can see a real gap; skip it here rather than failing the copy,
      # so the fixture's own run surfaces it in context.
      [[ -f "$src/$dep" ]] && cp "$src/$dep" "$dest/"
    done <<< "$out"
  done
}
