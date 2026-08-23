#!/usr/bin/env bash
# BL-1077 / BL-654: declared invariant — every entry point accepts the same
# Qwen credential names. Reads the three live sources; does not re-state the
# set in this file alone.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
FILES=(
  "$ROOT/swarmforge/scripts/qwen_launch_guard_lib.sh"
  "$ROOT/start-swarm-qwen.sh"
  "$ROOT/swarmforge/scripts/ancillary_provider_lib.sh"
)

REQUIRED=(QWEN_API_KEY BAILIAN_TOKEN_PLAN_API_KEY BAILIAN_CODING_PLAN_API_KEY)

for f in "${FILES[@]}"; do
  [[ -f "$f" ]] || { echo "FAIL: missing $f" >&2; exit 1; }
  for name in "${REQUIRED[@]}"; do
    if ! grep -q "$name" "$f"; then
      echo "FAIL: $f does not mention $name" >&2
      exit 1
    fi
  done
  # Token-plan preferred name must appear before the coding-plan legacy alias
  # in the fallback chain (order matters for which credential wins).
  token_line="$(grep -n 'BAILIAN_TOKEN_PLAN_API_KEY' "$f" | head -1 | cut -d: -f1)"
  coding_line="$(grep -n 'BAILIAN_CODING_PLAN_API_KEY' "$f" | head -1 | cut -d: -f1)"
  if [[ "$token_line" -ge "$coding_line" ]]; then
    echo "FAIL: $f mentions BAILIAN_CODING_PLAN_API_KEY before BAILIAN_TOKEN_PLAN_API_KEY ($coding_line <= $token_line)" >&2
    exit 1
  fi
  echo "ok: $f accepts the shared name set in preferred order"
done

# Generated guard site must source the shared lib (not a third copy of the names).
SWARMFORGE_SH="$ROOT/swarmforge/scripts/swarmforge.sh"
if ! grep -q 'qwen_launch_guard_lib.sh' "$SWARMFORGE_SH"; then
  echo "FAIL: swarmforge.sh does not source qwen_launch_guard_lib.sh" >&2
  exit 1
fi
echo "ok: swarmforge.sh delegates to the shared lib"

# Both guard branches share one source-prefix variable (avoids re-stating the
# fragile quote shape twice). The assignment must be the safe double-quoted
# path concat, and BOTH branches must expand ${qwen_lib_source} — a dead
# local that leaves each branch re-stating the path is the drift the shared
# prefix exists to prevent.
#
# QA bounce 20260823: broken $'…\''"$SCRIPT_DIR"'/…\'…' nesting made zsh fail
# to parse swarmforge.sh at the next elif. Reject that nesting by substring
# (a mutant can keep a dummy qwen_lib_source= and still embed it), then prove
# sourcing succeeds (BL-089: sourced, not executed as toplevel).
python3 - "$SWARMFORGE_SH" <<'PY'
import sys
path = sys.argv[1]
s = open(path).read()
safe = 'qwen_lib_source="source \'${SCRIPT_DIR}/qwen_launch_guard_lib.sh\'"'
if safe not in s:
    print("FAIL: swarmforge.sh missing safe shared qwen_lib_source assignment", file=sys.stderr)
    sys.exit(1)
uses = s.count('qwen_guard="${qwen_lib_source}"')
if uses < 2:
    print(
        f"FAIL: swarmforge.sh must expand ${{qwen_lib_source}} on both guard "
        f"branches (found {uses})",
        file=sys.stderr,
    )
    sys.exit(1)
# Pre-fix nesting fragment (ANSI-C close + SCRIPT_DIR + reopen).
broken = "$'source \\''\"$SCRIPT_DIR\"'/qwen_launch_guard"
if broken in s:
    print(
        "FAIL: swarmforge.sh still embeds the broken ANSI-C qwen_guard quote nesting",
        file=sys.stderr,
    )
    sys.exit(1)
print("ok: swarmforge.sh uses one shared qwen_lib_source prefix on both branches")
print("ok: swarmforge.sh rejects the broken ANSI-C qwen_guard quote nesting")
PY

set +e
zsh_err="$(zsh -c "source '$SWARMFORGE_SH'" 2>&1 >/dev/null)"
zsh_status=$?
set -e
if [[ "$zsh_status" -ne 0 ]]; then
  echo "FAIL: zsh cannot source swarmforge.sh (exit $zsh_status): $zsh_err" >&2
  exit 1
fi
echo "ok: zsh sources swarmforge.sh (qwen_guard quoting parses)"
echo "BL-1077 invariant: all entry points agree"
