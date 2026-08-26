#!/usr/bin/env bash
# BL-785: stop-swarm.sh must remove the root-scoped freshness cron so a
# deliberate full-stack stop is not undone within two minutes by the checker.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp_cleanup.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/../../.." && pwd)"
SRC="$(cd "$SCRIPT_DIR/.." && pwd)"
INSTALLER="$SRC/install_freshness_cron.sh"
UNINSTALLER="$SRC/uninstall_freshness_cron.sh"
STOP_SWARM="$REPO/stop-swarm.sh"
BASH_BIN="$(command -v bash)"

fail=0
note() { printf '%s\n' "$*"; }
check() { if eval "$2"; then note "ok   - $1"; else note "FAIL - $1"; fail=1; fi; }
pass() { note "PASS: $*"; }

make_root() {
  local d
  d="$(mktemp -d)"
  register_tmp_dir "$d"
  printf '%s' "$d"
}

make_fake_crontab_bin() {
  local dir=$1 store=$2
  mkdir -p "$dir"
  cat > "$dir/crontab" <<'EOF'
#!/usr/bin/env bash
store="${CRONTAB_STORE:?}"
if [[ "${1:-}" == "-l" ]]; then
  cat "$store" 2>/dev/null || true
  exit 0
fi
if [[ "${1:-}" == "-r" ]]; then
  : > "$store"
  exit 0
fi
cat > "$store"
EOF
  chmod +x "$dir/crontab"
}

# ── 01: uninstall removes only this root's line ─────────────────────────────
ROOT_A="$(make_root)"
ROOT_B="$(make_root)"
FAKE_CRON="$(make_root)"
STORE="$FAKE_CRON/crontab.txt"
: > "$STORE"
make_fake_crontab_bin "$FAKE_CRON" "$STORE"

PATH="$FAKE_CRON:$PATH" CRONTAB_STORE="$STORE" "$BASH_BIN" "$INSTALLER" "$ROOT_A" >/dev/null
PATH="$FAKE_CRON:$PATH" CRONTAB_STORE="$STORE" "$BASH_BIN" "$INSTALLER" "$ROOT_B" >/dev/null
PATH="$FAKE_CRON:$PATH" CRONTAB_STORE="$STORE" "$BASH_BIN" "$UNINSTALLER" "$ROOT_A" >/dev/null

check "01: root A's cron line is gone" "! grep -qF \"FRESHNESS_ROOT=$ROOT_A \" \"\$STORE\""
check "01: root B's cron line remains" "grep -qF \"FRESHNESS_ROOT=$ROOT_B \" \"\$STORE\""
pass "01: uninstall is root-scoped on a multi-root crontab"

# ── 02: uninstall is idempotent ─────────────────────────────────────────────
ROOT_C="$(make_root)"
STORE2="$FAKE_CRON/crontab2.txt"
: > "$STORE2"
PATH="$FAKE_CRON:$PATH" CRONTAB_STORE="$STORE2" "$BASH_BIN" "$INSTALLER" "$ROOT_C" >/dev/null
PATH="$FAKE_CRON:$PATH" CRONTAB_STORE="$STORE2" "$BASH_BIN" "$UNINSTALLER" "$ROOT_C" >/dev/null
PATH="$FAKE_CRON:$PATH" CRONTAB_STORE="$STORE2" "$BASH_BIN" "$UNINSTALLER" "$ROOT_C" >/dev/null
check "02: idempotent uninstall leaves no marker lines" '! grep -q "swarmforge-BL-675-freshness-check" "$STORE2"'
pass "02: uninstall is idempotent"

# ── 03: stop-swarm removes the cron for its target root ────────────────────
ROOT_D="$(make_root)"
STORE3="$FAKE_CRON/crontab3.txt"
: > "$STORE3"
PATH="$FAKE_CRON:$PATH" CRONTAB_STORE="$STORE3" "$BASH_BIN" "$INSTALLER" "$ROOT_D" >/dev/null
check "03: cron installed before stop" 'grep -qF "FRESHNESS_ROOT=$ROOT_D " "$STORE3"'

EMPTY_PS="$(mktemp)"
register_tmp_dir "$(dirname "$EMPTY_PS")"
: > "$EMPTY_PS"
PATH="$FAKE_CRON:$PATH" CRONTAB_STORE="$STORE3" SWARMFORGE_SURVIVOR_PS_FILE="$EMPTY_PS" \
  "$BASH_BIN" "$STOP_SWARM" "$ROOT_D" >/dev/null
check "03: stop-swarm removed the cron line" '! grep -qF "FRESHNESS_ROOT=$ROOT_D " "$STORE3"'
pass "03: stop-swarm uninstalls the freshness cron for its target root"

if [[ "$fail" -eq 0 ]]; then
  echo "stop-swarm freshness cron: ALL CHECKS PASSED"
else
  echo "stop-swarm freshness cron: FAILURES"
  exit 1
fi
