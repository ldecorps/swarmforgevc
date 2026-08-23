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
if ! grep -q 'qwen_launch_guard_lib.sh' "$ROOT/swarmforge/scripts/swarmforge.sh"; then
  echo "FAIL: swarmforge.sh does not source qwen_launch_guard_lib.sh" >&2
  exit 1
fi
echo "ok: swarmforge.sh delegates to the shared lib"
echo "BL-1077 invariant: all entry points agree"
