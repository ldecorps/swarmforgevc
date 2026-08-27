#!/usr/bin/env bash
# BL-477: upstream_drift_check.bb - the real CLI end to end, including its
# own real `git ls-remote --heads` adapter. Every upstream repo is a REAL
# LOCAL git repo this script creates (`git ls-remote` works against a plain
# filesystem path with no network involved at all - the same "real
# collaborator, no fake, no network" posture test_build_freshness_cli.sh
# already uses for its own real local git repos), never a stubbed `git`
# binary and never the real internet. The pure comparator and the
# adapter-injected run! orchestration (a fake fetch-live-refs!, in-process,
# no subprocess) are already exhaustively covered by
# upstream_drift_check_lib_test_runner.bb; this file is the ADDITION that
# locks the real wiring (arg parsing, exit codes, and the real ls-remote
# adapter itself), never the substitute for that in-process coverage.

set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp_cleanup.sh"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI="$SCRIPT_DIR/../upstream_drift_check.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "ok   - $*"; }

mk_upstream_repo() {
  local root
  root="$(mktemp -d)"
  register_tmp_dir "$root"
  # -b main: this box's git default-branch config may not be "main" (older
  # git defaults to "master") - every fixture below names its recorded
  # branch "main" explicitly, so the real local repo must actually have one.
  git -C "$root" init -q -b main
  git -C "$root" config user.email "t@t"
  git -C "$root" config user.name "t"
  git -C "$root" commit -q --allow-empty -m init
  printf '%s' "$root"
}

WORKDIR="$(mktemp -d)"
register_tmp_dir "$WORKDIR"

# ── upstream-drift-watch-01: an advanced branch is reported as drift, ─────
#    exits non-zero ────────────────────────────────────────────────────────
UPSTREAM="$(mk_upstream_repo)"
RECORDED_SHA="$(git -C "$UPSTREAM" rev-parse HEAD)"
git -C "$UPSTREAM" commit -q --allow-empty -m advance
LIVE_SHA="$(git -C "$UPSTREAM" rev-parse HEAD)"

WATCH="$WORKDIR/watch-01.json"
cat > "$WATCH" <<EOF
{"repos": {"swarm-forge": {"url": "$UPSTREAM", "branches": {"main": "$RECORDED_SHA"}}}}
EOF

set +e
OUT="$(bb "$CLI" "$WATCH")"
CODE=$?
set -e
if [[ "$CODE" -eq 0 ]]; then
  fail "upstream-drift-watch-01: expected a non-zero exit for an advanced branch, got 0. output: $OUT"
fi
if [[ "$OUT" != *"DRIFT swarm-forge main: $RECORDED_SHA -> $LIVE_SHA"* ]]; then
  fail "upstream-drift-watch-01: expected a DRIFT line naming from->to, got: $OUT"
fi
pass "upstream-drift-watch-01: a real advanced local-repo branch is reported drifted, non-zero exit"

# ── upstream-drift-watch-02: an unchanged branch reports no drift, ───────
#    exits zero ────────────────────────────────────────────────────────────
UPSTREAM2="$(mk_upstream_repo)"
SHA2="$(git -C "$UPSTREAM2" rev-parse HEAD)"
WATCH2="$WORKDIR/watch-02.json"
cat > "$WATCH2" <<EOF
{"repos": {"swarm-forge": {"url": "$UPSTREAM2", "branches": {"main": "$SHA2"}}}}
EOF
set +e
OUT2="$(bb "$CLI" "$WATCH2")"
CODE2=$?
set -e
if [[ "$CODE2" -ne 0 ]]; then
  fail "upstream-drift-watch-02: expected exit 0 for an unchanged branch, got $CODE2. output: $OUT2"
fi
if [[ "$OUT2" != *"clean: no drift detected"* ]]; then
  fail "upstream-drift-watch-02: expected a clean report, got: $OUT2"
fi
pass "upstream-drift-watch-02: a real unchanged local-repo branch reports clean, exit 0"

# ── upstream-drift-watch-03: a new upstream branch absent from the watch ──
#    file is reported as drift, exits non-zero ────────────────────────────
UPSTREAM3="$(mk_upstream_repo)"
git -C "$UPSTREAM3" checkout -q -b adversaries
git -C "$UPSTREAM3" commit -q --allow-empty -m adversaries-commit
ADV_SHA="$(git -C "$UPSTREAM3" rev-parse adversaries)"
git -C "$UPSTREAM3" checkout -q main
WATCH3="$WORKDIR/watch-03.json"
cat > "$WATCH3" <<EOF
{"repos": {"swarm-forge": {"url": "$UPSTREAM3", "branches": {}}}}
EOF
set +e
OUT3="$(bb "$CLI" "$WATCH3")"
CODE3=$?
set -e
if [[ "$CODE3" -eq 0 ]]; then
  fail "upstream-drift-watch-03: expected a non-zero exit for a new upstream branch, got 0. output: $OUT3"
