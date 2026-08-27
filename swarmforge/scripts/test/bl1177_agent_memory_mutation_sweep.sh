#!/usr/bin/env bash
# BL-1177 hardener: surgical mutation over portable agent-memory transfer.
set -uo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
TARGET=extension/src/tools/agentMemoryTransfer.ts
BACKUP=$(mktemp); cp "$TARGET" "$BACKUP"
restore(){ cp "$BACKUP" "$TARGET"; (cd extension && npm run compile >/dev/null 2>&1)||true; }
cleanup(){ restore; rm -f "$BACKUP" /tmp/b1177_from.txt /tmp/b1177_to.txt; }; trap cleanup EXIT
killed=0;survived=0;skipped=0
suite_fails(){
  if ! (cd extension && npm run compile >/dev/null 2>&1); then return 0; fi
  if ! (cd extension && npx vitest run --config vitest.properties.config.mjs test/agentMemoryTransfer.property.test.js >/dev/null 2>&1); then return 0; fi
  if ! bash specs/pipeline/scripts/run_acceptance.sh specs/features/BL-1177-portable-agent-memory-payload-capture-inject.feature >/dev/null 2>&1; then return 0; fi
  return 1
}
mutate(){ local label="$1"; restore
  if ! python3 - <<'PY'
from pathlib import Path
a=Path('/tmp/b1177_from.txt').read_text(); b=Path('/tmp/b1177_to.txt').read_text()
s=Path('extension/src/tools/agentMemoryTransfer.ts').read_text()
if a not in s: raise SystemExit(3)
Path('extension/src/tools/agentMemoryTransfer.ts').write_text(s.replace(a,b,1))
PY
  then echo "  skip     $label"; skipped=$((skipped+1)); return; fi
  if suite_fails; then echo "  killed   $label"; killed=$((killed+1)); else echo "  SURVIVED $label"; survived=$((survived+1)); fi
}
wp(){ python3 -c 'import pathlib,sys; pathlib.Path("/tmp/b1177_from.txt").write_text(sys.argv[1]); pathlib.Path("/tmp/b1177_to.txt").write_text(sys.argv[2])' "$1" "$2"; }
echo "mutation sweep over agent memory transfer (BL-1177)"
wp 'if (typeof raw.role !== '\''string'\'' || !raw.role.trim()) {
    return null;
  }' 'if (false) {
    return null;
  }'
mutate "empty role accepted by validate"
wp 'if (payload.role !== targetRole) {
    return {
      ok: false,
      signal: `inject refused: payload role "${payload.role}" does not match target role "${targetRole}" — fail closed`,
      pretendedContinuity: false,
    };
  }' 'if (false) {
    return {
      ok: false,
      signal: `inject refused: payload role "${payload.role}" does not match target role "${targetRole}" — fail closed`,
      pretendedContinuity: false,
    };
  }'
mutate "role mismatch check disabled"
wp 'if (!payload) {
    return {
      ok: false,
      signal: '\''inject refused: portable memory payload is malformed — fail closed'\'',
      pretendedContinuity: false,
    };
  }' 'if (!payload) {
    return {
      ok: true,
      role: normalizeRole(role),
      openParcelContext: { openParcelIds: [] },
      continuitySummary: '\'''\'',
      pretendedContinuity: true,
    };
  }'
mutate "malformed inject pretends continuity"
wp 'ok: true,' 'ok: false,'
mutate "successful inject flipped to failure"
wp 'return { payload: aggregateCapturePayload(outgoingState) };' \
  'return { payload: { kind: '\''portable-agent-memory-payload'\'', schemaVersion: AGENT_MEMORY_PAYLOAD_SCHEMA_VERSION, role: '\''x'\'', continuitySummary: '\'''\'', openParcelContext: { openParcelIds: [] } } };'
mutate "capture ignores named fixture inputs"
echo "summary: killed=$killed survived=$survived skipped=$skipped"
[[ "$survived" -eq 0 && "$skipped" -eq 0 && "$killed" -eq 5 ]]
