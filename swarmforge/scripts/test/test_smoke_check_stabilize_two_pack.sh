#!/usr/bin/env bash
# BL-203: the stabilize-two-pack smoke check must catch drift between the
# profile file and the launch.json entry that is supposed to reference it -
# exactly the kind of silent mismatch that would make "Run Extension
# (two-pack stabilize · daemon on)" launch something other than what an
# operator expects, without warning.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SMOKE="$SCRIPT_DIR/../smoke_check_stabilize_two_pack.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

make_good_fixture() {
  ROOT="$(cd "$(mktemp -d)" && pwd -P)"
  mkdir -p "$ROOT/swarmforge/profiles" "$ROOT/.vscode"
  cat > "$ROOT/swarmforge/profiles/stabilize-two-pack.conf" <<'EOF'
config active_backlog_max_depth 1

window coordinator claude master --model claude-opus-4-6 --dangerously-skip-permissions
window coder claude coder --model claude-opus-4-6 --dangerously-skip-permissions
window cleaner claude cleaner batch --model claude-sonnet-5 --dangerously-skip-permissions
EOF
  cat > "$ROOT/.vscode/launch.json" <<'EOF'
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Run Extension (two-pack stabilize · daemon on)",
      "type": "extensionHost",
      "request": "launch",
      "env": {
        "SWARMFORGE_SKIP_DAEMON": "0",
        "SWARMFORGE_CONFIG": "${workspaceFolder}/swarmforge/profiles/stabilize-two-pack.conf"
      },
      "settings": {
        "swarmforge.configPath": "${workspaceFolder}/swarmforge/profiles/stabilize-two-pack.conf"
      }
    }
  ]
}
EOF
}

cleanup() { [[ -n "${ROOT:-}" ]] && rm -rf "$ROOT"; }
trap cleanup EXIT

# ── 1: correctly wired profile + launch.json passes ─────────────────────────
make_good_fixture
bash "$SMOKE" "$ROOT" >/dev/null || fail "01: a correctly wired profile+launch.json must pass the smoke check"
pass "01: correctly wired profile + launch.json passes"
rm -rf "$ROOT"

# ── 2: profile roster drift (extra role) is caught ──────────────────────────
make_good_fixture
echo "window architect claude architect --model claude-sonnet-5" >> "$ROOT/swarmforge/profiles/stabilize-two-pack.conf"
set +e
OUT2="$(bash "$SMOKE" "$ROOT" 2>&1)"
STATUS2=$?
set -e
[[ "$STATUS2" -ne 0 ]] || fail "02: expected a 4th role in the profile to fail the smoke check"
echo "$OUT2" | grep -qi "architect\|expected" || fail "02: error should mention the roster mismatch, got: $OUT2"
pass "02: profile roster drift (unexpected extra role) is caught"
rm -rf "$ROOT"

# ── 3: daemon-skip regression in the profile is caught ──────────────────────
make_good_fixture
sed -i 's/^window coder .*/&\nSWARMFORGE_SKIP_DAEMON=1/' "$ROOT/swarmforge/profiles/stabilize-two-pack.conf"
set +e
OUT3="$(bash "$SMOKE" "$ROOT" 2>&1)"
STATUS3=$?
set -e
[[ "$STATUS3" -ne 0 ]] || fail "03: expected SWARMFORGE_SKIP_DAEMON in the profile to fail the smoke check"
echo "$OUT3" | grep -qi "SKIP_DAEMON" || fail "03: error should mention SWARMFORGE_SKIP_DAEMON, got: $OUT3"
pass "03: a daemon-skip regression in the profile is caught"
rm -rf "$ROOT"

# ── 4: launch.json missing the named configuration is caught ───────────────
make_good_fixture
cat > "$ROOT/.vscode/launch.json" <<'EOF'
{ "version": "0.2.0", "configurations": [] }
EOF
set +e
OUT4="$(bash "$SMOKE" "$ROOT" 2>&1)"
STATUS4=$?
set -e
[[ "$STATUS4" -ne 0 ]] || fail "04: expected a missing launch config to fail the smoke check"
echo "$OUT4" | grep -qi "no launch configuration" || fail "04: error should say the config is missing, got: $OUT4"
pass "04: launch.json missing the named configuration is caught"
rm -rf "$ROOT"

