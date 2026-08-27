#!/usr/bin/env bash
# BL-1200: lib/git_env_guard.sh's own unit test (required_wiring names the
# two callers, not this file itself, but a guard shipped with no test of its
# own is exactly the kind of "exists and is sourced nowhere" gap the
# ticket's own qa_e2e_procedure step 3 warns about).
#
# 01-03 drive the guard directly, in isolation from either real caller.
# 04 drives the real expedite_fixture.sh against a real decoy repository
# named only by an inherited GIT_DIR/GIT_WORK_TREE - the exact shape of the
# incident this ticket fixes, confirmed on the real artefact rather than a
# stand-in. 05 checks run_bb_suite.sh positionally instead (see its own
# comment for why a decoy-repository run cannot be driven end-to-end here).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LIB="$SCRIPT_DIR/lib/git_env_guard.sh"
FIXTURE="$SCRIPT_DIR/expedite_fixture.sh"
RUN_SUITE="$SCRIPT_DIR/run_bb_suite.sh"

FAILURES=0
fail() { echo "FAIL: $*" >&2; FAILURES=$((FAILURES + 1)); }
pass() { echo "PASS: $*"; }

WORKDIR="$(mktemp -d)"
cleanup_workdir() { rm -rf -- "$WORKDIR"; }
trap cleanup_workdir EXIT

# ── 01: sourcing the guard unsets an inherited GIT_DIR/GIT_WORK_TREE ───────

FIXTURE1="$WORKDIR/fixture_unsets.sh"
cat > "$FIXTURE1" <<EOF
#!/usr/bin/env bash
set -euo pipefail
export GIT_DIR="/tmp/some-live-repo/.git"
export GIT_WORK_TREE="/tmp/some-live-repo"
source "$LIB"
echo "GIT_DIR=[\${GIT_DIR:-}]"
echo "GIT_WORK_TREE=[\${GIT_WORK_TREE:-}]"
EOF
chmod +x "$FIXTURE1"

OUT1="$(bash "$FIXTURE1")"
if echo "$OUT1" | grep -q '^GIT_DIR=\[\]$' && echo "$OUT1" | grep -q '^GIT_WORK_TREE=\[\]$'; then
  pass "01: sourcing the guard unsets an inherited GIT_DIR and GIT_WORK_TREE"
else
  fail "01: expected both variables cleared, got: $OUT1"
fi

# ── 02: sourcing is safe under set -u when neither variable was set to
#    begin with - no "unbound variable" error, exits 0 ────────────────────

FIXTURE2="$WORKDIR/fixture_clean_env.sh"
cat > "$FIXTURE2" <<EOF
#!/usr/bin/env bash
set -euo pipefail
unset GIT_DIR GIT_WORK_TREE 2>/dev/null || true
source "$LIB"
echo DONE
EOF
chmod +x "$FIXTURE2"

STDERR2="$WORKDIR/fixture2.stderr"
set +e
OUT2="$(bash "$FIXTURE2" 2>"$STDERR2")"
CODE2=$?
set -e
if [[ $CODE2 -eq 0 ]] && echo "$OUT2" | grep -q DONE && ! grep -qi "unbound variable" "$STDERR2"; then
  pass "02: sourcing with neither variable set exits 0 with no unbound-variable error"
else
  fail "02: expected a clean exit 0, got code $CODE2, stdout [$OUT2], stderr [$(cat "$STDERR2")]"
fi

# ── 03: sourcing twice is safe (idempotent), and a variable set AFTER the
#    (second) source still takes effect - the guard clears an INHERITED
#    value at source time only, it does not stop deliberate later use ─────

FIXTURE3="$WORKDIR/fixture_twice_then_reset.sh"
cat > "$FIXTURE3" <<EOF
#!/usr/bin/env bash
set -euo pipefail
export GIT_DIR="/tmp/some-live-repo/.git"
source "$LIB"
source "$LIB"
export GIT_DIR="/tmp/deliberately-set-afterward/.git"
echo "GIT_DIR=[\${GIT_DIR:-}]"
EOF
chmod +x "$FIXTURE3"

OUT3="$(bash "$FIXTURE3")"
if [[ "$OUT3" == "GIT_DIR=[/tmp/deliberately-set-afterward/.git]" ]]; then
  pass "03: sourcing twice is safe, and a value set after sourcing is left alone"
else
  fail "03: expected the post-source value to survive, got: $OUT3"
fi

# ── decoy repository: a real repo an ambient GIT_DIR/GIT_WORK_TREE names,
#    standing in for whatever repo an agent pane's ambient redirect points
#    at in the real incident ────────────────────────────────────────────

