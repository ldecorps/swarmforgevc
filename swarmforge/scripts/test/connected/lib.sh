#!/usr/bin/env bash
# Shared helpers for connected SwarmForge tests (live tmux + real agents).

set -euo pipefail

CONNECTED_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$CONNECTED_LIB_DIR/../../../.." && pwd)"
PACKS_DIR="$CONNECTED_LIB_DIR/packs"
AGENT_RUNTIME="$REPO_ROOT/swarmforge/scripts/agent_runtime.sh"
SWARM_ATTACH="$REPO_ROOT/swarmforge/scripts/swarm_attach.sh"
SWARM_ENSURE_BB="$REPO_ROOT/swarmforge/scripts/swarm_ensure.bb"
ROUTE_BACKLOG="$REPO_ROOT/swarmforge/scripts/route_backlog_to_coder.sh"

CONNECTED_ROOT=""
CONNECTED_PROVIDER=""
CONNECTED_CONFIG=""
CONNECTED_AGENT=""
CONNECTED_SOCK=""

connected_fail() { echo "FAIL [$CONNECTED_PROVIDER]: $*" >&2; exit 1; }
connected_pass() { echo "PASS [$CONNECTED_PROVIDER]: $*"; }
connected_skip() { echo "SKIP [$CONNECTED_PROVIDER]: $*"; return 1; }

# Non-interactive shells (bash, zsh -lc) do not read ~/.zshrc. Pull export lines
# so provider keys stored there are visible to this bash harness.
connected_load_shell_env() {
  [[ -n "${MISTRAL_API_KEY:-}${ANTHROPIC_API_KEY:-}${OPENAI_API_KEY:-}" ]] && return 0
  [[ -f "${HOME}/.zshrc" ]] || return 0
  local line key
  while IFS= read -r line || [[ -n "$line" ]]; do
    case "$line" in
      export\ MISTRAL_API_KEY=*|export\ ANTHROPIC_API_KEY=*|export\ OPENAI_API_KEY=*)
        key="${line#export }"
        key="${key%%=*}"
        [[ -n "${!key:-}" ]] && continue
        eval "$line" 2>/dev/null || true
        ;;
    esac
  done < "${HOME}/.zshrc"
}

connected_provider_config() {
  case "$CONNECTED_PROVIDER" in
    mistral) echo "$PACKS_DIR/connected-two-pack-mistral.conf" ;;
    claude)  echo "$PACKS_DIR/connected-two-pack-claude.conf" ;;
    gpt)     echo "$PACKS_DIR/connected-two-pack-gpt.conf" ;;
    *) connected_fail "unknown provider: $CONNECTED_PROVIDER" ;;
  esac
}

connected_provider_agent() {
  case "$CONNECTED_PROVIDER" in
    mistral|gpt) echo "aider" ;;
    claude)      echo "claude" ;;
    *) connected_fail "unknown provider: $CONNECTED_PROVIDER" ;;
  esac
}

connected_provider_precheck() {
  case "$CONNECTED_PROVIDER" in
    mistral)
      command -v aider >/dev/null 2>&1 || { connected_skip "aider not installed"; return 1; }
      [[ -n "${MISTRAL_API_KEY:-}" ]] || { connected_skip "MISTRAL_API_KEY not set"; return 1; }
      ;;
    claude)
      command -v claude >/dev/null 2>&1 || { connected_skip "claude CLI not installed"; return 1; }
      [[ -n "${ANTHROPIC_API_KEY:-}" ]] || { connected_skip "ANTHROPIC_API_KEY not set"; return 1; }
      ;;
    gpt)
      command -v aider >/dev/null 2>&1 || { connected_skip "aider not installed"; return 1; }
      [[ -n "${OPENAI_API_KEY:-}" ]] || { connected_skip "OPENAI_API_KEY not set"; return 1; }
      ;;
  esac
  return 0
}

connected_setup_repo() {
  CONNECTED_ROOT="$(mktemp -d)"
  export CONNECTED_ROOT

  git init -q "$CONNECTED_ROOT"
  git -C "$CONNECTED_ROOT" config user.email "connected@test.local"
  git -C "$CONNECTED_ROOT" config user.name "connected-test"

  cp "$REPO_ROOT/swarm" "$CONNECTED_ROOT/"
  cp -R "$REPO_ROOT/swarmforge" "$CONNECTED_ROOT/"
  mkdir -p "$CONNECTED_ROOT/backlog/active" "$CONNECTED_ROOT/swarmforge/runtime"

  cat > "$CONNECTED_ROOT/backlog/active/BL-CONN-001-connected-route.yaml" <<'YAML'
id: BL-CONN-001
title: Connected test backlog routing item
assignedTo: coder
YAML

  git -C "$CONNECTED_ROOT" add -A
  git -C "$CONNECTED_ROOT" commit -q -m "init connected test repo"
  chmod +x "$CONNECTED_ROOT/swarmforge/scripts/connected_agent_probe.sh" 2>/dev/null || true
}

