#!/usr/bin/env bash
# BL-1052: a role seat can be staffed by a downloaded local model.
#
# The agent key is `local-model` (never folded into aider or codex). Its
# capability shape matches vibe/gemini — chat wake, embedded bootstrap —
# because the seat really executes shell commands. The aider-based
# qwen-mono-router pack shares models with this path and must keep a
# distinct shape. Launch targets a loopback OpenAI-compatible endpoint
# (BL-1082's serve), refuses when that endpoint is not ready, and never
# writes a credential into a launch file.
#
# Covers the scriptable substrate only. ModelFactory routing is BL-1053;
# pull/serve is BL-1082; the live trial run is operational
# (ticket qa_e2e_procedure).

set -euo pipefail

# BL-1318: this test exercises parse_config's OTHER behavior (not model
# staffing) - bypass the steward staffing gate so a fixture's placeholder
# --model value ("x", etc.) does not trip an unrelated refusal.
export PACK_STAFFING_SKIP_GATE=1
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

# ── 01: local-model is registered as a shell-capable agent ────────────────
[[ "$(normalized_agent local-model)" == "local-model" ]] \
  || fail "01: local-model is not a supported agent - it normalizes to $(normalized_agent local-model)"
[[ "$(capability local-model :wake-style)" == "chat-message" ]] \
  || fail "01: expected local-model wake style chat-message, got: $(capability local-model :wake-style)"
[[ "$(capability local-model :bootstrap-style)" == "embedded" ]] \
  || fail "01: expected local-model bootstrap style embedded, got: $(capability local-model :bootstrap-style)"
pass "01: local-model is registered chat-message/embedded in provider-capabilities"

# ── 02: the aider-based path keeps its own distinct shape ─────────────────
[[ "$(capability aider :wake-style)" == "shell-run-script" ]] \
  || fail "02: expected aider wake style shell-run-script, got: $(capability aider :wake-style)"
[[ "$(capability aider :bootstrap-style)" != "$(capability local-model :bootstrap-style)" ]] \
  || fail "02: aider and local-model must not share a bootstrap style"
pass "02: aider keeps shell-run-script/add-files-then-paste, distinct from local-model"

# ── 03/04: launch targets loopback, selects model, carries prompt, -y ─────
ROOT3="$(mk_root)"
cat > "$ROOT3/swarmforge/swarmforge.conf" <<'CONF'
config active_backlog_max_depth -1
window coder local-model coder --model qwen2.5-coder:7b-instruct
CONF
SWARMFORGE_LOCAL_MODEL_ENDPOINT_STATUS=healthy \
zsh -c "source '$SWARMFORGE_SH' '$ROOT3'; parse_config; $index_of_role_snippet write_role_launch_script \"\$(index_of_role coder)\""
CODER3="$ROOT3/.swarmforge/launch/coder.sh"
[[ -f "$CODER3" ]] || fail "03: coder launch script was not written for agent local-model"
grep -qE '127\.0\.0\.1|localhost' "$CODER3" \
  || fail "03: expected the launch body to target a loopback endpoint, got: $(cat "$CODER3")"
grep -qE -- '--model qwen2\.5-coder:7b-instruct' "$CODER3" \
  || fail "03: expected the window line's model to reach the launch body"
grep -qE '(^|[[:space:]])-y([[:space:]]|$)' "$CODER3" \
  || fail "03: expected -y (non-interactive execution) in the launch body"
grep -q "$ROOT3/.swarmforge/prompts/coder.md" "$CODER3" \
  || fail "04: expected the launch command to carry the role's bootstrap prompt"
grep -qi "obey every instruction" "$CODER3" \
  || fail "04: expected the launch command to instruct the agent to obey its bootstrap prompt"
pass "03/04: local-model launch targets loopback, selects model, -y, carries bootstrap prompt"

