#!/usr/bin/env bash
# BL-406: root cause of the duplicate/inconsistent morning briefing was six
# handoffd.bb daemons leaked from stale /tmp acceptance sandboxes, alive
# 9-11h unsupervised, each independently sweeping and sending real briefing
# email. daemon_alarm_lib.bb's test-fixture-root? already suppresses the
# SEND for any /tmp-rooted project (BL-326), but that guard is per-email and
# does nothing for a daemon side effect that never reaches it. This test
# proves the stronger front-door guard: handoffd.bb refuses to run AT ALL
# against a throwaway test/temp project root unless the caller explicitly
# opts in via SWARMFORGE_ALLOW_TMP_DAEMON=1 - checked before the daemon
# claims a pid file, loads roles, or starts a single sweep, so a leaked
# invocation exits immediately instead of running unsupervised for hours.
# Uses --poll-once / a plain foreground run (no background process, no
# sleep loop) since the refusal fires before -main is ever reached.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HANDOFFD="$SCRIPT_DIR/../handoffd.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$ROOT"' EXIT

SOCK="$ROOT/fake.sock"
touch "$SOCK"
mkdir -p "$ROOT/.swarmforge"
echo "$SOCK" > "$ROOT/.swarmforge/tmux-socket"
printf 'coder\tcoder\t%s\tswarmforge-coder\tCoder\tclaude\ttask\n' "$ROOT" \
  > "$ROOT/.swarmforge/roles.tsv"

# ── 01: no allow flag -> the daemon refuses to start, exit nonzero ─────────
set +e
OUT="$(env -u SWARMFORGE_ALLOW_TMP_DAEMON bb "$HANDOFFD" "$ROOT" --poll-once 2>&1)"
RC=$?
set -e
[[ "$RC" -ne 0 ]] || fail "01: expected a nonzero exit when no allow flag is set; got rc=0, output: $OUT"
grep -qi "refusing to start" <<< "$OUT" || fail "01: expected a clear refusal message; got: $OUT"
grep -q "SWARMFORGE_ALLOW_TMP_DAEMON" <<< "$OUT" || fail "01: refusal message must name the opt-in flag; got: $OUT"
pass "01: handoffd.bb refuses to start against a /tmp-rooted project root with no allow flag"

# ── 02: refusal happens before ANY daemon state is touched (no pid file,
#     no daemon dir, no log) - a leaked/mistaken invocation must leave no
#     trace of ever having started ─────────────────────────────────────────
[[ -e "$ROOT/.swarmforge/daemon" ]] && fail "02: refusal must not create the daemon state dir at all"
pass "02: a refused start leaves no daemon state behind"

# ── 03: with the explicit allow flag, the daemon proceeds normally ─────────
set +e
OUT="$(SWARMFORGE_ALLOW_TMP_DAEMON=1 bb "$HANDOFFD" "$ROOT" --poll-once 2>&1)"
RC=$?
set -e
[[ "$RC" -eq 0 ]] || fail "03: expected the daemon to run normally with the allow flag set; got rc=$RC, output: $OUT"
grep -qi "refusing to start" <<< "$OUT" && fail "03: must not refuse once the allow flag is set; got: $OUT"
pass "03: SWARMFORGE_ALLOW_TMP_DAEMON=1 lets an intentional test daemon run against the same /tmp root"

# Scenario 04 (a real, non-temp project root is never refused, flag or no
# flag) is intentionally NOT exercised here by actually running handoffd.bb
# against a real project root: doing so would touch this repo's own live
# .swarmforge/ state (pid file, real tmux socket if a real swarm is up) -
# exactly the shared-live-runtime-path hazard engineering.prompt bans a test
# from ever risking. That property belongs to the PURE predicate
# (refuse-tmp-daemon-start?) alone, and is already covered with a real,
# non-temp path by test_daemon_alarm_lib.sh's BL-406 scenarios 04/05.

echo "ALL PASS"
