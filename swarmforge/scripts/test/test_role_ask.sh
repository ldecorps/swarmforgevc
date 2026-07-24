#!/usr/bin/env bash
# BL-607: role_ask.bb - the role-facing ASK leg. Proves the per-role
# pending-question guard (ONE per role, never a single global marker) and
# the reply-outbox entry it appends (roleQuestion: <role>, never
# agentQuestion - the routing signal telegramFrontDeskBotCore.ts's
# relayOneRecord uses to retarget delivery) against a REAL filesystem,
# mirroring test_operator_file_question.sh's own "drive the real CLI
# against a real fixture, verify via real state" discipline.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI="$SCRIPT_DIR/../role_ask.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

tmp_root() {
  mktemp -d
}

# ── role-clarifying-poll-01: the ask lands in the reply outbox, marked for
# the ASKING ROLE's own topic ────────────────────────────────────────────
ROOT="$(tmp_root)"
trap 'rm -rf "$ROOT"' EXIT

OUT="$(bb "$CLI" "$ROOT" --role specifier --question "which environment?" --options '["staging","prod"]')"
echo "$OUT" | grep -q '"asked":true' || fail "expected asked:true, got: $OUT"

OUTBOX="$ROOT/.swarmforge/operator/telegram-reply-outbox.jsonl"
[[ -f "$OUTBOX" ]] || fail "expected a reply-outbox entry to exist"
grep -q '"roleQuestion":"specifier"' "$OUTBOX" || fail "expected the entry marked roleQuestion:specifier, got: $(cat "$OUTBOX")"
grep -q '"agentQuestion"' "$OUTBOX" && fail "a role question must never carry agentQuestion, got: $(cat "$OUTBOX")"
grep -q '"threadId":"role-ask-specifier"' "$OUTBOX" || fail "expected the synthetic role-ask-specifier threadId, got: $(cat "$OUTBOX")"
grep -q 'staging' "$OUTBOX" || fail "expected the options to ride the outbox entry"
pass "role-clarifying-poll-01: the ask is appended to the reply outbox marked for the specifier's own topic"

AWAITING="$ROOT/.swarmforge/operator/role-awaiting/specifier.json"
[[ -f "$AWAITING" ]] || fail "expected a per-role pending marker to be written"
grep -q "which environment?" "$AWAITING" || fail "expected the pending marker to carry the question"
pass "role-clarifying-poll-01: a per-role pending marker is recorded"

# ── role-clarifying-poll-05: a second ask for the SAME role while one is
# pending is refused; the first is left untouched ────────────────────────
BEFORE="$(cat "$AWAITING")"
OUT2="$(bb "$CLI" "$ROOT" --role specifier --question "a second question?")"
echo "$OUT2" | grep -q '"asked":false' || fail "expected the second ask to be refused, got: $OUT2"
echo "$OUT2" | grep -q '"reason":"already-pending"' || fail "expected reason already-pending, got: $OUT2"
AFTER="$(cat "$AWAITING")"
[[ "$BEFORE" == "$AFTER" ]] || fail "expected the first pending question untouched by the refused second ask"
OUTBOX_LINES="$(wc -l < "$OUTBOX")"
[[ "$OUTBOX_LINES" -eq 1 ]] || fail "expected the refused ask to append NOTHING to the outbox, got $OUTBOX_LINES lines"
pass "role-clarifying-poll-05: a second ask for the same role is refused, the first pending question is left untouched"

# ── the per-role guard is scoped PER ROLE, not global - a DIFFERENT role
# may ask concurrently while specifier's own question is still pending ────
OUT3="$(bb "$CLI" "$ROOT" --role coder --question "which branch?")"
echo "$OUT3" | grep -q '"asked":true' || fail "expected a DIFFERENT role's ask to succeed while specifier's is pending, got: $OUT3"
[[ -f "$ROOT/.swarmforge/operator/role-awaiting/coder.json" ]] || fail "expected coder's own pending marker to exist"
pass "the pending guard is per-role: a different role's ask is never blocked by another role's pending question"

rm -rf "$ROOT"
trap - EXIT

# ── an ask with no --options at all still succeeds, carries no options
# field (falls back to a plain-message question, same posture as
# operator_ask.bb's own no-options case) ──────────────────────────────────
ROOT2="$(tmp_root)"
trap 'rm -rf "$ROOT2"' EXIT
OUT4="$(bb "$CLI" "$ROOT2" --role documenter --question "anything else to update?")"
echo "$OUT4" | grep -q '"asked":true' || fail "expected asked:true with no options, got: $OUT4"
OUTBOX2="$ROOT2/.swarmforge/operator/telegram-reply-outbox.jsonl"
grep -q '"options"' "$OUTBOX2" && fail "expected NO options field for a bare question, got: $(cat "$OUTBOX2")"
pass "a bare question with no options still succeeds and carries no options field"
rm -rf "$ROOT2"
trap - EXIT

# ── malformed --options degrades to a plain message, never crashes the CLI
# (same "malformed input degrades to the documented fallback" posture as
# operator_ask.bb's own parse-options) ─────────────────────────────────────
ROOT3="$(tmp_root)"
trap 'rm -rf "$ROOT3"' EXIT
OUT5="$(bb "$CLI" "$ROOT3" --role hardener --question "well-formed question" --options 'not json' 2>&1)"
echo "$OUT5" | grep -q '"asked":true' || fail "expected the CLI to still succeed on malformed --options, got: $OUT5"
OUTBOX3="$ROOT3/.swarmforge/operator/telegram-reply-outbox.jsonl"
grep -q '"options"' "$OUTBOX3" && fail "expected malformed options to degrade to no options field at all, got: $(cat "$OUTBOX3")"
pass "malformed --options degrades to a plain-message question, never crashes the CLI"
rm -rf "$ROOT3"
trap - EXIT

echo "ALL PASS"
