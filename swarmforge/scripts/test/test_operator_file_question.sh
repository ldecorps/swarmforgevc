#!/usr/bin/env bash
# BL-371: operator_file_question.bb - the Operator's only path for a
# question it cannot answer itself. Proves the file-and-tell path end to
# end against a REAL git repo (never a mocked commit check) - including the
# ticket's own most-worth-being-ruthless-about assertion: the filed item is
# actually COMMITTED, verified by reading git state directly, not merely
# that the file exists on disk.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI="$SCRIPT_DIR/../operator_file_question.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

git_repo() {
  local d; d="$(mktemp -d)"
  (cd "$d" && git init -q && git config user.email t@t && git config user.name t && git commit -q -m init --allow-empty)
  printf '%s' "$d"
}

# ── operator-passes-a-question-down-01: files + commits + tells the human ──
ROOT="$(git_repo)"
trap 'rm -rf "$ROOT"' EXIT

OUT="$(bb "$CLI" "$ROOT" --thread SUP-1 --question "why is X broken?")"
echo "$OUT" | grep -q '"committed":true' || fail "expected committed:true in output, got: $OUT"
echo "$OUT" | grep -q '"told_human":true' || fail "expected told_human:true in output, got: $OUT"

FILED_REL="$(echo "$OUT" | grep -oE '"filed":"[^"]+"' | sed -E 's/"filed":"([^"]+)"/\1/')"
[[ -n "$FILED_REL" ]] || fail "expected a non-empty filed path in output, got: $OUT"
[[ -f "$ROOT/$FILED_REL" ]] || fail "expected the intake file to actually exist at $ROOT/$FILED_REL"
pass "operator-passes-a-question-down-01: files a raw intake item and reports success"

grep -q "why is X broken?" "$ROOT/$FILED_REL" || fail "expected the filed content to carry the question verbatim"
pass "operator-passes-a-question-down-01: the filed content carries the question"

# THE FILED ITEM MUST BE COMMITTED, NOT MERELY WRITTEN - verified via real
# git state (git status --porcelain shows nothing dirty for this path, and
# a real commit touching it exists), the exact check the ticket calls out
# as most worth being ruthless about.
DIRTY="$(git -C "$ROOT" status --porcelain -- "$FILED_REL")"
[[ -z "$DIRTY" ]] || fail "expected the intake file to show as clean/committed, got dirty status: $DIRTY"
LOG="$(git -C "$ROOT" log --oneline -- "$FILED_REL")"
[[ -n "$LOG" ]] || fail "expected a real commit touching the intake file"
pass "operator-passes-a-question-down-01/02: the intake item is DURABLY committed, not merely written"

# operator-passes-a-question-down-02: reaches the specifier - proven from a
# SEPARATE checkout of the SAME repo, never the one that wrote it (the only
# check that actually proves a different worktree can see it).
CLONE="$(mktemp -d)"
git clone -q "$ROOT" "$CLONE"
[[ -f "$CLONE/$FILED_REL" ]] || fail "expected the committed intake file to be visible from an independent clone"
pass "operator-passes-a-question-down-02: the filed question is visible from a DIFFERENT checkout, not just the one that wrote it"

# "reuses the reply path it already has" - the human is told via the SAME
# reply outbox/thread transcript operator_reply.bb itself writes to.
OUTBOX="$ROOT/.swarmforge/operator/telegram-reply-outbox.jsonl"
[[ -f "$OUTBOX" ]] || fail "expected the reply outbox to exist - the human must be told"
grep -q "Filed for the swarm: $FILED_REL" "$OUTBOX" || fail "expected the reply outbox to name what was filed, got: $(cat "$OUTBOX")"
pass "operator-passes-a-question-down-01/04: the human is told what was filed, via the EXISTING reply path"

THREAD="$ROOT/.swarmforge/support/threads/SUP-1.json"
[[ -f "$THREAD" ]] || fail "expected the reply to also land in the thread's own transcript"
grep -q "Filed for the swarm" "$THREAD" || fail "expected the thread transcript to carry the filed-reply text too"
pass "the reply also lands in the thread's own transcript (the SAME store, not a second one)"

rm -rf "$CLONE"
rm -rf "$ROOT"
trap - EXIT

# ── a commit failure is reported LOUDLY, never a silent false success ──────
NOT_A_REPO="$(mktemp -d)"
set +e
OUT2="$(bb "$CLI" "$NOT_A_REPO" --thread SUP-1 --question "will this get lost?" 2>&1)"
CODE=$?
set -e
[[ "$CODE" -ne 0 ]] || fail "expected a non-zero exit when the target is not a git repo at all, got 0: $OUT2"
[[ "$OUT2" == *"FAILED to commit"* ]] || fail "expected a loud failure message, got: $OUT2"
[[ "$OUT2" != *'"committed":true'* ]] || fail "expected NO success report on an uncommitted write, got: $OUT2"
NOT_A_REPO_OUTBOX="$NOT_A_REPO/.swarmforge/operator/telegram-reply-outbox.jsonl"
[[ ! -f "$NOT_A_REPO_OUTBOX" ]] || fail "expected the human to NEVER be told 'filed' when the commit itself failed"
pass "a commit failure is reported loudly (non-zero exit, no false success) and the human is never told a lie"
rm -rf "$NOT_A_REPO"

