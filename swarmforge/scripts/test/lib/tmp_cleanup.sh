#!/usr/bin/env bash
# BL-459: shared cleanup registry for swarmforge/scripts/test/*.sh harnesses
# that create mktemp -d temp roots - the shell sibling of
# extension/test/helpers/tmpDir.js's own "one shared registry, one place
# cleanup happens, on both the pass and throw path" discipline (BL-420).
#
# Usage: source this file, then call `register_tmp_dir "$your_var"`
# IMMEDIATELY after each `mktemp -d`-derived assignment. A single EXIT trap
# (installed once below) removes every registered root - it fires on a
# clean exit AND on a failing one (any `set -e`-triggered early exit, an
# explicit `exit N`, or an unhandled error), so a root a script's own inline
# `rm -rf` never reached because a LATER assertion failed first still gets
# cleaned up. Each registered path is captured as an immutable STRING at
# call time, so reusing the same variable name for several sequential
# fixtures (a common pattern in this tree) correctly accumulates every one
# of them, not just the last.
#
# BL-801: the established call convention across this tree wraps
# registration in a helper invoked via command substitution -
#   make_root() { local d; d="$(mktemp -d)"; register_tmp_dir "$d"; printf '%s' "$d"; }
#   ROOT="$(make_root)"
# `$(...)` runs the helper in a forked subshell; a plain shell ARRAY lives
# only in that subshell's copy of memory and is discarded when the subshell
# exits, so the registration was silently lost (every-host leak) and, with
# the array left empty, `"${arr[@]}"` under `set -u` on bash < 4.4 (stock
# macOS /bin/bash is 3.2.57) raised "unbound variable" in the EXIT trap -
# turning a fully passing suite into a false exit 1. A FILE survives a fork
# the way a shell variable never can, so the registry is now a file, keyed
# per top-level script process (captured once, below, before this script's
# own code can fork any subshell) rather than a shell array: register_tmp_dir
# appends a line to it from whatever shell depth it runs at, and the trap
# reads it back with a plain `while read` loop, which touches no array
# index and so cannot raise "unbound variable" on any bash regardless of
# how many lines it holds - including zero.
#
# Registering scripts never share a registry: __SWARMFORGE_TMP_CLEANUP_REGISTRY
# is set from a fresh `mktemp` exactly once per top-level process (the guard
# below short-circuits a second `source` of this file in the SAME process,
# and every separate `bash some_test.sh` invocation is its own process with
# its own environment to begin with) - one script's EXIT trap sweeps only
# the file it created, never a path a concurrently running sibling script
# owns.
#
# Confirmed empirically on the target bash (GNU bash 3.2.57, macOS): an
# EXIT trap installed before a `$(...)` command substitution runs does NOT
# re-fire when that subshell itself exits - only the top-level script's own
# exit fires it. This is what makes "append from inside the subshell, sweep
# once from the top-level trap" safe: the subshell's own implicit exit never
# prematurely sweeps a registry the top-level script is still adding to.
#
# BOUNDARY: a trap cannot catch SIGKILL/OOM - that residue is BL-413's
# periodic /tmp sweep's job, out of scope here.

