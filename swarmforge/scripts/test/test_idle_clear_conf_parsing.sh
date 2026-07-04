#!/usr/bin/env bash
# BL-089: per-role idle-boundary context-clear opt-in flag. Covers the
# non-behavioral gate "conf parsing + roles.tsv normalization of the new
# token", exercised directly against swarmforge.sh's own parse_config /
# write_roles_file (not a reimplementation of the parsing logic).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SWARMFORGE_SH="$SCRIPT_DIR/../swarmforge.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$ROOT"' EXIT

mkdir -p "$ROOT/swarmforge/roles" "$ROOT/.swarmforge"
touch "$ROOT/swarmforge/constitution.prompt"
for role in coder cleaner specifier hardener; do
  echo "role prompt" > "$ROOT/swarmforge/roles/$role.prompt"
done

cat > "$ROOT/swarmforge/swarmforge.conf" <<'CONF'
config active_backlog_max_depth -1
window specifier claude master --model x
window coder claude coder task idle-clear --model x --effort medium
window cleaner claude cleaner batch --model x
window hardener claude hardener batch idle-clear --model x --effort medium
CONF

# ── run parse_config + write_roles_file against the fixture conf, without
#    launching a real swarm (the ZSH_EVAL_CONTEXT toplevel guard in
#    swarmforge.sh skips tmux/git/launch side effects when sourced) ────────
zsh -c "
  source '$SWARMFORGE_SH' '$ROOT'
  parse_config
  write_roles_file
"

ROLES_TSV="$ROOT/.swarmforge/roles.tsv"
[[ -f "$ROLES_TSV" ]] || fail "roles.tsv was not written"

specifier_line="$(grep '^specifier' "$ROLES_TSV")"
coder_line="$(grep '^coder' "$ROLES_TSV")"
cleaner_line="$(grep '^cleaner' "$ROLES_TSV")"

specifier_idle_clear="$(printf '%s' "$specifier_line" | cut -f8)"
coder_idle_clear="$(printf '%s' "$coder_line" | cut -f8)"
cleaner_idle_clear="$(printf '%s' "$cleaner_line" | cut -f8)"
coder_receive_mode="$(printf '%s' "$coder_line" | cut -f7)"
cleaner_receive_mode="$(printf '%s' "$cleaner_line" | cut -f7)"

[[ "$specifier_idle_clear" == "off" ]] || fail "01: specifier (no token) should be off, got '$specifier_idle_clear'"
pass "01: role without the idle-clear token normalizes to off"

[[ "$coder_idle_clear" == "on" ]] || fail "02: coder (idle-clear token present) should be on, got '$coder_idle_clear'"
pass "02: role with the idle-clear token normalizes to on"

[[ "$coder_receive_mode" == "task" ]] || fail "03: coder receive-mode should still be task, got '$coder_receive_mode'"
pass "03: existing receive-mode field is unaffected by the new token"

[[ "$cleaner_idle_clear" == "off" ]] || fail "04: cleaner (batch, no idle-clear token) should be off, got '$cleaner_idle_clear'"
[[ "$cleaner_receive_mode" == "batch" ]] || fail "04: cleaner receive-mode should still be batch, got '$cleaner_receive_mode'"
pass "04: batch receive-mode role without the token normalizes to off, batch mode intact"

# The batch + idle-clear combination exercises the trickiest part of the
# field-shift arithmetic (next_field advances once for "batch" AND again for
# "idle-clear"), so it deserves its own coverage rather than relying on the
# task+idle-clear and batch+no-token cases to imply it works.
hardener_line="$(grep '^hardener' "$ROLES_TSV")"
hardener_idle_clear="$(printf '%s' "$hardener_line" | cut -f8)"
hardener_receive_mode="$(printf '%s' "$hardener_line" | cut -f7)"
[[ "$hardener_idle_clear" == "on" ]] || fail "05: hardener (batch + idle-clear) should be on, got '$hardener_idle_clear'"
[[ "$hardener_receive_mode" == "batch" ]] || fail "05: hardener receive-mode should still be batch, got '$hardener_receive_mode'"
pass "05: batch receive-mode role WITH the idle-clear token normalizes both fields correctly"

echo "ALL PASS"
