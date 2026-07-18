#!/usr/bin/env bash
# Wiring smoke for provider_quota_alert.bb — FORCE_RESULT seam, no network.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp_cleanup.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$SCRIPT_DIR/.."
CLI="$SRC/provider_quota_alert.bb"
fail=0
note() { printf '%s\n' "$*"; }
check() { if eval "$2"; then note "ok   - $1"; else note "FAIL - $1"; fail=1; fi; }

make_fixture() {
  local d; d="$(mktemp -d)"
  register_tmp_dir "$d"
  mkdir -p "$d/.swarmforge/operator" "$d/swarmforge/scripts"
  cp "$SRC/provider_quota_lib.bb" "$SRC/provider_quota_alert.bb" "$d/swarmforge/scripts/"
  printf '%s' "$d"
}

outbox() { cat "$1/.swarmforge/operator/telegram-reply-outbox.jsonl" 2>/dev/null || true; }
state() { cat "$1/.swarmforge/operator/provider-quota-state.json" 2>/dev/null || true; }

# ── 1. openai newly dry -> one OPERATOR alert with summary lines ───────────
F="$(make_fixture)"
FORCE='{"openai":{"status":"dry","detail":"quota"},"mistral":{"status":"ok","detail":"ok"},"gemini":{"status":"ok","detail":"ok"}}'
OUT="$(PROVIDER_QUOTA_FORCE_RESULT="$FORCE" bb "$F/swarmforge/scripts/provider_quota_alert.bb" "$F")"
BOX="$(outbox "$F")"
check "CLI reports alerted true" '[[ "$OUT" == *"\"alerted\":true"* ]]'
check "outbox uses OPERATOR threadId" '[[ "$BOX" == *"\"threadId\":\"OPERATOR\""* ]]'
check "alert names OpenAI just dried" '[[ "$BOX" == *"OpenAI just ran out of quota"* ]]'
check "alert has Also dry line" '[[ "$BOX" == *"Also dry: (none)"* ]]'
check "alert has Not dry line" '[[ "$BOX" == *"Not dry: Mistral, Gemini"* ]]'
check "state persists openai dry" '[[ "$(state "$F")" == *"\"openai\":\"dry\""* ]]'

# ── 2. second tick unchanged -> no new outbox line ─────────────────────────
LINES_BEFORE="$(wc -l < "$F/.swarmforge/operator/telegram-reply-outbox.jsonl")"
PROVIDER_QUOTA_FORCE_RESULT="$FORCE" bb "$F/swarmforge/scripts/provider_quota_alert.bb" "$F" > /dev/null
LINES_AFTER="$(wc -l < "$F/.swarmforge/operator/telegram-reply-outbox.jsonl")"
check "unchanged dry adds no outbox line" '[[ "$LINES_AFTER" -eq "$LINES_BEFORE" ]]'
rm -rf "$F"

# ── 3. dry-run does not write outbox ───────────────────────────────────────
F="$(make_fixture)"
PROVIDER_QUOTA_FORCE_RESULT="$FORCE" bb "$F/swarmforge/scripts/provider_quota_alert.bb" "$F" --dry-run > /dev/null
check "dry-run creates no outbox" '[[ ! -f "$F/.swarmforge/operator/telegram-reply-outbox.jsonl" ]]'
rm -rf "$F"

# ── 4. already-dry openai + newly-dry mistral -> Also dry includes OpenAI ──
F="$(make_fixture)"
printf '%s\n' '{"openai":"dry","mistral":"ok"}' > "$F/.swarmforge/operator/provider-quota-state.json"
FORCE2='{"openai":{"status":"dry"},"mistral":{"status":"dry"},"gemini":{"status":"ok"}}'
PROVIDER_QUOTA_FORCE_RESULT="$FORCE2" bb "$F/swarmforge/scripts/provider_quota_alert.bb" "$F" > /dev/null
BOX2="$(outbox "$F")"
check "second dry names Mistral as just dried" '[[ "$BOX2" == *"Mistral just ran out of quota"* ]]'
check "Also dry lists OpenAI" '[[ "$BOX2" == *"Also dry: OpenAI"* ]]'
rm -rf "$F"

if [[ "$fail" -eq 0 ]]; then
  echo "provider_quota_alert smoke: ALL CHECKS PASSED"
else
  echo "provider_quota_alert smoke: FAILURES"; exit 1
fi
