#!/usr/bin/env bash
# BL-130: per-role alternate agent runtime (pilot: documenter on aider/Mistral).
# Covers the scriptable substrate only: config parsing accepts a non-claude
# agent, the generated launch script targets that agent's CLI instead of
# claude, unconfigured roles keep defaulting to claude, and provider API keys
# are forwarded from this process's own env (never written to the repo).

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
  mkdir -p "$root/swarmforge/roles" "$root/.swarmforge/launch"
  touch "$root/swarmforge/constitution.prompt"
  for role in specifier coder documenter; do
    echo "role prompt" > "$root/swarmforge/roles/$role.prompt"
  done
  echo "$root"
}

# ── 1: a role configured with agent=aider gets a non-claude launch body,
#      while every unconfigured role still defaults to claude ─────────────
ROOT1="$(mk_root)"
cat > "$ROOT1/swarmforge/swarmforge.conf" <<'CONF'
config active_backlog_max_depth -1
window specifier claude master --model x
window documenter aider master --model mistral/mistral-large-latest
CONF
zsh -c "source '$SWARMFORGE_SH' '$ROOT1'; parse_config; $index_of_role_snippet write_role_launch_script \"\$(index_of_role documenter)\"; write_role_launch_script \"\$(index_of_role specifier)\""
DOC_SCRIPT="$ROOT1/.swarmforge/launch/documenter.sh"
SPEC_SCRIPT="$ROOT1/.swarmforge/launch/specifier.sh"
[[ -f "$DOC_SCRIPT" ]] || fail "01: documenter launch script was not written"
grep -q "^aider " "$DOC_SCRIPT" || fail "01: expected documenter launch body to invoke aider, got: $(cat "$DOC_SCRIPT")"
grep -q -- "--model mistral/mistral-large-latest" "$DOC_SCRIPT" || fail "01: expected the configured model flag to reach aider's launch body"
grep -q "^claude " "$SPEC_SCRIPT" || fail "01: unconfigured role specifier must still default to claude, got: $(cat "$SPEC_SCRIPT")"
pass "01: agent=aider produces a non-claude launch body; unconfigured roles keep claude"

# ── 2: provider API keys are forwarded from this process's env into the
#      generated launch script for a non-claude agent, never hardcoded ────
ROOT2="$(mk_root)"
cat > "$ROOT2/swarmforge/swarmforge.conf" <<'CONF'
config active_backlog_max_depth -1
window documenter aider master --model mistral/mistral-large-latest
CONF
MISTRAL_API_KEY=test-secret-do-not-leak zsh -c "source '$SWARMFORGE_SH' '$ROOT2'; parse_config; $index_of_role_snippet write_role_launch_script \"\$(index_of_role documenter)\""
DOC_SCRIPT2="$ROOT2/.swarmforge/launch/documenter.sh"
grep -q "export MISTRAL_API_KEY='test-secret-do-not-leak'" "$DOC_SCRIPT2" || fail "02: expected MISTRAL_API_KEY to be forwarded into the launch script"
grep -q "export OPENAI_API_KEY" "$DOC_SCRIPT2" && fail "02: OPENAI_API_KEY must not appear when unset in the environment"
pass "02: a set provider key is forwarded into the alternate-runtime launch script; an unset one is not"

# ── 3: with no provider key in the environment, nothing is forwarded and the
#      repo/worktree gains no trace of it ──────────────────────────────────
ROOT3="$(mk_root)"
cat > "$ROOT3/swarmforge/swarmforge.conf" <<'CONF'
config active_backlog_max_depth -1
window documenter aider master --model mistral/mistral-large-latest
CONF
env -u MISTRAL_API_KEY -u OPENAI_API_KEY zsh -c "source '$SWARMFORGE_SH' '$ROOT3'; parse_config; $index_of_role_snippet write_role_launch_script \"\$(index_of_role documenter)\""
DOC_SCRIPT3="$ROOT3/.swarmforge/launch/documenter.sh"
grep -q "API_KEY" "$DOC_SCRIPT3" && fail "03: no provider API key line expected when neither is set, got: $(cat "$DOC_SCRIPT3")"
pass "03: no provider key set in env means no key line written to the launch script"

echo "ALL PASS"