# Second model id — same launch branch, only the window-line model changes.
ROOT3b="$(mk_root)"
cat > "$ROOT3b/swarmforge/swarmforge.conf" <<'CONF'
config active_backlog_max_depth -1
window coder local-model coder --model llama3.1:8b
CONF
SWARMFORGE_LOCAL_MODEL_ENDPOINT_STATUS=healthy \
zsh -c "source '$SWARMFORGE_SH' '$ROOT3b'; parse_config; $index_of_role_snippet write_role_launch_script \"\$(index_of_role coder)\""
CODER3b="$ROOT3b/.swarmforge/launch/coder.sh"
grep -qE -- '--model llama3\.1:8b' "$CODER3b" \
  || fail "03b: expected llama3.1:8b on the same local-model launch path"
pass "03b: a second model id needs only the window line"

# ── 05: credential value never reaches the launch file ────────────────────
ROOT5="$(mk_root)"
cat > "$ROOT5/swarmforge/swarmforge.conf" <<'CONF'
config active_backlog_max_depth -1
window coder local-model coder --model qwen2.5-coder:7b-instruct
CONF
FAKE5="$(mk_fake_tmux)"; LOG5="$FAKE5/tmux-calls.log"
OPENAI_API_KEY=local-model-credential-must-never-reach-a-file \
SWARMFORGE_LOCAL_MODEL_ENDPOINT_STATUS=healthy \
env -u QWEN_API_KEY -u BAILIAN_CODING_PLAN_API_KEY -u MISTRAL_API_KEY \
    -u CEREBRAS_API_KEY -u PERPLEXITY_API_KEY -u GEMINI_API_KEY -u SWARMFORGE_GEMINI_API_KEY \
PATH="$FAKE5:$PATH" TMUX_LOG="$LOG5" zsh -f -c "
  source '$SWARMFORGE_SH' '$ROOT5'
  parse_config
  $index_of_role_snippet
  choose_cleanup_owner
  launch_role \"\$(index_of_role coder)\"
"
CODER5="$ROOT5/.swarmforge/launch/coder.sh"
grep -q "local-model-credential-must-never-reach-a-file" "$CODER5" \
  && fail "05: OPENAI_API_KEY value leaked into the launch script file"
grep -qE '127\.0\.0\.1|localhost' "$CODER5" \
  || fail "05: expected the launch script to force a loopback OpenAI-compat endpoint"
pass "05: local endpoint credential reaches the pane via env, never the launch file"

# ── 06: refuse when the local endpoint is not ready ───────────────────────
ROOT6="$(mk_root)"
cat > "$ROOT6/swarmforge/swarmforge.conf" <<'CONF'
config active_backlog_max_depth -1
window coder local-model coder --model qwen2.5-coder:7b-instruct
CONF
FAKE6="$(mk_fake_tmux)"; LOG6="$FAKE6/tmux-calls.log"
set +e
REFUSAL6="$(
  SWARMFORGE_LOCAL_MODEL_ENDPOINT_STATUS=missing \
  SWARMFORGE_LOCAL_MODEL_ENDPOINT_URL=http://127.0.0.1:11434/v1 \
  PATH="$FAKE6:$PATH" TMUX_LOG="$LOG6" zsh -f -c "
    source '$SWARMFORGE_SH' '$ROOT6'
    parse_config
    $index_of_role_snippet
    choose_cleanup_owner
    launch_role \"\$(index_of_role coder)\"
  " 2>&1
)"
RC6=$?
set -e
[[ "$RC6" -ne 0 ]] || fail "06: launch_role should refuse when the endpoint is not ready"
echo "$REFUSAL6" | grep -qE '127\.0\.0\.1:11434' \
  || fail "06: refusal must name the endpoint that was not ready, got: $REFUSAL6"
[[ -s "$LOG6" ]] && grep -q 'respawn-pane' "$LOG6" \
  && fail "06: refused launch must not respawn a pane"
