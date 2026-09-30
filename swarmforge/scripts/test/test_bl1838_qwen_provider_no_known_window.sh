#!/usr/bin/env bash
# BL-1838: with neither a served window (Ollama unreachable) nor a
# context-length fallback known, local_model_qwen_provider_cli.bb writes NO
# modelProviders entry and prints exactly one warning line naming the seat
# (ticket "What is wanted" item 2's second sentence - no Gherkin scenario
# covers this shape, so it is covered here instead).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/tmp_cleanup.sh"
PROVIDER_CLI="$SCRIPT_DIR/../local_model_qwen_provider_cli.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(mktemp -d)"
register_tmp_dir "$ROOT"
SETTINGS="$ROOT/.qwen/settings.json"
mkdir -p "$(dirname "$SETTINGS")"
cat > "$SETTINGS" <<'JSON'
{"coreTools": ["run_shell_command"]}
JSON

# Port 1 is never a live HTTP endpoint (privileged, unbound) - curl fails
# fast; no --context-length given either, so neither source of a window
# resolves.
OUT="$(bb "$PROVIDER_CLI" write \
  --settings-file "$SETTINGS" \
  --model "ista-iq3s-coder:latest" \
  --endpoint-url "http://127.0.0.1:1/v1" \
  --role coder 2>&1)"
RC=$?

[[ "$RC" -eq 0 ]] || fail "expected exit 0 (a skip is not a launch-blocking failure), got $RC: $OUT"
pass "exits 0 when no window is known"

[[ "$(printf '%s\n' "$OUT" | wc -l | tr -d ' ')" == "1" ]] || fail "expected exactly one output line, got: $OUT"
pass "prints exactly one line"

[[ "$OUT" == WARN:* ]] || fail "expected a WARN line, got: $OUT"
pass "the line is a WARN"

[[ "$OUT" == *"coder"* ]] || fail "expected the warning to name the seat's role, got: $OUT"
[[ "$OUT" == *"ista-iq3s-coder:latest"* ]] || fail "expected the warning to name the model, got: $OUT"
pass "the warning names the seat and the model"

HAS_ENTRY="$(python3 -c '
import json
d = json.load(open("'"$SETTINGS"'"))
print("modelProviders" in d)
')"
[[ "$HAS_ENTRY" == "False" ]] || fail "expected no modelProviders entry to be written"
pass "writes no modelProviders entry"

UNCHANGED="$(python3 -c '
import json
d = json.load(open("'"$SETTINGS"'"))
print(d == {"coreTools": ["run_shell_command"]})
')"
[[ "$UNCHANGED" == "True" ]] || fail "expected the settings file to be left exactly as it was"
pass "leaves the settings file exactly as it was"

echo "ALL PASS: BL-1838 no-known-window skip"
