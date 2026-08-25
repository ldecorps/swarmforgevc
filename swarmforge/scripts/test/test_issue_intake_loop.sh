#!/usr/bin/env bash
# BL-114: issue_specced.sh / issue_done.sh close the loop on the GitHub
# issue that seeded a backlog item. Exercised against a fake `gh` on PATH -
# no live GitHub. Covers acceptance scenarios BL-114 issue-loop-01..03.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SPECCED="$SCRIPT_DIR/../issue_specced.sh"
DONE="$SCRIPT_DIR/../issue_done.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT

FAKE_BIN="$ROOT/bin"
mkdir -p "$FAKE_BIN"
GH_CALLS="$ROOT/gh-calls.log"

install_working_gh() {
  cat > "$FAKE_BIN/gh" <<GH
#!/usr/bin/env bash
echo "\$*" >> "$GH_CALLS"
exit 0
GH
  chmod +x "$FAKE_BIN/gh"
}

install_unauthenticated_gh() {
  cat > "$FAKE_BIN/gh" <<'GH'
#!/usr/bin/env bash
if [[ "$1" == "auth" && "$2" == "status" ]]; then
  echo "not logged in" >&2
  exit 1
fi
exit 0
GH
  chmod +x "$FAKE_BIN/gh"
}

# ── issue-loop-01: draining a GH item comments and labels the issue ────────
install_working_gh
: > "$GH_CALLS"
OUT="$(PATH="$FAKE_BIN:$PATH" bash "$SPECCED" "https://github.com/acme/repo/issues/42" "backlog/paused/BL-200-something.yaml")"

grep -q "^auth status$" "$GH_CALLS" || fail "01: expected an auth status check"
grep -q "^issue comment https://github.com/acme/repo/issues/42 --body Specced: \`backlog/paused/BL-200-something.yaml\` is ready in the swarm's paused backlog\.$" "$GH_CALLS" \
  || fail "01: expected an issue comment naming the paused path; got: $(cat "$GH_CALLS")"
grep -q "^issue edit https://github.com/acme/repo/issues/42 --add-label swarm-specced$" "$GH_CALLS" \
  || fail "01: expected the swarm-specced label to be applied; got: $(cat "$GH_CALLS")"
echo "$OUT" | grep -q "^OK: " || fail "01: expected an OK report; got: $OUT"
pass "01: draining a GH item comments the issue with the paused path and applies swarm-specced"

# ── issue-loop-02: completion closes the issue with the merge commit ───────
install_working_gh
: > "$GH_CALLS"
OUT="$(PATH="$FAKE_BIN:$PATH" bash "$DONE" "https://github.com/acme/repo/issues/42" "a1b2c3d4e5")"

grep -q "^issue comment https://github.com/acme/repo/issues/42 --body Merged: \`a1b2c3d4e5\`\.$" "$GH_CALLS" \
  || fail "02: expected an issue comment naming the merge commit; got: $(cat "$GH_CALLS")"
grep -q "^issue close https://github.com/acme/repo/issues/42$" "$GH_CALLS" \
  || fail "02: expected the issue to be closed; got: $(cat "$GH_CALLS")"
echo "$OUT" | grep -q "^OK: " || fail "02: expected an OK report; got: $OUT"
pass "02: completion comments the merge commit and closes the issue"

# ── issue-loop-03: missing gh auth never blocks either helper ──────────────
install_unauthenticated_gh
: > "$GH_CALLS"
set +e
OUT="$(PATH="$FAKE_BIN:$PATH" bash "$SPECCED" "https://github.com/acme/repo/issues/42" "backlog/paused/BL-200-something.yaml")"
RC=$?
set -e
[[ "$RC" -eq 0 ]] || fail "03a: issue_specced.sh must exit 0 when gh auth is unavailable; got $RC"
echo "$OUT" | grep -q "^SKIP: " || fail "03a: expected a SKIP line noting the auth gap; got: $OUT"
[[ ! -s "$GH_CALLS" ]] || fail "03a: no GitHub-mutating call may be made when auth is unavailable; got: $(cat "$GH_CALLS")"
pass "03a: issue_specced.sh skips silently (exit 0) when gh auth is unavailable"

install_unauthenticated_gh
: > "$GH_CALLS"
set +e
OUT="$(PATH="$FAKE_BIN:$PATH" bash "$DONE" "https://github.com/acme/repo/issues/42" "a1b2c3d4e5")"
RC=$?
set -e
[[ "$RC" -eq 0 ]] || fail "03b: issue_done.sh must exit 0 when gh auth is unavailable; got $RC"
echo "$OUT" | grep -q "^SKIP: " || fail "03b: expected a SKIP line noting the auth gap; got: $OUT"
[[ ! -s "$GH_CALLS" ]] || fail "03b: no GitHub-mutating call may be made when auth is unavailable; got: $(cat "$GH_CALLS")"
pass "03b: issue_done.sh skips silently (exit 0) when gh auth is unavailable"

# ── argument validation: both scripts require both arguments ───────────────
set +e
bash "$SPECCED" "https://github.com/acme/repo/issues/42" >/dev/null 2>&1
RC=$?
set -e
[[ "$RC" -ne 0 ]] || fail "expected issue_specced.sh to fail fast when the paused-path argument is missing"
pass "issue_specced.sh requires both arguments"

set +e
bash "$SPECCED" >/dev/null 2>&1
RC=$?
set -e
[[ "$RC" -ne 0 ]] || fail "expected issue_specced.sh to fail fast with no arguments at all"
pass "issue_specced.sh requires the issue-ref argument"

set +e
bash "$DONE" "https://github.com/acme/repo/issues/42" >/dev/null 2>&1
RC=$?
set -e
[[ "$RC" -ne 0 ]] || fail "expected issue_done.sh to fail fast when the merge-commit argument is missing"
pass "issue_done.sh requires both arguments"

set +e
bash "$DONE" >/dev/null 2>&1
RC=$?
set -e
[[ "$RC" -ne 0 ]] || fail "expected issue_done.sh to fail fast with no arguments at all"
pass "issue_done.sh requires the issue-ref argument"

echo "ALL PASS"