DECOY="$WORKDIR/decoy"
mkdir -p "$DECOY"
(
  cd "$DECOY"
  git init -q -b main .
  git config user.email "decoy@example.com"
  git config user.name "decoy"
  git config commit.gpgsign false
  echo seed > seed.txt
  git add -A
  git commit -qm "decoy: initial"
)
DECOY_HEAD_BEFORE="$(git -C "$DECOY" rev-parse HEAD)"
DECOY_LOG_COUNT_BEFORE="$(git -C "$DECOY" log --oneline | wc -l | tr -d ' ')"

REDIRECT_ENV=(env "GIT_DIR=$DECOY/.git" "GIT_WORK_TREE=$DECOY")

# ── 04: expedite_fixture.sh, run under the redirect, writes its commit into
#    its OWN temp repository and leaves the decoy untouched ───────────────

FIXTURE_DEST="$WORKDIR/fixture_dest"
set +e
FIXTURE_OUT="$("${REDIRECT_ENV[@]}" bash "$FIXTURE" "$FIXTURE_DEST")"
CODE4=$?
set -e

DECOY_HEAD_AFTER4="$(git -C "$DECOY" rev-parse HEAD)"
DECOY_LOG_COUNT_AFTER4="$(git -C "$DECOY" log --oneline | wc -l | tr -d ' ')"
FIXTURE_LOG="$(git -C "$FIXTURE_DEST" log --oneline 2>/dev/null || true)"

if [[ $CODE4 -ne 0 ]]; then
  fail "04: expedite_fixture.sh under the redirect exited $CODE4: $FIXTURE_OUT"
elif [[ "$DECOY_HEAD_AFTER4" != "$DECOY_HEAD_BEFORE" || "$DECOY_LOG_COUNT_AFTER4" != "$DECOY_LOG_COUNT_BEFORE" ]]; then
  fail "04: the decoy repository's HEAD/commit count changed - fixture: initial\", got: $FIXTURE_LOG"
else
  pass "04: expedite_fixture.sh run under an ambient GIT_DIR/GIT_WORK_TREE writes its commit into its own temp repo and leaves the decoy repo's ref state unchanged"
fi

# ── 05: the guard is sourced in run_bb_suite.sh BEFORE the inventory gate
#    (and everything else) runs - a positional check, not just presence.
#
#    A pre-existing, unrelated suite-manifest.tsv drift (BL-973's own
#    inventory gate: dozens of discovered-vs-listed mismatches, out of this
#    ticket's scope - "do not migrate the other 73 git-using shell tests")
#    makes run_bb_suite.sh exit at that gate on THIS checkout before it ever
#    reaches (or spawns) a single standing test, on every mode including
#    --list - so driving it end-to-end can never observe whether a spawned
#    CHILD inherited a clean environment, on this checkout, regardless of
#    this guard. Ordering is what is actually verifiable here, and it is
#    exactly what the ticket's own qa_e2e_procedure step 3 asks for: "a
#    guard that exists and is sourced nowhere [effectively] is the failure
#    this step catches" - sourced AFTER the one git-adjacent gate it exists
#    to protect is the same failure with different arithmetic.
GUARD_LINE="$(grep -n 'source.*git_env_guard\.sh' "$RUN_SUITE" | head -1 | cut -d: -f1 || true)"
INVENTORY_LINE="$(grep -n '"\$INVENTORY"' "$RUN_SUITE" | head -1 | cut -d: -f1 || true)"

if [[ -z "$GUARD_LINE" ]]; then
  fail "05: run_bb_suite.sh no longer sources git_env_guard.sh at all"
elif [[ -z "$INVENTORY_LINE" ]]; then
  fail "05: could not locate the inventory-gate invocation in run_bb_suite.sh to check ordering against"
elif [[ "$GUARD_LINE" -ge "$INVENTORY_LINE" ]]; then
  fail "05: git_env_guard.sh is sourced at line $GUARD_LINE, AFTER the inventory gate at line $INVENTORY_LINE - every git-adjacent thing run_bb_suite.sh does before that point is unprotected"
else
  pass "05: run_bb_suite.sh sources git_env_guard.sh (line $GUARD_LINE) before the inventory gate runs (line $INVENTORY_LINE)"
fi

# ── report ──────────────────────────────────────────────────────────────
if [[ $FAILURES -gt 0 ]]; then
  echo "$FAILURES failure(s)"
  exit 1
fi
echo "ALL PASS (test_git_env_guard_lib.sh)"
