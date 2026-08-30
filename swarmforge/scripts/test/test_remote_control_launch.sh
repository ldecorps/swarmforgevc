#!/usr/bin/env bash
# Claude agents get --remote-control on launch by default (claude.ai/code sessions).

set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp_cleanup.sh"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SWARMFORGE_SH="$SCRIPT_DIR/../swarmforge.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

index_of_role_snippet='
index_of_role() {
  local target="$1" i
  for (( i = 1; i <= ${#ROLES[@]}; i++ )); do
    [[ "${ROLES[$i]}" == "$target" ]] && { echo "$i"; return; }
  done
}
'

mk_root() {
  local root; root="$(cd "$(mktemp -d)" && pwd -P)"
  register_tmp_dir "$root"
  mkdir -p "$root/swarmforge/roles" "$root/.swarmforge/launch" "$root/.swarmforge/prompts"
  printf 'constitution\n' > "$root/swarmforge/constitution.prompt"
  printf 'role prompt\n' > "$root/swarmforge/roles/coder.prompt"
  echo "$root"
}

ROOT1="$(mk_root)"
cat > "$ROOT1/swarmforge/swarmforge.conf" <<'EOF'
window coder claude coder --model claude-haiku-4-5-20251001 --dangerously-skip-permissions --effort low
EOF

zsh -c "source '$SWARMFORGE_SH' '$ROOT1'; parse_config; $index_of_role_snippet write_role_launch_script \"\$(index_of_role coder)\""
CODER_SCRIPT="$ROOT1/.swarmforge/launch/coder.sh"
[[ -f "$CODER_SCRIPT" ]] || fail "01: coder launch script was not written"
grep -q -- '--remote-control SwarmForge-Coder' "$CODER_SCRIPT" \
  || fail "01: default launch must include --remote-control SwarmForge-Coder"
pass "01: claude agent without explicit flag gets remote-control by default"

ROOT2="$(mk_root)"
cat > "$ROOT2/swarmforge/swarmforge.conf" <<'EOF'
config remote_control off
window coder claude coder --model claude-haiku-4-5-20251001 --dangerously-skip-permissions --effort low
EOF

zsh -c "source '$SWARMFORGE_SH' '$ROOT2'; parse_config; $index_of_role_snippet write_role_launch_script \"\$(index_of_role coder)\""
CODER_SCRIPT_OFF="$ROOT2/.swarmforge/launch/coder.sh"
grep -q -- '--remote-control' "$CODER_SCRIPT_OFF" \
  && fail "02: config remote_control off must not inject --remote-control"
pass "02: config remote_control off disables auto-inject"

# ── BL-1218: config off must beat an EXPLICIT --remote-control on the window
#    line. This is the row that gates that ticket: 01/02 above pass
#    identically before and after it, because neither names the flag.
ROOT3="$(mk_root)"
cat > "$ROOT3/swarmforge/swarmforge.conf" <<'EOF'
config remote_control off
window coder claude coder --model claude-haiku-4-5-20251001 --dangerously-skip-permissions --effort low --remote-control SwarmForge-Coder
EOF

zsh -c "source '$SWARMFORGE_SH' '$ROOT3'; parse_config; $index_of_role_snippet write_role_launch_script \"\$(index_of_role coder)\""
CODER_SCRIPT_EXPLICIT_OFF="$ROOT3/.swarmforge/launch/coder.sh"
[[ -f "$CODER_SCRIPT_EXPLICIT_OFF" ]] || fail "03: coder launch script was not written"
grep -q -- '--remote-control' "$CODER_SCRIPT_EXPLICIT_OFF" \
  && fail "03: config remote_control off must strip an explicitly named --remote-control"
# --model/--effort are parsed out of extra_cli into the settings JSON
# (BL-319), so the rest of the window line is checked where it actually
# lands rather than in the script text.
grep -q -- '--dangerously-skip-permissions' "$CODER_SCRIPT_EXPLICIT_OFF" \
  || fail "03: stripping the flag must not eat the rest of the window line"
grep -q 'claude-haiku-4-5-20251001' "$ROOT3/.swarmforge/launch/coder.claude-settings.json" \
  || fail "03: stripping the flag must not eat the model the window line named"
pass "03: config remote_control off beats an explicit --remote-control on the window line"

# ── config ON with an explicit flag: unchanged, and not duplicated ─────────
ROOT4="$(mk_root)"
cat > "$ROOT4/swarmforge/swarmforge.conf" <<'EOF'
config remote_control on
window coder claude coder --model claude-haiku-4-5-20251001 --dangerously-skip-permissions --effort low --remote-control SwarmForge-Coder
EOF

zsh -c "source '$SWARMFORGE_SH' '$ROOT4'; parse_config; $index_of_role_snippet write_role_launch_script \"\$(index_of_role coder)\""
CODER_SCRIPT_ON="$ROOT4/.swarmforge/launch/coder.sh"
grep -q -- '--remote-control SwarmForge-Coder' "$CODER_SCRIPT_ON" \
  || fail "04: config remote_control on must keep an explicitly named flag"
[[ "$(grep -c -- '--remote-control' "$CODER_SCRIPT_ON")" == "1" ]] \
  || fail "04: config on must not duplicate a flag the window line already named"
pass "04: config remote_control on leaves an explicit flag exactly as written"

# ── absent config behaves exactly as on (the ticket's own constraint) ──────
ROOT5="$(mk_root)"
cat > "$ROOT5/swarmforge/swarmforge.conf" <<'EOF'
window coder claude coder --model claude-haiku-4-5-20251001 --dangerously-skip-permissions --effort low --remote-control SwarmForge-Coder
EOF

zsh -c "source '$SWARMFORGE_SH' '$ROOT5'; parse_config; $index_of_role_snippet write_role_launch_script \"\$(index_of_role coder)\""
CODER_SCRIPT_ABSENT="$ROOT5/.swarmforge/launch/coder.sh"
grep -q -- '--remote-control SwarmForge-Coder' "$CODER_SCRIPT_ABSENT" \
  || fail "05: an absent remote_control config must behave exactly as on"
pass "05: absent config keeps today's behaviour"

echo "ALL PASS"
