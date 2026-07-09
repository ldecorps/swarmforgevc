#!/usr/bin/env bash
# BL-130: per-role alternate agent runtime (pilot: documenter on aider/Mistral).
# Covers the scriptable substrate only: config parsing accepts a non-claude
# agent, the generated launch script targets that agent's CLI instead of
# claude, unconfigured roles keep defaulting to claude, and provider API keys
# reach the pane without ever being written to a file on disk.
#
# BL-130-VIOLATION (architect finding, 2026-07-06): an earlier version of
# this fix wrote `export MISTRAL_API_KEY='<value>'` directly into
# .swarmforge/launch/<role>.sh - a file under the target working directory,
# which the constitution's secrets rule bars regardless of it being
# gitignored/never committed. Tests 02/03/04 below guard against that
# regression: the launch script must never contain the secret, in any
# configuration.

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
grep -q -- "--message-file" "$DOC_SCRIPT" && fail "01: aider must stay in persistent chat mode, not one-shot --message-file"
grep -q "^claude " "$SPEC_SCRIPT" || fail "01: unconfigured role specifier must still default to claude, got: $(cat "$SPEC_SCRIPT")"
pass "01: agent=aider produces a non-claude launch body; unconfigured roles keep claude"

# ── 2: a set provider API key is NEVER written into the generated launch
#      script file, for any agent ──────────────────────────────────────────
ROOT2="$(mk_root)"
cat > "$ROOT2/swarmforge/swarmforge.conf" <<'CONF'
config active_backlog_max_depth -1
window documenter aider master --model mistral/mistral-large-latest
CONF
MISTRAL_API_KEY=test-secret-do-not-leak zsh -c "source '$SWARMFORGE_SH' '$ROOT2'; parse_config; $index_of_role_snippet write_role_launch_script \"\$(index_of_role documenter)\""
DOC_SCRIPT2="$ROOT2/.swarmforge/launch/documenter.sh"
grep -q "test-secret-do-not-leak" "$DOC_SCRIPT2" && fail "02: provider API key value leaked into the launch script file on disk"
grep -q "API_KEY" "$DOC_SCRIPT2" && fail "02: launch script must not reference a provider API key at all"
pass "02: a set provider key never lands in the generated launch script file"

# ── 3: with no provider key in the environment, nothing is forwarded and the
#      launch script has no trace of it ────────────────────────────────────
ROOT3="$(mk_root)"
cat > "$ROOT3/swarmforge/swarmforge.conf" <<'CONF'
config active_backlog_max_depth -1
window documenter aider master --model mistral/mistral-large-latest
CONF
env -u MISTRAL_API_KEY -u OPENAI_API_KEY zsh -c "source '$SWARMFORGE_SH' '$ROOT3'; parse_config; $index_of_role_snippet write_role_launch_script \"\$(index_of_role documenter)\""
DOC_SCRIPT3="$ROOT3/.swarmforge/launch/documenter.sh"
grep -q "API_KEY" "$DOC_SCRIPT3" && fail "03: no provider API key line expected when neither is set, got: $(cat "$DOC_SCRIPT3")"
pass "03: no provider key set in env means no key line written to the launch script"

# ── 4: the provider key instead reaches the pane via an ephemeral
#      respawn-pane -e flag, never touching disk ───────────────────────────
ROOT4="$(mk_root)"
cat > "$ROOT4/swarmforge/swarmforge.conf" <<'CONF'
config active_backlog_max_depth -1
window documenter aider master --model mistral/mistral-large-latest
CONF

FAKE_BIN="$(mktemp -d)"
TMUX_LOG="$FAKE_BIN/tmux-calls.log"
cat > "$FAKE_BIN/tmux" <<'FAKETMUX'
#!/usr/bin/env bash
echo "$@" >> "$TMUX_LOG"
case "$1" in
  -S)
    case "$3" in
      list-panes) exit 0 ;;
      respawn-pane) exit 0 ;;
      *) exit 0 ;;
    esac
    ;;
esac
exit 0
FAKETMUX
chmod +x "$FAKE_BIN/tmux"

MISTRAL_API_KEY=test-secret-do-not-leak PATH="$FAKE_BIN:$PATH" TMUX_LOG="$TMUX_LOG" zsh -c "
  source '$SWARMFORGE_SH' '$ROOT4'
  parse_config
  $index_of_role_snippet
  choose_cleanup_owner
  launch_role \"\$(index_of_role documenter)\"
"
grep -q -- "-e MISTRAL_API_KEY=test-secret-do-not-leak" "$TMUX_LOG" \
  || fail "04: expected respawn-pane to receive -e MISTRAL_API_KEY=<value>; got: $(cat "$TMUX_LOG")"
