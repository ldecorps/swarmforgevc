#!/usr/bin/env bash
# BL-328: build_freshness_cli.bb - staleness detection for every long-lived
# process (report), and the coordinator-invoked recompile+restart action
# (sync). Real processes, real git commits, real tmux-free daemons on
# isolated fixture roots - never the live swarm's own state. Mirrors
# test_role_lifecycle_cli.sh's own fixture rigor (real spawn/kill, no mocks
# of the mechanism under test).

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
CLI="$SCRIPT_DIR/../build_freshness_cli.bb"
LAUNCH_FRONT_DESK="$SCRIPT_DIR/../launch_front_desk.sh"
START_HANDOFF_DAEMON="$SCRIPT_DIR/../start_handoff_daemon.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "ok   - $*"; }

LIVE_ROOTS=()
final_cleanup() {
  local root
  for root in "${LIVE_ROOTS[@]:-}"; do
    [[ -n "$root" && -d "$root" ]] || continue
    pkill -9 -f "$root/extension/out/tools/" 2>/dev/null || true
    [[ -f "$root/.swarmforge/operator/front-desk-supervisor.pid" ]] && kill -9 "$(cat "$root/.swarmforge/operator/front-desk-supervisor.pid")" 2>/dev/null || true
    [[ -f "$root/.swarmforge/daemon/handoffd.pid" ]] && kill -9 "$(cat "$root/.swarmforge/daemon/handoffd.pid")" 2>/dev/null || true
    [[ -f "$root/.swarmforge/daemon/handoffd-supervisor.pid" ]] && kill -9 "$(cat "$root/.swarmforge/daemon/handoffd-supervisor.pid")" 2>/dev/null || true
    [[ -f "$root/.swarmforge/operator/runtime.pid" ]] && kill -9 "$(cat "$root/.swarmforge/operator/runtime.pid")" 2>/dev/null || true
    rm -rf "$root"
  done
}
trap final_cleanup EXIT

mk_git_root() {
  local root
  root="$(mktemp -d)"
  git -C "$root" init -q
  git -C "$root" config user.email "t@t"
  git -C "$root" config user.name "t"
  git -C "$root" commit -q --allow-empty -m init1
  printf '%s' "$root"
}

wait_for() {
  local timeout_s="$1"; shift
  local i=0
  while (( i < timeout_s * 10 )); do
    if "$@" 2>/dev/null; then return 0; fi
    sleep 0.1
    ((i++)) || true
  done
  return 1
}

# ── merged-code-reaches-daemons-01/06: report names both builds, flags a
#    stale process, never flags a fresh one, for every language ───────────
ROOT="$(mk_git_root)"
LIVE_ROOTS+=("$ROOT")
OLD_SHA="$(git -C "$ROOT" rev-parse HEAD)"
git -C "$ROOT" commit -q --allow-empty -m init2
NEW_SHA="$(git -C "$ROOT" rev-parse HEAD)"
git -C "$ROOT" branch main
mkdir -p "$ROOT/.swarmforge/operator" "$ROOT/.swarmforge/daemon"
cat > "$ROOT/.swarmforge/operator/front-desk-supervisor.status.json" <<EOF
{"bridge":{"pid":111,"build_sha":"$OLD_SHA"},"bot":{"pid":112,"build_sha":"$OLD_SHA"},"supervisor_build_sha":"$NEW_SHA"}
EOF
cat > "$ROOT/.swarmforge/daemon/handoffd-build.json" <<EOF
{"build_sha":"$OLD_SHA"}
EOF
cat > "$ROOT/.swarmforge/operator/status.json" <<EOF
{"build_sha":"$NEW_SHA"}
EOF
REPORT="$(bb "$CLI" "$ROOT" report)"
check_01_06() {
  echo "$REPORT" | python3 -c "
import json, sys
r = json.load(sys.stdin)
by_name = {x['name']: x for x in r}
assert by_name['bridge']['stale'] is True, 'bridge (compiled, stale) should be flagged stale'
assert by_name['bridge']['running_sha'] == '$OLD_SHA', 'bridge running_sha should name the build it is running'
assert by_name['bridge']['main_sha'] == '$NEW_SHA', 'bridge main_sha should name the build on main'
assert by_name['handoffd']['stale'] is True, 'handoffd (interpreted, stale) should be flagged stale'
assert by_name['front_desk_supervisor']['stale'] is False, 'front_desk_supervisor (compiled, fresh) must not be flagged stale'
assert by_name['operator_runtime']['stale'] is False, 'operator_runtime (interpreted, fresh) must not be flagged stale'
"
}
if check_01_06; then
  pass "merged-code-reaches-daemons-01/06: report names both builds, flags stale processes of both languages, never flags a fresh one"
