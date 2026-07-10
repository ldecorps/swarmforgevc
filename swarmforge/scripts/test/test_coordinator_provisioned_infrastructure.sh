#!/usr/bin/env bash
# BL-243: the coordinator is provisioned infrastructure, never a
# swarmforge.conf window line. Exercised directly against swarmforge.sh's
# own parse_config/provision_coordinator/pack_size/write_roles_file/
# write_swarm_identity_file (not a reimplementation of the launch logic),
# sourced against fixture confs (the ZSH_EVAL_CONTEXT toplevel guard skips
# tmux/git/real-launch side effects when sourced - BL-089's own convention,
# see test_idle_clear_conf_parsing.sh). No real tmux session is ever
# launched or bounced by this test.

set -euo pipefail

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

# ── coordinator-infrastructure-01/03: a conf omitting coordinator still
# gets exactly one, with no dedicated worktree ───────────────────────────
ROOT="$(mk_fixture_root)"
trap 'rm -rf "$ROOT"' EXIT

cat > "$ROOT/swarmforge/swarmforge.conf" <<'CONF'
config swarm_name second
window specifier claude master --model x
window coder claude coder --model x
window cleaner claude cleaner batch --model x
CONF

OUT_DIR="$ROOT/.out01"
mkdir -p "$OUT_DIR"
zsh -c "
  source '$SWARMFORGE_SH' '$ROOT'
  parse_config
  write_roles_file
  write_swarm_identity_file
  print -l -- \"\${ROLES[@]}\" > '$OUT_DIR/roles.txt'
  print -r -- \"\$(pack_size)\" > '$OUT_DIR/pack_size.txt'
"

grep -qx "coordinator" "$OUT_DIR/roles.txt" || fail "01: a conf omitting coordinator must still provision one"
pass "01: a conf that omits coordinator still brings a coordinator up"

COORD_COUNT="$(grep -cx "coordinator" "$OUT_DIR/roles.txt")"
[[ "$COORD_COUNT" == "1" ]] || fail "01: expected exactly one coordinator entry, got $COORD_COUNT"
pass "01: exactly one coordinator is provisioned"

ROLES_TSV="$ROOT/.swarmforge/roles.tsv"
[[ -f "$ROLES_TSV" ]] || fail "01: roles.tsv was not written"
grep -q "^coordinator" "$ROLES_TSV" || fail "01: coordinator must appear in roles.tsv like every other role"
pass "01: coordinator appears in roles.tsv (a live pane's role source)"

COORD_LINE="$(grep '^coordinator' "$ROLES_TSV")"
COORD_WORKTREE_NAME="$(printf '%s' "$COORD_LINE" | cut -f2)"
[[ "$COORD_WORKTREE_NAME" == "master" ]] || fail "03: coordinator must use worktree 'master' (no dedicated worktree), got '$COORD_WORKTREE_NAME'"
pass "03: the coordinator owns no dedicated worktree (worktree name is 'master')"

COORD_WORKTREE_PATH="$(printf '%s' "$COORD_LINE" | cut -f3)"
[[ "$COORD_WORKTREE_PATH" == "$ROOT" ]] || fail "03: coordinator worktree path must be the main checkout, got '$COORD_WORKTREE_PATH'"
pass "03: the coordinator's worktree path is the main checkout, not a dedicated one"

# ── coordinator-infrastructure-02: pack size excludes coordinator ────────
[[ "$(cat "$OUT_DIR/pack_size.txt")" == "3" ]] || fail "02: expected pack size 3 (specifier/coder/cleaner), got $(cat "$OUT_DIR/pack_size.txt")"
pass "02: the coordinator is not counted in the pack size (3-role conf reports 3)"

rm -rf "$ROOT"

# ── coordinator-infrastructure-02 (2-pack, the ticket's own literal example) ─
ROOT="$(mk_fixture_root)"
cat > "$ROOT/swarmforge/swarmforge.conf" <<'CONF'
window coder claude coder --model x
window cleaner claude cleaner batch --model x
CONF
OUT_DIR="$ROOT/.out02"
mkdir -p "$OUT_DIR"
zsh -c "
  source '$SWARMFORGE_SH' '$ROOT'
  parse_config
  print -r -- \"\$(pack_size)\" > '$OUT_DIR/pack_size.txt'
"
[[ "$(cat "$OUT_DIR/pack_size.txt")" == "2" ]] || fail "02: a 2-pack (coder, cleaner) must report pack size 2"
pass "02: a 2-pack of coder+cleaner reports pack size 2, coordinator excluded"
rm -rf "$ROOT"

# ── coordinator-infrastructure-04: naming coordinator in the conf is
# rejected as reserved, before it can ever be provisioned twice ──────────
ROOT="$(mk_fixture_root)"
cat > "$ROOT/swarmforge/swarmforge.conf" <<'CONF'
window coordinator claude master --model x
window coder claude coder --model x
CONF
ERROR_OUTPUT="$(zsh -c "source '$SWARMFORGE_SH' '$ROOT'; parse_config" 2>&1 || true)"
echo "$ERROR_OUTPUT" | grep -qi "coordinator is reserved infrastructure" \
  || fail "04: expected a 'coordinator is reserved infrastructure' error, got: $ERROR_OUTPUT"
pass "04: naming coordinator in the conf reports it is reserved infrastructure"

EXIT_CODE=0
zsh -c "source '$SWARMFORGE_SH' '$ROOT'; parse_config" >/dev/null 2>&1 || EXIT_CODE=$?
[[ "$EXIT_CODE" != "0" ]] || fail "04: a conf naming coordinator must fail parse_config, not succeed"
pass "04: a conf naming coordinator fails the launch rather than silently accepting it"
rm -rf "$ROOT"

# ── coordinator-infrastructure-05: identity() returns the swarm's name ───
ROOT="$(mk_fixture_root)"
cat > "$ROOT/swarmforge/swarmforge.conf" <<'CONF'
config swarm_name second
window coder claude coder --model x
CONF
zsh -c "
  source '$SWARMFORGE_SH' '$ROOT'
  parse_config
  write_swarm_identity_file
"
IDENTITY_FILE="$ROOT/.swarmforge/swarm-identity"
[[ -f "$IDENTITY_FILE" ]] || fail "05: swarm-identity file was not written"
grep -qx $'swarm_name\tsecond' "$IDENTITY_FILE" || fail "05: expected swarm_name 'second' in the identity file, got: $(cat "$IDENTITY_FILE")"
pass "05: identity() for the swarm returns its configured name"
rm -rf "$ROOT"

# ── regression: a secondary swarm still has no local coordinator
# (unchanged from today - it is enslaved to its primary's own triage) ────
ROOT="$(mk_fixture_root)"
cat > "$ROOT/swarmforge/swarmforge.conf" <<'CONF'
config swarm_name second
config swarm_mode secondary primary
window coder claude coder --model x
CONF
OUT_DIR="$ROOT/.out-secondary"
mkdir -p "$OUT_DIR"
zsh -c "
  source '$SWARMFORGE_SH' '$ROOT'
  parse_config
  print -l -- \"\${ROLES[@]}\" > '$OUT_DIR/roles.txt'
"
grep -qx "coordinator" "$OUT_DIR/roles.txt" && fail "regression: a secondary swarm must NOT get a local coordinator"
pass "regression: a secondary swarm still has no local coordinator, preserving its enslaved-to-primary invariant"
rm -rf "$ROOT"

echo "ALL PASS"
