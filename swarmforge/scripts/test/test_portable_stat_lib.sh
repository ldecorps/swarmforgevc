#!/usr/bin/env bash
# BL-203 hardening: portable_stat_lib.sh's portable_stat() branches into a
# BSD `stat -f` path and a GNU `stat -c` fallback. Every other test in this
# repo runs on a GNU/Linux host, where the real `stat -f` always fails - so
# only the GNU fallback branch has ever actually executed. The BSD branch
# (the exact call the original pre-fix code made unconditionally) had zero
# coverage anywhere. Stub a fake `stat` on PATH that accepts BSD-style
# `-f FORMAT FILE` so the success branch runs deterministically on any host,
# without needing a real BSD/macOS machine.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LIB="$SCRIPT_DIR/../portable_stat_lib.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

source "$LIB"

TESTFILE="$(mktemp)"
FAKE_BIN_DIR="$(mktemp -d)"
cleanup() { rm -f "$TESTFILE"; rm -rf "$FAKE_BIN_DIR"; }
trap cleanup EXIT

# ── 1: when `stat -f` succeeds (as on BSD/macOS), portable_stat must use the
#       BSD format string and must not fall through to the GNU form ────────
cat > "$FAKE_BIN_DIR/stat" <<'EOF'
#!/usr/bin/env bash
if [[ "$1" == "-f" ]]; then
  echo "BSD:$2"
  exit 0
fi
echo "unexpected stat invocation: $*" >&2
exit 1
EOF
chmod +x "$FAKE_BIN_DIR/stat"

BSD_OUT="$(PATH="$FAKE_BIN_DIR:$PATH" bash -c "source '$LIB'; portable_stat 'bsd-fmt' 'gnu-fmt' '$TESTFILE'")"
[[ "$BSD_OUT" == "BSD:bsd-fmt" ]] \
  || fail "01: expected the BSD branch output 'BSD:bsd-fmt', got: $BSD_OUT"
pass "01: portable_stat uses the BSD stat -f branch when it succeeds"

# ── 2: when `stat -f` fails (as on GNU/Linux), portable_stat falls back to
#       `stat -c` with the GNU format string ────────────────────────────────
GNU_OUT="$(portable_stat '%m' '%Y' "$TESTFILE")"
[[ "$GNU_OUT" =~ ^[0-9]+$ ]] \
  || fail "02: expected a numeric GNU stat -c mtime, got: $GNU_OUT"
pass "02: portable_stat falls back to GNU stat -c when stat -f fails"

# ── 3: each caller supplies its own format pair - the GNU format string must
#       reach `stat -c` verbatim, not the BSD one (a swapped-argument mutant
#       would otherwise pass silently on a GNU host) ────────────────────────
MISMATCH_OUT="$(portable_stat 'unused-bsd-fmt' '%s' "$TESTFILE")"
EXPECTED_SIZE="$(stat -c '%s' "$TESTFILE")"
[[ "$MISMATCH_OUT" == "$EXPECTED_SIZE" ]] \
  || fail "03: expected the GNU format '%s' to produce '$EXPECTED_SIZE', got: $MISMATCH_OUT"
pass "03: the GNU-branch format string is passed through unmodified"

echo "ALL PASS"