DOC_SCRIPT4="$ROOT4/.swarmforge/launch/documenter.sh"
grep -q "test-secret-do-not-leak" "$DOC_SCRIPT4" && fail "04: provider API key leaked into the launch script file despite the -e fix"
pass "04: provider key reaches the pane via respawn-pane -e, never written to the launch script file"

# ── 5: a claude role never gets a provider-key -e flag, even when a
#      provider key happens to be set in the environment ──────────────────
ROOT5="$(mk_root)"
cat > "$ROOT5/swarmforge/swarmforge.conf" <<'CONF'
config active_backlog_max_depth -1
window documenter claude master
CONF

FAKE_BIN5="$(mktemp -d)"
TMUX_LOG5="$FAKE_BIN5/tmux-calls.log"
cat > "$FAKE_BIN5/tmux" <<'FAKETMUX'
#!/usr/bin/env bash
echo "$@" >> "$TMUX_LOG"
exit 0
FAKETMUX
chmod +x "$FAKE_BIN5/tmux"

MISTRAL_API_KEY=test-secret-do-not-leak OPENAI_API_KEY=another-secret PATH="$FAKE_BIN5:$PATH" TMUX_LOG="$TMUX_LOG5" zsh -c "
  source '$SWARMFORGE_SH' '$ROOT5'
  parse_config
  $index_of_role_snippet
  choose_cleanup_owner
  launch_role \"\$(index_of_role documenter)\"
"
grep -q -- "-e " "$TMUX_LOG5" \
  && fail "05: a claude role's respawn-pane must never receive a provider-key -e flag; got: $(cat "$TMUX_LOG5")"
pass "05: a claude role's respawn-pane never receives a provider-key -e flag, even with provider keys set in env"

# ── 6: aider roles get an explicit bootstrap prompt (not bare Read-lines that
#      split into three tmux submissions and confuse weaker models) ───────
ROOT6="$(mk_root)"
PROMPT6="$ROOT6/.swarmforge/prompts/coder.md"
zsh -c "source '$SWARMFORGE_SH' '$ROOT6'; write_agent_instruction_file coder '$PROMPT6' aider"
grep -q "full repository read and write access" "$PROMPT6" \
  || fail "06: aider coder prompt must assert repo access, got: $(cat "$PROMPT6")"
grep -q "^Read swarmforge" "$PROMPT6" \
  && fail "06: aider prompt must not use bare Read-lines that tmux splits into separate turns"
zsh -c "source '$SWARMFORGE_SH' '$ROOT6'; write_agent_instruction_file coder '$PROMPT6' claude"
grep -q "^Read swarmforge/constitution.prompt" "$PROMPT6" \
  || fail "06: claude roles must keep the standard three-line bootstrap"
pass "06: aider roles get aider-specific bootstrap; claude roles keep Read-lines"

# ── 7: aider coordinator bootstrap forbids coding and notes two-pack routing ─
ROOT7="$(mk_root)"
echo "role prompt" > "$ROOT7/swarmforge/roles/coordinator.prompt"
echo "role prompt" > "$ROOT7/swarmforge/roles/coder.prompt"
echo "role prompt" > "$ROOT7/swarmforge/roles/cleaner.prompt"
mkdir -p "$ROOT7/swarmforge/packs"
cat > "$ROOT7/swarmforge/packs/two-pack-mistral.conf" <<CONF
config active_backlog_max_depth 1
window coordinator aider master --model mistral/mistral-large-latest
window coder aider master --model mistral/codestral-latest
window cleaner aider cleaner batch --model mistral/mistral-large-latest
CONF
PROMPT7="$ROOT7/.swarmforge/prompts/coordinator.md"
zsh -c "SWARMFORGE_CONFIG='$ROOT7/swarmforge/packs/two-pack-mistral.conf' source '$SWARMFORGE_SH' '$ROOT7'; write_agent_instruction_file coordinator '$PROMPT7' aider"
grep -q "ORCHESTRATOR ONLY" "$PROMPT7" \
  || fail "07: aider coordinator prompt must forbid coding, got: $(cat "$PROMPT7")"
grep -q "no specifier" "$PROMPT7" \
  || fail "07: two-pack coordinator prompt must note direct-to-coder routing"
grep -q "swarmforge/runtime/handoff-draft.txt" "$PROMPT7" \
  || fail "07: coordinator prompt must use runtime handoff draft path"
pass "07: aider coordinator gets orchestration-only two-pack bootstrap"

echo "ALL PASS"