# ── 5: launch.json pointing at the wrong profile path is caught (the exact
#       silent-drift failure mode this check exists to prevent) ────────────
make_good_fixture
sed -i 's#stabilize-two-pack.conf#two-pack.conf#g' "$ROOT/.vscode/launch.json"
set +e
OUT5="$(bash "$SMOKE" "$ROOT" 2>&1)"
STATUS5=$?
set -e
[[ "$STATUS5" -ne 0 ]] || fail "05: expected launch.json pointing at the wrong profile to fail the smoke check"
echo "$OUT5" | grep -qi "does not point at" || fail "05: error should say the config points elsewhere, got: $OUT5"
pass "05: launch.json drifted onto the wrong profile path is caught"
rm -rf "$ROOT"

# ── 6: a missing profile file entirely is caught (before any other check
#       runs — was previously exercised by no test) ─────────────────────────
make_good_fixture
rm -f "$ROOT/swarmforge/profiles/stabilize-two-pack.conf"
set +e
OUT6="$(bash "$SMOKE" "$ROOT" 2>&1)"
STATUS6=$?
set -e
[[ "$STATUS6" -ne 0 ]] || fail "06: expected a missing profile file to fail the smoke check"
echo "$OUT6" | grep -qi "profile missing" || fail "06: error should say the profile is missing, got: $OUT6"
pass "06: a missing profile file is caught"
rm -rf "$ROOT"

# ── 7: a missing launch.json entirely is caught (was previously exercised by
#       no test) ─────────────────────────────────────────────────────────────
make_good_fixture
rm -f "$ROOT/.vscode/launch.json"
set +e
OUT7="$(bash "$SMOKE" "$ROOT" 2>&1)"
STATUS7=$?
set -e
[[ "$STATUS7" -ne 0 ]] || fail "07: expected a missing launch.json to fail the smoke check"
echo "$OUT7" | grep -qi "launch.json missing" || fail "07: error should say launch.json is missing, got: $OUT7"
pass "07: a missing launch.json is caught"
rm -rf "$ROOT"

# ── 8: malformed JSON in launch.json is caught (the node -e JSON.parse catch
#       path — was previously exercised by no test) ──────────────────────────
make_good_fixture
echo '{ not valid json' > "$ROOT/.vscode/launch.json"
set +e
OUT8="$(bash "$SMOKE" "$ROOT" 2>&1)"
STATUS8=$?
set -e
[[ "$STATUS8" -ne 0 ]] || fail "08: expected malformed launch.json to fail the smoke check"
echo "$OUT8" | grep -qi "not valid JSON" || fail "08: error should say launch.json is not valid JSON, got: $OUT8"
pass "08: malformed JSON in launch.json is caught"
rm -rf "$ROOT"

# ── 9: SWARMFORGE_SKIP_DAEMON=1 on the launch.json config itself is caught —
#       distinct from case 03's profile-level check; a fixed/regressed
#       profile could still be undermined by this launch-entry-local flag
#       flipping daemon-off at the exact moment of launch (was previously
#       exercised by no test) ─────────────────────────────────────────────
make_good_fixture
node -e '
const fs = require("fs");
const path = "'"$ROOT"'/.vscode/launch.json";
const parsed = JSON.parse(fs.readFileSync(path, "utf8"));
parsed.configurations[0].env.SWARMFORGE_SKIP_DAEMON = "1";
fs.writeFileSync(path, JSON.stringify(parsed, null, 2));
'
set +e
OUT9="$(bash "$SMOKE" "$ROOT" 2>&1)"
STATUS9=$?
set -e
[[ "$STATUS9" -ne 0 ]] || fail "09: expected launch.json's own SWARMFORGE_SKIP_DAEMON=1 to fail the smoke check"
echo "$OUT9" | grep -qi "SKIP_DAEMON=1" || fail "09: error should mention SWARMFORGE_SKIP_DAEMON=1, got: $OUT9"
pass "09: SWARMFORGE_SKIP_DAEMON=1 set directly on the launch.json config is caught"
rm -rf "$ROOT"

echo "ALL PASS"
