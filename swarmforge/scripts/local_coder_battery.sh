#!/usr/bin/env bash
# BL-1127: documented local coder battery — claim / edit / test / handoff on
# this host, then record pass/fail under backlog/evidence/ (or
# LOCAL_CODER_BATTERY_EVIDENCE_DIR). Fail/absent must not staff the production
# local forge pack (see start-swarm-ollama-qwen.sh staffing gate).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PROVIDER="${LOCAL_CODER_BATTERY_PROVIDER:-ollama}"
MODEL="${LOCAL_CODER_BATTERY_MODEL:-qwen2.5-coder}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
EVIDENCE_DIR="${LOCAL_CODER_BATTERY_EVIDENCE_DIR:-$ROOT/backlog/evidence}"
mkdir -p "$EVIDENCE_DIR"
OUT="$EVIDENCE_DIR/BL-1127-coder-battery-${PROVIDER}-${MODEL}-${STAMP}.md"

forced_result_from_argv() {
  local arg
  for arg in "$@"; do
    case "$arg" in
      --result=pass|--result=fail) printf '%s' "${arg#--result=}"; return 0 ;;
      --result=*) return 2 ;;
    esac
  done
  return 1
}

# Hermetic coder-role loop: claim → edit → test → handoff (fixture workspace).
# Returns 0 when all phases pass; prints phase lines on stdout for the artifact.
run_coder_loop_phases() {
  local work claim_dir src handoff_file
  work="$(mktemp -d "${TMPDIR:-/tmp}/bl1127-battery.XXXXXX")"
  # BL-1289: an EXIT trap, not only the manual rm -rf before each return
  # below - those miss a `set -e` early death between mktemp and the next
  # guarded check. This function runs inside a `$(...)` subshell (its sole
  # caller), so the trap fires when that subshell exits, not the outer script.
  # shellcheck disable=SC2064
  trap "rm -rf '$work'" EXIT
  claim_dir="$work/.swarmforge/claim"
  src="$work/src/widget.txt"
  handoff_file="$work/tmp/handoff.txt"
  mkdir -p "$claim_dir" "$(dirname "$src")" "$(dirname "$handoff_file")"

  # claim
  printf 'BL-1127-fixture\n' >"$claim_dir/current.task"
  [[ -s "$claim_dir/current.task" ]] || {
    echo "phase=claim status=fail"
    rm -rf "$work"
    return 1
  }
  echo "phase=claim status=pass detail=wrote claim marker"

  # edit
  printf 'widget-v1\n' >"$src"
  [[ -f "$src" ]] || {
    echo "phase=edit status=fail"
    rm -rf "$work"
    return 1
  }
  echo "phase=edit status=pass detail=wrote $src"

  # test
  if ! grep -qx 'widget-v1' "$src"; then
    echo "phase=test status=fail detail=content mismatch"
    rm -rf "$work"
    return 1
  fi
  echo "phase=test status=pass detail=verified edit content"

  # handoff
  cat >"$handoff_file" <<'EOF'
type: git_handoff
to: cleaner
priority: 50
task: BL-1127-fixture-battery
commit: deadbeef01
EOF
  if ! grep -q '^type: git_handoff$' "$handoff_file" ||
    ! grep -q '^to: cleaner$' "$handoff_file" ||
    ! grep -q '^task: BL-1127-fixture-battery$' "$handoff_file"; then
    echo "phase=handoff status=fail detail=draft fields incomplete"
    rm -rf "$work"
    return 1
  fi
  echo "phase=handoff status=pass detail=wrote handoff draft"

  # model pairing probe (live path) — harness --result bypasses via resolve_result
  if command -v ollama >/dev/null 2>&1; then
    if ollama run "$MODEL" "Reply with exactly: BATTERY_OK" 2>/dev/null | grep -q BATTERY_OK; then
      echo "phase=model status=pass detail=ollama BATTERY_OK"
    else
      echo "phase=model status=fail detail=ollama probe missed BATTERY_OK"
      rm -rf "$work"
      return 1
    fi
  else
    echo "phase=model status=fail detail=ollama not on PATH"
    rm -rf "$work"
    return 1
  fi

  rm -rf "$work"
  return 0
}

resolve_result() {
  local forced rc=1 phases_out
  set +e
  forced="$(forced_result_from_argv "$@")"
  rc=$?
  set -e
  if [[ "$rc" -eq 2 ]]; then
    echo "ERROR: forced result must be pass or fail" >&2
    exit 2
  fi
  if [[ "$rc" -ne 0 ]]; then
    forced="${LOCAL_CODER_BATTERY_FORCE_RESULT:-}"
  fi
  if [[ -n "$forced" ]]; then
    case "$forced" in
      pass|fail)
        RESULT="$forced"
        DETAIL="forced via harness seam (--result / LOCAL_CODER_BATTERY_FORCE_RESULT)"
        PHASES="phase=claim status=harness
phase=edit status=harness
phase=test status=harness
phase=handoff status=harness
phase=model status=harness"
        return 0
        ;;
      *)
        echo "ERROR: forced result must be pass or fail (got: $forced)" >&2
        exit 2
        ;;
    esac
  fi

  set +e
  phases_out="$(run_coder_loop_phases)"
  rc=$?
  set -e
  PHASES="$phases_out"
  if [[ "$rc" -eq 0 ]]; then
    RESULT="pass"
    DETAIL="claim/edit/test/handoff (+ model probe) all passed"
  else
    RESULT="fail"
    DETAIL="coder-loop battery failed (see phases)"
  fi
}

RESULT="fail"
DETAIL=""
PHASES=""
resolve_result "$@"

{
  echo "# BL-1127 coder battery — ${RESULT}"
  echo
  echo "- provider: ${PROVIDER}"
  echo "- model: ${MODEL}"
  echo "- stamped: ${STAMP}"
  echo "- result: ${RESULT}"
  echo "- detail: ${DETAIL}"
  echo
  echo "## Phases (claim / edit / test / handoff / model)"
  echo
  printf '%s\n' "$PHASES"
  echo
  echo "Staffing: fail/absent must not enable production local forge pack."
  echo "Gate: start-swarm-ollama-qwen.sh requires a cited pass evidence path."
} >"$OUT"

echo "RESULT=${RESULT}"
echo "EVIDENCE=${OUT}"
[[ "$RESULT" == "pass" ]]
