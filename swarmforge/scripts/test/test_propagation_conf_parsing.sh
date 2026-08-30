#!/usr/bin/env bash
# Reverse-hop propagation token (forward-only|back-one|back-all) → roles.tsv col 9.
# Mirrors test_idle_clear_conf_parsing.sh: parse_config + write_roles_file only.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SWARMFORGE_SH="$SCRIPT_DIR/../swarmforge.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$ROOT"' EXIT

mkdir -p "$ROOT/swarmforge/roles" "$ROOT/.swarmforge"
touch "$ROOT/swarmforge/constitution.prompt"
for role in specifier coder cleaner architect hardender; do
  echo "role prompt" > "$ROOT/swarmforge/roles/$role.prompt"
done

cat > "$ROOT/swarmforge/swarmforge.conf" <<'CONF'
config active_backlog_max_depth -1
window specifier claude master --model x
window coder claude coder task --model x
window cleaner claude cleaner batch back-one --model x
window architect claude architect back-all idle-clear --model x
window hardender claude hardender batch forward-only --model x
CONF

zsh -c "
  source '$SWARMFORGE_SH' '$ROOT'
  parse_config
  write_roles_file
"

ROLES_TSV="$ROOT/.swarmforge/roles.tsv"
[[ -f "$ROLES_TSV" ]] || fail "roles.tsv was not written"

cut_field() { printf '%s' "$1" | cut -f"$2"; }

coder_line="$(grep '^coder' "$ROLES_TSV")"
cleaner_line="$(grep '^cleaner' "$ROLES_TSV")"
architect_line="$(grep '^architect' "$ROLES_TSV")"
hardender_line="$(grep '^hardender' "$ROLES_TSV")"

[[ "$(cut_field "$coder_line" 9)" == "forward-only" ]] \
  || fail "01: coder default propagation should be forward-only, got '$(cut_field "$coder_line" 9)'"
pass "01: absent propagation token defaults to forward-only"

[[ "$(cut_field "$cleaner_line" 9)" == "back-one" ]] \
  || fail "02: cleaner back-one, got '$(cut_field "$cleaner_line" 9)'"
[[ "$(cut_field "$cleaner_line" 7)" == "batch" ]] \
  || fail "02: cleaner receive-mode should stay batch"
[[ "$(cut_field "$cleaner_line" 8)" == "off" ]] \
  || fail "02: cleaner idle-clear should stay off"
pass "02: batch + back-one leaves receive-mode and idle-clear intact"

[[ "$(cut_field "$architect_line" 9)" == "back-all" ]] \
  || fail "03: architect back-all, got '$(cut_field "$architect_line" 9)'"
[[ "$(cut_field "$architect_line" 8)" == "on" ]] \
  || fail "03: architect idle-clear should still be on (col 8)"
pass "03: back-all + idle-clear — propagation col9, idle-clear col8"

[[ "$(cut_field "$hardender_line" 9)" == "forward-only" ]] \
  || fail "04: explicit forward-only, got '$(cut_field "$hardender_line" 9)'"
pass "04: explicit forward-only token is accepted"

echo "ALL PASS"
