#!/usr/bin/env bash
# BL-597 hardener: surgical mutation over selfHealTelemetry + store swallow.
set -uo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

BACKUP_ROOT="$(mktemp -d)"
FILES=(
  extension/src/metrics/selfHealTelemetry.ts
  extension/src/metrics/selfHealTelemetryStore.ts
)
for f in "${FILES[@]}"; do
  mkdir -p "$BACKUP_ROOT/$(dirname "$f")"
  cp "$f" "$BACKUP_ROOT/$f"
done

restore() {
  for f in "${FILES[@]}"; do cp "$BACKUP_ROOT/$f" "$f"; done
  (cd extension && npm run compile >/dev/null 2>&1) || true
}
cleanup() { restore; rm -rf "$BACKUP_ROOT" /tmp/bl597_from.txt /tmp/bl597_to.txt /tmp/bl597_target.txt; }
trap cleanup EXIT

killed=0; survived=0; skipped=0

suite_fails() {
  if ! (cd extension && npm run compile >/dev/null 2>&1); then return 0; fi
  if ! (cd extension && npx vitest run test/selfHealTelemetry.test.js >/dev/null 2>&1); then return 0; fi
  if ! (cd extension && npx vitest run --config vitest.properties.config.mjs test/selfHealTelemetry.property.test.js >/dev/null 2>&1); then return 0; fi
  if ! (bb swarmforge/scripts/test/self_heal_telemetry_lib_test_runner.bb >/dev/null 2>&1); then return 0; fi
  if ! (bash specs/pipeline/scripts/run_acceptance.sh specs/features/BL-597-trend-self-heal-events.feature >/dev/null 2>&1); then return 0; fi
  return 1
}

mutate_file() {
  local label="$1" target="$2"
  restore
  printf '%s' "$target" > /tmp/bl597_target.txt
  if ! python3 - <<'PY'
from pathlib import Path
target = Path('/tmp/bl597_target.txt').read_text().strip()
a = Path('/tmp/bl597_from.txt').read_text()
b = Path('/tmp/bl597_to.txt').read_text()
s = Path(target).read_text()
if a not in s:
    raise SystemExit(3)
Path(target).write_text(s.replace(a, b, 1))
PY
  then echo "  skip     $label"; skipped=$((skipped + 1)); return; fi
  if suite_fails; then echo "  killed   $label"; killed=$((killed + 1)); return; fi
  echo "  SURVIVED $label"; survived=$((survived + 1))
}

write_pair() {
  python3 -c 'import pathlib,sys; pathlib.Path("/tmp/bl597_from.txt").write_text(sys.argv[1]); pathlib.Path("/tmp/bl597_to.txt").write_text(sys.argv[2])' "$1" "$2"
}

echo "mutation sweep over self-heal telemetry (BL-597)"

write_pair 'if (ev.type !== type) continue;' 'if (false) continue;'
mutate_file "aggregator ignores type filter" extension/src/metrics/selfHealTelemetry.ts

write_pair 'return ms !== null && ms >= startMs && ms <= endMs;' 'return true;'
mutate_file "window filter always includes events" extension/src/metrics/selfHealTelemetry.ts

write_pair 'reason: typeof raw.reason === '\''string'\'' ? raw.reason : '\'\'',' 'reason: '\'\'','
mutate_file "parse drops reason field" extension/src/metrics/selfHealTelemetryStore.ts

write_pair \
  'export function emitSelfHealEvent(
  mainWorktreePath: string,
  event: Omit<SelfHealEvent, '\''at'\''> & { at?: string }
): void {
  try {' \
  'export function emitSelfHealEvent(
  mainWorktreePath: string,
  event: Omit<SelfHealEvent, '\''at'\''> & { at?: string }
): void {
  throw new Error("forced telemetry failure");
  try {'
mutate_file "emit always throws before append" extension/src/metrics/selfHealTelemetryStore.ts

echo "summary: killed=$killed survived=$survived skipped=$skipped"
[[ "$survived" -eq 0 ]] || exit 1
[[ "$skipped" -eq 0 ]] || exit 1
