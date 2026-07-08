#!/usr/bin/env zsh
set -euo pipefail

SESSION_PREFIX="swarmforge"
AGENT_WINDOW="swarm"
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# BL-145: `./swarm ensure <path>` checks/repairs the extension host, every
# configured agent pane, and the daemon in one idempotent command, then
# exits - it never falls into the full (destructive, always-relaunch) launch
# flow below.
if [[ "${1:-}" == "ensure" ]]; then
  shift
  ENSURE_WORKING_DIR="${1:-$PWD}"
  ENSURE_WORKING_DIR="$(cd "$ENSURE_WORKING_DIR" && pwd)"
  exec bb "$SCRIPT_DIR/swarm_ensure.bb" "$ENSURE_WORKING_DIR"
fi

if [[ "${1:-}" == "attach" ]]; then
  shift
  exec "$SCRIPT_DIR/swarm_attach.sh" "$@"
fi

WORKING_DIR="${1:-$PWD}"
WORKING_DIR="$(cd "$WORKING_DIR" && pwd)"
SWARM_FORGE_DIR="$WORKING_DIR/swarmforge"
CONFIG_FILE="${SWARMFORGE_CONFIG:-$SWARM_FORGE_DIR/swarmforge.conf}"
for (( idx = 2; idx <= $#; idx++ )); do
  if [[ "${!idx}" == "--pack" ]]; then
    next=$((idx + 1))
    if [[ $next -le $# ]]; then
      CONFIG_FILE="$SWARM_FORGE_DIR/packs/${!next}.conf"
    fi
    break
  fi
done
WORKTREES_DIR="$WORKING_DIR/.worktrees"
ROLES_DIR="$SWARM_FORGE_DIR/roles"
CONSTITUTION_FILE="$SWARM_FORGE_DIR/constitution.prompt"
STATE_DIR="$WORKING_DIR/.swarmforge"
NOTIFY_DIR="$STATE_DIR/notify"
WINDOW_IDS_FILE="$STATE_DIR/window-ids"
WINDOW_STATE_FILE="$STATE_DIR/windows.tsv"
WINDOW_WATCHDOG_LOG="$STATE_DIR/window-watchdog.log"
SESSIONS_FILE="$STATE_DIR/sessions.tsv"
ROLES_FILE="$STATE_DIR/roles.tsv"
PROMPTS_DIR="$STATE_DIR/prompts"
DAEMON_DIR="$STATE_DIR/daemon"
HANDOFF_DAEMON_LOG="$DAEMON_DIR/handoffd.log"
TMUX_SOCKET_DIR="/private/tmp/swarmforge-${UID}"
PROJECT_SOCKET_ID="$(printf '%s' "$WORKING_DIR" | cksum)"
PROJECT_SOCKET_ID="${PROJECT_SOCKET_ID%% *}"
TMUX_SOCKET="$TMUX_SOCKET_DIR/$PROJECT_SOCKET_ID.sock"
TMUX_SOCKET_FILE="$STATE_DIR/tmux-socket"
TMUX_ENV_FILE="$STATE_DIR/tmux-env"
TERMINAL_BACKEND=""

typeset -a ROLES=()
typeset -a AGENTS=()
typeset -a SESSIONS=()
typeset -a DISPLAY_NAMES=()
typeset -a WORKTREE_NAMES=()
typeset -a WORKTREE_PATHS=()
typeset -a RECEIVE_MODES=()
typeset -a IDLE_CLEAR_FLAGS=()
# BL-090: multi-swarm identity. SWARM_NAME defaults to "primary" so an
# existing single-swarm swarmforge.conf (no swarm_name/swarm_mode lines) is
# untouched - it is, by definition, THE primary swarm. SWARM_MODE_PRIMARY is
# only meaningful when SWARM_MODE=secondary (names the primary it defers to).
SWARM_NAME="primary"
SWARM_MODE="autonomous"
SWARM_MODE_PRIMARY=""
REMOTE_CONTROL_DEFAULT=1
if [[ "${SWARMFORGE_REMOTE_CONTROL:-}" == "0" ]]; then
  REMOTE_CONTROL_DEFAULT=0
fi
typeset -a EXTRA_CLI_ARGS=()
typeset -A ROLE_INDEX=()
typeset -A WORKTREE_INDEX=()
typeset -i CLEANUP_OWNER_INDEX=1
typeset -i TMUX_WINDOW_BASE_INDEX=0
typeset -i TMUX_PANE_BASE_INDEX=0
typeset -i i=0

check_dependency() {
  if ! command -v "$1" &>/dev/null; then
    echo -e "${RED}Error:${RESET} '$1' is required but not installed."
    exit 1
  fi
}

get_tmux_option() {
  local option="$1"
  local scope="$2"
  local default_value="$3"
  local value=""

  case "$scope" in
    session)
      value="$(tmux -S "$TMUX_SOCKET" show-options -gqv "$option" 2>/dev/null || true)"
      ;;
    window)
      value="$(tmux -S "$TMUX_SOCKET" show-window-options -gqv "$option" 2>/dev/null || true)"
      ;;
  esac

  if [[ "$value" == <-> ]]; then
    echo "$value"
  else
    echo "$default_value"
  fi
}

detect_tmux_base_indexes() {
  local probe_session=""

  mkdir -p "$TMUX_SOCKET_DIR"
  if ! tmux -S "$TMUX_SOCKET" info >/dev/null 2>&1; then
    probe_session="swarmforge-probe-$$"
    tmux -S "$TMUX_SOCKET" new-session -d -s "$probe_session" "sleep 60" >/dev/null
  fi

  TMUX_WINDOW_BASE_INDEX="$(get_tmux_option base-index session 0)"
  TMUX_PANE_BASE_INDEX="$(get_tmux_option pane-base-index window 0)"

  if [[ -n "$probe_session" ]]; then
    tmux -S "$TMUX_SOCKET" kill-session -t "$probe_session" >/dev/null 2>&1 || true
  fi
}

tmux_agent_target() {
  local session="$1"
  local window="$2"

  echo "${session}:${window}.${TMUX_PANE_BASE_INDEX}"
}

tmux_agent_target_for_session() {
  local session="$1"
  local window_index

  window_index="$(tmux -S "$TMUX_SOCKET" list-windows -t "$session" -F '#{window_index}' 2>/dev/null | head -1)"
  if [[ -z "$window_index" ]]; then
    window_index="$TMUX_WINDOW_BASE_INDEX"
  fi

  echo "${session}:${window_index}.${TMUX_PANE_BASE_INDEX}"
}

ensure_initial_gitignore() {
  local gitignore_file="$WORKING_DIR/.gitignore"

  if [[ ! -f "$gitignore_file" ]]; then
    cat > "$gitignore_file" <<'EOF'
.swarmforge/
.worktrees/
EOF
    return
  fi

  if ! grep -qx '.swarmforge/' "$gitignore_file"; then
    echo '.swarmforge/' >> "$gitignore_file"
  fi

  if ! grep -qx '.worktrees/' "$gitignore_file"; then
    echo '.worktrees/' >> "$gitignore_file"
  fi

}

ensure_runtime_git_excludes() {
  local exclude_file
  exclude_file="$(git -C "$WORKING_DIR" rev-parse --git-path info/exclude)"
  mkdir -p "${exclude_file:h}"
  touch "$exclude_file"

  local pattern
  for pattern in ".swarmforge/" ".worktrees/"; do
    if ! grep -qx "$pattern" "$exclude_file"; then
      echo "$pattern" >> "$exclude_file"
    fi
  done
}

# BL-105: installs the shared commit-size guard (swarmforge/git-hooks/
# pre-commit) repo-wide via core.hooksPath. core.hooksPath lives in the
# single physical .git/config shared by every linked worktree, so setting
# it once here covers every role's commits, including the specifier's
# merge/push. Idempotent - safe to re-run on every launch.
ensure_commit_size_guard() {
  git -C "$WORKING_DIR" config core.hooksPath swarmforge/git-hooks
}

initialize_git_repo() {
  if [[ -d "$WORKING_DIR/.git" ]]; then
    return
  fi

  git init "$WORKING_DIR" >/dev/null
  git -C "$WORKING_DIR" branch -M master >/dev/null
  ensure_initial_gitignore
  git -C "$WORKING_DIR" add .
  git -C "$WORKING_DIR" commit -m "Initial swarmforge repository" >/dev/null
}

has_command() {
  command -v "$1" &>/dev/null
}

source "$SCRIPT_DIR/swarm-terminal-adapter.sh"

display_name_for_role() {
  local role="$1"
  local normalized="${role//[-_]/ }"
  local -a parts
  local part
  local label=""

  parts=(${=normalized})
  for part in "${parts[@]}"; do
    part="${(C)part}"
    if [[ -n "$label" ]]; then
      label+=" "
    fi
    label+="$part"
  done

  echo "$label"
}

remote_control_session_name_for_role() {
  local role="$1"
  if [[ "$role" == "QA" ]]; then
    echo "SwarmForge-QA"
  else
    echo "SwarmForge-$(display_name_for_role "$role")"
  fi
}

session_name_for_role() {
  echo "${SESSION_PREFIX}-$1"
}

worktree_path_for_name() {
  echo "$WORKTREES_DIR/$1"
}

parse_config() {
  if [[ ! -f "$CONFIG_FILE" ]]; then
    echo -e "${RED}Error:${RESET} Config not found at $CONFIG_FILE"
    exit 1
  fi

  if [[ ! -f "$CONSTITUTION_FILE" ]]; then
    echo -e "${RED}Error:${RESET} Constitution prompt not found at $CONSTITUTION_FILE"
    exit 1
  fi

  local line keyword role agent worktree receive_mode line_no=0
  while IFS= read -r line || [[ -n "$line" ]]; do
    line_no=$((line_no + 1))
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    [[ -z "$line" || "${line[1]}" == "#" ]] && continue

    local -a fields extra_args
    fields=(${=line})
    if (( ${#fields[@]} < 2 )); then
      echo -e "${RED}Error:${RESET} Invalid config line $line_no: $line"
      exit 1
    fi

    keyword="${fields[1]}"

    if [[ "$keyword" == "config" ]]; then
      if (( ${#fields[@]} < 3 )); then
        echo -e "${RED}Error:${RESET} Invalid config line $line_no: $line"
        exit 1
      fi
      case "${fields[2]}" in
        swarm_name)
          if [[ -z "${fields[3]:-}" ]]; then
            echo -e "${RED}Error:${RESET} Invalid config line $line_no: swarm_name requires a name"
            exit 1
          fi
          SWARM_NAME="${fields[3]}"
          ;;
        swarm_mode)
          case "${fields[3]:-}" in
            autonomous)
              SWARM_MODE="autonomous"
              SWARM_MODE_PRIMARY=""
              ;;
            secondary)
              if [[ -z "${fields[4]:-}" ]]; then
                echo -e "${RED}Error:${RESET} Invalid config line $line_no: swarm_mode secondary requires a primary swarm name"
                exit 1
              fi
              SWARM_MODE="secondary"
              SWARM_MODE_PRIMARY="${fields[4]}"
              ;;
            *)
              echo -e "${RED}Error:${RESET} Invalid config line $line_no: swarm_mode must be 'autonomous' or 'secondary <primary-name>'"
              exit 1
              ;;
          esac
          ;;
        remote_control)
          case "${fields[3]:-}" in
            on|yes|true|1)
              REMOTE_CONTROL_DEFAULT=1
              ;;
            off|no|false|0)
              REMOTE_CONTROL_DEFAULT=0
              ;;
            *)
              echo -e "${RED}Error:${RESET} Invalid config line $line_no: remote_control must be 'on' or 'off'"
              exit 1
              ;;
          esac
          ;;
      esac
      continue
    fi

    if (( ${#fields[@]} < 4 )); then
      echo -e "${RED}Error:${RESET} Invalid config line $line_no: $line"
      exit 1
    fi

    role="${fields[2]}"
    agent="${fields[3]:l}"
    worktree="${fields[4]}"
    local next_field=5
    if [[ "${fields[5]:-}" == (task|batch) ]]; then
      receive_mode="${fields[5]}"
      next_field=6
    else
      receive_mode="task"
    fi
    local idle_clear="off"
    if [[ "${fields[$next_field]:-}" == "idle-clear" ]]; then
      idle_clear="on"
      next_field=$((next_field + 1))
    fi
    extra_args=(${fields[$next_field,$#fields]})
    local extra_cli="${(j: :)extra_args}"

    if [[ "$agent" == "claude" && "$REMOTE_CONTROL_DEFAULT" == 1 && "$extra_cli" != *"--remote-control"* ]]; then
      extra_cli+=" --remote-control $(remote_control_session_name_for_role "$role")"
    fi

    if [[ "$keyword" != "window" ]]; then
      echo -e "${RED}Error:${RESET} Unknown config directive on line $line_no: $keyword"
      exit 1
    fi

    if [[ "$role" == *"_"* ]]; then
      echo -e "${RED}Error:${RESET} Invalid role '$role' on line $line_no: role names may not contain underscores"
      exit 1
    fi

    if [[ -n "${ROLE_INDEX[$role]:-}" ]]; then
      echo -e "${RED}Error:${RESET} Duplicate role '$role' in $CONFIG_FILE"
      exit 1
    fi

    if [[ "$worktree" != "none" && "$worktree" != "master" && -n "${WORKTREE_INDEX[$worktree]:-}" ]]; then
      echo -e "${RED}Error:${RESET} Duplicate worktree '$worktree' in $CONFIG_FILE"
      exit 1
    fi

    if [[ "$worktree" == *"/"* || "$worktree" == "." || "$worktree" == ".." ]]; then
      echo -e "${RED}Error:${RESET} Invalid worktree '$worktree' for role '$role'"
      exit 1
    fi

    case "$agent" in
      claude|codex|copilot|grok|aider) ;;
      *)
        echo -e "${RED}Error:${RESET} Unsupported agent '$agent' for role '$role'"
        exit 1
        ;;
    esac

    case "$receive_mode" in
      task|batch) ;;
      *)
        echo -e "${RED}Error:${RESET} Invalid receive mode '$receive_mode' for role '$role' on line $line_no: expected task or batch"
        exit 1
        ;;
    esac

    if [[ "$agent" != "none" && ! -f "$ROLES_DIR/$role.prompt" ]]; then
      echo -e "${RED}Error:${RESET} Missing role prompt $ROLES_DIR/$role.prompt"
      exit 1
    fi

    ROLE_INDEX[$role]=${#ROLES[@]}
    if [[ "$worktree" != "none" && "$worktree" != "master" ]]; then
      WORKTREE_INDEX[$worktree]=${#ROLES[@]}
    fi
    ROLES+=("$role")
    AGENTS+=("$agent")
    SESSIONS+=("$(session_name_for_role "$role")")
    DISPLAY_NAMES+=("$(display_name_for_role "$role")")
    WORKTREE_NAMES+=("$worktree")
    RECEIVE_MODES+=("$receive_mode")
    IDLE_CLEAR_FLAGS+=("$idle_clear")
    EXTRA_CLI_ARGS+=("$extra_cli")
    if [[ "$worktree" == "none" || "$worktree" == "master" ]]; then
      WORKTREE_PATHS+=("$WORKING_DIR")
    else
      WORKTREE_PATHS+=("$(worktree_path_for_name "$worktree")")
    fi
  done < "$CONFIG_FILE"

  if (( ${#ROLES[@]} == 0 )); then
    echo -e "${RED}Error:${RESET} No windows defined in $CONFIG_FILE"
    exit 1
  fi

  if [[ "$SWARM_MODE" == "secondary" && -n "${ROLE_INDEX[coordinator]:-}" ]]; then
    echo -e "${RED}Error:${RESET} swarm_mode secondary must not declare a coordinator window (role '$SWARM_NAME' would both triage and be enslaved to '$SWARM_MODE_PRIMARY')"
    exit 1
  fi
}

# BL-090: single-triage invariant. The committed primacy marker
# (swarmforge/primary, a plain-text file naming the current autonomous
# swarm) is the cross-machine, git-transported source of truth for which
# swarm is allowed to triage/promote. An autonomous launch whose OWN name
# does not match an EXISTING marker fails fast rather than risk two
# coordinators promoting/assigning concurrently. A missing marker means no
# swarm has claimed primacy yet - the first autonomous launch is allowed
# through (the operator commits the marker deliberately to make a transfer,
# per the ticket's design; launch does not auto-commit one).
check_primacy() {
  if [[ "$SWARM_MODE" != "autonomous" ]]; then
    return
  fi

  local marker_file="$SWARM_FORGE_DIR/primary"
  if [[ ! -f "$marker_file" ]]; then
    return
  fi

  local current_primary
  current_primary="$(<"$marker_file")"
  current_primary="${current_primary//$'\n'/}"
  current_primary="${current_primary## }"
  current_primary="${current_primary%% }"

  if [[ -n "$current_primary" && "$current_primary" != "$SWARM_NAME" ]]; then
    echo -e "${RED}Error:${RESET} swarm '$SWARM_NAME' cannot launch autonomous: the committed primacy marker names '$current_primary' as the current primary. Launch as 'config swarm_mode secondary $current_primary', or have the operator deliberately transfer primacy by committing a new $marker_file."
    exit 1
  fi
}

write_swarm_identity_file() {
  printf 'swarm_name\t%s\nswarm_mode\t%s\nswarm_mode_primary\t%s\n' \
    "$SWARM_NAME" "$SWARM_MODE" "$SWARM_MODE_PRIMARY" > "$STATE_DIR/swarm-identity"
}

write_sessions_file() {
  : > "$SESSIONS_FILE"
  local i
  for (( i = 1; i <= ${#ROLES[@]}; i++ )); do
    printf '%s\t%s\t%s\t%s\t%s\n' \
      "$i" \
      "${ROLES[$i]}" \
      "${SESSIONS[$i]}" \
      "${DISPLAY_NAMES[$i]}" \
      "${AGENTS[$i]}" >> "$SESSIONS_FILE"
  done
}

write_roles_file() {
  : > "$ROLES_FILE"
  local i
  for (( i = 1; i <= ${#ROLES[@]}; i++ )); do
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
      "${ROLES[$i]}" \
      "${WORKTREE_NAMES[$i]}" \
      "${WORKTREE_PATHS[$i]}" \
      "${SESSIONS[$i]}" \
      "${DISPLAY_NAMES[$i]}" \
      "${AGENTS[$i]}" \
      "${RECEIVE_MODES[$i]}" \
      "${IDLE_CLEAR_FLAGS[$i]}" >> "$ROLES_FILE"
  done
}

check_helper_scripts() {
  local helper
  for helper in handoff-lib.sh swarm_handoff.sh swarm_handoff.bb ready_for_next.sh ready_for_next.bb done_with_current.sh done_with_current.bb ready_for_next_task.sh ready_for_next_task.bb done_with_current_task.sh done_with_current_task.bb ready_for_next_batch.sh ready_for_next_batch.bb done_with_current_batch.sh done_with_current_batch.bb handoffd.bb handoffd_supervisor.bb swarm-cleanup.sh swarm-window-watchdog.sh swarm-terminal-adapter.sh; do
    if [[ ! -x "$SCRIPT_DIR/$helper" ]]; then
      echo -e "${RED}Error:${RESET} Required helper script not found or not executable: $SCRIPT_DIR/$helper"
      exit 1
    fi
  done

  for helper in terminal-app.sh ghostty.sh windows-terminal.sh none.sh; do
    if [[ ! -x "$SCRIPT_DIR/terminal-adapters/$helper" ]]; then
      echo -e "${RED}Error:${RESET} Required terminal adapter not found or not executable: $SCRIPT_DIR/terminal-adapters/$helper"
      exit 1
    fi
  done
}

prepare_workspace() {
  mkdir -p "$STATE_DIR" "$NOTIFY_DIR" "$PROMPTS_DIR" "$WORKTREES_DIR" "$TMUX_SOCKET_DIR" "$DAEMON_DIR" "$STATE_DIR/launch"
  printf '%s\n' "$TMUX_SOCKET" > "$TMUX_SOCKET_FILE"
  check_helper_scripts
  write_sessions_file
  write_roles_file
  write_swarm_identity_file
}

write_tmux_env_file() {
  local tmux_value
  tmux_value="$(tmux -S "$TMUX_SOCKET" display-message -p '#{socket_path},#{pid},#{pane_id}')"
  printf '%s\n' "$tmux_value" > "$TMUX_ENV_FILE"
}

prepare_worktrees() {
  local i worktree_name worktree_path branch_name
  for (( i = 1; i <= ${#ROLES[@]}; i++ )); do
    worktree_name="${WORKTREE_NAMES[$i]}"
    worktree_path="${WORKTREE_PATHS[$i]}"
    branch_name="swarmforge-${worktree_name}"

    if [[ "$worktree_name" == "none" || "$worktree_name" == "master" ]]; then
      continue
    fi

    if [[ ! -e "$worktree_path/.git" && ! -d "$worktree_path/.git" ]]; then
      git -C "$WORKING_DIR" worktree add --force -B "$branch_name" "$worktree_path" HEAD >/dev/null
      # Bootstrap deps: a fresh worktree has no node_modules, so build/test/
      # mutation would fail (devDeps like vitest, @stryker-mutator/vitest-runner,
      # @vitest/coverage-v8 are not in git). Install once at creation. Existing
      # worktrees skip this (guarded above); they re-install on sync per the
      # constitution's npm-install rule when package.json changes.
      if [[ -f "$worktree_path/extension/package.json" ]]; then
        ( cd "$worktree_path/extension" && npm install --no-audit --no-fund >/dev/null 2>&1 ) || true
      fi
    fi
  done
}

prepare_handoff_dirs() {
  local i worktree_path
  for (( i = 1; i <= ${#ROLES[@]}; i++ )); do
    worktree_path="${WORKTREE_PATHS[$i]}"
    mkdir -p \
      "$worktree_path/.swarmforge/handoffs/outbox/tmp" \
      "$worktree_path/.swarmforge/handoffs/sent" \
      "$worktree_path/.swarmforge/handoffs/failed" \
      "$worktree_path/.swarmforge/handoffs/inbox/new" \
      "$worktree_path/.swarmforge/handoffs/inbox/in_process" \
      "$worktree_path/.swarmforge/handoffs/inbox/completed"
  done
}

sync_worktree_scripts() {
  local i worktree_path role_scripts_dir role_state_dir
  for (( i = 1; i <= ${#ROLES[@]}; i++ )); do
    worktree_path="${WORKTREE_PATHS[$i]}"
    if [[ "$worktree_path" == "$WORKING_DIR" ]]; then
      continue
    fi

    role_scripts_dir="$worktree_path/swarmforge/scripts"
    role_state_dir="$worktree_path/.swarmforge"
    mkdir -p "$role_scripts_dir"
    cp -R "$SCRIPT_DIR/." "$role_scripts_dir/"
    mkdir -p "$role_state_dir/notify"
    cp "$SESSIONS_FILE" "$role_state_dir/sessions.tsv"
    cp "$ROLES_FILE" "$role_state_dir/roles.tsv"
    cp "$TMUX_SOCKET_FILE" "$role_state_dir/tmux-socket"
    cp "$TMUX_ENV_FILE" "$role_state_dir/tmux-env"
  done
}

check_backend_dependencies() {
  local i
  for (( i = 1; i <= ${#AGENTS[@]}; i++ )); do
    case "${AGENTS[$i]}" in
      claude) check_dependency claude ;;
      codex) check_dependency codex ;;
      copilot) check_dependency copilot ;;
      grok) check_dependency grok ;;
      aider) check_dependency aider ;;
    esac
  done
}

create_role_session() {
  local session="$1"
  local title="$2"

  tmux -S "$TMUX_SOCKET" new-session -d -s "$session" -n "$AGENT_WINDOW"
  tmux -S "$TMUX_SOCKET" rename-window -t "$session:$AGENT_WINDOW" "$title"
  tmux -S "$TMUX_SOCKET" set-window-option -t "$session:$title" allow-rename off
}

is_two_pack_config() {
  [[ "$CONFIG_FILE" == *two-pack* ]]
}

handoff_draft_rel_path() {
  bb "$SCRIPT_DIR/agent_runtime_cli.bb" handoff-draft-path claude 2>/dev/null \
    || echo "swarmforge/runtime/handoff-draft.txt"
}

pack_has_role() {
  local want="$1"
  local r
  for r in "${ROLES[@]}"; do
    [[ "$r" == "$want" ]] && return 0
  done
  return 1
}

write_agent_instruction_file() {
  local role="$1"
  local prompt_file="$2"
  local agent="${3:-claude}"
  local two_pack_flag=0

  is_two_pack_config && two_pack_flag=1
  bb "$SCRIPT_DIR/agent_runtime_cli.bb" bootstrap-text "$agent" "$role" "$two_pack_flag" > "$prompt_file"
}

agent-runtime-needs-bootstrap() {
  local agent="$1"
  case "$agent" in
    aider|grok) return 0 ;;
    *) return 1 ;;
  esac
}

run_agent_bootstrap() {
  local session="$1"
  local display="$2"
  local role="$3"
  local agent="$4"
  local prompt_file="$5"
  local target two_pack_flag=0

  agent-runtime-needs-bootstrap "$agent" || return 0

  target="$(tmux_agent_target "$session" "$display")"
  is_two_pack_config && two_pack_flag=1

  (
    bb "$SCRIPT_DIR/agent_runtime_cli.bb" run-bootstrap \
      "$TMUX_SOCKET" "$target" "$agent" "$role" "$prompt_file" "$two_pack_flag"
  ) &!
}

claude_settings_and_flags_from_extra_cli() {
  local extra_cli="$1"
  local -a parts cli_flags
  local model="" effort="low" permission_mode=""
  local skip_permissions=0
  local i=1

  parts=(${=extra_cli})
  while (( i <= ${#parts} )); do
    case "${parts[i]}" in
      --model)
        model="${parts[i+1]}"
        (( i += 2 ))
        ;;
      --effort)
        effort="${parts[i+1]}"
        (( i += 2 ))
        ;;
      --permission-mode)
        permission_mode="${parts[i+1]}"
        (( i += 2 ))
        ;;
      --dangerously-skip-permissions)
        skip_permissions=1
        permission_mode="bypassPermissions"
        (( i++ ))
        ;;
      --allow-dangerously-skip-permissions)
        (( i++ ))
        ;;
      --remote-control)
        if [[ -n "${parts[i+1]:-}" && "${parts[i+1]}" != --* ]]; then
          cli_flags+=("${parts[i]}" "${parts[i+1]}")
          (( i += 2 ))
        else
          cli_flags+=("${parts[i]}")
          (( i++ ))
        fi
        ;;
      *)
        cli_flags+=("${parts[i]}")
        (( i++ ))
        ;;
    esac
  done

  CLAUDE_SETTINGS_MODEL="$model"
  CLAUDE_SETTINGS_EFFORT="$effort"
  CLAUDE_SETTINGS_PERMISSION_MODE="$permission_mode"
  CLAUDE_SKIP_PERMISSIONS="$skip_permissions"
  CLAUDE_REMAINING_FLAGS="${(j: :)cli_flags}"
}

write_claude_settings_file() {
  local role="$1"
  local settings_file="$STATE_DIR/launch/${role}.claude-settings.json"

  mkdir -p "$STATE_DIR/launch"

  if [[ -n "$CLAUDE_SETTINGS_PERMISSION_MODE" ]]; then
    cat > "$settings_file" <<EOF
{
  "model": "$CLAUDE_SETTINGS_MODEL",
  "effortLevel": "$CLAUDE_SETTINGS_EFFORT",
  "skipDangerousModePermissionPrompt": true,
  "permissions": {
    "defaultMode": "$CLAUDE_SETTINGS_PERMISSION_MODE"
  }
}
EOF
  elif [[ -n "$CLAUDE_SETTINGS_MODEL" ]]; then
    cat > "$settings_file" <<EOF
{
  "model": "$CLAUDE_SETTINGS_MODEL",
  "effortLevel": "$CLAUDE_SETTINGS_EFFORT"
}
EOF
  else
    cat > "$settings_file" <<EOF
{
  "effortLevel": "$CLAUDE_SETTINGS_EFFORT"
}
EOF
  fi

  echo "$settings_file"
}

write_role_launch_script() {
  local index="$1"
  local role="${ROLES[$index]}"
  local agent="${AGENTS[$index]}"
  local role_worktree="${WORKTREE_PATHS[$index]}"
  local display="${DISPLAY_NAMES[$index]}"
  local role_script_dir="$role_worktree/swarmforge/scripts"
  local prompt_file="$PROMPTS_DIR/${role}.md"
  local extra_cli="${EXTRA_CLI_ARGS[$index]}"
  local launch_script="$STATE_DIR/launch/${role}.sh"
  local settings_file=""
  local claude_flags=""
  local launch_body=""

  if [[ "$role_worktree" == "$WORKING_DIR" ]]; then
    role_script_dir="$SCRIPT_DIR"
  fi

  case "$agent" in
    claude)
      claude_settings_and_flags_from_extra_cli "$extra_cli"
      settings_file="$(write_claude_settings_file "$role")"
      claude_flags="$CLAUDE_REMAINING_FLAGS"
      local claude_permission_flags=""
      if [[ "$CLAUDE_SKIP_PERMISSIONS" == 1 ]]; then
        claude_permission_flags=" --dangerously-skip-permissions"
      elif [[ -n "$CLAUDE_SETTINGS_PERMISSION_MODE" ]]; then
        claude_permission_flags=" --permission-mode '$CLAUDE_SETTINGS_PERMISSION_MODE'"
      fi
      launch_body="claude --settings '$settings_file'${claude_permission_flags}${claude_flags:+ $claude_flags} --append-system-prompt-file '$prompt_file' -n 'SwarmForge ${display}' \"\$(cat '$prompt_file')\""
      ;;
    codex)
      launch_body="codex${extra_cli:+ $extra_cli} -C '$role_worktree' \"\$(cat '$prompt_file')\""
      ;;
    copilot)
      launch_body="copilot${extra_cli:+ $extra_cli} -C '$role_worktree' --name 'SwarmForge ${display}' -i \"\$(cat '$prompt_file')\""
      ;;
    grok)
      launch_body="grok${extra_cli:+ $extra_cli} --cwd '$role_worktree' --permission-mode acceptEdits --rules \"\$(cat '$prompt_file')\""
      ;;
    aider)
      launch_body="aider${extra_cli:+ $extra_cli} --yes-always"
      ;;
    *)
      echo -e "${RED}Error:${RESET} Unsupported agent '$agent' for role '$role'"
      exit 1
      ;;
  esac

  local billing_guard=""
  if [[ "$agent" == "claude" ]]; then
    billing_guard=$'unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN\n'
  fi
  # BL-130-VIOLATION fix: a provider API key (OPENAI_API_KEY/MISTRAL_API_KEY,
  # for an alternate-runtime role like aider on Mistral/OpenAI) must NEVER be
  # written into this launch script - the constitution's secrets rule bars
  # any key from landing in a file under the target working directory, not
  # just from being committed, and .swarmforge/launch/<role>.sh is exactly
  # such a file (previously written here as a plaintext `export KEY=value`
  # line - a real violation, caught by architect review). The key is instead
  # passed at respawn-pane time via `-e`, ephemeral to that tmux command, in
  # launch_role below - never persisted to disk.

  cat > "$launch_script" <<LAUNCH
#!/usr/bin/env zsh
set -euo pipefail
export SWARMFORGE_ROLE='$role'
export PATH='$role_script_dir':\$PATH
cd '$role_worktree'
${billing_guard}${launch_body}
LAUNCH

  # Only wire cleanup when a GUI terminal backend owns windows to close.
  # Headless (SWARMFORGE_TERMINAL=none): coordinator exiting — e.g. aider
  # auth failure without MISTRAL_API_KEY — must not tear down every session.
  if [[ "$index" -eq "${CLEANUP_OWNER_INDEX}" ]] && terminal_backend_can_open_sessions; then
    cat >> "$launch_script" <<LAUNCH
exit_code=\$?
SWARMFORGE_TERMINAL_BACKEND='$TERMINAL_BACKEND' nohup '$SCRIPT_DIR/swarm-cleanup.sh' '$TMUX_SOCKET' '$WINDOW_IDS_FILE' \\
LAUNCH
    local session_name
    for session_name in "${SESSIONS[@]}"; do
      [[ -n "$session_name" ]] || continue
      echo "  '$session_name' \\" >> "$launch_script"
    done
    cat >> "$launch_script" <<'LAUNCH'
  >/dev/null 2>&1 & disown
exit $exit_code
LAUNCH
  fi

  chmod +x "$launch_script"
  echo "$launch_script"
}

wait_for_session_pane() {
  local session="$1"
  local attempt

  for attempt in {1..30}; do
    if tmux -S "$TMUX_SOCKET" list-panes -t "$session" &>/dev/null; then
      return 0
    fi
    sleep 0.1
  done

  echo -e "${RED}Error:${RESET} Timed out waiting for tmux pane in session '$session'"
  exit 1
}

launch_role() {
  local index="$1"
  local role="${ROLES[$index]}"
  local agent="${AGENTS[$index]}"
  local session="${SESSIONS[$index]}"
  local display="${DISPLAY_NAMES[$index]}"
  local launch_script=""

  write_agent_instruction_file "$role" "$PROMPTS_DIR/${role}.md" "$agent"
  launch_script="$(write_role_launch_script "$index")"

  # BL-130-VIOLATION fix: pass a non-claude role's provider API key as a
  # respawn-pane `-e` flag - ephemeral to this tmux invocation - rather than
  # writing it into the launch script file (see write_role_launch_script).
  local -a provider_env_flags=()
  if [[ "$agent" != "claude" ]]; then
    local provider_key
    for provider_key in OPENAI_API_KEY MISTRAL_API_KEY; do
      if [[ -n "${(P)provider_key:-}" ]]; then
        provider_env_flags+=(-e "${provider_key}=${(P)provider_key}")
      fi
    done
  fi

  wait_for_session_pane "$session"
  tmux -S "$TMUX_SOCKET" respawn-pane -k "${provider_env_flags[@]}" -t "$(tmux_agent_target_for_session "$session")" "zsh '$launch_script'"
  sleep 0.25
  if agent-runtime-needs-bootstrap "$agent"; then
    run_agent_bootstrap "$session" "$display" "$role" "$agent" "$PROMPTS_DIR/${role}.md"
  fi
  echo -e "  ${CYAN}[${display}]${RESET} started in session ${session}"
}

choose_cleanup_owner() {
  CLEANUP_OWNER_INDEX=1
}

stop_handoff_daemon() {
  local pid_file
  local pid

  for pid_file in "$DAEMON_DIR/handoffd-supervisor.pid" "$DAEMON_DIR/handoffd.pid"; do
    if [[ ! -f "$pid_file" ]]; then
      continue
    fi
    pid="$(< "$pid_file")"
    if [[ "$pid" == <-> ]]; then
      kill -TERM "$pid" 2>/dev/null || true
    fi
  done
}

start_handoff_daemon() {
  if [[ "${SWARMFORGE_SKIP_DAEMON:-}" == "1" ]]; then
    echo -e "${YELLOW}Skipping handoff daemon (SWARMFORGE_SKIP_DAEMON=1).${RESET}"
    return 0
  fi
  if [[ "${SWARMFORGE_MAILBOX_ONLY:-}" == "1" ]]; then
    echo -e "${CYAN}Mailbox-only mode: handoffd delivers files without tmux wake (SWARMFORGE_MAILBOX_ONLY=1).${RESET}"
  fi
  rm -f "$DAEMON_DIR/stop"
  # Rotate the previous log aside instead of truncating it, so evidence of a
  # crash or hang survives the restart (BL-061).
  if [[ -s "$HANDOFF_DAEMON_LOG" ]]; then
    mv "$HANDOFF_DAEMON_LOG" "$HANDOFF_DAEMON_LOG.$(date -u +%Y%m%dT%H%M%SZ)"
  fi
  nohup "$SCRIPT_DIR/handoffd.bb" "$WORKING_DIR" >> "$HANDOFF_DAEMON_LOG" 2>&1 &
  echo -e "${GREEN}Started handoff daemon.${RESET}"
  nohup "$SCRIPT_DIR/handoffd_supervisor.bb" "$WORKING_DIR" >> "$DAEMON_DIR/handoffd-supervisor.log" 2>&1 &
  echo -e "${GREEN}Started handoff daemon supervisor.${RESET}"
}

# BL-089: guarded so a test can `source` this file (e.g. to exercise
# parse_config/write_roles_file against a fixture conf) without launching a
# real swarm. Direct execution (the normal `./swarmforge.sh` launch path)
# still runs this unconditionally, since ZSH_EVAL_CONTEXT is exactly
# "toplevel" only when the file is the top-level script being run, not when
# it is sourced from another script.
if [[ "$ZSH_EVAL_CONTEXT" == "toplevel" ]]; then

check_dependency tmux
check_dependency git
check_dependency bb
detect_tmux_base_indexes
initialize_git_repo
ensure_runtime_git_excludes
ensure_commit_size_guard
parse_config
check_primacy
check_backend_dependencies
prepare_workspace
prepare_worktrees
prepare_handoff_dirs
choose_cleanup_owner
TERMINAL_BACKEND="$(detect_terminal_backend)"
load_terminal_backend "$TERMINAL_BACKEND"

stop_handoff_daemon
local_session=""
for local_session in "${SESSIONS[@]}"; do
  [[ -n "$local_session" ]] || continue
  if tmux -S "$TMUX_SOCKET" has-session -t "$local_session" 2>/dev/null; then
    echo -e "${YELLOW}Existing SwarmForge session found: ${local_session}. Killing it...${RESET}"
    tmux -S "$TMUX_SOCKET" kill-session -t "$local_session"
  fi
done

echo -e "${CYAN}${BOLD}"
echo "  ╔═══════════════════════════════════════════════╗"
echo "  ║           SwarmForge v1.0 Starting            ║"
echo "  ║   Disciplined agents build better software    ║"
echo "  ╚═══════════════════════════════════════════════╝"
echo -e "${RESET}"

echo -e "${GREEN}Launching SwarmForge tmux sessions...${RESET}"
for (( i = 1; i <= ${#ROLES[@]}; i++ )); do
  create_role_session "${SESSIONS[$i]}" "${DISPLAY_NAMES[$i]}"
done
write_tmux_env_file
sync_worktree_scripts
start_handoff_daemon

echo -e "${GREEN}Starting agents...${RESET}"
for (( i = 1; i <= ${#ROLES[@]}; i++ )); do
  launch_role "$i"
done

echo ""
echo -e "${GREEN}${BOLD}SwarmForge is ready.${RESET}"
echo -e "Working directory: ${WORKING_DIR}"
echo -e "Sessions:"
for (( i = 1; i <= ${#ROLES[@]}; i++ )); do
  echo -e "  ${DISPLAY_NAMES[$i]}: ${SESSIONS[$i]}"
done
echo ""
echo -e "${GREEN}Tip: Write a handoff draft and run swarm_handoff.sh while the swarm is running.${RESET}"
echo -e "${GREEN}Tip: Reattach manually with 'tmux -S $TMUX_SOCKET attach-session -t <session-name>' if needed.${RESET}"
echo ""

if terminal_backend_can_open_sessions; then
  echo -e "Opening separate $(terminal_backend_label) surfaces for each session..."
  if terminal_backend_tracks_windows; then
    : > "$WINDOW_IDS_FILE"
    : > "$WINDOW_STATE_FILE"
  fi
  previous_window_id=""
  for (( i = 1; i <= ${#ROLES[@]}; i++ )); do
    window_id="$(terminal_open_session "${SESSIONS[$i]}" "SwarmForge ${DISPLAY_NAMES[$i]}" "$previous_window_id")"
    if terminal_backend_tracks_windows; then
      echo "$window_id" >> "$WINDOW_IDS_FILE"
      printf '%s\t%s\t%s\t%s\n' \
        "$i" \
        "$window_id" \
        "${SESSIONS[$i]}" \
        "SwarmForge ${DISPLAY_NAMES[$i]}" >> "$WINDOW_STATE_FILE"
      previous_window_id="$window_id"
    fi
  done
  if terminal_backend_tracks_windows; then
    nohup "$SCRIPT_DIR/swarm-window-watchdog.sh" \
      "$WINDOW_STATE_FILE" \
      "$WINDOW_IDS_FILE" \
      "$CLEANUP_OWNER_INDEX" \
      "$TMUX_SOCKET" \
      "$WORKING_DIR" \
      "$TERMINAL_BACKEND" > "$WINDOW_WATCHDOG_LOG" 2>&1 &
  else
    echo -e "${YELLOW}$(terminal_backend_label) surfaces are not trackable; window watchdog is disabled for this backend.${RESET}"
  fi
else
  if [[ "$TERMINAL_BACKEND" == "none" ]]; then
    echo -e "${GREEN}Running headless (SWARMFORGE_TERMINAL=none). Attach manually if needed.${RESET}"
  else
    echo -e "${YELLOW}No terminal backend found; attaching current shell to '${SESSIONS[$CLEANUP_OWNER_INDEX]}' instead.${RESET}"
    tmux -S "$TMUX_SOCKET" attach-session -t "${SESSIONS[$CLEANUP_OWNER_INDEX]}"
  fi
fi

fi # ZSH_EVAL_CONTEXT toplevel guard (BL-089)