# BL-1058: an EXPLICIT template, and no -t.
#
# `mktemp -t <prefix>` is BSD/macOS syntax, where the operand is a prefix.
# GNU coreutils treats the operand as a TEMPLATE and requires at least three
# trailing X's, so on a GNU userland the call is a hard error:
#
#     mktemp: too few X's in template 'swarmforge-tmp-cleanup-registry'
#
# Every one of the shell test files that sources this helper does so at the
# top under `set -euo pipefail`, so the failed command substitution killed the
# script before a single test body ran - including this helper's own suite,
# which is why nothing caught it until the host moved from macOS to Linux.
#
# `mktemp "<dir>/<prefix>.XXXXXX"` is accepted identically by both: an
# explicit path template with six X's, and no dialect-specific flag. The
# directory comes from TMPDIR when set (BSD's -t honoured it, so dropping the
# flag must not silently relocate anyone's fixtures) and falls back to /tmp.
#
# BL-801's design is untouched: the registry is still a FILE keyed per
# top-level process, so a registration made inside a `$(...)` subshell
# survives, and the EXIT trap still sweeps it with a read loop that touches no
# array index.
if [[ -z "${__SWARMFORGE_TMP_CLEANUP_REGISTRY:-}" ]]; then
  if ! __SWARMFORGE_TMP_CLEANUP_REGISTRY="$(mktemp "${TMPDIR:-/tmp}/swarmforge-tmp-cleanup-registry.XXXXXX")"; then
    # Fail loud and BY NAME. Propagating mktemp's own message alone named
    # neither this helper nor the registry, so the only clue a reader got was
    # a bare tool error from a file they never opened - and `set -u` then made
    # the next register_tmp_dir an unbound-variable error somewhere else
    # entirely.
    echo "tmp_cleanup: could not create the tmp-cleanup registry file under ${TMPDIR:-/tmp} - shell test cleanup cannot be initialized" >&2
    exit 1
  fi
  export __SWARMFORGE_TMP_CLEANUP_REGISTRY

  __swarmforge_cleanup_tmp_dirs() {
    local registry="$__SWARMFORGE_TMP_CLEANUP_REGISTRY"
    local d
    if [[ -f "$registry" ]]; then
      while IFS= read -r d || [[ -n "$d" ]]; do
        [[ -n "$d" ]] && rm -rf -- "$d"
      done < "$registry"
      rm -f -- "$registry"
    fi
  }
  trap __swarmforge_cleanup_tmp_dirs EXIT
fi

register_tmp_dir() {
  printf '%s\n' "$1" >> "$__SWARMFORGE_TMP_CLEANUP_REGISTRY"
}

# BL-1686: pid-scoped, zombie-aware replacement for the blind BL-971
# startup sweep `rm -rf "${TMPDIR:-/tmp}/${PREFIX}".* 2>/dev/null || true`.
# That idiom removes EVERY root sharing the prefix, including one a
# concurrently running sibling invocation of the same script is still
# using (the everyday multi-seat case) - deleting a live TMPROOT out from
# under a peer, which is what let `git init` run against a process's own
# CWD in the BL-1686 incident (a `mktemp` under a just-deleted TMPROOT
# fails silently under `set -uo pipefail`, no `-e`).
#
# Callers name their roots `<prefix><pid>.XXXXXX` (pid immediately after
# the prefix, no separator required - each of this helper's five callers
# already has its own convention for whether the prefix itself ends in a
# separator). This sweep parses the leading digit run right after the
# prefix as the OWNING pid and removes the root only when that pid is not
# alive - `kill -0` ALONE reads a zombie (exited, not yet reaped) as
# running, so liveness is `kill -0` AND NOT a zombie, checked via
# `ps -o stat=` (BL-1647's own idiom, reused verbatim from
# finish_shift_lib.sh's `_finish_shift_pid_is_zombie` - stock bash 3.2 has
# no /proc). A root whose name carries no parseable pid segment (a stale
# root from before this convention, or a foreign directory sharing the
# prefix by coincidence) is left alone - this sweep only ever removes a
# root it can positively attribute to a dead owner, never a blind
# "anything with this prefix" glob.
sweep_stale_prefix_roots() {
  local prefix="$1" dir base rest pid stat
  for dir in "${TMPDIR:-/tmp}/${prefix}"*; do
    [[ -d "$dir" ]] || continue
    base="$(basename "$dir")"
    rest="${base#"$prefix"}"
    rest="${rest#.}"
    pid="${rest%%.*}"
    [[ "$pid" =~ ^[0-9]+$ ]] || continue
    if kill -0 "$pid" 2>/dev/null; then
      stat="$(ps -o stat= -p "$pid" 2>/dev/null || true)"
      stat="${stat#"${stat%%[![:space:]]*}"}"
      [[ "$stat" == Z* ]] || continue
    fi
    rm -rf -- "$dir"
  done
}