else
  fail "01/06: report did not match expected staleness/build-identity, got: $REPORT"
fi
rm -rf "$ROOT"

# ── merged-code-reaches-daemons-02/03(compiled): a REAL merge (real git
#    commit reachable from main) reaches a REAL running front-desk group
#    with no human action beyond the coordinator's own sync call ─────────
ROOT="$(mk_git_root)"
LIVE_ROOTS+=("$ROOT")
OLD_SHA="$(git -C "$ROOT" rev-parse HEAD)"
mkdir -p "$ROOT/.swarmforge/operator" "$ROOT/extension/out/tools"
cat > "$ROOT/extension/out/tools/start-bridge-headless.js" <<'EOF'
console.log('bridge running');
setInterval(() => {}, 1000);
EOF
cat > "$ROOT/extension/out/tools/telegram-front-desk-bot.js" <<'EOF'
console.log('bot running');
setInterval(() => {}, 1000);
EOF
echo "$OLD_SHA" > "$ROOT/extension/out/BUILD_SHA"
export TELEGRAM_BOT_TOKEN=x TELEGRAM_CHAT_ID=x TELEGRAM_PRINCIPAL_USER_ID=x
bash "$LAUNCH_FRONT_DESK" "$ROOT" >/dev/null
wait_for 5 test -f "$ROOT/.swarmforge/operator/front-desk-supervisor.pid" || fail "02 setup: front-desk group did not start"
OLD_SUP_PID="$(cat "$ROOT/.swarmforge/operator/front-desk-supervisor.pid")"

# The real merge: a real commit, reachable from main, touching this
# process's own tracked source file.
echo "// merged fix" >> "$ROOT/extension/out/tools/start-bridge-headless.js"
git -C "$ROOT" add -A
git -C "$ROOT" commit -q -m "merge: fix bridge"
git -C "$ROOT" branch -f main
NEW_SHA="$(git -C "$ROOT" rev-parse HEAD)"

REPORT_BEFORE="$(bb "$CLI" "$ROOT" report)"
FAKE_BIN="$(mktemp -d)"
cat > "$FAKE_BIN/npm" <<EOF
#!/usr/bin/env bash
echo "$NEW_SHA" > "$ROOT/extension/out/BUILD_SHA"
exit 0
EOF
chmod +x "$FAKE_BIN/npm"
# No human action from here: one coordinator-invoked CLI call closes the loop.
PATH="$FAKE_BIN:$PATH" bb "$CLI" "$ROOT" sync >/dev/null
SYNC_EXIT=$?
rm -rf "$FAKE_BIN"

wait_for 5 bash -c "! kill -0 $OLD_SUP_PID 2>/dev/null" || true
sleep 1
REPORT_AFTER="$(bb "$CLI" "$ROOT" report)"
check_02_03() {
  [[ "$SYNC_EXIT" -eq 0 ]] || return 1
  echo "$REPORT_BEFORE" | python3 -c "
import json, sys
r = json.load(sys.stdin)
by_name = {x['name']: x for x in r}
assert by_name['bridge']['stale'] is True, 'bridge should be reported stale before sync (03-compiled)'
" || return 1
  echo "$REPORT_AFTER" | python3 -c "
import json, sys
r = json.load(sys.stdin)
by_name = {x['name']: x for x in r}
assert by_name['bridge']['stale'] is False, 'bridge should be running the merged code after sync, within the configured interval'
assert by_name['bridge']['running_sha'] == '$NEW_SHA', 'bridge should be running the exact merged sha'
" || return 1
  ! kill -0 "$OLD_SUP_PID" 2>/dev/null
}
if check_02_03; then
  pass "merged-code-reaches-daemons-02/03(compiled): a real merge to a real running process's source reaches it via one coordinator-invoked sync call, no other human action"
else
  fail "02/03(compiled): expected the merge to reach the running process after sync. before=$REPORT_BEFORE after=$REPORT_AFTER"
fi

