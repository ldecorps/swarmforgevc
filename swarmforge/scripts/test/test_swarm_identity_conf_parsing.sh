#!/usr/bin/env bash
# BL-090: multi-swarm foundations, first slice. Covers the scriptable
# substrate only: swarm_name/swarm_mode conf parsing + normalization into
# .swarmforge/swarm-identity, secondary-mode launch validation, and the
# primacy-marker fail-fast gate. Coordinator promotion / specifier routing
# judgment is role-prompt behavior, out of this script's scope.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SWARMFORGE_SH="$SCRIPT_DIR/../swarmforge.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

mk_root() {
  local root; root="$(cd "$(mktemp -d)" && pwd -P)"
  mkdir -p "$root/swarmforge/roles" "$root/.swarmforge"
  touch "$root/swarmforge/constitution.prompt"
  for role in coordinator specifier coder; do
    echo "role prompt" > "$root/swarmforge/roles/$role.prompt"
  done
  echo "$root"
}

# ── 1: default identity (no swarm_name/swarm_mode lines) is primary/autonomous,
#      matching every existing single-swarm conf ───────────────────────────
ROOT1="$(mk_root)"
cat > "$ROOT1/swarmforge/swarmforge.conf" <<'CONF'
config active_backlog_max_depth -1
window coordinator claude master --model x
window specifier claude master --model x
CONF
zsh -c "source '$SWARMFORGE_SH' '$ROOT1'; parse_config; check_primacy; write_swarm_identity_file"
IDENTITY1="$ROOT1/.swarmforge/swarm-identity"
[[ -f "$IDENTITY1" ]] || fail "01: swarm-identity file was not written"
grep -qx $'swarm_name\tprimary' "$IDENTITY1" || fail "01: expected default swarm_name 'primary', got: $(cat "$IDENTITY1")"
grep -qx $'swarm_mode\tautonomous' "$IDENTITY1" || fail "01: expected default swarm_mode 'autonomous', got: $(cat "$IDENTITY1")"
pass "01: an unmodified single-swarm conf normalizes to primary/autonomous"

# ── 2: explicit swarm_name + secondary mode normalize correctly ────────────
ROOT2="$(mk_root)"
cat > "$ROOT2/swarmforge/swarmforge.conf" <<'CONF'
config swarm_name second
config swarm_mode secondary primary
window specifier claude master --model x
window coder claude coder task --model x
CONF
zsh -c "source '$SWARMFORGE_SH' '$ROOT2'; parse_config; check_primacy; write_swarm_identity_file"
IDENTITY2="$ROOT2/.swarmforge/swarm-identity"
grep -qx $'swarm_name\tsecond' "$IDENTITY2" || fail "02: expected swarm_name 'second', got: $(cat "$IDENTITY2")"
grep -qx $'swarm_mode\tsecondary' "$IDENTITY2" || fail "02: expected swarm_mode 'secondary', got: $(cat "$IDENTITY2")"
grep -qx $'swarm_mode_primary\tprimary' "$IDENTITY2" || fail "02: expected swarm_mode_primary 'primary', got: $(cat "$IDENTITY2")"
pass "02: explicit swarm_name + secondary mode normalize into swarm-identity"

# ── 3: secondary mode declaring a coordinator window is rejected ───────────
ROOT3="$(mk_root)"
cat > "$ROOT3/swarmforge/swarmforge.conf" <<'CONF'
config swarm_mode secondary primary
window coordinator claude master --model x
window specifier claude master --model x
CONF
set +e
OUT3="$(zsh -c "source '$SWARMFORGE_SH' '$ROOT3'; parse_config" 2>&1)"
STATUS3=$?
set -e
[[ "$STATUS3" -ne 0 ]] || fail "03: expected launch to fail when secondary mode declares a coordinator window"
echo "$OUT3" | grep -qi "coordinator" || fail "03: error must mention the coordinator conflict, got: $OUT3"
pass "03: secondary mode + a coordinator window is rejected at parse time"

# ── 4: secondary mode with no primary name is rejected ─────────────────────
ROOT4="$(mk_root)"
cat > "$ROOT4/swarmforge/swarmforge.conf" <<'CONF'
config swarm_mode secondary
window specifier claude master --model x
CONF
set +e
OUT4="$(zsh -c "source '$SWARMFORGE_SH' '$ROOT4'; parse_config" 2>&1)"
STATUS4=$?
set -e
[[ "$STATUS4" -ne 0 ]] || fail "04: expected launch to fail when secondary mode names no primary"
echo "$OUT4" | grep -qi "primary" || fail "04: error must mention the missing primary name, got: $OUT4"
pass "04: secondary mode with no primary name is rejected at parse time"

# ── 5: an invalid swarm_mode value is rejected ──────────────────────────────
ROOT5="$(mk_root)"
cat > "$ROOT5/swarmforge/swarmforge.conf" <<'CONF'
config swarm_mode yolo
window specifier claude master --model x
CONF
set +e
OUT5="$(zsh -c "source '$SWARMFORGE_SH' '$ROOT5'; parse_config" 2>&1)"
STATUS5=$?
set -e
[[ "$STATUS5" -ne 0 ]] || fail "05: expected launch to fail for an unrecognized swarm_mode value"
pass "05: an unrecognized swarm_mode value is rejected"

# ── 6: no primacy marker present -> autonomous launch is allowed through ───
ROOT6="$(mk_root)"
cat > "$ROOT6/swarmforge/swarmforge.conf" <<'CONF'
window coordinator claude master --model x
CONF
zsh -c "source '$SWARMFORGE_SH' '$ROOT6'; parse_config; check_primacy"
pass "06: an absent primacy marker does not block an autonomous launch"

# ── 7: primacy marker naming THIS swarm -> allowed through ─────────────────
ROOT7="$(mk_root)"
cat > "$ROOT7/swarmforge/swarmforge.conf" <<'CONF'
window coordinator claude master --model x
CONF
echo "primary" > "$ROOT7/swarmforge/primary"
zsh -c "source '$SWARMFORGE_SH' '$ROOT7'; parse_config; check_primacy"
pass "07: a primacy marker naming this swarm allows the autonomous launch through"

# ── 8: primacy marker naming a DIFFERENT swarm -> autonomous launch refused ─
ROOT8="$(mk_root)"
cat > "$ROOT8/swarmforge/swarmforge.conf" <<'CONF'
config swarm_name second
window coordinator claude master --model x
CONF
echo "primary" > "$ROOT8/swarmforge/primary"
set +e
OUT8="$(zsh -c "source '$SWARMFORGE_SH' '$ROOT8'; parse_config; check_primacy" 2>&1)"
STATUS8=$?
set -e
[[ "$STATUS8" -ne 0 ]] || fail "08: expected the autonomous launch to be refused when the marker names a different swarm"
echo "$OUT8" | grep -q "primary" || fail "08: error must name the current primary, got: $OUT8"
pass "08: an autonomous launch is refused when the committed marker names a different swarm"

# ── 9: a secondary-mode launch is never gated by the primacy marker ────────
ROOT9="$(mk_root)"
cat > "$ROOT9/swarmforge/swarmforge.conf" <<'CONF'
config swarm_name second
config swarm_mode secondary primary
window specifier claude master --model x
CONF
echo "primary" > "$ROOT9/swarmforge/primary"
zsh -c "source '$SWARMFORGE_SH' '$ROOT9'; parse_config; check_primacy"
pass "09: secondary mode is never blocked by the primacy marker (it makes no triage claim)"

echo "ALL PASS"
