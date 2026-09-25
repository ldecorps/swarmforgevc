#!/usr/bin/env bash
# BL-1698 D7 (QA bounce 2026-09-25, hardener's own domain): handoffd.bb's
# startup call to local-parcel-driver-lib/resume-writable-sweep!
# (handoffd.bb:~5556, requirement 1's own live consumer) had no test that
# fails when that one line is removed - every existing suite stayed
# green. Seeds a driver record naming a 0444 spec file, runs handoffd
# once (--poll-once, which reaches the startup sweep before its own
# work), and asserts the file is writable afterward.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HANDOFFD="$SCRIPT_DIR/../handoffd.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(cd "$(mktemp -d)" && pwd -P)"
export SWARMFORGE_ALLOW_TMP_DAEMON=1
trap 'rm -rf "$ROOT"' EXIT

SOCK="$ROOT/fake.sock"
touch "$SOCK"
mkdir -p "$ROOT/.swarmforge/local-driver"
echo "$SOCK" > "$ROOT/.swarmforge/tmux-socket"
printf 'coder\tcoder\t%s\tsf-coder\tCoder\taider\ttask\n' "$ROOT" \
  > "$ROOT/.swarmforge/roles.tsv"

SPEC_FILE="$ROOT/spec.yaml"
echo 'id: BL-9' > "$SPEC_FILE"
chmod 0444 "$SPEC_FILE"

cat > "$ROOT/.swarmforge/local-driver/coder.json" <<JSON
{"phase":"awaiting-model","ticket":"BL-9","specFiles":["$SPEC_FILE"],"editablePaths":[],"fixTurnsUsed":0,"fixTurnsLimit":3}
JSON

[[ -w "$SPEC_FILE" ]] && fail "setup: expected the seeded spec file to start unwritable"

FAKE_BIN="$ROOT/bin"
mkdir -p "$FAKE_BIN"
cat > "$FAKE_BIN/tmux" <<'TMUX'
#!/usr/bin/env bash
exit 0
TMUX
chmod +x "$FAKE_BIN/tmux"

OUT="$(PATH="$FAKE_BIN:$PATH" bb "$HANDOFFD" "$ROOT" --poll-once 2>&1)"
RC=$?

[[ "$RC" -eq 0 ]] || fail "handoffd --poll-once exited $RC: $OUT"
[[ -w "$SPEC_FILE" ]] || fail "expected the daemon's startup sweep to restore write permission on $SPEC_FILE: $OUT"
pass "handoffd's startup sweep restored write permission on a crashed driver seat's spec file"

echo "ALL PASS"
