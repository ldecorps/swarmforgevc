#!/usr/bin/env bash
# BL-570: when staged changes can invalidate a property, run the property
# suite before the commit lands. Shared via swarmforge/git-hooks/pre-commit
# (core.hooksPath), same standalone-script pattern as check_commit_size.sh.
#
# Usage: check_property_suite_drift.sh [suite-command [args...]]
#   No args — run `npm run test:properties` from extension/ when the
#   toolchain is present. With args — those are the suite command
#   (injectable for tests; no *_FORCE_RESULT env bypasses).
#
# Env:
#   SWARMFORGE_SKIP_PROPERTY_SUITE_GUARD=1 — warn and exit 0 (recovery-only;
#   never the standing recipe — see BL-1121).
#
# Exit 0: path skip, reconcile-import skip (BL-1121), override, green suite,
#         allowlisted standing reds only (BL-1175), or toolchain unavailable.
# Exit 1: genuine property regression (suite red with a non-allowlisted file)
#         OR BL-1124 shared-repo canary failure (core.bare flipped / live refs
#         rewritten).
#
# BL-1175 property suite gate: green or allowlisted standing reds; unrelated
# green commits not refused (property_suite_standing_allowlist.tsv).

set -euo pipefail

# BL-1407: the script's own invocation args, captured before any function
# runs - "$@" inside a bash function is that function's OWN positional
# params, not the top-level script's, so the re-run seam below (which needs
# the same injected test command the full run used, from inside a function)
# reads this array rather than "$@" directly.
ORIG_ARGS=("$@")

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=property_suite_shared_repo_guard.sh
source "$SCRIPT_DIR/property_suite_shared_repo_guard.sh"
# shellcheck source=incoming_merge_parent_lib.sh
source "$SCRIPT_DIR/incoming_merge_parent_lib.sh"

ALLOWLIST_TSV=""
if [[ -f "$SCRIPT_DIR/property_suite_standing_allowlist_lib.sh" ]]; then
  # shellcheck source=property_suite_standing_allowlist_lib.sh
  source "$SCRIPT_DIR/property_suite_standing_allowlist_lib.sh"
  ALLOWLIST_TSV="$(ps_allowlist_tsv_path "$SCRIPT_DIR")"
fi

warn_override() {
  echo "property-suite-guard: overridden" >&2
  echo "Warning: property check was overridden (SWARMFORGE_SKIP_PROPERTY_SUITE_GUARD=1)." >&2
}

warn_skipped() {
  echo "property-suite-guard: skipped (toolchain unavailable)" >&2
  echo "Warning: property check was skipped (toolchain unavailable)." >&2
}

# ── BL-1275: what survives a refusal ─────────────────────────────────────
# A refusal is the one moment this run's output is worth keeping: it is the
# evidence someone later adjudicates the red from - genuine regression,
# known flake, or new mechanism. Until this ticket the run was captured to a
# mktemp file, echoed to stderr and deleted, so the only surviving copy was
# terminal scrollback. Twice that decided an investigation (a retained 53KB
# properties.log split one vague report into four mechanisms on 2026-08-22;
# a swept log left bl955 unadjudicated on 2026-08-29), and four different
# files refused five commits in a single shift, so ONE fixed-name log would
# have kept only the last - precisely the one that was not the question.
#
# .swarmforge/ is the established home for local, gitignored runtime state.
REFUSAL_LOG_DIR_REL=".swarmforge/property-guard-refusals"
REFUSAL_LOG_KEEP_DEFAULT=20

refusal_log_keep() {
  local keep="${SWARMFORGE_PROPERTY_GUARD_REFUSAL_KEEP:-$REFUSAL_LOG_KEEP_DEFAULT}"
  if [[ "$keep" =~ ^[0-9]+$ ]] && (( keep >= 1 )); then
    printf '%s' "$keep"
  else
    printf '%s' "$REFUSAL_LOG_KEEP_DEFAULT"
  fi
}