connected_teardown() {
  [[ -n "${CONNECTED_ROOT:-}" && -d "$CONNECTED_ROOT" ]] || return 0
  if [[ -f "$CONNECTED_ROOT/.swarmforge/tmux-socket" ]]; then
    local sock
    sock="$(<"$CONNECTED_ROOT/.swarmforge/tmux-socket")"
    if [[ -n "$sock" ]] && tmux -S "$sock" info >/dev/null 2>&1; then
      tmux -S "$sock" list-sessions -F '#{session_name}' 2>/dev/null \
        | while read -r session; do
            [[ -n "$session" ]] && tmux -S "$sock" kill-session -t "$session" 2>/dev/null || true
          done
    fi
  fi
  rm -rf "$CONNECTED_ROOT"
  CONNECTED_ROOT=""
  CONNECTED_SOCK=""
}

connected_read_socket() {
  [[ -f "$CONNECTED_ROOT/.swarmforge/tmux-socket" ]] \
    || connected_fail "tmux socket file missing after launch"
  CONNECTED_SOCK="$(<"$CONNECTED_ROOT/.swarmforge/tmux-socket")"
  tmux -S "$CONNECTED_SOCK" info >/dev/null 2>&1 \
    || connected_fail "tmux socket not live: $CONNECTED_SOCK"
}

connected_session_for_role() {
  local want="$1"
  local role session display
  while IFS=$'\t' read -r role _ _ session display _ _ _ _; do
    [[ -z "$role" ]] && continue
    if [[ "$role" == "$want" ]]; then
      echo "$session"
      return 0
    fi
  done < "$CONNECTED_ROOT/.swarmforge/roles.tsv"
  connected_fail "role not found in roles.tsv: $want"
}

connected_worktree_for_role() {
  local want="$1"
  local role wt
  while IFS=$'\t' read -r role _ wt _ _ _ _ _ _; do
    [[ -z "$role" ]] && continue
    if [[ "$role" == "$want" ]]; then
      echo "$wt"
      return 0
    fi
  done < "$CONNECTED_ROOT/.swarmforge/roles.tsv"
  connected_fail "role worktree not found: $want"
}

connected_inbox_new_dir() {
  local role="${1:-coder}"
  echo "$(connected_worktree_for_role "$role")/.swarmforge/handoffs/inbox/new"
}

connected_pane_target() {
  local want="$1"
  local role session display
  while IFS=$'\t' read -r role _ _ session display _ _ _ _; do
    [[ -z "$role" ]] && continue
    if [[ "$role" == "$want" ]]; then
      echo "${session}:${display}.0"
      return 0
    fi
  done < "$CONNECTED_ROOT/.swarmforge/roles.tsv"
  connected_fail "pane target not found for role: $want"
}

connected_wake_role() {
  local role="$1"
  local target agent inject
  target="$(connected_pane_target "$role")"
  agent="$(connected_provider_agent)"
  inject="$REPO_ROOT/swarmforge/scripts/agent_runtime_inject.bb"
  bb -e "(load-file \"$inject\") (agent-runtime-inject/notify-agent! \"$CONNECTED_SOCK\" \"$target\" \"$agent\")" \
    >/dev/null 2>&1 || true
}

connected_capture() {
  local session="$1"
  tmux -S "$CONNECTED_SOCK" capture-pane -p -t "$session" -S -200 2>/dev/null || true
}

connected_wait_pane() {
  local session="$1"
  local pattern="$2"
  local timeout="${3:-180}"
  local elapsed=0
  local pane=""
  while (( elapsed < timeout )); do
    pane="$(connected_capture "$session")"
    if echo "$pane" | grep -Eq "$pattern"; then
      return 0
    fi
    sleep 2
    elapsed=$((elapsed + 2))
  done
  connected_fail "timed out waiting for pane pattern /$pattern/ on $session; tail:\n${pane: -800}"
}

