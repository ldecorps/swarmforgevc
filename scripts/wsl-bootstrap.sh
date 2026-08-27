#!/usr/bin/env bash
# Bootstrap SwarmForge VC on WSL2 (Ubuntu/Debian): check or install Linux
# prerequisites, optionally compile the extension, and print exact start
# commands for this machine.
#
# Usage:
#   curl -fsSL .../scripts/wsl-bootstrap.sh | bash -s -- --install-deps
#   ./scripts/wsl-bootstrap.sh [--install-deps] [--write-settings] [--check-only]
#
# Does not install Claude CLI or Node — those need separate setup (claude auth,
# nvm/apt). Safe to re-run; --install-deps is idempotent for apt packages.
set -euo pipefail

REPO_URL="${SWARMFORGE_REPO_URL:-https://github.com/ldecorps/swarmforgevc.git}"
INSTALL_DEPS=false
WRITE_SETTINGS=false
CHECK_ONLY=false

usage() {
  cat <<'EOF'
Usage: wsl-bootstrap.sh [options]

Options:
  --install-deps    apt-install git, tmux, zsh, curl; install babashka if missing
  --write-settings  set extension/.vscode/settings.json swarmforge.targetPath
  --check-only      report dependency status and exit (no compile, no settings)
  -h, --help        show this help

After a successful run, start the swarm headlessly:
  SWARMFORGE_TERMINAL=none ./swarm

Or with Windows Terminal tabs from WSL (when wt.exe is on PATH):
  SWARMFORGE_TERMINAL=windows-terminal ./swarm
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --install-deps) INSTALL_DEPS=true ;;
    --write-settings) WRITE_SETTINGS=true ;;
    --check-only) CHECK_ONLY=true ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "error: unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
  shift
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TARGET_PATH="$(cd "$REPO_ROOT" && pwd -P)"
EXT_DIR="$REPO_ROOT/extension"
SETTINGS_FILE="$EXT_DIR/.vscode/settings.json"
MISSING=()

is_wsl() {
  grep -qiE 'microsoft|wsl' /proc/version 2>/dev/null
}

have_cmd() {
  command -v "$1" &>/dev/null
}

note() {
  printf '  %s\n' "$*"
}

ok() {
  printf '  OK   %s\n' "$*"
}

warn() {
  printf '  WARN %s\n' "$*" >&2
}

fail_missing() {
  MISSING+=("$1")
  printf '  MISS %s\n' "$1" >&2
}

install_apt_packages() {
  if ! have_cmd apt-get; then
    warn "apt-get not found — install git, tmux, zsh, and curl manually."
    return 0
  fi
  note "Installing apt packages (sudo may prompt)…"
  sudo apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq git tmux zsh curl ca-certificates
}

install_babashka() {
  if have_cmd bb; then
    return 0
  fi
  note "Installing babashka (bb)…"
  curl -sSL https://raw.githubusercontent.com/babashka/babashka/master/install | bash
  if ! have_cmd bb && [[ -x "$HOME/.local/bin/bb" ]]; then
    export PATH="$HOME/.local/bin:$PATH"
  fi
}

write_extension_settings() {
  mkdir -p "$(dirname "$SETTINGS_FILE")"
  if [[ -f "$SETTINGS_FILE" ]] && grep -q '"swarmforge.targetPath"' "$SETTINGS_FILE"; then
    # Replace existing targetPath value in place.
    local tmp
    tmp="$(mktemp)"
    sed "s|\"swarmforge.targetPath\"[[:space:]]*:[[:space:]]*\"[^\"]*\"|\"swarmforge.targetPath\": \"$TARGET_PATH\"|" \
      "$SETTINGS_FILE" >"$tmp"
    mv "$tmp" "$SETTINGS_FILE"
  else
    cat >"$SETTINGS_FILE" <<EOF
{
  "swarmforge.targetPath": "$TARGET_PATH"
}
EOF
  fi
  ok "wrote swarmforge.targetPath=$TARGET_PATH → $SETTINGS_FILE"
}

