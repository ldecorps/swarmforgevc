#!/usr/bin/env bash
# BL-1711 QA D2: handoffd.bb's send-ollama-restart-alert! rendered the CLI's
# raw token line verbatim to the human ("SwarmForge: ESCALATED 1 1800 …"),
# so a single failed restart (RESTART_FAILED, same "<verb> N N path" shape as
# a bound-exhausted ESCALATED) was indistinguishable from restarts being
# exhausted. ollama-restart-alert-text renders distinct wording per token;
# this loads handoffd.bb as a file (BL-1395's own guarded idiom - `load-file`
# never starts the daemon loop) and calls it directly for all three tokens.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HANDOFFD="$SCRIPT_DIR/../handoffd.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$ROOT"' EXIT

OUT="$(SWARMFORGE_ALLOW_TMP_DAEMON=1 bb -e "
(binding [*command-line-args* [\"$ROOT\"]]
  (load-file \"$HANDOFFD\"))
(println (:text (handoffd/ollama-restart-alert-text \"RESTARTED 111 222 /tmp/x.log\")))
(println (:text (handoffd/ollama-restart-alert-text \"RESTART_FAILED 111 222 /tmp/x.log\")))
(println (:text (handoffd/ollama-restart-alert-text \"ESCALATED 3 1800 /tmp/x.log\")))
" 2>&1)"
RC=$?

[[ "$RC" -eq 0 ]] || fail "probe exited $RC: $OUT"

RESTARTED_LINE="$(sed -n '1p' <<<"$OUT")"
FAILED_LINE="$(sed -n '2p' <<<"$OUT")"
ESCALATED_LINE="$(sed -n '3p' <<<"$OUT")"

[[ "$RESTARTED_LINE" == *"restarted: pid 111 -> 222"* ]] || fail "RESTARTED text wrong: $RESTARTED_LINE"
pass "RESTARTED renders a distinct 'restarted: pid A -> B' text"

[[ "$FAILED_LINE" == *"never answered"* ]] || fail "RESTART_FAILED text wrong: $FAILED_LINE"
[[ "$FAILED_LINE" != *"exhausted"* ]] || fail "RESTART_FAILED text must not read as exhausted: $FAILED_LINE"
pass "RESTART_FAILED renders its own text, never the exhausted wording"

[[ "$ESCALATED_LINE" == *"exhausted"* ]] || fail "ESCALATED text wrong: $ESCALATED_LINE"
[[ "$ESCALATED_LINE" != *"never answered"* ]] || fail "ESCALATED text must not read as a single failed restart: $ESCALATED_LINE"
pass "ESCALATED renders its own 'restarts exhausted' text, distinct from RESTART_FAILED"

[[ "$FAILED_LINE" != "$ESCALATED_LINE" ]] || fail "RESTART_FAILED and ESCALATED rendered identical text: $FAILED_LINE"
pass "RESTART_FAILED and ESCALATED are distinguishable"

echo "ALL PASS"
