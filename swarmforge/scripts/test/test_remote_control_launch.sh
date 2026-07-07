#!/usr/bin/env bash
# Claude agents get --remote-control on launch by default (claude.ai/code sessions).

set -euo pipefail

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

echo "ALL PASS"
