#!/usr/bin/env bash
# BL-671: shared sandbox copy for operator_runtime.bb + every lib it load-files
# (and the small set of sibling helpers fixtures already needed).
#
# Usage (from a test_operator_runtime_*.sh):
#   source "$SCRIPT_DIR/lib/operator_runtime_sandbox.sh"
#   copy_operator_runtime_sandbox "$SRC" "$dest/swarmforge/scripts"
#
# BL-973: the file list is DERIVED from the real transitive load-file closure
# of the entry points below, never hand-maintained. Adding a new load-file
# anywhere upstream now needs no edit here at all - which is the point, because
# the hand list this replaces went stale three times (BL-911's
# prompt_engine_lib.bb, BL-967's daemon_cycle_guard_lib.bb, BL-1029's
# shell_quote_lib.bb) with nothing gating it.
#
# What DOES need an edit here is a new sibling ENTRY POINT - a script a fixture
# shells to that operator_runtime.bb does not itself load-file. Those are named
# below with their reasons, and each one's own closure is walked too. That is a
# far smaller and far more meaningful surface than 45 filenames: an entry point
# is a decision, a transitive dependency is a consequence.
#
# Shell fixtures cannot require the JS closure helper
# (specs/pipeline/steps/lib/operatorRuntimeBbClosure.js), so this uses its
# Babashka twin, bb_load_closure_lib.bb. The two are held to the same answer by
# swarmforge/scripts/test/bb_load_closure_agreement_test_runner.bb (BL-897: a
# rule mirrored across a language boundary needs a test asserting both agree -
# a "kept in sync" comment is not a gate).

# shellcheck source=swarmforge/scripts/test/lib/bb_closure_copy.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/bb_closure_copy.sh"

copy_operator_runtime_sandbox() {
  local src="${1:?copy_operator_runtime_sandbox: src dir}"
  local dest="${2:?copy_operator_runtime_sandbox: dest dir}"
  mkdir -p "$dest"

  # operator_runtime.bb is the subject. The rest are siblings its ticks SHELL
  # to rather than load-file, so no closure walk from operator_runtime.bb alone
  # would reach them - each is here because a fixture broke without it:
  #   operator_ask.bb            - the ask/await path (BL-306)
  #   swarm_handoff.bb           - hotfix-certification-sweep! shells to it (BL-848)
  #   chase_sweep_lib.bb         - the chase/dropped-parcel sweeps
  #   pre_qa_gate_lib.bb         - the pre-QA gate a tick can run
  #   salvage_lib.bb             - salvage of an abandoned parcel
  #   ticket_close_guard_lib.bb  - the close guard
  #   duplicate_chain_guard_lib.bb - the duplicate-forward guard
  #   coordinator_config_lib.bb  - coordinator config a tick reads
  local entry_points=(
    operator_runtime.bb
    operator_ask.bb
    swarm_handoff.bb
    chase_sweep_lib.bb
    pre_qa_gate_lib.bb
    salvage_lib.bb
    ticket_close_guard_lib.bb
    duplicate_chain_guard_lib.bb
    coordinator_config_lib.bb
  )

  # ${arr[@]+"${arr[@]}"}: stock macOS /bin/bash 3.2 raises "unbound variable"
  # expanding an EMPTY array under set -u (BL-801).
  copy_bb_closure "$src" "$dest" ${entry_points[@]+"${entry_points[@]}"}
}

# Moved here from test_operator_runtime_babysitterd_watchdog.sh (2026-10-02)
# so every operator_runtime fixture can satisfy BL-1517's git-checkout
# guard the same way: two of its siblings still built plain mktemp roots and
# were refused before a single check ran.
# BL-1728: fails (prints to stderr, returns 1) unless DIR is itself a git
# checkout whose --git-common-dir resolves under DIR - never a live
# enclosing repository (engineering Guardrails, BL-1390). Never mutates
# anything; safe to call against an unproven directory.
#
# --path-format=absolute (git >= 2.31): a plain --git-common-dir prints a
# path RELATIVE to DIR when DIR is itself the repository root (".git"), and
# a "../../.git"-shaped climb when DIR is an unproven subdirectory of an
# enclosing repo - a bare string-prefix check on that climb still reads as
# "starts with DIR/", which is exactly the false pass this proof exists to
# prevent. --path-format=absolute sidesteps it: always a real path.
prove_git_fixture_root() {
  local d="${1:?prove_git_fixture_root: fixture root required}"
  local common_dir d_abs
  common_dir="$(git -C "$d" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || {
    echo "FIXTURE PROOF FAILED: git -C $d rev-parse --git-common-dir failed - not a git checkout" >&2
    return 1
  }
  d_abs="$(cd "$d" 2>/dev/null && pwd -P)" || {
    echo "FIXTURE PROOF FAILED: cannot resolve $d" >&2
    return 1
  }
  case "$common_dir" in
    "$d_abs"/*|"$d_abs") return 0 ;;
    *)
      echo "FIXTURE PROOF FAILED: git-common-dir $common_dir for $d resolves outside it - this is a subdirectory of a live enclosing checkout, not its own" >&2
      return 1
      ;;
  esac
}

# BL-1728: `git init`s DIR as its own checkout (a fresh branch, throwaway
# identity, no gpg signing) and proves it before returning. DIR must
# already exist.
init_git_fixture_root() {
  local d="${1:?init_git_fixture_root: fixture root required}"
  git -C "$d" init -q -b main
  git -C "$d" config user.email "watchdog-fixture@example.com"
  git -C "$d" config user.name "watchdog fixture"
  git -C "$d" config commit.gpgsign false
  prove_git_fixture_root "$d"
}