# The index comes from the names already present, not from a clock: two
# refusals inside the same second must still order the way they happened,
# and `date +%N` does not exist on stock macOS. Pruning always keeps the
# NEWEST, so the highest surviving index only ever grows.
next_refusal_index() {
  local dir="$1" highest=0 name idx
  for name in "$dir"/refusal-*.log; do
    [[ -e "$name" ]] || continue
    idx="${name##*/refusal-}"
    idx="${idx%%-*}"
    [[ "$idx" =~ ^[0-9]+$ ]] || continue
    idx=$((10#$idx))
    (( idx > highest )) && highest=$idx
  done
  printf '%s' $((highest + 1))
}

# Bounded so the directory cannot grow without limit. Names carry a
# zero-padded index, so the glob is ALREADY creation order - counted and
# then walked directly, with no array and no `sort` subshell. Deliberate:
# `${#names[@]}` over an array that can legitimately be empty is the
# BL-801 shape that breaks under `set -u` on the stock macOS bash 3.2 this
# has to run on, and there is nothing here an array buys.
prune_refusal_logs() {
  local dir="$1" keep="$2" name total=0 seen=0
  for name in "$dir"/refusal-*.log; do
    [[ -e "$name" ]] || continue
    total=$((total + 1))
  done
  (( total > keep )) || return 0
  for name in "$dir"/refusal-*.log; do
    [[ -e "$name" ]] || continue
    seen=$((seen + 1))
    (( seen > total - keep )) && break
    rm -f "$name"
  done
  return 0
}

# Copies the run's own output aside (never moves it - the caller still owns
# the temp file and its own stderr echo) and prints the durable path.
retain_refusal_log() {
  local src="$1" dir index stamp path
  [[ -n "${REPO_ROOT:-}" && -f "$src" ]] || return 1
  dir="$REPO_ROOT/$REFUSAL_LOG_DIR_REL"
  mkdir -p "$dir" 2>/dev/null || return 1
  # Self-ignoring, so invariant 2 holds by construction rather than by the
  # outer checkout happening to carry a .swarmforge/ rule: nothing under
  # here can ever become a commitable artifact.
  if [[ ! -f "$dir/.gitignore" ]]; then
    printf '*\n' >"$dir/.gitignore" 2>/dev/null || true
  fi
  index="$(next_refusal_index "$dir")"
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  path="$(printf '%s/refusal-%06d-%s.log' "$dir" "$index" "$stamp")"
  cp "$src" "$path" 2>/dev/null || return 1
  prune_refusal_logs "$dir" "$(refusal_log_keep)"
  printf '%s' "$path"
}

# ── BL-1407: re-run a non-allowlisted red once, alone, before refusing ───
# The gate decides from ONE run of the whole 316-file suite under a fork
# pool BL-1348/BL-1349 show is mis-sized - a file that is only load-
# dependent (green alone, red under the full pool) refuses a commit exactly
# like a genuine regression, and because BL-1275 only retains output on
# refusal, nobody could tell which it was. 2026-09-04: five commit attempts
# refused across 2.5 hours, a different unrelated red each time, none of
# them a file the parcel touched.
FLAKE_LOG_DIR_REL=".swarmforge/property-flakes"
RERUN_CEILING_SECONDS_DEFAULT=180

rerun_ceiling_seconds() {
  local v="${SWARMFORGE_PROPERTY_RERUN_CEILING_SECONDS:-$RERUN_CEILING_SECONDS_DEFAULT}"
  if [[ "$v" =~ ^[0-9]+$ ]] && (( v >= 1 )); then
    printf '%s' "$v"
  else
    printf '%s' "$RERUN_CEILING_SECONDS_DEFAULT"
  fi
}

# Production: the same properties config the full suite uses, scoped to one
# file. Under test injection (the guard was invoked with its own extra
# args, the same seam run_default_suite's caller uses for the full run) the
# file is appended after a placeholder that lands on bash -c's $0 slot, so
# a fixture reads "$1" for the file being re-run - the file argument is
# never $0, so a fixture that ignores args (like the plain GREEN/RED
# fixtures) still runs unchanged.
default_rerun_cmd() {
  local file="$1"
  (cd extension && npx vitest run --config vitest.properties.config.mjs "$file")
}

run_rerun_for_file() {
  local file="$1"
  if (( ${#ORIG_ARGS[@]} > 0 )); then
    "${ORIG_ARGS[@]}" bl1407-rerun "$file"
  else
    default_rerun_cmd "$file"
  fi
}

# Runs "$@" as the leader of its own process group (BL-1202's shape, reused)
# bounded by $1 seconds wall-clock. A command that is still running at the
# ceiling is killed (group-wide, grace-then-force, same as
# report_canary_once) and counted as a failure via exit 124 - a plain
# sentinel fed straight into the same invariant-3 decision a real non-zero
# exit would produce, never a forced pass/fail bypass. No GNU `timeout`
# dependency (stock macOS bash has none).
run_bounded() {
  local ceiling="$1"; shift
  local out_file pid waited=0 rc
  out_file="$(mktemp)"
  set -m
  ("$@") >"$out_file" 2>&1 &
  pid=$!
  set +m
  while kill -0 -- "$pid" 2>/dev/null; do
    if (( waited >= ceiling )); then
      kill -TERM -- "-$pid" 2>/dev/null || true
      local grace
      for grace in 1 2 3 4 5 6 7 8 9 10; do
        kill -0 -- "-$pid" 2>/dev/null || break
        sleep 0.05
      done
      kill -KILL -- "-$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
      rm -f "$out_file"
      return 124
    fi
    sleep 1
    waited=$((waited + 1))
  done
  wait "$pid"
  rc=$?
  rm -f "$out_file"
  return "$rc"
}

current_head_sha() {
  git rev-parse HEAD 2>/dev/null || printf '%s' "(initial-commit)"
}

# True when the staged diff touches $normalized (an ps_allowlist_normalize_file
# result), so a flake record can say whether THIS commit is implicated.
commit_touched_file() {
  local normalized="$1" f
  while IFS= read -r f; do
    [[ -n "$f" ]] || continue
    [[ "$(ps_allowlist_normalize_file "$f")" == "$normalized" ]] && return 0
  done < <(git diff --cached --name-only)
  return 1
}

json_escape() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  printf '%s' "$s"
}

# Invariant 2: every red the re-run cleared is recorded durably (file,
# commit, whether this commit touched it, and where full output is
# retained) so the flake rate is measurable. No mixed-outcome scenario ties
# a cleared file to a refusal's retained log (BL-1275 owns that store), so
# the field is always the placeholder the ticket's own description names.
record_flake() {
  local file="$1" dir path at commit normalized touched_flag retained
  normalized="$(ps_allowlist_normalize_file "$file")"
  commit="$(current_head_sha)"
  if commit_touched_file "$normalized"; then touched_flag=true; else touched_flag=false; fi
  retained="not retained until BL-1275"
  dir="$REPO_ROOT/$FLAKE_LOG_DIR_REL"
  mkdir -p "$dir" 2>/dev/null || true
  if [[ ! -f "$dir/.gitignore" ]]; then
    printf '*\n' >"$dir/.gitignore" 2>/dev/null || true
  fi
  path="$dir/$(date -u +%Y-%m).jsonl"
  at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '{"at":"%s","file":"%s","commit":"%s","touched_by_commit":%s,"output_retained":"%s"}\n' \
    "$at" "$(json_escape "$normalized")" "$(json_escape "$commit")" "$touched_flag" "$(json_escape "$retained")" \
    >>"$path" 2>/dev/null || true
  echo "property-suite-guard: flake recorded — $normalized failed in the full run, passed alone (BL-1407)" >&2
}

# Re-runs each non-allowlisted failing file (one per line in $1) once,
# alone, under a TOTAL wall-clock ceiling shared across all of them - a
# file that clears the remaining budget is never attempted and counts as
# still-failing (invariant 3: no answer is never a pass). Prints the files
# that are STILL failing after their re-run, one per line (empty output
# when every one of them turned out to be a load flake). Allowlisted files
# are never passed in here at all - the caller only ever hands it $UNLISTED.
rerun_unlisted_alone() {
  local unlisted="$1" file ceiling started now elapsed remaining rc
  local still=()
  ceiling="$(rerun_ceiling_seconds)"
  started="$(date +%s)"
  while IFS= read -r file; do
    [[ -n "$file" ]] || continue
    now="$(date +%s)"
    elapsed=$((now - started))
    remaining=$((ceiling - elapsed))
    if (( remaining <= 0 )); then
      still+=("$file")
      continue
    fi
    set +e
    run_bounded "$remaining" run_rerun_for_file "$file"
    rc=$?
    set -e
    if (( rc == 0 )); then
      record_flake "$file"
    else
      echo "property-suite-guard: $file still fails when run alone" >&2
      still+=("$file")
    fi
  done <<<"$unlisted"
  if (( ${#still[@]} > 0 )); then
    printf '%s\n' "${still[@]}"
  fi
}

path_triggers_check() {
  case "$1" in
    extension/src/*|*.property.test.js) return 0 ;;
  esac
  return 1
}

collect_trigger_paths() {
  local file
  TRIGGER_PATHS=()
  while IFS= read -r file; do
    [[ -z "$file" ]] && continue
    if path_triggers_check "$file"; then
      TRIGGER_PATHS+=("$file")
    fi
  done < <(git diff --cached --name-only)
}

staged_needs_check() {
  collect_trigger_paths
  (( ${#TRIGGER_PATHS[@]} > 0 ))
}

# True when every suite-triggering staged path is byte-identical to the
# incoming parent (pure import — BL-925/1096 lineage; BL-1121 standing recipe).
reconcile_import_byte_identical() {
  local parent="$1"
  local f
  for f in "${TRIGGER_PATHS[@]}"; do
    [[ -z "$(git diff --cached "$parent" -- "$f")" ]] || return 1
  done
  return 0
}

maybe_skip_reconcile_import() {
  local parent
  parent="$(resolve_incoming_merge_parent || true)"
  [[ -n "$parent" ]] || return 1
  reconcile_import_byte_identical "$parent" || return 1
  echo "property-suite-guard: skip-reconcile-import (staged trigger paths byte-identical to incoming parent ${parent:0:10})" >&2
  return 0
}

default_toolchain_ready() {
  [[ -d extension/node_modules ]] && command -v npm >/dev/null 2>&1
}

run_default_suite() {
  (cd extension && npm run test:properties)
}

# BL-1202: the guard must report its BL-1124 canary verdict on EVERY exit
# path of the run it guards - green, red, AND a kill mid-run (the foreground
# `git commit` being killed by a client-side timeout, the incident this
# ticket exists for) - and must not leave the suite's own process group
# running once the guard itself is gone. BEFORE/SUITE_PID are set only once
# a real suite run actually starts (right before it starts); every
# short-circuit above this point never touches them, so the EXIT/INT/TERM
# traps below are a no-op for a path that never started a suite (a path
# with nothing to report must not start printing one).
BEFORE=""
SUITE_PID=""
SUITE_OUT_FILE=""
CANARY_DONE=0
CANARY_RESULT=0

# Idempotent: the first caller (either the normal post-suite path below, or
# the trap on an abnormal exit) computes and reports the verdict; every
# later call (the OTHER of those two, whichever runs second) is a fast
# no-op returning the same verdict, so the message and the process-group
# kill each happen exactly once. Never blocks indefinitely on a dying
# child (constraint: the report path must not itself hang the hook) - the
# grace-then-force kill loop below is bounded.
report_canary_once() {
  if (( CANARY_DONE )); then
    return "$CANARY_RESULT"
  fi
  CANARY_DONE=1
  [[ -n "$BEFORE" ]] || return 0

  if [[ -n "$SUITE_PID" ]]; then
    kill -TERM -- "-$SUITE_PID" 2>/dev/null || true
    local waited
    for waited in 1 2 3 4 5 6 7 8 9 10; do
      kill -0 -- "-$SUITE_PID" 2>/dev/null || break
      sleep 0.05
    done
    kill -KILL -- "-$SUITE_PID" 2>/dev/null || true
  fi

  set +e
  bl1124_assert_unchanged "$REPO_ROOT" "$BEFORE"
  CANARY_RESULT=$?
  set -e
  if (( CANARY_RESULT != 0 )); then
    echo "Commit rejected: property suite mutated the shared checkout (BL-1124)." >&2
  fi
  return "$CANARY_RESULT"
}

# A caught INT/TERM (the guard itself being killed mid-run) must still
# report the canary and take the suite process group down with it - then
# exit non-zero, same as any other abnormal end to a started run. The
# explicit exit here also fires the EXIT trap below, which is a no-op by
# then (report_canary_once's own idempotency guard).
on_interrupt() {
  report_canary_once || true
  exit 1
}
trap on_interrupt INT TERM
# BL-1275: the suite output now outlives the read into $OUT - the refusal
# path copies it aside - so its removal moves onto the EXIT trap, which
# every path through this script (including on_interrupt's explicit exit)
# already runs.
cleanup_suite_out() {
  [[ -n "${SUITE_OUT_FILE:-}" ]] && rm -f "$SUITE_OUT_FILE"
  return 0
}
trap 'report_canary_once || true; cleanup_suite_out' EXIT

if [[ "${SWARMFORGE_SKIP_PROPERTY_SUITE_GUARD:-}" == "1" ]]; then
  warn_override
  exit 0
fi

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

if ! staged_needs_check; then
  echo "property-suite-guard: skip-paths" >&2
  exit 0
fi

# BL-1121: standing recipe for already-QA'd reconcile imports — not the env override.
if maybe_skip_reconcile_import; then
  exit 0
fi

echo "property-suite-guard: run" >&2

if ! default_toolchain_ready && (( $# == 0 )); then
  warn_skipped
  exit 0
fi

# BL-1124: canary the live checkout before fixtures run.
BEFORE="$(bl1124_snapshot "$REPO_ROOT")"

# BL-1202: run the suite as the leader of its OWN process group (job
# control enabled just for the background launch, both on Linux and macOS
# bash), redirected to a temp file rather than a command substitution, so
# report_canary_once (from either the normal path below or a kill trap)
# can address that whole group by pgid and `wait` can be interrupted by a
# caught signal without losing the suite's own exit status.
# BL-1196 (amended 2026-08-28): git exports GIT_DIR/GIT_INDEX_FILE (absolute,
# GIT_WORK_TREE unset) into every hook it runs for a commit made from a
# linked worktree, and this script's own environment inherits them straight
# from the pre-commit hook that invoked it. A fixture inside the suite doing
# mkdtemp + `git init` + `git commit` would silently obey an inherited
# redirect over its own cwd - this is the vector a vitest setupFile can never
# reach, since it covers code inside vitest, not the shell fixtures the
# suite shells out to. Stripped here, once, right before the suite (or the
# test-injected command) launches, so every subprocess it starts inherits a
# clean environment regardless of what the invoking hook exported.
unset -v GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE

SUITE_OUT_FILE="$(mktemp)"
set -m
if (( $# > 0 )); then
  "$@" >"$SUITE_OUT_FILE" 2>&1 &
else
  run_default_suite >"$SUITE_OUT_FILE" 2>&1 &
fi
SUITE_PID=$!
set +m

set +e
wait "$SUITE_PID"
STATUS=$?
set -e
OUT="$(cat "$SUITE_OUT_FILE" 2>/dev/null || true)"

if (( STATUS == 127 )); then
  CANARY_DONE=1
  warn_skipped
  [[ -n "$OUT" ]] && echo "$OUT" >&2
  exit 0
fi

# Always assert canary after a real suite run (green or red).
set +e
report_canary_once
CANARY=$?
set -e
if (( CANARY != 0 )); then
  [[ -n "$OUT" ]] && echo "$OUT" >&2
  exit 1
fi

if (( STATUS != 0 )); then
  echo "$OUT" >&2
  set +e
  ALLOWLIST_OK=1
  UNLISTED=""
  if [[ -n "$ALLOWLIST_TSV" && -f "$ALLOWLIST_TSV" ]]; then
    UNLISTED="$(ps_suite_failures_all_allowlisted "$ALLOWLIST_TSV" "$OUT")"
    ALLOWLIST_OK=$?
  fi
  set -e
  if (( ALLOWLIST_OK == 0 )); then
    echo "property-suite-guard: allowlisted-standing-reds; unrelated green commits not refused (BL-1175)" >&2
    exit 0
  fi

  # BL-1407: give each non-allowlisted failing file one chance to prove the
  # red was the pool's weather rather than the commit's fault, before this
  # becomes a refusal. Nothing to re-run (UNLISTED empty - no TSV, or the
  # suite crashed without printing per-file FAIL lines) skips straight to
  # the existing refusal below, unchanged.
  if [[ -n "$UNLISTED" ]]; then
    UNLISTED="$(rerun_unlisted_alone "$UNLISTED")"
    if [[ -z "$UNLISTED" ]]; then
      echo "property-suite-guard: all non-allowlisted reds cleared on re-run alone (load flake, BL-1407)" >&2
      exit 0
    fi
  fi

  # BL-1275: from here the commit IS refused, so keep the run this verdict
  # was reached from and say where it is.
  RETAINED="$(retain_refusal_log "$SUITE_OUT_FILE" || true)"
  if [[ -n "$RETAINED" ]]; then
    echo "property-suite-guard: refusal output retained at $RETAINED" >&2
  fi
  if [[ -n "$UNLISTED" ]]; then
    echo "Commit rejected: property suite failed with non-allowlisted files:" >&2
    echo "$UNLISTED" >&2
  else
    echo "Commit rejected: property suite failed. Fix the red property or set SWARMFORGE_SKIP_PROPERTY_SUITE_GUARD=1 to override." >&2
  fi
  exit 1
fi

[[ -n "$OUT" ]] && echo "$OUT" >&2
exit 0