connected_launch_swarm() {
  CONNECTED_CONFIG="$(connected_provider_config)"
  CONNECTED_AGENT="$(connected_provider_agent)"

  (
    cd "$CONNECTED_ROOT"
    SWARMFORGE_TERMINAL=none \
    SWARMFORGE_SKIP_DAEMON=1 \
    SWARMFORGE_CONFIG="$CONNECTED_CONFIG" \
      ./swarm . >"$CONNECTED_ROOT/launch.log" 2>&1
  ) || connected_fail "swarm launch failed: $(tail -40 "$CONNECTED_ROOT/launch.log" 2>/dev/null)"

  connected_read_socket
}

connected_test_facade_cli() {
  local agent draft wake
  agent="$(connected_provider_agent)"
  draft="$("$AGENT_RUNTIME" handoff-draft-path "$agent")"
  [[ "$draft" == "swarmforge/runtime/handoff-draft.txt" ]] \
    || connected_fail "handoff-draft-path, got: $draft"

  wake="$("$AGENT_RUNTIME" wake-text "$agent")"
  case "$agent" in
    aider) [[ "$wake" == "! ./swarmforge/scripts/ready_for_next.sh" ]] \
      || connected_fail "aider wake-text, got: $wake" ;;
    claude) [[ "$wake" == *"handoff mail"* ]] \
      || connected_fail "claude wake-text, got: $wake" ;;
  esac

  "$AGENT_RUNTIME" bootstrap-text "$agent" coordinator 1 >"$CONNECTED_ROOT/bootstrap-coord.txt"
  case "$agent" in
    aider)
      grep -qE 'ORCHESTRATOR|swarm_handoff' "$CONNECTED_ROOT/bootstrap-coord.txt" \
        || connected_fail "aider coordinator bootstrap-text missing orchestration hints"
      ;;
    claude)
      grep -q 'route_backlog_to_coder' "$CONNECTED_ROOT/bootstrap-coord.txt" \
        || connected_fail "claude coordinator bootstrap-text missing route_backlog_to_coder hint"
      ;;
  esac

  connected_pass "facade CLI (handoff-draft-path, wake-text, bootstrap-text)"
}

connected_test_launch() {
  connected_launch_swarm

  local coord coder
  coord="$(connected_session_for_role coordinator)"
  coder="$(connected_session_for_role coder)"

  tmux -S "$CONNECTED_SOCK" has-session -t "$coord" 2>/dev/null \
    || connected_fail "coordinator session missing: $coord"
  tmux -S "$CONNECTED_SOCK" has-session -t "$coder" 2>/dev/null \
    || connected_fail "coder session missing: $coder"

  case "$CONNECTED_AGENT" in
    aider)
      connected_wait_pane "$coder" '(Aider|aider|> ?$)' 180
      connected_wait_pane "$coord" '(Aider|aider|> ?$)' 180
      ;;
    claude)
      connected_wait_pane "$coder" '(❯|Claude|handoff)' 180
      connected_wait_pane "$coord" '(❯|Claude|handoff)' 180
      ;;
  esac

  connected_pass "swarm launch + agent panes ready"
}

connected_test_sync_handoff() {
  local coder draft out
  coder="$(connected_session_for_role coder)"
  draft="$CONNECTED_ROOT/swarmforge/runtime/handoff-draft.txt"

  cat > "$draft" <<'EOF'
type: note
to: coder
priority: 50
message: connected sync deliver test
EOF

  out="$(
    cd "$CONNECTED_ROOT"
    export SWARMFORGE_ROLE=coordinator
    export SWARMFORGE_SKIP_DAEMON=1
    ./swarmforge/scripts/swarm_handoff.sh "$draft" 2>&1
  )"

  echo "$out" | grep -q "HANDOFF DELIVERED:" \
    || connected_fail "swarm_handoff sync deliver failed: $out"

  find "$(connected_inbox_new_dir coder)" -name '*_for_coder.handoff' -print -quit \
    | grep -q . || connected_fail "parcel missing from coder inbox/new ($(connected_inbox_new_dir coder))"

  grep -q 'outcome=ok' "$CONNECTED_ROOT/.swarmforge/handoffs/inject-traffic.log" 2>/dev/null \
    || connected_fail "inject-traffic.log missing outcome=ok for sync deliver"

  case "$CONNECTED_AGENT" in
    aider)
      connected_wait_pane "$coder" '(ready_for_next|inbox|handoff|MOCK_WAKE|! ./)' 60
      ;;
    claude)
      connected_wait_pane "$coder" '(handoff mail|ready_for_next|inbox)' 60
      ;;
  esac

  connected_pass "swarm_handoff sync deliver + wake"
}

