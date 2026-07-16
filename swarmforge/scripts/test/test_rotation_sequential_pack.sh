#!/usr/bin/env bash
# BL-448: `config rotation sequential` marks a pack whose pipeline roles all
# share ONE resident process (the mono-rotate pack) instead of one tmux
# session per role. Exercised directly against swarmforge.sh's own
# parse_config/is_sequential_dormant/write_roles_file (not a reimplementation
# of the launch logic, and never a real tmux session - the session-creation
# loop itself lives in the top-level script body, which the ZSH_EVAL_CONTEXT
# guard skips when sourced, same convention every other test in this
# directory relies on). No real tmux session is ever launched or bounced by
# this test.

set -euo pipefail

# BL-315/engineering.prompt: unset a caller's own SWARMFORGE_CONFIG override
# so every fixture below resolves via the conf this test writes, never a
# leaked live-launch override.
unset SWARMFORGE_CONFIG

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SWARMFORGE_SH="$SCRIPT_DIR/../swarmforge.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

mk_fixture_root() {
  local root
  root="$(cd "$(mktemp -d)" && pwd -P)"
  mkdir -p "$root/swarmforge/roles" "$root/.swarmforge"
  touch "$root/swarmforge/constitution.prompt"
  for role in specifier coder cleaner architect hardener documenter QA; do
    echo "role prompt" > "$root/swarmforge/roles/$role.prompt"
  done
  echo "$root"
}

# ── rotation-sequential-01: a rotation pack's middle pipeline roles are
# dormant (no session of their own); the resident role and the
# separately-provisioned coordinator are never dormant ──────────────────
ROOT="$(mk_fixture_root)"
trap 'rm -rf "$ROOT"' EXIT

cat > "$ROOT/swarmforge/swarmforge.conf" <<'CONF'
config swarm_name mono
config rotation sequential
window coder claude coder --model x
window cleaner claude cleaner batch --model x
window architect claude architect --model x
window hardener claude hardener --model x
window QA claude QA --model x
CONF

OUT_DIR="$ROOT/.out01"
mkdir -p "$OUT_DIR"
zsh -c "
  source '$SWARMFORGE_SH' '$ROOT'
  parse_config
  write_roles_file
  is_sequential_dormant 1 && echo 'DORMANT:1' || echo 'RESIDENT:1'
  is_sequential_dormant 2 && echo 'DORMANT:2' || echo 'RESIDENT:2'
  is_sequential_dormant 3 && echo 'DORMANT:3' || echo 'RESIDENT:3'
  is_sequential_dormant 4 && echo 'DORMANT:4' || echo 'RESIDENT:4'
  is_sequential_dormant \${#ROLES[@]} && echo 'DORMANT:last' || echo 'RESIDENT:last'
  print -l -- \"\${ROLES[@]}\" > '$OUT_DIR/roles.txt'
" > "$OUT_DIR/dormancy.txt"

grep -qx "RESIDENT:1" "$OUT_DIR/dormancy.txt" || fail "01: expected index 1 (coder, the conf's first window line) to be resident, not dormant"
pass "01: the first-declared pipeline role is resident (gets a real session)"

grep -qx "DORMANT:2" "$OUT_DIR/dormancy.txt" || fail "01: expected index 2 (cleaner) to be sequential-dormant"
grep -qx "DORMANT:3" "$OUT_DIR/dormancy.txt" || fail "01: expected index 3 (architect) to be sequential-dormant"
grep -qx "DORMANT:4" "$OUT_DIR/dormancy.txt" || fail "01: expected index 4 (hardener) to be sequential-dormant"
pass "01: every middle pipeline role is sequential-dormant (no session of its own)"

grep -qx "RESIDENT:last" "$OUT_DIR/dormancy.txt" || fail "01: expected the coordinator (last-registered role) to never be dormant"
pass "01: the coordinator is never sequential-dormant - it stays reserved, separately-provisioned infrastructure"

ROLE_COUNT="$(wc -l < "$OUT_DIR/roles.txt" | tr -d ' ')"
[[ "$ROLE_COUNT" == "6" ]] || fail "01: expected all 6 roles (5 pipeline + coordinator) still registered, got $ROLE_COUNT"
pass "01: every rotation-member role is still fully registered (its own worktree/roles.tsv entry), regardless of dormancy"

ROLES_TSV="$ROOT/.swarmforge/roles.tsv"
for role in coder cleaner architect hardener QA coordinator; do
  grep -q "^$role	" "$ROLES_TSV" || fail "01: expected $role in roles.tsv with its own entry"
done
pass "01: roles.tsv carries a full entry for every rotation-member role, exactly like a non-rotation pack"

rm -rf "$ROOT"

# ── rotation-sequential-02: an invalid rotation value is rejected ────────
ROOT="$(mk_fixture_root)"
cat > "$ROOT/swarmforge/swarmforge.conf" <<'CONF'
config rotation nonsense
window coder claude coder --model x
CONF
ERROR_OUTPUT="$(zsh -c "source '$SWARMFORGE_SH' '$ROOT'; parse_config" 2>&1 || true)"
echo "$ERROR_OUTPUT" | grep -qi "rotation must be 'sequential'" \
  || fail "02: expected a \"rotation must be 'sequential'\" error, got: $ERROR_OUTPUT"
pass "02: an invalid 'config rotation' value is rejected rather than silently accepted"
rm -rf "$ROOT"

# ── rotation-sequential-03: regression - a normal (non-rotation) pack is
# completely unaffected, every role is resident ──────────────────────────
ROOT="$(mk_fixture_root)"
cat > "$ROOT/swarmforge/swarmforge.conf" <<'CONF'
window coder claude coder --model x
window cleaner claude cleaner batch --model x
CONF
OUT_DIR="$ROOT/.out03"
mkdir -p "$OUT_DIR"
zsh -c "
  source '$SWARMFORGE_SH' '$ROOT'
  parse_config
  is_sequential_dormant 1 && echo 'DORMANT:1' || echo 'RESIDENT:1'
  is_sequential_dormant 2 && echo 'DORMANT:2' || echo 'RESIDENT:2'
  is_sequential_dormant \${#ROLES[@]} && echo 'DORMANT:last' || echo 'RESIDENT:last'
" > "$OUT_DIR/dormancy.txt"

grep -qx "RESIDENT:1" "$OUT_DIR/dormancy.txt" || fail "03: expected a normal pack's index 1 to be resident"
grep -qx "RESIDENT:2" "$OUT_DIR/dormancy.txt" || fail "03: expected a normal pack's index 2 to be resident too (no rotation declared)"
grep -qx "RESIDENT:last" "$OUT_DIR/dormancy.txt" || fail "03: expected a normal pack's coordinator to be resident"
pass "03: a pack that never declares 'config rotation sequential' has every role resident, unchanged from before BL-448"
rm -rf "$ROOT"

echo "ALL PASS"