pass "06: launch refuses when the local endpoint is not ready and names it"

# ── 07: new pack staffs every window with local-model, no cloud key prereq ─
PACK="$PACKS_DIR/local-model-mono-router.conf"
[[ -f "$PACK" ]] || fail "07: expected a new pack at $PACK"
while IFS= read -r line; do
  [[ "$line" =~ ^window[[:space:]]+[A-Za-z]+[[:space:]]+local-model[[:space:]] ]] \
    || fail "07: every window line must name agent local-model, found: $line"
done < <(grep -E '^window ' "$PACK")
grep -qiE 'OPENAI_API_KEY|ANTHROPIC|MISTRAL_API_KEY|QWEN_API_KEY|BAILIAN|GEMINI_API_KEY|CURSOR_API_KEY' "$PACK" \
  && fail "07: the local-model pack must not require a cloud provider API key"
grep -qE '^config coordinator_agent local-model$' "$PACK" \
  || fail "07: expected coordinator_agent local-model"
grep -qE '^config coordinator_model ' "$PACK" \
  || fail "07: a non-claude coordinator_agent pack must set coordinator_model (BL-530)"
grep -qE '^config rotation ' "$PACK" \
  || fail "07: a non-claude coordinator_agent pack must set rotation (BL-530)"
pass "07: local-model-mono-router.conf staffs local-model windows and needs no cloud key"

# ── 08: existing aider-based Qwen pack is left alone ──────────────────────
OLD_PACK="$PACKS_DIR/qwen-mono-router.conf"
[[ -f "$OLD_PACK" ]] || fail "08: expected the pre-existing pack at $OLD_PACK"
while IFS= read -r line; do
  [[ "$line" =~ ^window[[:space:]]+[A-Za-z]+[[:space:]]+aider[[:space:]] ]] \
    || fail "08: every window line in the pre-existing pack must still name aider, found: $line"
done < <(grep -E '^window ' "$OLD_PACK")
grep -q "local-model" "$OLD_PACK" && fail "08: the pre-existing aider pack must not be rewritten to local-model"
pass "08: qwen-mono-router.conf still names aider for every role window"

# ── 09: validate_agent still rejects unknowns ─────────────────────────────
ROOT9="$(mk_root)"
cat > "$ROOT9/swarmforge/swarmforge.conf" <<'CONF'
config active_backlog_max_depth -1
window coder local-models coder --model qwen2.5-coder:7b-instruct
CONF
if zsh -c "source '$SWARMFORGE_SH' '$ROOT9'; parse_config" >/dev/null 2>&1; then
  fail "09: parse_config accepted an unsupported agent 'local-models'"
fi
pass "09: validate_agent still rejects an agent outside the allow-list"

# ── 10: harness scrub keeps optional local OPENAI_API_KEY, scrubs cloud ───
SCRUB="$(bb -e "
(load-file \"$SCRIPTS_DIR/harness_env_scrub_lib.bb\")
(let [conf \"window coder local-model coder --model qwen2.5-coder:7b-instruct\"]
  (doseq [v (sort (harness-env-scrub-lib/provider-scrub-vars
                    (harness-env-scrub-lib/config-backends conf)))]
    (println v)))
")"
echo "$SCRUB" | grep -qx "MISTRAL_API_KEY" \
  || fail "10: a local-model-only configuration must scrub MISTRAL_API_KEY, got: $SCRUB"
echo "$SCRUB" | grep -qx "QWEN_API_KEY" \
  || fail "10: a local-model-only configuration must scrub QWEN_API_KEY, got: $SCRUB"
echo "$SCRUB" | grep -qx "OPENAI_API_KEY" \
  && fail "10: a local-model seat may read OPENAI_API_KEY for the OpenAI-compat client - scrubbing it would cut credentials"
pass "10: a local-model configuration keeps OPENAI_API_KEY and scrubs cloud keys"

echo "ALL PASS"
