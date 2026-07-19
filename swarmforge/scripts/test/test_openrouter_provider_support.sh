#!/usr/bin/env bash
# BL-523: OpenRouter as alternate auth for claude-harness roles.
# Covers role_uses_openrouter membership, launch-script billing_guard
# (Anthropic Skin vs first-party unset), and BL-130 (OPENROUTER_API_KEY
# never written into .swarmforge/launch/<role>.sh).
#
# Pattern mirrors test_alternate_runtime_launch.sh: source swarmforge.sh,
# parse_config + write write_role_launch_script — never a real tmux launch.

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
  local root
  root="$(cd "$(mktemp -d)" && pwd -P)"
  register_tmp_dir "$root"
  mkdir -p "$root/swarmforge/roles" "$root/.swarmforge/launch" "$root/.swarmforge/prompts"
  touch "$root/swarmforge/constitution.prompt"
  for role in specifier coder cleaner architect documenter; do
    echo "role prompt" > "$root/swarmforge/roles/$role.prompt"
  done
  echo "$root"
}

write_conf() {
  local root="$1"
  cat > "$root/swarmforge/swarmforge.conf" <<'CONF'
config active_backlog_max_depth -1
window coder claude coder --model deepseek/deepseek-chat
window cleaner claude cleaner --model qwen/qwen3-32b
window architect claude architect --model google/gemini-2.5-pro
window documenter claude documenter --model deepseek/deepseek-chat
CONF
}

# ── 01: unset SWARMFORGE_OPENROUTER_ROLES keeps first-party billing_guard ─
ROOT1="$(mk_root)"
write_conf "$ROOT1"
env -u SWARMFORGE_OPENROUTER_ROLES OPENROUTER_API_KEY=test-or-secret zsh -c "
  source '$SWARMFORGE_SH' '$ROOT1'
  parse_config
  $index_of_role_snippet
  write_role_launch_script \"\$(index_of_role documenter)\"
"
DOC1="$ROOT1/.swarmforge/launch/documenter.sh"
[[ -f "$DOC1" ]] || fail "01: documenter launch script missing"
grep -q "unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN" "$DOC1" \
  || fail "01: expected first-party unset billing_guard, got: $(head -40 "$DOC1")"
grep -q "openrouter.ai" "$DOC1" && fail "01: OpenRouter URL must not appear when roles list is empty"
grep -q "test-or-secret" "$DOC1" && fail "01: OPENROUTER_API_KEY leaked into launch script"
pass "01: empty SWARMFORGE_OPENROUTER_ROLES keeps first-party auth; key never on disk"
rm -rf "$ROOT1"

# ── 02: role in SWARMFORGE_OPENROUTER_ROLES gets Anthropic Skin billing ───
ROOT2="$(mk_root)"
write_conf "$ROOT2"
SWARMFORGE_OPENROUTER_ROLES="documenter coder" OPENROUTER_API_KEY=test-or-secret zsh -c "
  source '$SWARMFORGE_SH' '$ROOT2'
  parse_config
  $index_of_role_snippet
  write_role_launch_script \"\$(index_of_role documenter)\"
  write_role_launch_script \"\$(index_of_role architect)\"
"
DOC2="$ROOT2/.swarmforge/launch/documenter.sh"
ARCH2="$ROOT2/.swarmforge/launch/architect.sh"
grep -q "ANTHROPIC_BASE_URL='https://openrouter.ai/api'" "$DOC2" \
  || fail "02: expected OpenRouter base URL on documenter, got: $(grep -E 'ANTHROPIC|openrouter' "$DOC2" || true)"
grep -q 'ANTHROPIC_AUTH_TOKEN="\$OPENROUTER_API_KEY"' "$DOC2" \
  || fail "02: expected AUTH_TOKEN to reference OPENROUTER_API_KEY env, not a literal"
grep -q "test-or-secret" "$DOC2" && fail "02: secret value leaked into OpenRouter launch script"
grep -q "unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN" "$ARCH2" \
  || fail "02: architect (not in list) must keep first-party unset guard"
grep -q "openrouter.ai" "$ARCH2" && fail "02: architect must not get OpenRouter URL"
pass "02: listed roles use OpenRouter Skin; unlisted keep first-party; key never on disk"
rm -rf "$ROOT2"

