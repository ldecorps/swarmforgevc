#!/usr/bin/env bash
# BL-1052: a role seat can be staffed by qwen-code.
#
# qwen-code (npm @qwen-code/qwen-code, binary `qwen`) is Alibaba's own
# agentic CLI - Gemini-CLI-derived and genuinely shell-capable. The swarm's
# only pre-existing Qwen path drove the same MODELS through `aider`, a file
# editor that cannot execute, so a role staffed that way narrates
# ready_for_next.sh instead of running it (the live Mistral/aider incident).
# Capability entries describe the AGENT, not the model: these two share a
# model catalog, an endpoint and a key, and must never share a shape.
#
# Covers the scriptable substrate only - the capability entry, the launch
# adapter, the credential path, and the pack files. The ModelFactory
# provider->agent entry and Model Steward cost class are BL-1053; the live
# trial run is operational (see the ticket's qa_e2e_procedure).

set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp_cleanup.sh"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SWARMFORGE_SH="$SCRIPT_DIR/../swarmforge.sh"
SCRIPTS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
PACKS_DIR="$REPO_ROOT/swarmforge/packs"

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
  touch "$root/swarmforge/constitution.prompt"
  local role
  for role in specifier coder documenter; do
    echo "role prompt" > "$root/swarmforge/roles/$role.prompt"
  done
  echo "$root"
}

# A fake tmux that records every argv it is handed, so respawn-pane -e flags
# are observable without a real tmux server (BL-089 convention).
mk_fake_tmux() {
  local bin; bin="$(mktemp -d)"
  register_tmp_dir "$bin"
  cat > "$bin/tmux" <<'FAKETMUX'
#!/usr/bin/env bash
echo "$@" >> "$TMUX_LOG"
exit 0
FAKETMUX
  chmod +x "$bin/tmux"
  echo "$bin"
}

