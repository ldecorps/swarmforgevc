#!/usr/bin/env bash
# BL-419: subprocess-level proof that commit_integrity_cli.bb is a real,
# invocable wiring of commit_integrity_lib.bb - the same "drive the CLI as
# a real subprocess against a real git fixture" posture as
# test_operator_file_question.sh.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI="$SCRIPT_DIR/../commit_integrity_cli.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

git_repo() {
  local d; d="$(mktemp -d)"
  (cd "$d" && git init -q && git config user.email t@t && git config user.name t && git commit -q -m init --allow-empty)
  printf '%s' "$d"
}

# ── a real commit succeeds and reports its sha ──────────────────────────
ROOT="$(git_repo)"
trap 'rm -rf "$ROOT"' EXIT

printf 'human_approval: approved\n' > "$ROOT/ticket.yaml"
OUT="$(bb "$CLI" "$ROOT" --message "Approve BL-000" --path ticket.yaml)"
echo "$OUT" | grep -q '"success":true' || fail "expected success:true, got: $OUT"

SHA="$(echo "$OUT" | grep -oE '"sha":"[^"]+"' | sed -E 's/"sha":"([^"]+)"/\1/')"
[[ -n "$SHA" ]] || fail "expected a non-empty sha in the CLI output, got: $OUT"
[[ "$(git -C "$ROOT" show "$SHA:ticket.yaml")" == "human_approval: approved" ]] \
  || fail "expected git show of the reported sha to carry the committed content"
[[ -z "$(git -C "$ROOT" status --porcelain -- ticket.yaml)" ]] \
  || fail "expected the working tree to be clean for the committed path"
pass "commit_integrity_cli commits a real path and reports the real sha"
rm -rf "$ROOT"
trap - EXIT

# ── multiple --path flags land in one commit, pathspec-scoped ──────────
ROOT2="$(git_repo)"
trap 'rm -rf "$ROOT2"' EXIT

printf 'a\n' > "$ROOT2/a.txt"
printf 'b\n' > "$ROOT2/b.txt"
OUT2="$(bb "$CLI" "$ROOT2" --message "add a and b" --path a.txt --path b.txt)"
echo "$OUT2" | grep -q '"success":true' || fail "expected success:true for a two-path commit, got: $OUT2"
SHA2="$(echo "$OUT2" | grep -oE '"sha":"[^"]+"' | sed -E 's/"sha":"([^"]+)"/\1/')"
STAT="$(git -C "$ROOT2" show --stat --format= "$SHA2")"
echo "$STAT" | grep -q "a.txt" || fail "expected the commit to include a.txt"
echo "$STAT" | grep -q "b.txt" || fail "expected the commit to include b.txt"
pass "commit_integrity_cli commits multiple --path flags together"
rm -rf "$ROOT2"
trap - EXIT

# ── a non-repo target fails loudly, never a false success ──────────────
NOT_A_REPO="$(mktemp -d)"
printf 'x\n' > "$NOT_A_REPO/x.txt"
set +e
OUT3="$(bb "$CLI" "$NOT_A_REPO" --message "m" --path x.txt 2>&1)"
CODE=$?
set -e
[[ "$CODE" -ne 0 ]] || fail "expected non-zero exit for a non-git-repo target, got 0: $OUT3"
[[ "$OUT3" == *'no-git-dir'* ]] || fail "expected the no-git-dir reason to be named, got: $OUT3"
[[ "$OUT3" != *'"success":true'* ]] || fail "expected no false success report, got: $OUT3"
pass "commit_integrity_cli fails loudly (non-zero, no false success) against a non-git-repo target"
rm -rf "$NOT_A_REPO"

# ── missing required flags print usage and exit non-zero ───────────────
set +e
OUT4="$(bb "$CLI" "/tmp" --message "m" 2>&1)"
CODE4=$?
set -e
[[ "$CODE4" -ne 0 ]] || fail "expected non-zero exit with no --path given, got 0: $OUT4"
[[ "$OUT4" == *'Usage:'* ]] || fail "expected a usage message, got: $OUT4"
pass "commit_integrity_cli refuses to run with no --path given"

# ── BL-856: a close-guard rejection leaves no residue - it exits before
#    commit-with-integrity! (and therefore any staging) ever runs, so the
#    snapshot/restore guarantee holds trivially: nothing changed, so there
#    is nothing to restore. ──────────────────────────────────────────────
ROOT5="$(git_repo)"
trap 'rm -rf "$ROOT5"' EXIT

mkdir -p "$ROOT5/backlog/active" "$ROOT5/backlog/done"
printf 'id: BL-777\n' > "$ROOT5/backlog/active/BL-777-x.yaml"
git -C "$ROOT5" add -- backlog/active/BL-777-x.yaml
git -C "$ROOT5" commit -q -m "seed BL-777"
git -C "$ROOT5" mv backlog/active/BL-777-x.yaml backlog/done/BL-777-x.yaml
BEFORE5="$(git -C "$ROOT5" status --porcelain -- backlog/active/BL-777-x.yaml backlog/done/BL-777-x.yaml)"

set +e
OUT5="$(bb "$CLI" "$ROOT5" --message "Close BL-777" --path backlog/active/BL-777-x.yaml --path backlog/done/BL-777-x.yaml 2>&1)"
CODE5=$?
set -e
AFTER5="$(git -C "$ROOT5" status --porcelain -- backlog/active/BL-777-x.yaml backlog/done/BL-777-x.yaml)"

[[ "$CODE5" -ne 0 ]] || fail "expected non-zero exit for a close-guard rejection (no QA approval evidence), got 0: $OUT5"
[[ "$OUT5" == *'CLOSE BLOCKED'* ]] || fail "expected a CLOSE BLOCKED message, got: $OUT5"
[[ "$BEFORE5" == "$AFTER5" ]] || fail "expected the close-guard rejection to leave the index exactly as found (before: '$BEFORE5', after: '$AFTER5')"
pass "commit_integrity_cli: a close-guard rejection leaves the caller's pre-staged rename exactly as it found it"
rm -rf "$ROOT5"
trap - EXIT

echo "ALL PASS"
