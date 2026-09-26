#!/usr/bin/env bash
# BL-1757: swarmforge.sh's pack-conf parser accepts `config tooling_root
# <absolute-path>` and exports it as SWARMFORGE_TOOLING_ROOT - the value
# launch_front_desk.sh/start_cursor_bridge.sh read (via tooling_root_lib.sh)
# to resolve their compiled entrypoints from a separate swarmforgevc
# checkout when the target project has none of its own.
set -euo pipefail

export PACK_STAFFING_SKIP_GATE=1
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp_cleanup.sh"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SWARMFORGE_SH="$SCRIPT_DIR/../swarmforge.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

mk_root() {
  local root; root="$(cd "$(mktemp -d)" && pwd -P)"
  register_tmp_dir "$root"
  mkdir -p "$root/swarmforge/roles"
  printf 'constitution\n' > "$root/swarmforge/constitution.prompt"
  printf 'role prompt\n' > "$root/swarmforge/roles/coder.prompt"
  echo "$root"
}

# ── 1: a valid absolute path is accepted and exported ──────────────────────
ROOT1="$(mk_root)"
TOOLING1="$(mktemp -d)"; register_tmp_dir "$TOOLING1"
cat > "$ROOT1/swarmforge/swarmforge.conf" <<EOF
config tooling_root $TOOLING1
window coder claude coder --model claude-haiku-4-5-20251001
EOF
OUT1="$(zsh -c "source '$SWARMFORGE_SH' '$ROOT1'; parse_config; printf 'TOOLING_ROOT=[%s]\n' \"\$SWARMFORGE_TOOLING_ROOT\"")"
[[ "$OUT1" == *"TOOLING_ROOT=[$TOOLING1]"* ]] \
  || fail "1: config tooling_root <path> must be parsed and exported as SWARMFORGE_TOOLING_ROOT, got: $OUT1"
pass "1: config tooling_root accepted and exported"

# ── 2: a relative path is rejected as an Invalid config line, like every
#      other malformed config value ─────────────────────────────────────────
ROOT2="$(mk_root)"
cat > "$ROOT2/swarmforge/swarmforge.conf" <<'EOF'
config tooling_root relative/path
window coder claude coder --model claude-haiku-4-5-20251001
EOF
OUT2="$(zsh -c "source '$SWARMFORGE_SH' '$ROOT2'; parse_config" 2>&1)" && rc2=0 || rc2=$?
[[ "$rc2" -ne 0 && "$OUT2" == *"Invalid config line"* ]] \
  || fail "2: a relative tooling_root path must be refused as an Invalid config line, got (rc=$rc2): $OUT2"
pass "2: a relative tooling_root path is refused"

# ── 3: a missing value is rejected the same way ─────────────────────────────
ROOT3="$(mk_root)"
cat > "$ROOT3/swarmforge/swarmforge.conf" <<'EOF'
config tooling_root
window coder claude coder --model claude-haiku-4-5-20251001
EOF
OUT3="$(zsh -c "source '$SWARMFORGE_SH' '$ROOT3'; parse_config" 2>&1)" && rc3=0 || rc3=$?
[[ "$rc3" -ne 0 && "$OUT3" == *"Invalid config line"* ]] \
  || fail "3: a missing tooling_root value must be refused as an Invalid config line, got (rc=$rc3): $OUT3"
pass "3: a missing tooling_root value is refused"

# ── 4: absent entirely -> SWARMFORGE_TOOLING_ROOT stays empty, byte-identical
#      to every pre-BL-1757 conf with no such line (invariant 1) ───────────
ROOT4="$(mk_root)"
cat > "$ROOT4/swarmforge/swarmforge.conf" <<'EOF'
window coder claude coder --model claude-haiku-4-5-20251001
EOF
OUT4="$(zsh -c "source '$SWARMFORGE_SH' '$ROOT4'; parse_config; printf 'TOOLING_ROOT=[%s]\n' \"\$SWARMFORGE_TOOLING_ROOT\"")"
[[ "$OUT4" == *"TOOLING_ROOT=[]"* ]] \
  || fail "4: with no tooling_root line, SWARMFORGE_TOOLING_ROOT must stay empty, got: $OUT4"
pass "4: no tooling_root line leaves SWARMFORGE_TOOLING_ROOT empty (byte-identical default)"

echo "ALL PASS"