# ── merged-code-reaches-daemons-04/07: a crash BEFORE any sync has run -
#    the supervisor is the only actor awake in that window, so ITS OWN
#    respawn path must check freshness and recompile, never assume a sync
#    already happened. A separate, self-contained fixture from 02/03
#    above (which recompiles via sync BEFORE the crash) - that ordering is
#    exactly the fixture flaw the specifier's amendment called out:
#    staging a sync before the crash never exercises the merge->crash gap
#    at all. npm must be stubbed on PATH BEFORE the supervisor is even
#    launched (it is a long-running process; a PATH change after it
#    starts is invisible to it) so ITS OWN internal `npm run compile`
#    call, fired from inside spawn-bridge! at crash-respawn time, is what
#    picks up the merged sha - never a sync call anywhere in this block ──
ROOT="$(mk_git_root)"
LIVE_ROOTS+=("$ROOT")
OLD_SHA="$(git -C "$ROOT" rev-parse HEAD)"
mkdir -p "$ROOT/.swarmforge/operator" "$ROOT/extension/out/tools"
cat > "$ROOT/extension/out/tools/start-bridge-headless.js" <<'EOF'
console.log('bridge running');
setInterval(() => {}, 1000);
EOF
cat > "$ROOT/extension/out/tools/telegram-front-desk-bot.js" <<'EOF'
console.log('bot running');
setInterval(() => {}, 1000);
EOF
echo "$OLD_SHA" > "$ROOT/extension/out/BUILD_SHA"
export TELEGRAM_BOT_TOKEN=x TELEGRAM_CHAT_ID=x TELEGRAM_PRINCIPAL_USER_ID=x
FAKE_BIN_04="$(mktemp -d)"
cat > "$FAKE_BIN_04/npm" <<'NPMEOF'
#!/usr/bin/env bash
# ensure-current-build! invokes npm with :dir set to <project-root>/extension
# - CWD here IS that directory, so ".." is the project root regardless of
# where this stub itself lives.
ROOT_DIR="$(cd .. && pwd)"
echo "$(git -C "$ROOT_DIR" rev-parse main 2>/dev/null)" > "out/BUILD_SHA"
exit 0
NPMEOF
chmod +x "$FAKE_BIN_04/npm"
PATH="$FAKE_BIN_04:$PATH" bash "$LAUNCH_FRONT_DESK" "$ROOT" >/dev/null
wait_for 5 test -f "$ROOT/.swarmforge/operator/front-desk-supervisor.pid" || fail "04/07 setup: front-desk group did not start"

# The real merge - a real commit, reachable from main - with NO sync call
# anywhere in this block. extension/out/BUILD_SHA still names OLD_SHA.
echo "// merged fix" >> "$ROOT/extension/out/tools/start-bridge-headless.js"
git -C "$ROOT" add -A
git -C "$ROOT" commit -q -m "merge: fix bridge"
git -C "$ROOT" branch -f main
NEW_SHA_04="$(git -C "$ROOT" rev-parse main)"

