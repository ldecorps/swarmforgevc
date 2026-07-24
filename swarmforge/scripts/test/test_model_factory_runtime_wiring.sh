#!/usr/bin/env bash
# BL-563 Slice 1+2: a ModelFactory assignment overlay changes what launches.
# Pattern mirrors test_openrouter_provider_support.sh: source swarmforge.sh,
# parse_config + write_role_launch_script/write_agent_instruction_file directly
# against a fixture root - never a real tmux launch. Pure decision table is
# covered by model_factory_test_runner.bb; the CLI fs-adapter (resolve-model)
# by test_model_factory_cli.sh; this file covers the real swarmforge.sh call
# sites (write_claude_settings_file, write_agent_instruction_file) end to end.

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
window coder claude coder --model sonnet
window cleaner claude cleaner --model sonnet
window architect claude architect --model sonnet
window documenter claude documenter --model sonnet
CONF
}

write_router_conf() {
  local root="$1"
  cat > "$root/swarmforge/swarmforge.conf" <<'CONF'
config active_backlog_max_depth -1
config rotation router
window coder claude coder --model sonnet
window cleaner claude cleaner --model sonnet
window architect claude architect --model sonnet
window documenter claude documenter --model sonnet
CONF
}

write_overlay() {
  local root="$1"
  local role="$2"
  local model="$3"
  mkdir -p "$root/.swarmforge/model-factory"
  cat > "$root/.swarmforge/model-factory/assignment.json" <<JSON
{"$role": {"role": "$role", "agent": "claude", "provider": "anthropic", "model": "$model"}}
JSON
}

run_write_role_launch_script() {
  local root="$1"
  local role="$2"
  # MODEL_FACTORY_STATE_DIR: swarmforge.sh here is sourced from THIS repo's own
  # swarmforge/scripts (the fixture root has no copy of it - only the config/
  # prompt files a real target project's own checkout would carry), so
  # model_factory_cli.bb's own repo-root-derived default would read THIS
  # repo's real .swarmforge/model-factory/ instead of the fixture's. A real
  # launch never needs this override - the target project's own cloned
  # swarmforge/scripts IS what runs, so repo-root naturally lands on the
  # right root already; this only stands in for that coincidence in a fixture
  # that borrows the scripts without the rest of the tree.
  MODEL_FACTORY_STATE_DIR="$root/.swarmforge/model-factory" zsh -c "
    source '$SWARMFORGE_SH' '$root'
    parse_config
    $index_of_role_snippet
    write_role_launch_script \"\$(index_of_role $role)\" >/dev/null
  " 2>/dev/null
}

# launch_role's own body (real tmux session creation, pane-wait) is
# environmentally unsuitable for this suite (Design And Testability: live
# tmux/PTY interaction is the unsuitable boundary) - this replicates ONLY
# launch_role's two testable file-writing lines: the model-resolution +
# write_agent_instruction_file call the ticket's Slice 2 actually touches.
run_compose_step_of_launch_role() {
  local root="$1"
  local role="$2"
  MODEL_FACTORY_STATE_DIR="$root/.swarmforge/model-factory" zsh -c "
    source '$SWARMFORGE_SH' '$root'
    parse_config
    $index_of_role_snippet
    idx=\"\$(index_of_role $role)\"
    agent=\"\${AGENTS[\$idx]}\"
    resolved_model=\"\$(resolve_claude_model_for_index \"\$idx\")\"
    write_agent_instruction_file '$role' \"\$PROMPTS_DIR/${role}.md\" \"\$agent\" \"\$resolved_model\"
  "
}

# ── model-factory-runtime-wiring-01: overlay overrides the pack model ──────
ROOT1="$(mk_root)"
write_conf "$ROOT1"
write_overlay "$ROOT1" coder opus
run_write_role_launch_script "$ROOT1" coder
grep -q '"model": "opus"' "$ROOT1/.swarmforge/launch/coder.claude-settings.json" \
  || fail "01: expected overlay model 'opus' in coder settings, got: $(cat "$ROOT1/.swarmforge/launch/coder.claude-settings.json")"
pass "01: assignment overlay overrides the pack model for a named role"

# ── model-factory-runtime-wiring-02: no overlay -> byte-identical to pack-derived ─
ROOT2A="$(mk_root)"; write_conf "$ROOT2A"
ROOT2B="$(mk_root)"; write_conf "$ROOT2B"
write_overlay "$ROOT2B" coder opus
rm -f "$ROOT2B/.swarmforge/model-factory/assignment.json"
for role in coder cleaner architect documenter; do
  run_write_role_launch_script "$ROOT2A" "$role"
  run_write_role_launch_script "$ROOT2B" "$role"
  diff -q "$ROOT2A/.swarmforge/launch/${role}.claude-settings.json" "$ROOT2B/.swarmforge/launch/${role}.claude-settings.json" \
    || fail "02: settings for $role differ with no overlay present"
done
pass "02: with no overlay present, settings files are byte-identical to pack-derived output"

# ── model-factory-runtime-wiring-03: a broken overlay degrades, never aborts ─
for broken in malformed truncated empty; do
  ROOT3="$(mk_root)"
  write_conf "$ROOT3"
  mkdir -p "$ROOT3/.swarmforge/model-factory"
  case "$broken" in
    malformed) printf '{not valid json' > "$ROOT3/.swarmforge/model-factory/assignment.json" ;;
    truncated) printf '{"coder": {"model": "op' > "$ROOT3/.swarmforge/model-factory/assignment.json" ;;
    empty) : > "$ROOT3/.swarmforge/model-factory/assignment.json" ;;
  esac
  run_write_role_launch_script "$ROOT3" coder \
    || fail "03: settings-writing step must not abort on a $broken overlay"
  grep -q '"model": "sonnet"' "$ROOT3/.swarmforge/launch/coder.claude-settings.json" \
    || fail "03: expected pack-derived model 'sonnet' for a $broken overlay, got: $(cat "$ROOT3/.swarmforge/launch/coder.claude-settings.json")"