# ── 03: membership outline — coder+cleaner on OR, architect first-party ──
ROOT3="$(mk_root)"
write_conf "$ROOT3"
SWARMFORGE_OPENROUTER_ROLES="coder cleaner" OPENROUTER_API_KEY=x zsh -c "
  source '$SWARMFORGE_SH' '$ROOT3'
  parse_config
  $index_of_role_snippet
  write_role_launch_script \"\$(index_of_role coder)\"
  write_role_launch_script \"\$(index_of_role cleaner)\"
  write_role_launch_script \"\$(index_of_role architect)\"
"
grep -q "openrouter.ai" "$ROOT3/.swarmforge/launch/coder.sh" || fail "03: coder should be OpenRouter"
grep -q "openrouter.ai" "$ROOT3/.swarmforge/launch/cleaner.sh" || fail "03: cleaner should be OpenRouter"
grep -q "unset ANTHROPIC_API_KEY" "$ROOT3/.swarmforge/launch/architect.sh" || fail "03: architect should be first-party"
pass "03: role routing follows SWARMFORGE_OPENROUTER_ROLES membership"
rm -rf "$ROOT3"

# ── 04: model flag from conf still reaches the claude launch line ────────
ROOT4="$(mk_root)"
write_conf "$ROOT4"
SWARMFORGE_OPENROUTER_ROLES="documenter" OPENROUTER_API_KEY=x zsh -c "
  source '$SWARMFORGE_SH' '$ROOT4'
  parse_config
  $index_of_role_snippet
  write_role_launch_script \"\$(index_of_role documenter)\"
"
# Model is baked into the Claude settings JSON (not the argv), same as
# non-OpenRouter claude roles after the BL-519 bootstrap path.
grep -q '"model": "deepseek/deepseek-chat"' "$ROOT4/.swarmforge/launch/documenter.claude-settings.json" \
  || fail "04: conf --model must still reach the settings JSON, got: $(cat "$ROOT4/.swarmforge/launch/documenter.claude-settings.json")"
pass "04: OpenRouter path preserves --model from the window line into settings"
rm -rf "$ROOT4"

# ── 05: reversing membership restores first-party ────────────────────────
ROOT5="$(mk_root)"
write_conf "$ROOT5"
SWARMFORGE_OPENROUTER_ROLES="documenter" OPENROUTER_API_KEY=x zsh -c "
  source '$SWARMFORGE_SH' '$ROOT5'
  parse_config
  $index_of_role_snippet
  write_role_launch_script \"\$(index_of_role documenter)\"
"
grep -q "openrouter.ai" "$ROOT5/.swarmforge/launch/documenter.sh" || fail "05a: setup"
# wipe and rewrite with empty list
SWARMFORGE_OPENROUTER_ROLES="" OPENROUTER_API_KEY=x zsh -c "
  source '$SWARMFORGE_SH' '$ROOT5'
  parse_config
  $index_of_role_snippet
  write_role_launch_script \"\$(index_of_role documenter)\"
"
grep -q "unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN" "$ROOT5/.swarmforge/launch/documenter.sh" \
  || fail "05: removing role from list must restore first-party unset"
grep -q "openrouter.ai" "$ROOT5/.swarmforge/launch/documenter.sh" && fail "05: OpenRouter URL must be gone after reverse"
pass "05: removing a role from SWARMFORGE_OPENROUTER_ROLES restores first-party auth"
rm -rf "$ROOT5"

# ── 06: role_uses_openrouter helper unit (zsh) ───────────────────────────
zsh -c "
  source '$SWARMFORGE_SH' '$(mk_root)'
  SWARMFORGE_OPENROUTER_ROLES='coder documenter'
  role_uses_openrouter coder || exit 11
  role_uses_openrouter documenter || exit 12
  role_uses_openrouter architect && exit 13
  SWARMFORGE_OPENROUTER_ROLES=''
  role_uses_openrouter coder && exit 14
  exit 0
" || fail "06: role_uses_openrouter membership helper misbehaved (exit $?)"
pass "06: role_uses_openrouter matches space-separated membership only"

echo "All BL-523 OpenRouter provider-support tests passed."
