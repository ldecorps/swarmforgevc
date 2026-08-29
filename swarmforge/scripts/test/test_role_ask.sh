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

# ── GH-26: a marker in state "undeliverable" (deliverRoleQuestion's own
# rewrite on an undeliverable drop) never blocks a fresh ask - the role may
# ask again immediately, and the marker is overwritten (state cleared) ────
ROOT4="$(tmp_root)"
trap 'rm -rf "$ROOT4"' EXIT
AWAITING4="$ROOT4/.swarmforge/operator/role-awaiting/specifier.json"
mkdir -p "$(dirname "$AWAITING4")"
printf '{"question":"which environment?","asked_at_ms":1000,"state":"undeliverable"}' > "$AWAITING4"

OUT6="$(bb "$CLI" "$ROOT4" --role specifier --question "a fresh question")"
echo "$OUT6" | grep -q '"asked":true' || fail "expected an undeliverable-state marker to never block a fresh ask, got: $OUT6"
grep -q "a fresh question" "$AWAITING4" || fail "expected the marker to be overwritten with the new question"
grep -q '"state"' "$AWAITING4" && fail "expected the rewritten marker to carry no state field (a fresh ordinary pending ask), got: $(cat "$AWAITING4")"
pass "GH-26: an undeliverable-state marker never blocks a fresh ask, and is overwritten by it"
rm -rf "$ROOT4"
trap - EXIT

# ── GH-26: an ORDINARY pending marker (no state field at all, the shape
# role_ask.bb itself writes on every successful ask) still blocks exactly
# as before this ticket - only the literal "undeliverable" state is exempt
ROOT5="$(tmp_root)"
trap 'rm -rf "$ROOT5"' EXIT
AWAITING5="$ROOT5/.swarmforge/operator/role-awaiting/specifier.json"
mkdir -p "$(dirname "$AWAITING5")"
printf '{"question":"which environment?","asked_at_ms":1000}' > "$AWAITING5"

OUT7="$(bb "$CLI" "$ROOT5" --role specifier --question "a second question")"
echo "$OUT7" | grep -q '"asked":false' || fail "expected an ordinary pending marker (no state) to still block, got: $OUT7"
grep -q '"asked_at_ms":1000' "$AWAITING5" || fail "expected the ordinary pending marker to be left untouched"
pass "GH-26: an ordinary pending marker (no state field) still blocks, unchanged from before this ticket"
rm -rf "$ROOT5"
trap - EXIT

# ── BL-1245: resolve with a blank --reason is refused, the pending
# marker is left untouched, and a subsequent ask is still refused ────────
ROOT6="$(tmp_root)"
trap 'rm -rf "$ROOT6"' EXIT
AWAITING6="$ROOT6/.swarmforge/operator/role-awaiting/specifier.json"
mkdir -p "$(dirname "$AWAITING6")"
printf '{"question":"old question","asked_at_ms":1700000000000}' > "$AWAITING6"

# blank --reason: resolve-main emits a structured "reason-required" JSON
# and exits 2. The marker must be untouched.
OUT8="$(bb "$CLI" "$ROOT6" --role specifier --resolve --reason "" 2>/dev/null || true)"
echo "$OUT8" | grep -q '"resolved":false' || fail "expected resolved:false for blank reason, got: $OUT8"
echo "$OUT8" | grep -q '"reason":"reason-required"' || fail "expected reason reason-required, got: $OUT8"
AFTER6="$(cat "$AWAITING6")"
[[ "$AFTER6" == '{"question":"old question","asked_at_ms":1700000000000}' ]] || fail "expected the marker untouched after a blank-reason resolve, got: $AFTER6"
# a follow-on ask is still refused (marker still blocks)
OUT9="$(bb "$CLI" "$ROOT6" --role specifier --question "new question")"
echo "$OUT9" | grep -q '"asked":false' || fail "expected a follow-on ask to still be refused after a blank-reason resolve, got: $OUT9"
echo "$OUT9" | grep -q '"reason":"already-pending"' || fail "expected reason still already-pending after blank-reason resolve, got: $OUT9"
pass "BL-1245: a blank --reason is refused, the pending marker is untouched, a follow-on ask is still refused"
rm -rf "$ROOT6"
trap - EXIT

# ── BL-1245: resolve with no marker reports nothing-pending, exit 0 ────
ROOT7="$(tmp_root)"
trap 'rm -rf "$ROOT7"' EXIT
OUT10="$(bb "$CLI" "$ROOT7" --role specifier --resolve --reason "housekeeping")"
echo "$OUT10" | grep -q '"resolved":false' || fail "expected resolved:false when nothing pending, got: $OUT10"
echo "$OUT10" | grep -q '"reason":"nothing-pending"' || fail "expected reason nothing-pending, got: $OUT10"
pass "BL-1245: resolving when nothing is pending reports nothing-pending, exit 0"
rm -rf "$ROOT7"
trap - EXIT