# ── the commit can succeed while telling the human fails - the filing must
# still stand, reported honestly as told_human:false (never silently
# swallowed, never downgraded to a filing failure) ─────────────────────────
ROOT2="$(git_repo)"
trap 'rm -rf "$ROOT2"' EXIT
# Force operator_reply.bb's own write to fail deterministically - pre-create
# .swarmforge as a plain FILE so its fs/create-dirs hits an existing
# non-directory path component (ENOTDIR), never a permission-bit trick.
: > "$ROOT2/.swarmforge"

set +e
OUT3="$(bb "$CLI" "$ROOT2" --thread SUP-1 --question "will reply fail?" 2>&1)"
CODE3=$?
set -e
[[ "$CODE3" -eq 0 ]] || fail "expected success (filing/commit are what matter) even when telling the human fails, got exit $CODE3: $OUT3"
echo "$OUT3" | grep -q '"committed":true' || fail "expected committed:true even when telling the human fails, got: $OUT3"
echo "$OUT3" | grep -q '"told_human":false' || fail "expected told_human:false when the reply subprocess fails, got: $OUT3"
FILED_REL2="$(echo "$OUT3" | grep -oE '"filed":"[^"]+"' | sed -E 's/"filed":"([^"]+)"/\1/')"
LOG2="$(git -C "$ROOT2" log --oneline -- "$FILED_REL2")"
[[ -n "$LOG2" ]] || fail "expected the intake to still be committed even though telling the human failed"
pass "a reply failure after a successful commit is reported honestly (told_human:false), never masked as a filing failure"
rm -rf "$ROOT2"
trap - EXIT

# ── BL-415: the confirmation carries a real GitHub permalink at the ACTUAL
# filing commit's sha, proven against a real git origin - not just the pure
# helper in isolation ────────────────────────────────────────────────────
ROOT3="$(git_repo)"
trap 'rm -rf "$ROOT3"' EXIT
git -C "$ROOT3" remote add origin git@github.com:ldecorps/swarmforgevc.git

OUT4="$(bb "$CLI" "$ROOT3" --thread SUP-1 --question "does the link work?")"
echo "$OUT4" | grep -q '"committed":true' || fail "expected committed:true, got: $OUT4"
FILED_REL3="$(echo "$OUT4" | grep -oE '"filed":"[^"]+"' | sed -E 's/"filed":"([^"]+)"/\1/')"
SHA3="$(git -C "$ROOT3" rev-parse HEAD)"
OUTBOX3="$ROOT3/.swarmforge/operator/telegram-reply-outbox.jsonl"
[[ -f "$OUTBOX3" ]] || fail "expected the reply outbox to exist"
grep -q "https://github.com/ldecorps/swarmforgevc/blob/$SHA3/$FILED_REL3" "$OUTBOX3" \
  || fail "expected the outbox to carry a permalink at the real filing commit's sha, got: $(cat "$OUTBOX3")"
pass "BL-415: the confirmation carries a real GitHub permalink at the actual filing commit's sha"
rm -rf "$ROOT3"
trap - EXIT

# ── BL-415: no origin configured still falls back to the plain path, and
# filing still succeeds ─────────────────────────────────────────────────
ROOT4="$(git_repo)"
trap 'rm -rf "$ROOT4"' EXIT
OUT5="$(bb "$CLI" "$ROOT4" --thread SUP-1 --question "no origin here")"
echo "$OUT5" | grep -q '"committed":true' || fail "expected committed:true with no origin configured, got: $OUT5"
FILED_REL4="$(echo "$OUT5" | grep -oE '"filed":"[^"]+"' | sed -E 's/"filed":"([^"]+)"/\1/')"
OUTBOX4="$ROOT4/.swarmforge/operator/telegram-reply-outbox.jsonl"
grep -q "Filed for the swarm: $FILED_REL4" "$OUTBOX4" || fail "expected the plain-path fallback text, got: $(cat "$OUTBOX4")"
grep -q "github.com" "$OUTBOX4" && fail "expected NO permalink when there is no GitHub origin, got: $(cat "$OUTBOX4")"
pass "BL-415: a missing origin falls back to the plain path without failing the filing"
rm -rf "$ROOT4"
trap - EXIT

echo "ALL PASS"