connected_test_route_backlog() {
  local out
  out="$(
    cd "$CONNECTED_ROOT"
    export SWARMFORGE_SKIP_DAEMON=1
    "$ROUTE_BACKLOG" BL-CONN-001 "$CONNECTED_ROOT" 2>&1
  )"

  echo "$out" | grep -q "HANDOFF DELIVERED:" \
    || connected_fail "route_backlog_to_coder failed: $out"

  grep -rl 'BL-CONN-001' "$(connected_inbox_new_dir coder)/" 2>/dev/null | grep -q . \
    || connected_fail "routed backlog parcel missing from coder inbox"

  connected_pass "route_backlog_to_coder"
}

connected_test_agent_executes_probe() {
  [[ "${CONNECTED_TRANSPORT_ONLY:-0}" == "1" ]] && {
    connected_pass "agent behavioral probe (skipped: CONNECTED_TRANSPORT_ONLY=1)"
    return 0
  }

  local marker draft out probe_msg elapsed=0 timeout=180 pane
  marker="$CONNECTED_ROOT/swarmforge/runtime/connected-probe.ok"
  draft="$CONNECTED_ROOT/swarmforge/runtime/handoff-draft.txt"
  rm -f "$marker"

  case "$CONNECTED_AGENT" in
    aider) probe_msg='Run ! ./swarmforge/scripts/connected_agent_probe.sh now.' ;;
    claude) probe_msg='Run ./swarmforge/scripts/connected_agent_probe.sh from repo root.' ;;
    *) connected_fail "unknown agent for probe: $CONNECTED_AGENT" ;;
  esac

  cat > "$draft" <<EOF
type: note
to: coder
priority: 99
message: ${probe_msg}
EOF

  out="$(
    cd "$CONNECTED_ROOT"
    export SWARMFORGE_ROLE=coordinator
    export SWARMFORGE_SKIP_DAEMON=1
    ./swarmforge/scripts/swarm_handoff.sh "$draft" 2>&1
  )"
  echo "$out" | grep -q "HANDOFF DELIVERED:" \
    || connected_fail "probe handoff deliver failed: $out"

  tail -1 "$CONNECTED_ROOT/.swarmforge/handoffs/inject-traffic.log" 2>/dev/null | grep -q 'outcome=ok' \
    || connected_fail "probe handoff wake did not log outcome=ok"

  while (( elapsed < timeout )); do
    [[ -f "$marker" ]] && break
    connected_wake_role coder
    sleep 15
    elapsed=$((elapsed + 15))
  done

  if [[ ! -f "$marker" ]]; then
    pane="$(connected_capture "$(connected_session_for_role coder)" | tail -20)"
    connected_fail "agent did not execute connected_agent_probe.sh within ${timeout}s — expected ${marker}; pane tail:${pane}"
  fi

  grep -q 'connected-probe' "$marker" \
    || connected_fail "probe marker malformed: $(cat "$marker")"

  connected_pass "agent executes swarm probe script (behavioral)"
}

connected_test_attach_resolves() {
  local session=""
  while IFS=$'\t' read -r role _ _ sess _ _ _ _ _; do
    [[ "$role" == "coder" ]] && session="$sess" && break
  done < "$CONNECTED_ROOT/.swarmforge/roles.tsv"

  [[ -n "$session" ]] || connected_fail "attach could not resolve coder session"
  tmux -S "$CONNECTED_SOCK" has-session -t "$session" 2>/dev/null \
    || connected_fail "attach target session not live: $session"

  connected_pass "attach session resolution (coder)"
}

connected_test_ensure_smoke() {
  local out
  out="$(bb "$SWARM_ENSURE_BB" "$CONNECTED_ROOT" 2>&1)" || true
  echo "$out" | grep -qiE 'ensure|pane|daemon|ok|fixed|healthy|skip' \
    || connected_fail "swarm ensure returned unexpected output: $out"
  connected_pass "swarm ensure smoke"
}

connected_run_provider_suite() {
  CONNECTED_PROVIDER="$1"
  connected_load_shell_env
  if ! connected_provider_precheck; then
    return 0
  fi
  CONNECTED_CONFIG="$(connected_provider_config)"
  CONNECTED_AGENT="$(connected_provider_agent)"

  trap connected_teardown EXIT
  connected_setup_repo

  echo ""
  echo "=== Connected suite: $CONNECTED_PROVIDER ($CONNECTED_AGENT) ==="

  connected_test_facade_cli
  connected_test_launch
  connected_test_sync_handoff
  connected_test_route_backlog
  connected_test_agent_executes_probe
  connected_test_attach_resolves
  connected_test_ensure_smoke

  connected_teardown
  trap - EXIT
  echo "ALL PASS [$CONNECTED_PROVIDER]"
}