BRIDGE_PID="$(python3 -c "import json; print(json.load(open('$ROOT/.swarmforge/operator/front-desk-supervisor.status.json'))['bridge']['pid'])")"
kill -9 "$BRIDGE_PID" 2>/dev/null
wait_for 10 bash -c "
  p=\$(python3 -c \"import json; print(json.load(open('$ROOT/.swarmforge/operator/front-desk-supervisor.status.json'))['bridge']['pid'])\" 2>/dev/null)
  [[ -n \"\$p\" && \"\$p\" != \"$BRIDGE_PID\" ]]
"
sleep 1
check_04_07() {
  local sha
  sha="$(python3 -c "import json; print(json.load(open('$ROOT/.swarmforge/operator/front-desk-supervisor.status.json'))['bridge']['build_sha'])")"
  [[ "$sha" == "$NEW_SHA_04" ]]
}
if check_04_07; then
  pass "merged-code-reaches-daemons-04/07: a crash BEFORE any sync ran still respawns on the current build - the supervisor made the build current itself, the stale build is not re-armed"
else
  fail "04/07: respawned bridge did not carry the current build_sha (expected $NEW_SHA_04), no sync ever ran in this block"
fi
final_cleanup
LIVE_ROOTS=()
rm -rf "$FAKE_BIN_04"

# ── merged-code-reaches-daemons-08: the current build cannot be produced
#    (a failing recompile) - the process still comes back up, degraded and
#    visible, rather than staying down (a dead front desk takes the
#    human's only channel with it) ──────────────────────────────────────
ROOT="$(mk_git_root)"
LIVE_ROOTS+=("$ROOT")
OLD_SHA="$(git -C "$ROOT" rev-parse HEAD)"
mkdir -p "$ROOT/.swarmforge/operator" "$ROOT/extension/out/tools"
cat > "$ROOT/extension/out/tools/start-bridge-headless.js" <<'EOF'
console.log('bridge running');
setInterval(() => {}, 1000);
EOF
cat > "$ROOT/extension/out/tools/telegram-front-desk-bot.js" <<'EOF'
console.log('bot running');
setInterval(() => {}, 1000);
EOF
echo "$OLD_SHA" > "$ROOT/extension/out/BUILD_SHA"
FAKE_BIN_08="$(mktemp -d)"
cat > "$FAKE_BIN_08/npm" <<'NPMEOF'
#!/usr/bin/env bash
exit 1
NPMEOF
chmod +x "$FAKE_BIN_08/npm"
PATH="$FAKE_BIN_08:$PATH" bash "$LAUNCH_FRONT_DESK" "$ROOT" >/dev/null
wait_for 5 test -f "$ROOT/.swarmforge/operator/front-desk-supervisor.pid" || fail "08 setup: front-desk group did not start"

git -C "$ROOT" commit -q --allow-empty -m "merge: unreachable fix"
git -C "$ROOT" branch -f main

BRIDGE_PID="$(python3 -c "import json; print(json.load(open('$ROOT/.swarmforge/operator/front-desk-supervisor.status.json'))['bridge']['pid'])")"
kill -9 "$BRIDGE_PID" 2>/dev/null
wait_for 10 bash -c "
  p=\$(python3 -c \"import json; print(json.load(open('$ROOT/.swarmforge/operator/front-desk-supervisor.status.json'))['bridge']['pid'])\" 2>/dev/null)
  [[ -n \"\$p\" && \"\$p\" != \"$BRIDGE_PID\" ]]
"
sleep 1
check_08() {
  local newpid
  newpid="$(python3 -c "import json; print(json.load(open('$ROOT/.swarmforge/operator/front-desk-supervisor.status.json'))['bridge']['pid'])" 2>/dev/null)"
  [[ -n "$newpid" && "$newpid" != "$BRIDGE_PID" ]] || return 1
  kill -0 "$newpid" 2>/dev/null || return 1
  grep -q "degraded-respawn bridge" "$ROOT/.swarmforge/operator/front-desk-supervisor.log"
}
if check_08; then
  pass "merged-code-reaches-daemons-08: a failed recompile still brings the process back up, degraded and loudly logged, never left down"
else
  fail "08: expected the process brought back up with a loud degraded-respawn log line even though recompile failed"
fi
final_cleanup
LIVE_ROOTS=()
unset TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID TELEGRAM_PRINCIPAL_USER_ID
rm -rf "$FAKE_BIN_08"

# ── merged-code-reaches-daemons-03(interpreted): the same staleness
#    coverage for a Babashka daemon, not just the compiled Node ones ──────
ROOT="$(mk_git_root)"
LIVE_ROOTS+=("$ROOT")
OLD_SHA="$(git -C "$ROOT" rev-parse HEAD)"
git -C "$ROOT" commit -q --allow-empty -m init2
NEW_SHA="$(git -C "$ROOT" rev-parse HEAD)"
git -C "$ROOT" branch main
mkdir -p "$ROOT/.swarmforge/daemon" "$ROOT/.swarmforge/handoffs/inbox/new" "$ROOT/.swarmforge/handoffs/inbox/in_process" "$ROOT/.swarmforge/handoffs/inbox/completed"
touch "$ROOT/.swarmforge/roles.tsv"
echo "fake-socket" > "$ROOT/.swarmforge/tmux-socket"
SWARMFORGE_MAILBOX_ONLY=1 bash "$START_HANDOFF_DAEMON" "$ROOT" >/dev/null
wait_for 5 test -f "$ROOT/.swarmforge/daemon/handoffd.pid" || fail "03(interpreted) setup: handoffd did not start"
python3 -c "
import json
p = '$ROOT/.swarmforge/daemon/handoffd-build.json'
with open(p) as f: d = json.load(f)
d['build_sha'] = '$OLD_SHA'
with open(p, 'w') as f: json.dump(d, f)
"
REPORT="$(bb "$CLI" "$ROOT" report)"
check_03_interpreted() {
  echo "$REPORT" | python3 -c "
import json, sys
r = json.load(sys.stdin)
by_name = {x['name']: x for x in r}
assert by_name['handoffd']['stale'] is True
assert by_name['handoffd_supervisor']['stale'] is True
"
}
if check_03_interpreted; then
  pass "merged-code-reaches-daemons-03(interpreted): a long-lived Babashka daemon is covered too, not just compiled processes"
else
  fail "03(interpreted): expected handoffd/handoffd_supervisor flagged stale, got: $REPORT"
fi
final_cleanup
LIVE_ROOTS=()

echo "build_freshness_cli smoke: ALL CHECKS PASSED"
