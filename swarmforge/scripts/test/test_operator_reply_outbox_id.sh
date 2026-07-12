#!/usr/bin/env bash
# BL-320: operator_reply.bb's reply-outbox append now includes an "id"
# field per line - the idempotency key the bridge's ack-driven cursor
# (replyRelayCursor.ts) and the bot's own seenIds dedup both key on. This
# proves the real CLI writes the field (unique per call, and threadId/text
# still round-trip exactly), not just that the TS reader can COPE with one
# if present (operatorEventQueue.test.js already covers that side).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI="$SCRIPT_DIR/../operator_reply.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT

bb "$CLI" "$ROOT" --thread SUP-1 --text "first reply" >/dev/null
bb "$CLI" "$ROOT" --thread SUP-1 --text "second reply" >/dev/null

OUTBOX="$ROOT/.swarmforge/operator/telegram-reply-outbox.jsonl"
[[ -f "$OUTBOX" ]] || fail "expected the outbox file to exist after two replies"
[[ "$(wc -l < "$OUTBOX")" == "2" ]] || fail "expected exactly two lines, got: $(cat "$OUTBOX")"

LINE1="$(sed -n '1p' "$OUTBOX")"
LINE2="$(sed -n '2p' "$OUTBOX")"

echo "$LINE1" | grep -qE '"id":"[0-9a-f-]{36}"' || fail "line 1 missing a UUID-shaped id field: $LINE1"
echo "$LINE1" | grep -q '"threadId":"SUP-1"' || fail "line 1 missing threadId: $LINE1"
echo "$LINE1" | grep -q '"text":"first reply"' || fail "line 1 missing text: $LINE1"
pass "operator_reply.bb writes an id/threadId/text line for the first reply"

echo "$LINE2" | grep -qE '"id":"[0-9a-f-]{36}"' || fail "line 2 missing a UUID-shaped id field: $LINE2"
ID1="$(echo "$LINE1" | grep -oE '"id":"[0-9a-f-]{36}"')"
ID2="$(echo "$LINE2" | grep -oE '"id":"[0-9a-f-]{36}"')"
[[ "$ID1" != "$ID2" ]] || fail "expected two distinct ids, got the same value twice: $ID1"
pass "operator_reply.bb generates a distinct id per reply"

echo "ALL PASS"