compile_extension() {
  if [[ ! -d "$EXT_DIR" ]]; then
    warn "extension/ not found — skipping npm compile."
    return 0
  fi
  if ! have_cmd npm; then
    warn "npm not found — skip extension compile (install Node, then: cd extension && npm install && npm run compile)."
    return 0
  fi
  note "Compiling extension…"
  (cd "$EXT_DIR" && npm install --silent && npm run compile --silent)
  ok "extension compiled"
}

check_dependencies() {
  echo "== SwarmForge VC WSL bootstrap =="
  if is_wsl; then
    ok "WSL detected ($(grep -oE 'Microsoft|WSL' /proc/version | head -1 || echo linux))"
  else
    warn "Not WSL — script still works on Linux; Windows native is unsupported."
  fi
  echo
  echo "Repo: $TARGET_PATH"
  echo
  echo "Dependencies:"

  for cmd in git tmux zsh curl bb; do
    if have_cmd "$cmd"; then
      ok "$cmd → $(command -v "$cmd")"
    else
      fail_missing "$cmd"
    fi
  done

  if have_cmd claude; then
    ok "claude → $(command -v claude)"
  else
    warn "claude CLI not found — required by swarmforge.conf (install + claude auth login)."
  fi

  if have_cmd npm; then
    ok "npm → $(command -v npm) ($(npm -v 2>/dev/null || echo '?'))"
  else
    warn "npm not found — optional for VS Code extension (F5 dev host)."
  fi

  if have_cmd wt.exe; then
    ok "wt.exe on PATH — SWARMFORGE_TERMINAL=windows-terminal available"
  else
    note "wt.exe not on PATH — use SWARMFORGE_TERMINAL=none (headless) or attach tmux manually"
  fi
}

print_next_steps() {
  echo
  echo "== Next steps =="
  echo
  echo "1. Start swarm (headless, recommended in WSL):"
  echo "   cd $TARGET_PATH"
  echo "   SWARMFORGE_TERMINAL=none ./swarm"
  echo
  echo "2. Attach to coordinator when running headless:"
  echo "   tmux -S \"\$(cat $TARGET_PATH/.swarmforge/tmux-socket)\" attach -t swarmforge-coordinator"
  echo
  echo "3. Extension in Cursor (WSL window):"
  echo "   cd $TARGET_PATH/extension && npm install && npm run compile"
  echo "   Open extension/ in Cursor → F5 → Set Target → $TARGET_PATH"
  echo
  echo "4. Recovery:"
  echo "   cd $TARGET_PATH && ./swarm ensure"
  echo
  if [[ ${#MISSING[@]} -gt 0 ]]; then
    echo "Install missing tools, then re-run:"
    echo "   $TARGET_PATH/scripts/wsl-bootstrap.sh --install-deps"
    echo
    return 1
  fi
  return 0
}

main() {
  if [[ ! -f "$REPO_ROOT/swarm" || ! -f "$REPO_ROOT/swarmforge/swarmforge.conf" ]]; then
    echo "error: run this script from a cloned swarmforgevc repo (expected ./swarm)." >&2
    echo "  git clone $REPO_URL ~/swarmforgevc && ~/swarmforgevc/scripts/wsl-bootstrap.sh" >&2
    exit 1
  fi

  check_dependencies

  if [[ "$INSTALL_DEPS" == true ]]; then
    echo
    echo "== Installing dependencies =="
    install_apt_packages
    install_babashka
    MISSING=()
    check_dependencies
  fi

  if [[ "$CHECK_ONLY" == true ]]; then
    print_next_steps
    exit $?
  fi

  if [[ "$WRITE_SETTINGS" == true ]]; then
    echo
    echo "== Extension settings =="
    write_extension_settings
  fi

  if [[ ${#MISSING[@]} -eq 0 && "$CHECK_ONLY" == false ]]; then
    echo
    compile_extension
  fi

  print_next_steps
}

main "$@"
