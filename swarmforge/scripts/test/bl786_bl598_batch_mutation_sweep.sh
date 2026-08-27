#!/usr/bin/env bash
# BL-786 + BL-598 hardener batch: surgical mutation on resolver + telemetry.
set -uo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
RESOLVER=extension/src/tools/resolve-mutation-concurrency.ts
TELEMETRY=extension/src/metrics/alertTelemetry.ts
PROP786=(node --test extension/test/resolveMutationConcurrency.property.test.js)
PROP598=(node --test extension/test/alertTelemetry.property.test.js)
ACCEPT786=(bash specs/pipeline/scripts/run_acceptance.sh specs/features/BL-786-mutation-concurrency-host-resolved.feature)
ACCEPT598=(bash specs/pipeline/scripts/run_acceptance.sh specs/features/BL-598-trend-false-alarm-rate.feature)

BACKUP_R="$(mktemp)"; BACKUP_T="$(mktemp)"
cp "$RESOLVER" "$BACKUP_R"; cp "$TELEMETRY" "$BACKUP_T"
restore() { cp "$BACKUP_R" "$RESOLVER"; cp "$BACKUP_T" "$TELEMETRY"; (cd extension && npm run compile >/dev/null 2>&1); }
cleanup() { restore; rm -f "$BACKUP_R" "$BACKUP_T"; }
trap cleanup EXIT

killed=0; survived=0; skipped=0
declare -a SURVIVORS=()

suite_fails() {
  if ! (cd extension && npm run compile >/dev/null 2>&1); then return 0; fi
  if ! "${PROP786[@]}" >/dev/null 2>&1; then return 0; fi
  if ! "${PROP598[@]}" >/dev/null 2>&1; then return 0; fi
  if ! "${ACCEPT786[@]}" >/dev/null 2>&1; then return 0; fi
  if ! "${ACCEPT598[@]}" >/dev/null 2>&1; then return 0; fi
  return 1
}

mutate() {
  local label="$1" file="$2" from="$3" to="$4"
  restore
  if ! python3 - "$file" "$from" "$to" <<'PY'
import sys
p,a,b=sys.argv[1],sys.argv[2],sys.argv[3]
s=open(p).read()
if a not in s: sys.exit(3)
open(p,'w').write(s.replace(a,b,1))
PY
  then echo "  skip     $label"; skipped=$((skipped+1)); return; fi
  if suite_fails; then echo "  killed   $label"; killed=$((killed+1)); return; fi
  echo "  SURVIVED $label"; SURVIVORS+=("$label"); survived=$((survived+1))
}

echo "batch mutation sweep BL-786 + BL-598"

mutate "786 pin ignored" "$RESOLVER" \
  'if (input.pin !== undefined && Number.isFinite(input.pin) && input.pin > 0) {' \
  'if (false) {'

mutate "786 always returns pinned source" "$RESOLVER" \
  "source: 'computed'," \
  "source: 'pinned',"

mutate "786 pin env always undefined" "$RESOLVER" \
  'return Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;' \
  'return undefined;'

mutate "598 false-positive inverted" "$TELEMETRY" \
  "record.verdict === 'false-positive'" \
  "record.verdict === 'actionable'"

mutate "598 counts non-fired records" "$TELEMETRY" \
  'if (!record.fired) continue;' \
  'if (false) continue;'

mutate "598 bucket mean always 0" "$TELEMETRY" \
  'value: values.reduce((s, v) => s + v, 0) / values.length,' \
  'value: 0,'

echo "---"
echo "surgical killed=$killed survived=$survived skipped=$skipped"
printf 'survivors: %s\n' "${SURVIVORS[*]:-none}"
