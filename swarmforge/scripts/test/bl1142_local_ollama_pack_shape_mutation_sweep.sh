#!/usr/bin/env bash
# BL-1142 hardender: surgical mutation sweep over local_ollama_pack_shape_lib.sh.
#
# Stryker mutates extension/out only. Soft Gherkin is BL-638 inapplicable
# (plain Scenarios, no Outline Examples). Each mutant is a single edit a
# correct unit + acceptance suite must reject.
set -uo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
LIB=swarmforge/scripts/local_ollama_pack_shape_lib.sh
UNIT=(bash swarmforge/scripts/test/local_ollama_pack_shape_test_runner.sh)
FEATURE=specs/features/BL-1142-local-ollama-mono-vs-forge-cpu.feature
ACCEPT=(bash specs/pipeline/scripts/run_acceptance.sh "$FEATURE")

BACKUP="$(mktemp)"
cp "$LIB" "$BACKUP"
restore() { cp "$BACKUP" "$LIB"; }
cleanup() { restore; rm -f "$BACKUP"; }
trap cleanup EXIT

killed=0; survived=0; skipped=0
declare -a SURVIVORS=()

suite_fails() {
  if ! "${UNIT[@]}" >/dev/null 2>&1; then
    return 0
  fi
  if ! "${ACCEPT[@]}" >/dev/null 2>&1; then
    return 0
  fi
  return 1
}

mutate() {
  local label="$1" from="$2" to="$3"
  restore
  if ! python3 - "$LIB" "$from" "$to" <<'PY'
import sys
p, a, b = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(p).read()
if a not in s:
    sys.exit(3)
open(p, 'w').write(s.replace(a, b, 1))
PY
  then
    echo "  skip     $label (anchor not found)"
    skipped=$((skipped + 1)); return
  fi

  if suite_fails; then
    echo "  killed   $label"
    killed=$((killed + 1)); return
  fi
  echo "  SURVIVED $label"
  SURVIVORS+=("$label")
  survived=$((survived + 1))
}

echo "mutation sweep over $LIB"

# ── router depth / mono decision ───────────────────────────────────────────
mutate "mono max depth default 1 -> 0" \
  'LOCAL_OLLAMA_MONO_MAX_DEPTH="${LOCAL_OLLAMA_MONO_MAX_DEPTH:-1}"' \
  'LOCAL_OLLAMA_MONO_MAX_DEPTH="${LOCAL_OLLAMA_MONO_MAX_DEPTH:-0}"'

mutate "router depth-le becomes depth-gt (never mono)" \
  'if [[ -n "$depth" && "$depth" -le "$LOCAL_OLLAMA_MONO_MAX_DEPTH" ]]; then' \
  'if [[ -n "$depth" && "$depth" -gt "$LOCAL_OLLAMA_MONO_MAX_DEPTH" ]]; then'

mutate "mono-router label flipped to capped-forge" \
  '    echo mono-router' \
  '    echo capped-forge'

mutate "capped-forge router branch flips to uncapped" \
  '    echo capped-forge
    return 0
  fi
  echo uncapped-forge
}' \
  '    echo uncapped-forge
    return 0
  fi
  echo uncapped-forge
}'

# ── standing / uncapped ────────────────────────────────────────────────────
mutate "standing windows-gt-1 becomes windows-gt-99" \
  'if [[ "$windows" -gt 1 ]]; then' \
  'if [[ "$windows" -gt 99 ]]; then'

mutate "uncapped-forge standing label flipped to capped-forge" \
  '    echo uncapped-forge
    return 0
  fi
  echo unknown
}' \
  '    echo capped-forge
    return 0
  fi
  echo unknown
}'

# ── decision allow-list / forbidden substitute ─────────────────────────────
mutate "shape allow-list accepts capped-forge" \
  '    mono-router) return 0 ;;
    *) return 1 ;;' \
  '    mono-router|capped-forge) return 0 ;;
    *) return 1 ;;'

mutate "qwen-forge dropped from forbidden case" \
  '    qwen-forge|*-qwen-forge|token-plan-forge|*-token-plan-forge) return 0 ;;' \
  '    *-qwen-forge|token-plan-forge|*-token-plan-forge) return 0 ;;'

mutate "router rotation check always false" \
  'if [[ "$rotation" == "router" ]]; then' \
  'if [[ "$rotation" == "never-router" ]]; then'

echo
echo "killed=$killed survived=$survived skipped=$skipped"
if (( survived > 0 )); then
  echo "SURVIVORS:"
  printf '  - %s\n' "${SURVIVORS[@]}"
  exit 1
fi
exit 0
