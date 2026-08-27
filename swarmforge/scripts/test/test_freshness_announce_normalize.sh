#!/usr/bin/env bash
# Unit coverage for freshness_announce_normalize_lib.sh (Operator tofu belt).
# Bash for the harness only; the lib under test must work under /bin/sh (dash).
set -euo pipefail
SCRIPTS="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
# Prove the lib is dash-safe before exercising it from bash.
/bin/sh -c '. "'"$SCRIPTS"'/freshness_announce_normalize_lib.sh"; normalize_telegram_plain_text "ok" >/dev/null'
# shellcheck disable=SC1091
. "$SCRIPTS/freshness_announce_normalize_lib.sh"

fail=0
check() {
  name=$1
  got=$2
  want=$3
  if [ "$got" = "$want" ]; then
    echo "PASS: $name"
  else
    echo "FAIL: $name got=$(printf %s "$got" | od -An -tx1) want=$(printf %s "$want" | od -An -tx1)" >&2
    fail=1
  fi
}

check "ascii unchanged" \
  "$(normalize_telegram_plain_text 'FRESHNESS_VIOLATION age_secs=968')" \
  "FRESHNESS_VIOLATION age_secs=968"

nbsp=$(printf '\302\240')
check "NBSP becomes ASCII space" \
  "$(normalize_telegram_plain_text "hello${nbsp}world")" \
  "hello world"

zwsp=$(printf '\342\200\213')
check "ZWSP becomes ASCII space" \
  "$(normalize_telegram_plain_text "a${zwsp}b")" \
  "a b"

nnbsp=$(printf '\342\200\257')
check "NNBSP becomes ASCII space" \
  "$(normalize_telegram_plain_text "x${nnbsp}y")" \
  "x y"

if [ "$fail" -ne 0 ]; then
  exit 1
fi
echo "All freshness announce normalize checks passed."