done
pass "03: a malformed/truncated/empty overlay degrades to pack-derived values without aborting"

# ── model-factory-runtime-wiring-04: overlay names only some roles ─────────
ROOT4="$(mk_root)"
write_conf "$ROOT4"
write_overlay "$ROOT4" coder opus
run_write_role_launch_script "$ROOT4" coder
run_write_role_launch_script "$ROOT4" cleaner
grep -q '"model": "opus"' "$ROOT4/.swarmforge/launch/coder.claude-settings.json" \
  || fail "04: coder should carry the overlay model"
grep -q '"model": "sonnet"' "$ROOT4/.swarmforge/launch/cleaner.claude-settings.json" \
  || fail "04: cleaner (not named by the overlay) should keep its pack-derived model"
pass "04: an overlay naming only some roles leaves unnamed roles on pack values"

# ── model-factory-runtime-wiring-06: the launch call site passes the ──────
# resolved model into prompt composition (Slice 2).
ROOT6="$(mk_root)"
write_conf "$ROOT6"
write_overlay "$ROOT6" coder opus
run_compose_step_of_launch_role "$ROOT6" coder
MD_FILE="$ROOT6/.swarmforge/prompts/coder.md.metadata.json"
[[ -f "$MD_FILE" ]] || fail "06: expected a compose-metadata sidecar at $MD_FILE"
grep -q '"model":"opus"' "$MD_FILE" \
  || fail "06: expected the compose invocation's metadata to record model 'opus', got: $(cat "$MD_FILE")"
pass "06: the launch call site passes the resolved model to compose; the composed artifact's metadata records it"

# ── model-factory-runtime-wiring-07: the `rotation router` dormant-role ────
# launch-artifact generation loop (BL-518) calls the SAME
# generate_dormant_role_launch_artifacts function the top-level
# `ROTATION_MODE == "router"` loop in swarmforge.sh calls, for every dormant
# role - reproducing the exact repeated-call pattern (same shell process,
# more than one iteration) that a top-level `local` used to leak as stray
# `dormant_resolved_model=<model>` stdout lines from the 2nd iteration
# onward (architect send-back #1, 2026-07-24). Pins that regression AND
# proves the overlay-resolved model still reaches both dormant-role
# artifacts (launch settings + composed prompt metadata) now that the loop
# body lives in a function instead of being inlined at file scope.
ROOT7="$(mk_root)"
write_router_conf "$ROOT7"
write_overlay "$ROOT7" architect opus
DORMANT_OUT="$ROOT7/.dormant_stdout.txt"
MODEL_FACTORY_STATE_DIR="$ROOT7/.swarmforge/model-factory" zsh -c "
  source '$SWARMFORGE_SH' '$ROOT7'
  parse_config
  $index_of_role_snippet
  for role in cleaner architect; do
    idx=\"\$(index_of_role \$role)\"
    generate_dormant_role_launch_artifacts \"\$idx\"
  done
" > "$DORMANT_OUT" 2>&1

grep -q 'dormant_resolved_model=' "$DORMANT_OUT" \
  && fail "07: dormant-role generation leaked 'dormant_resolved_model=' to stdout across repeated calls, got: $(cat "$DORMANT_OUT")"
pass "07: generating launch artifacts for multiple dormant roles in one process produces no stray stdout"

CLEANER_SETTINGS="$ROOT7/.swarmforge/launch/cleaner.claude-settings.json"
[[ -f "$CLEANER_SETTINGS" ]] || fail "07: expected a launch settings file for dormant role cleaner at $CLEANER_SETTINGS"
grep -q '"model": "sonnet"' "$CLEANER_SETTINGS" \
  || fail "07: expected cleaner (not named by the overlay) to keep its pack-derived model, got: $(cat "$CLEANER_SETTINGS")"

ARCHITECT_SETTINGS="$ROOT7/.swarmforge/launch/architect.claude-settings.json"
[[ -f "$ARCHITECT_SETTINGS" ]] || fail "07: expected a launch settings file for dormant role architect at $ARCHITECT_SETTINGS"
grep -q '"model": "opus"' "$ARCHITECT_SETTINGS" \
  || fail "07: expected the overlay model 'opus' in architect's dormant-generated settings, got: $(cat "$ARCHITECT_SETTINGS")"

ARCHITECT_MD_META="$ROOT7/.swarmforge/prompts/architect.md.metadata.json"
[[ -f "$ARCHITECT_MD_META" ]] || fail "07: expected a compose-metadata sidecar for dormant role architect at $ARCHITECT_MD_META"
grep -q '"model":"opus"' "$ARCHITECT_MD_META" \
  || fail "07: expected architect's composed-prompt metadata to record overlay model 'opus', got: $(cat "$ARCHITECT_MD_META")"

[[ -f "$ROOT7/.swarmforge/launch/cleaner.sh" ]] || fail "07: expected a pre-generated launch script for dormant role cleaner"
[[ -f "$ROOT7/.swarmforge/launch/architect.sh" ]] || fail "07: expected a pre-generated launch script for dormant role architect"
pass "07: dormant-role generation writes correct per-role settings, composed-prompt metadata, and launch script artifacts, overlay-resolved model included"

echo "ALL PASS"
