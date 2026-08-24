#!/usr/bin/env bash
# BL-1053 hardener: surgical mutation sweep over the APS step handler.
#
# Stryker mutates extension/out only. model_factory_lib.bb and the feature
# file are BL-149 skip-cooldown this pass (recent main churn). The step
# handler is brand-new on the in-flight branch (no main history → run).
# Each mutant is a single edit a correct acceptance suite must reject.
set -uo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
LIB=specs/pipeline/steps/bl1053LocalProviderRoutingSteps.js
FEATURE=specs/features/BL-1053-the-intelligence-layer-can-route-work-to-a-local-model-seat.feature
ACCEPT=(bash specs/pipeline/scripts/run_acceptance.sh "$FEATURE")

BACKUP="$(mktemp)"
cp "$LIB" "$BACKUP"
restore() { cp "$BACKUP" "$LIB"; }
cleanup() { restore; rm -f "$BACKUP"; }
trap cleanup EXIT

killed=0; survived=0; skipped=0
declare -a SURVIVORS=()
declare -a EQUIVALENTS=()

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

  if ! "${ACCEPT[@]}" >/dev/null 2>&1; then
    echo "  killed   $label (acceptance)"
    killed=$((killed + 1)); return
  fi
  echo "  SURVIVED $label"
  SURVIVORS+=("$label")
  survived=$((survived + 1))
}

# Mutants expected to survive for a documented code-level reason (BL-234).
# Still run so a future edit that makes them killable is noticed.
probe_equivalent() {
  local label="$1" from="$2" to="$3" reason="$4"
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
  if ! "${ACCEPT[@]}" >/dev/null 2>&1; then
    echo "  killed   $label (was marked equivalent — re-check reason)"
    killed=$((killed + 1)); return
  fi
  echo "  equivalent $label — $reason"
  EQUIVALENTS+=("$label")
}

echo "mutation sweep over $LIB"

# ── provider / agent constants ──────────────────────────────────────────────
mutate "LOCAL_MODEL_AGENT -> codex" \
  "const LOCAL_MODEL_AGENT = 'local-model';" \
  "const LOCAL_MODEL_AGENT = 'codex';"
mutate "LOCAL_PROVIDER -> openai" \
  "const LOCAL_PROVIDER = 'local';" \
  "const LOCAL_PROVIDER = 'openai';"
mutate "openai agent flipped to claude" \
  "  openai: 'codex'," \
  "  openai: 'claude',"
mutate "anthropic agent flipped to codex" \
  "  anthropic: 'claude'," \
  "  anthropic: 'codex',"
mutate "cerebras agent flipped to claude" \
  "  cerebras: 'aider'" \
  "  cerebras: 'claude'"

# ── resolveLaunchAgent / registration assertions ────────────────────────────
mutate "known always true" \
  "known: /:known\\? true/.test(text)" \
  "known: true"
mutate "agent always null" \
  'agent: /:agent nil/.test(text) ? null : (text.match(/:agent "([^"]+)"/) || [])[1] || null,' \
  "agent: null,"
mutate "Given rejects local provider registrations" \
  "assert.equal(
      provider,
      LOCAL_PROVIDER,
      \`this feature only registers under provider \"\${LOCAL_PROVIDER}\"; got \"\${provider}\"\`
    );" \
  "assert.equal(
      provider,
      'openai',
      \`mutated: force openai\`
    );"
mutate "cost class assert always low" \
  "assert.equal(
      ctx.registryEntry.cost_class,
      costClass,
      \`expected cost class \"\${costClass}\" on the stored entry\`
    );" \
  "assert.equal(
      ctx.registryEntry.cost_class,
      'medium',
      \`mutated: force medium\`
    );"
mutate "allow-list regex never matches" \
  'new RegExp(`\\|${LOCAL_MODEL_AGENT}\\)|${LOCAL_MODEL_AGENT}\\)`),' \
  'new RegExp(`\\|never-an-agent\\)|never-an-agent\\)`),'

# ── BL-234 equivalents (code-level reason recorded) ─────────────────────────
probe_equivalent "agent-nil check dropped" \
  'agent: /:agent nil/.test(text) ? null : (text.match(/:agent "([^"]+)"/) || [])[1] || null,' \
  'agent: (text.match(/:agent "([^"]+)"/) || [])[1] || null,' \
  "edn :agent nil has no quotes, so the capture match fails and || null already yields null"

probe_equivalent "SEAT_LAUNCHED_MODEL renamed" \
  "const SEAT_LAUNCHED_MODEL = 'claude-sonnet-5';" \
  "const SEAT_LAUNCHED_MODEL = 'never-the-resolved-model';" \
  "fixture writes and asserts the same constant; both sides move together"

echo
echo "killed=$killed survived=$survived skipped=$skipped equivalents=${#EQUIVALENTS[@]}"
if (( survived > 0 )); then
  echo "SURVIVORS:"
  printf '  - %s\n' "${SURVIVORS[@]}"
  exit 1
fi
exit 0
