#!/usr/bin/env bash
# BL-998: a shell test must never dispatch into the REAL repo.
#
# The receive and completion helpers resolve their own root. The .sh
# wrappers `cd "$(dirname "$0")"`, and the .bb dispatchers hand off to those
# wrappers by name and take their root from git-rev-parse afterwards. Both
# are correct in production, where every worktree carries its own hot-synced
# swarmforge/scripts/ copy - and fatal for a test, which has cd'd into a
# fixture with no such copy. The helper then resolves THIS checkout, so the
# test proves nothing about its fixture, and worse: the helper does what it
# always does - it CLAIMS - so a suite run can dequeue a live parcel out of a
# real role's inbox/new/.
#
# This guard is DERIVED, never a roster. Three prior instances of the same
# shape (BL-948's gate was itself a hand list of spellings and caught 1 of 6;
# BL-964 gated 3 of 11) are why: a guard that names today's offenders
# reproduces the bug it fixes. Membership is decided in two derived steps:
#
#   1. Which scripts are SELF-ROOTING is read out of the scripts directory
#      itself - a script that runs the dispatch table, asks git for the root,
#      or cd's to its own dirname. Add a new dispatcher tomorrow and it is
#      covered with no edit here.
#   1b. That set is then CLOSED over sibling process invocations, because
#      self-rooting is transitive and reading it one hop deep is what let
#      done_with_current_task.bb pass for a leaf - in this ticket's own
#      constraints as well as in this guard. See step 1b below.
#   2. Which tests offend is read out of what each test EXECUTES - a
#      self-rooting script invoked through a path anchored at the REAL
#      scripts dir. A test dispatching through its own fixture's copy is
#      anchored elsewhere and is not flagged; a test calling a LEAF helper
#      (which takes an explicit root and is not self-rooting) is not flagged
#      either. Those are the two safe shapes and both must stay legal.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REAL_SCRIPTS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

# ── step 1: derive the self-rooting scripts ──────────────────────────────
# A script resolves its own root if it runs the dispatch table, asks git for
# the root, or cd's to its own directory. Everything else takes the root it
# is given and is safe to invoke from anywhere.
SELF_ROOTING_RE='run-dispatch!|dispatch-lib/git-root|cd "\$SCRIPT_DIR"|cd "\$\(dirname "\$0"\)"'

# Comments are prose, not behaviour. batch_claim_progress_cli.bb carries a
# comment explaining that its .sh sibling's own `cd "$SCRIPT_DIR"` makes it
# unsafe against a fixture root - which made this derivation call the .bb
# self-rooting and flag a test that is entirely correct. Strip whole-line
# comments (`#` in sh, `;` in Clojure) before deciding anything: the same
# counting-mentions-not-call-sites trap the ticket's own notes record two
# sweeps falling into.
code_only() {
  sed -e 's/^[[:space:]]*#.*$//' -e 's/^[[:space:]]*;.*$//' "$1"
}