# ── BL-1245: resolve with a real reason preserves the question and frees
# the slot so a new ask is accepted ──────────────────────────────────────
ROOT8="$(tmp_root)"
trap 'rm -rf "$ROOT8"' EXIT
AWAITING8="$ROOT8/.swarmforge/operator/role-awaiting/specifier.json"
mkdir -p "$(dirname "$AWAITING8")"
printf '{"question":"old question","asked_at_ms":1700000000000}' > "$AWAITING8"

OUT11="$(bb "$CLI" "$ROOT8" --role specifier --resolve --reason "answered out of band")"
echo "$OUT11" | grep -q '"resolved":true' || fail "expected resolved:true, got: $OUT11"
echo "$OUT11" | grep -q '"question":"old question"' || fail "expected preserved question in output, got: $OUT11"
echo "$OUT11" | grep -q '"asked_at_ms":1700000000000' || fail "expected preserved asked_at_ms in output, got: $OUT11"
echo "$OUT11" | grep -q '"reason":"answered out of band"' || fail "expected reason echoed in output, got: $OUT11"

# live marker is gone
[[ ! -f "$AWAITING8" ]] || fail "expected the live marker at role-awaiting/specifier.json to be removed, but it still exists"

# preserved record exists OUTSIDE role-awaiting/
ARCHIVE_DIR="$ROOT8/.swarmforge/operator/role-awaiting-archive"
[[ -d "$ARCHIVE_DIR" ]] || fail "expected role-awaiting-archive/ to exist, got: $(ls -la "$ROOT8/.swarmforge/operator/")"
ARCHIVE_FILE="$ARCHIVE_DIR/specifier-1700000000000.json"
[[ -f "$ARCHIVE_FILE" ]] || fail "expected preserved record at $ARCHIVE_FILE, got: $(ls -la "$ARCHIVE_DIR")"
grep -q '"question":"old question"' "$ARCHIVE_FILE" || fail "expected preserved question in archive, got: $(cat "$ARCHIVE_FILE")"
grep -q '"asked_at_ms":1700000000000' "$ARCHIVE_FILE" || fail "expected preserved asked_at_ms in archive, got: $(cat "$ARCHIVE_FILE")"
grep -q '"reason":"answered out of band"' "$ARCHIVE_FILE" || fail "expected reason in archive, got: $(cat "$ARCHIVE_FILE")"

# a new ask is accepted
OUT12="$(bb "$CLI" "$ROOT8" --role specifier --question "new question")"
echo "$OUT12" | grep -q '"asked":true' || fail "expected the new ask to be accepted after resolve, got: $OUT12"

# and the ONLY pending question for specifier is now the new one
NEW_AWAITING="$(cat "$AWAITING8")"
echo "$NEW_AWAITING" | grep -q '"question":"new question"' || fail "expected the new pending marker to be the new question, got: $NEW_AWAITING"
pass "BL-1245: resolve preserves the question in role-awaiting-archive/, frees the slot, a new ask is accepted"
rm -rf "$ROOT8"
trap - EXIT

# ── BL-1245: the preserved record is never a .json inside role-awaiting/
# (operator_runtime.bb scans that directory for *.json and would read it
# back as a live marker) ────────────────────────────────────────────────
ROOT9="$(tmp_root)"
trap 'rm -rf "$ROOT9"' EXIT
mkdir -p "$ROOT9/.swarmforge/operator/role-awaiting"
printf '{"question":"old question","asked_at_ms":1700000000000}' > "$ROOT9/.swarmforge/operator/role-awaiting/specifier.json"
bb "$CLI" "$ROOT9" --role specifier --resolve --reason "answered out of band" > /dev/null
# role-awaiting/ must hold NO .json after the resolve
LIVE_FILES="$(find "$ROOT9/.swarmforge/operator/role-awaiting" -maxdepth 1 -name '*.json' 2>/dev/null | wc -l | tr -d ' ')"
[[ "$LIVE_FILES" -eq 0 ]] || fail "expected role-awaiting/ to hold NO .json after resolve, got $LIVE_FILES"
pass "BL-1245: role-awaiting/ holds no .json after resolve - operator_runtime.bb's scan cannot read the preserved record back as live"
rm -rf "$ROOT9"
trap - EXIT

echo "ALL PASS"