fi
if [[ "$OUT3" != *"NEW-BRANCH swarm-forge adversaries @ $ADV_SHA"* ]]; then
  fail "upstream-drift-watch-03: expected a NEW-BRANCH line naming the branch, got: $OUT3"
fi
pass "upstream-drift-watch-03: a real new upstream branch absent from the watch file is reported new, non-zero exit"

# ── upstream-drift-watch-04: read-only - the watch file is never ─────────
#    rewritten and no install pin is touched, even when drift is found ────
BEFORE_HASH="$(sha256sum "$WATCH" | cut -d' ' -f1)"
LOCK_JSON="$SCRIPT_DIR/../../../swarmforge.lock.json"
LOCK_BEFORE_HASH="$(sha256sum "$LOCK_JSON" | cut -d' ' -f1)"
bb "$CLI" "$WATCH" >/dev/null 2>&1 || true
AFTER_HASH="$(sha256sum "$WATCH" | cut -d' ' -f1)"
LOCK_AFTER_HASH="$(sha256sum "$LOCK_JSON" | cut -d' ' -f1)"
if [[ "$BEFORE_HASH" != "$AFTER_HASH" ]]; then
  fail "upstream-drift-watch-04: expected the watch file to be byte-for-byte unchanged, hash changed"
fi
if [[ "$LOCK_BEFORE_HASH" != "$LOCK_AFTER_HASH" ]]; then
  fail "upstream-drift-watch-04: expected swarmforge.lock.json to be untouched, hash changed"
fi
pass "upstream-drift-watch-04: the drift check is read-only - the watch file and the install pin are both untouched after a drifted run"

# ── CLI-failure-path (engineering.prompt): the documented "Exit 2: the ────
#    watch file could not be read/parsed, or a `git ls-remote` failed"
#    contract must actually be proven, not just declared in a comment - a
#    happy-path-only suite never exercises -main's catch block at all.
set +e
OUT5="$(bb "$CLI" "$WORKDIR/does-not-exist-watch.json" 2>&1)"
CODE5=$?
set -e
if [[ "$CODE5" -ne 2 ]]; then
  fail "upstream-drift-watch-05: expected exit 2 for an unreadable watch file, got $CODE5. output: $OUT5"
fi
if [[ "$OUT5" != *"error:"* ]]; then
  fail "upstream-drift-watch-05: expected a stderr 'error:' line for an unreadable watch file, got: $OUT5"
fi
pass "upstream-drift-watch-05: a missing/unreadable watch file exits 2 with a stderr error, not a crash or a silent pass"

WATCH6="$WORKDIR/watch-06-malformed.json"
printf 'not json' > "$WATCH6"
set +e
OUT6="$(bb "$CLI" "$WATCH6" 2>&1)"
CODE6=$?
set -e
if [[ "$CODE6" -ne 2 ]]; then
  fail "upstream-drift-watch-06: expected exit 2 for a malformed watch file, got $CODE6. output: $OUT6"
fi
if [[ "$OUT6" != *"error:"* ]]; then
  fail "upstream-drift-watch-06: expected a stderr 'error:' line for a malformed watch file, got: $OUT6"
fi
pass "upstream-drift-watch-06: a malformed (non-JSON) watch file exits 2 with a stderr error, not a crash or a silent pass"

WATCH7="$WORKDIR/watch-07-bad-remote.json"
cat > "$WATCH7" <<EOF
{"repos": {"swarm-forge": {"url": "$WORKDIR/does-not-exist-upstream-repo", "branches": {"main": "aaaa"}}}}
EOF
set +e
OUT7="$(bb "$CLI" "$WATCH7" 2>&1)"
CODE7=$?
set -e
if [[ "$CODE7" -ne 2 ]]; then
  fail "upstream-drift-watch-07: expected exit 2 when git ls-remote fails, got $CODE7. output: $OUT7"
fi
if [[ "$OUT7" != *"error:"*"git ls-remote"* ]]; then
  fail "upstream-drift-watch-07: expected a stderr error naming the failed git ls-remote, got: $OUT7"
fi
pass "upstream-drift-watch-07: a failing 'git ls-remote' (bad/unreachable upstream url) exits 2 with a stderr error, not a crash or a silent pass"

# ── default watch-file path resolves to the tracked repo-root file ───────
# (structural only - never invoke the CLI with no argument here: a bare
# invocation defaults to the TRACKED upstream-watch.json, whose repos are
# real github.com URLs, and would fire a real network `git ls-remote` -
# exactly what this suite must never do.)
if [[ ! -f "$SCRIPT_DIR/../../../upstream-watch.json" ]]; then
  fail "expected the tracked repo-root upstream-watch.json to exist"
fi
pass "default watch-file path: the tracked repo-root upstream-watch.json exists for a bare invocation to default to"

echo "test_upstream_drift_check_cli: ALL CHECKS PASSED"