self_rooting_scripts() {
  local f
  for f in "$REAL_SCRIPTS_DIR"/*.sh "$REAL_SCRIPTS_DIR"/*.bb; do
    [ -f "$f" ] || continue
    if code_only "$f" | grep -qE "$SELF_ROOTING_RE" 2>/dev/null; then
      basename "$f"
    fi
  done
}

SELF_ROOTING="$(self_rooting_scripts)"
[ -n "$SELF_ROOTING" ] || fail "derivation broke: no self-rooting script found in $REAL_SCRIPTS_DIR"

is_self_rooting() {
  printf '%s\n' "$SELF_ROOTING" | grep -qxF "$1"
}

# ── step 1b: close that set over sibling process invocations ─────────────
# Self-rooting is TRANSITIVE, and this ticket's own bounce is the proof.
# Nothing in done_with_current_task.bb resolves a root, so step 1 called it
# a leaf and the ticket's constraints said the same - but its completion
# path ends in
#     (process/exec (str (fs/path script-dir "ready_for_next_task.sh")))
# where script-dir is the directory of the FILE ON DISK, not cwd.
# process/exec replaces the process image with a wrapper that cd's to its
# own dirname, so invoking that "leaf" from the real scripts dir escapes the
# fixture exactly as a dispatcher would. A script that STARTS a sibling
# resolved from its own location inherits that sibling's rooting, however
# many hops away it is.
#
# Only a real process invocation is an edge. `load-file` of a sibling lib
# uses the identical (fs/path script-dir ...) shape but runs IN-PROCESS,
# where the root still comes from cwd - counting it would make nearly every
# helper self-rooting and flag tests that are entirely correct.
SIBLING_START_RE='process/exec|process/shell|process/sh|sh/sh|exec bb|bash '
SIBLING_PATH_RE='(fs/path (script-dir|\(fs/parent \*file\*\)) "[A-Za-z0-9_.-]+"|\$\{?SCRIPT_DIR\}?/[A-Za-z0-9_.-]+)'

sibling_invocations() {
  code_only "$1" \
    | grep -E "$SIBLING_START_RE" \
    | grep -oE "$SIBLING_PATH_RE" \
    | grep -oE '[A-Za-z0-9_.-]+\.(sh|bb)' \
    | sort -u
}

# One pass over the scripts dir builds the edge list; the fixpoint below
# then reads only that (a couple of dozen lines) instead of re-grepping ~300
# files per round. A single grep -l narrows ~300 files to the few dozen that
# start a process at all before the per-file pipeline runs - it may include a
# file whose only match is in a comment, which code_only then drops, so the
# edge list is identical either way.
EDGES_FILE="$(mktemp)"
trap 'rm -f "$EDGES_FILE"' EXIT
for f in $(grep -lE "$SIBLING_START_RE" "$REAL_SCRIPTS_DIR"/*.sh "$REAL_SCRIPTS_DIR"/*.bb 2>/dev/null || true); do
  [ -f "$f" ] || continue
  sibs="$(sibling_invocations "$f" 2>/dev/null || true)"
  [ -n "$sibs" ] || continue
  printf '%s\t%s\n' "$(basename "$f")" "$(printf '%s' "$sibs" | tr '\n' ' ')"
done > "$EDGES_FILE"

GREW=1
while [ "$GREW" = "1" ]; do
  GREW=0
  while IFS="$(printf '\t')" read -r name sibs; do
    [ -n "$name" ] || continue
    if is_self_rooting "$name"; then continue; fi
    for sib in $sibs; do
      if is_self_rooting "$sib"; then
        SELF_ROOTING="$SELF_ROOTING
$name"
        GREW=1
        break
      fi
    done
  done < "$EDGES_FILE"
done

# ── step 2: derive the offenders from what each test executes ────────────
# An offence is a two-part shape in one file: a variable bound to a
# self-rooting script through a REAL-scripts-dir path, and an execution of
# that variable. Binding it without executing it is not an offence
# (test_backlog_depth_conf.sh does exactly that, deliberately).
# One pass per test file, never one per (test x script): extract every
# variable bound to a REAL-scripts-dir path in a single grep, keep the ones
# whose target is self-rooting, then look for executions of just those. The
# naive nested form is 30 x 235 grep processes and does not finish.

# "$VAR" in COMMAND position: opening a command (line start, or after ( && ||
# ; | ), then any run of env assignments (FOO=bar, PATH="...") and an
# optional `bb`, then the variable itself. Anything else - notably an
# argument to grep/cat/test - is a reference, not an execution.
execution_re() {
  local var="$1"
  printf '%s' '(^|[;&|(])[[:space:]]*([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+|bb[[:space:]]+)*"\$\{?'"$var"'\}?"'
}

offences_in() {
  local test_file="$1" line var script
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    var="${line%%=*}"
    script="${line##*/}"
    script="${script%\"}"
    is_self_rooting "$script" || continue
    # Bound is not executed. A test may define a dispatcher path and only
    # READ it - test_backlog_depth_conf.sh binds one and never runs it, and
    # test_ready_for_next_no_promotion.sh greps its own dispatcher for a
    # symbol while dispatching through the fixture copy. Both are correct
    # and neither may be swept in, so the variable has to appear in COMMAND
    # position: at the start of a command, after any env assignments and an
    # optional `bb`. `grep -q "..." "$VAR"` is an argument, not a command.
    if code_only "$test_file" | grep -qE "$(execution_re "$var")" 2>/dev/null; then
      echo "$(basename "$test_file"):\$$var -> $script"
    fi
  done <<EOF
$(code_only "$test_file" | grep -oE '^[A-Za-z_][A-Za-z0-9_]*="\$\{?SCRIPT_DIR\}?/\.\./[A-Za-z0-9_.-]+"' 2>/dev/null || true)
EOF
}

FOUND=""
for t in "$SCRIPT_DIR"/*.sh; do
  [ -f "$t" ] || continue
  # The guard must not flag itself: it names these scripts in prose only and
  # executes none of them.
  [ "$(basename "$t")" = "$(basename "$0")" ] && continue
  hits="$(offences_in "$t")"
  if [ -n "$hits" ]; then
    FOUND="$FOUND$hits
"
  fi
done

if [ -n "$FOUND" ]; then
  echo "FAIL: these shell tests execute a self-rooting helper from the REAL scripts dir," >&2
  echo "      so they dispatch into this checkout instead of their own fixture - and can" >&2
  echo "      claim a live parcel out of a real role's mailbox:" >&2
  printf '%s' "$FOUND" | sed 's/^/        /' >&2
  echo "" >&2
  echo "      Fix: copy the real scripts tree into the fixture worktree and dispatch" >&2
  echo "      through the fixture's own copy (source lib/install_scripts.sh and call" >&2
  echo "      install_scripts), so cd \"\$(dirname \"\$0\")\" stays inside it." >&2
  exit 1
fi

pass "no shell test dispatches a self-rooting helper from the real scripts dir"