# Reads the RAW provider-capabilities map, never the normalize-agent-backed
# `capabilities` accessor: an agent with NO entry normalizes to "claude" and
# would report claude's own chat-message/embedded shape, so every assertion
# below would pass against the exact defect this ticket exists to close
# (the ticket's own required_wiring names this fall-through). Prints
# "ABSENT" when the agent has no entry of its own.
capability() {
  bb -e "
(load-file \"$SCRIPTS_DIR/prompt_engine_lib.bb\")
(if-let [caps (get prompt-engine-lib/provider-capabilities \"$1\")]
  (println (name (get caps $2)))
  (println \"ABSENT\"))
"
}

normalized_agent() {
  bb -e "
(load-file \"$SCRIPTS_DIR/prompt_engine_lib.bb\")
(println (prompt-engine-lib/normalize-agent \"$1\"))
"
}

# ── 01: qwen-code is registered as a shell-capable agent ──────────────────
# qwen-code-seat-01. Same shape as vibe/gemini, the other two entries that
# exist BECAUSE their agent really executes: chat wake, prompt embedded at
# launch. A missing entry is not inert - normalize-agent silently falls back
# to claude, so the adapter would compose the wrong agent's shape entirely.
[[ "$(normalized_agent qwen-code)" == "qwen-code" ]] \
  || fail "01: qwen-code is not a supported agent - it normalizes to $(normalized_agent qwen-code)"
[[ "$(capability qwen-code :wake-style)" == "chat-message" ]] \
  || fail "01: expected qwen-code wake style chat-message, got: $(capability qwen-code :wake-style)"
[[ "$(capability qwen-code :bootstrap-style)" == "embedded" ]] \
  || fail "01: expected qwen-code bootstrap style embedded, got: $(capability qwen-code :bootstrap-style)"
pass "01: qwen-code is registered chat-message/embedded in provider-capabilities"

# ── 02: the aider-based Qwen path keeps its own distinct shape ────────────
# qwen-code-seat-02. The whole point of the ticket: one entry per AGENT.
[[ "$(capability aider :wake-style)" == "shell-run-script" ]] \
  || fail "02: expected aider wake style shell-run-script, got: $(capability aider :wake-style)"
[[ "$(capability aider :bootstrap-style)" != "$(capability qwen-code :bootstrap-style)" ]] \
  || fail "02: aider and qwen-code must not share a bootstrap style"
pass "02: aider keeps shell-run-script/add-files-then-paste, distinct from qwen-code"

# ── 03: the launch command invokes the CLI in non-interactive exec mode ───
# qwen-code-seat-03/04. -y is what made the operator's smoke test actually
# RUN a shell command; without it the CLI refuses (and says so).
ROOT3="$(mk_root)"
cat > "$ROOT3/swarmforge/swarmforge.conf" <<'CONF'
config active_backlog_max_depth -1
window coder qwen-code coder --model qwen3.7-plus
CONF
zsh -c "source '$SWARMFORGE_SH' '$ROOT3'; parse_config; $index_of_role_snippet write_role_launch_script \"\$(index_of_role coder)\""
CODER3="$ROOT3/.swarmforge/launch/coder.sh"
[[ -f "$CODER3" ]] || fail "03: coder launch script was not written for agent qwen-code"
grep -qE '(^|[[:space:]])qwen ' "$CODER3" || fail "03: expected the launch body to invoke qwen, got: $(cat "$CODER3")"
grep -q -- "--auth-type openai" "$CODER3" || fail "03: expected --auth-type openai in the launch body"
grep -qE -- '(^|[[:space:]])-y([[:space:]]|$)' "$CODER3" || fail "03: expected -y (non-interactive execution) in the launch body"
grep -q -- "--model qwen3.7-plus" "$CODER3" || fail "03: expected the window line's model to reach the launch body"
grep -q "$ROOT3/.swarmforge/prompts/coder.md" "$CODER3" \
  || fail "04: expected the launch command to carry the role's bootstrap prompt, got: $(cat "$CODER3")"
grep -qi "obey every instruction" "$CODER3" \
  || fail "04: expected the launch command to instruct the agent to obey its bootstrap prompt"
pass "03/04: qwen launch body is --auth-type openai -y --model <m> and carries the role bootstrap prompt"

# ── 05a: QWEN_API_KEY reaches the pane through env, never the launch file ─
# qwen-code-seat-05. Same BL-130 posture every other provider seat has.
ROOT5="$(mk_root)"
cat > "$ROOT5/swarmforge/swarmforge.conf" <<'CONF'
config active_backlog_max_depth -1
window coder qwen-code coder --model qwen3.7-plus
CONF
FAKE5="$(mk_fake_tmux)"; LOG5="$FAKE5/tmux-calls.log"
QWEN_API_KEY=qwen-secret-do-not-leak \
env -u OPENAI_API_KEY -u BAILIAN_CODING_PLAN_API_KEY -u MISTRAL_API_KEY \
    -u CEREBRAS_API_KEY -u PERPLEXITY_API_KEY -u GEMINI_API_KEY -u SWARMFORGE_GEMINI_API_KEY \
PATH="$FAKE5:$PATH" TMUX_LOG="$LOG5" zsh -f -c "
  source '$SWARMFORGE_SH' '$ROOT5'
  parse_config
  $index_of_role_snippet
  choose_cleanup_owner
  launch_role \"\$(index_of_role coder)\"
"
CODER5="$ROOT5/.swarmforge/launch/coder.sh"
grep -q "qwen-secret-do-not-leak" "$CODER5" && fail "05a: QWEN_API_KEY value leaked into the launch script file"
# FORCED, not defaulted: the opt-in guard branch carries the same host inside
# a "${OPENAI_API_BASE:-...}" fallback, so grepping for the host alone passes
# even when ~/.zshenv's own OPENAI_BASE_URL would win at runtime.
grep -q "export OPENAI_BASE_URL=https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1" "$CODER5" \
  || fail "05a: expected the launch script to FORCE the Token Plan endpoint, not default to it: $(cat "$CODER5")"
grep -q -- "-e OPENAI_BASE_URL=https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1" "$LOG5" \
  || fail "05a: expected respawn-pane to carry the Token Plan endpoint; got: $(cat "$LOG5")"
grep -q -- "-e OPENAI_API_KEY=qwen-secret-do-not-leak" "$LOG5" \
  || fail "05a: expected the key to reach the pane via respawn-pane -e; got: $(cat "$LOG5")"
pass "05a: QWEN_API_KEY reaches the pane via -e and the Token Plan endpoint, never via the launch file"

# ── 05b: BAILIAN_CODING_PLAN_API_KEY is the same path, by fallback ────────
ROOT6="$(mk_root)"
cat > "$ROOT6/swarmforge/swarmforge.conf" <<'CONF'
config active_backlog_max_depth -1
window coder qwen-code coder --model qwen3.7-plus
CONF
FAKE6="$(mk_fake_tmux)"; LOG6="$FAKE6/tmux-calls.log"
BAILIAN_CODING_PLAN_API_KEY=bailian-secret-do-not-leak \
env -u QWEN_API_KEY -u OPENAI_API_KEY -u MISTRAL_API_KEY \
    -u CEREBRAS_API_KEY -u PERPLEXITY_API_KEY -u GEMINI_API_KEY -u SWARMFORGE_GEMINI_API_KEY \
PATH="$FAKE6:$PATH" TMUX_LOG="$LOG6" zsh -f -c "
  source '$SWARMFORGE_SH' '$ROOT6'
  parse_config
  $index_of_role_snippet
  choose_cleanup_owner
  launch_role \"\$(index_of_role coder)\"
"
CODER6="$ROOT6/.swarmforge/launch/coder.sh"
grep -q "bailian-secret-do-not-leak" "$CODER6" && fail "05b: BAILIAN_CODING_PLAN_API_KEY value leaked into the launch script file"
grep -q "export OPENAI_BASE_URL=https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1" "$CODER6" \
  || fail "05b: expected the launch script to FORCE the Token Plan endpoint, not default to it: $(cat "$CODER6")"
grep -q -- "-e OPENAI_API_KEY=bailian-secret-do-not-leak" "$LOG6" \
  || fail "05b: expected the BAILIAN fallback key to reach the pane via -e; got: $(cat "$LOG6")"
pass "05b: BAILIAN_CODING_PLAN_API_KEY falls back onto the same env-only path"

# ── 06: the new pack carries the terms-of-service caution ─────────────────
# qwen-code-seat-06. The intake asked for this verbatim rather than dropped:
# this ticket BUILDS the capability, it does not rule the Personal plan in.
PACK="$PACKS_DIR/qwen-code-mono-router.conf"
[[ -f "$PACK" ]] || fail "06: expected a new pack at $PACK"
grep -q "risk key revocation" "$PACK" || fail "06: expected the ToS caution ('risk key revocation') in the new pack"
grep -q "Personal" "$PACK" || fail "06: expected the ToS caution to name the Personal plan"
grep -qE '^window +[A-Za-z]+ +qwen-code ' "$PACK" || fail "06: expected the new pack to staff windows with agent qwen-code"
# The header names aider deliberately (it explains why the two packs are not
# interchangeable); what must never happen is a WINDOW staffed by it.
grep -qE '^window +[A-Za-z]+ +aider ' "$PACK" && fail "06: the new pack must not staff any window with aider"
grep -qE '^config coordinator_agent qwen-code$' "$PACK" || fail "06: expected the new pack's coordinator to be qwen-code"
grep -qE '^config coordinator_model ' "$PACK" || fail "06: a non-claude coordinator_agent pack must set coordinator_model (BL-530)"
grep -qE '^config rotation ' "$PACK" || fail "06: a non-claude coordinator_agent pack must set rotation (BL-530)"
pass "06: qwen-code-mono-router.conf staffs qwen-code windows and carries the ToS caution"

# ── 07: the existing aider-based pack is left alone ───────────────────────
# qwen-code-seat-07.
OLD_PACK="$PACKS_DIR/qwen-mono-router.conf"
[[ -f "$OLD_PACK" ]] || fail "07: expected the pre-existing pack at $OLD_PACK"
while IFS= read -r line; do
  [[ "$line" =~ ^window[[:space:]]+[A-Za-z]+[[:space:]]+aider[[:space:]] ]] \
    || fail "07: every window line in the pre-existing pack must still name aider, found: $line"
done < <(grep -E '^window ' "$OLD_PACK")
grep -q "qwen-code" "$OLD_PACK" && fail "07: the pre-existing aider pack must not be rewritten to qwen-code"
pass "07: qwen-mono-router.conf still names aider for every role window"

# ── 08: an unrecognised agent still fails loudly ──────────────────────────
# Guards the allow-list widening: adding qwen-code must not turn
# validate_agent into a passthrough that accepts anything.
ROOT8="$(mk_root)"
cat > "$ROOT8/swarmforge/swarmforge.conf" <<'CONF'
config active_backlog_max_depth -1
window coder qwen-codex coder --model qwen3.7-plus
CONF
if zsh -c "source '$SWARMFORGE_SH' '$ROOT8'; parse_config" >/dev/null 2>&1; then
  fail "08: parse_config accepted an unsupported agent 'qwen-codex'"
fi
pass "08: validate_agent still rejects an agent outside the allow-list"

# ── 09: the tmux server keeps only what a qwen-code seat actually reads ───
# BL-1049 fails SAFE for an unlisted backend - it keeps EVERY provider secret,
# so the new pack would leave live OpenAI/Mistral/Cerebras keys in the tmux
# server's global environment for all seven panes. A qwen-code seat reads the
# Token Plan credentials and nothing else, so it gets its own entry, exactly
# as gemini and vibe do.
SCRUB="$(bb -e "
(load-file \"$SCRIPTS_DIR/harness_env_scrub_lib.bb\")
(let [conf \"window coder qwen-code coder --model qwen3.7-plus\"]
  (doseq [v (sort (harness-env-scrub-lib/provider-scrub-vars
                    (harness-env-scrub-lib/config-backends conf)))]
    (println v)))
")"
echo "$SCRUB" | grep -qx "MISTRAL_API_KEY" \
  || fail "09: a qwen-code-only configuration must scrub MISTRAL_API_KEY, got: $SCRUB"
echo "$SCRUB" | grep -qx "CEREBRAS_API_KEY" \
  || fail "09: a qwen-code-only configuration must scrub CEREBRAS_API_KEY, got: $SCRUB"
echo "$SCRUB" | grep -qx "QWEN_API_KEY" \
  && fail "09: a qwen-code seat reads QWEN_API_KEY - scrubbing it would cut its credentials"
echo "$SCRUB" | grep -qx "BAILIAN_CODING_PLAN_API_KEY" \
  && fail "09: a qwen-code seat reads the BAILIAN fallback key - scrubbing it would cut its credentials"
echo "$SCRUB" | grep -qx "OPENAI_API_KEY" \
  && fail "09: a qwen-code seat reads the MAPPED OPENAI_API_KEY - scrubbing it would cut its credentials"
pass "09: a qwen-code configuration keeps the Token Plan credentials and scrubs the rest"

echo "ALL PASS"
