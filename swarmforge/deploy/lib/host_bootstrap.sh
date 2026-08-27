# BL-628: the shape-agnostic half of a bare-Linux-host bootstrap - packages,
# the pinned substrate (babashka/node/claude CLI from swarmforge.lock.json,
# never a floating "latest"), the auto-updater disabled, and the repo clone.
# Lifted out so a NEW shape (provision_autonomous_host.sh) can reuse it
# without re-deriving package lists or version-pin lookups; the ORIGINAL
# provision_secondary_host.sh is left untouched by this ticket (invariant 2
# - "nothing the autonomous path adds changes what the secondary path
# does" holds trivially when that script's own bytes never change).
#
# Sourced, not executed - the caller is expected to already have
# `set -euo pipefail`. Every function that mutates the host goes through
# bootstrap_is_dryrun/bootstrap_log_dryrun so a caller can opt into
# BOOTSTRAP_DRYRUN=1 (no sudo, no download, no file write, no clone) -
# the seam BL-628's own invariant 1 requires for its autonomous path. Unset
# (the default), every function below runs for real, unchanged from what
# provision_secondary_host.sh's own inline steps 1-5 already did.

bootstrap_log() { echo "[bootstrap] $*"; }
bootstrap_die() { echo "[bootstrap] ERROR: $*" >&2; exit 1; }

bootstrap_require_cmd() {
  command -v "$1" >/dev/null 2>&1 || bootstrap_die "required command '$1' not found on PATH"
}

bootstrap_is_dryrun() { [[ "${BOOTSTRAP_DRYRUN:-0}" == "1" ]]; }
bootstrap_log_dryrun() { printf 'DRYRUN: %s\n' "$*"; }

# $1 = python-expression path into the parsed lock JSON, e.g.
#   data['secondary_host_substrate']['babashka']['version']
bootstrap_lock_value() {
  local lock_file="$1" expr="$2"
  python3 -c "import json,sys; data=json.load(open('$lock_file')); print($expr)"
}

bootstrap_detect_arch() {
  case "$(uname -m)" in
    aarch64|arm64) echo "aarch64" ;;
    x86_64|amd64) echo "x86_64" ;;
    *) bootstrap_die "unsupported architecture: $(uname -m) (targets ARM64 Pi 5 or x86_64 VPS only)" ;;
  esac
}

bootstrap_install_base_packages() {
  if bootstrap_is_dryrun; then
    bootstrap_log_dryrun "apt-get update -y && apt-get install -y tmux git curl python3 gnupg"
    return
  fi
  sudo apt-get update -y
  sudo apt-get install -y tmux git curl python3 gnupg
}

bootstrap_install_gh() {
  if command -v gh >/dev/null 2>&1; then
    return
  fi
  if bootstrap_is_dryrun; then
    bootstrap_log_dryrun "install the GitHub CLI apt repo keyring + source list, then apt-get install -y gh"
    return
  fi
  sudo install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg >/dev/null
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    | sudo tee /etc/apt/sources.list.d/github-cli.list >/dev/null
  sudo apt-get update -y
  sudo apt-get install -y gh
}

# $1 = lock file, $2 = arch (from bootstrap_detect_arch)
bootstrap_install_babashka() {
  local lock_file="$1" arch="$2"
  local bb_version bb_arch bb_asset bb_url
  bb_version="$(bootstrap_lock_value "$lock_file" "data['secondary_host_substrate']['babashka']['version']")"
  if command -v bb >/dev/null 2>&1 && [[ "$(bb --version 2>/dev/null)" == *"$bb_version"* ]]; then
    return
  fi
  bb_arch="$(bootstrap_lock_value "$lock_file" "data['secondary_host_substrate']['babashka']['arch_map']['$arch']")"
  bb_asset="babashka-${bb_version}-linux-${bb_arch}-static.tar.gz"
  bb_url="https://github.com/babashka/babashka/releases/download/v${bb_version}/${bb_asset}"
  if bootstrap_is_dryrun; then
    bootstrap_log_dryrun "download $bb_url and extract bb $bb_version to /usr/local/bin"
    return
  fi
  local tmp_bb; tmp_bb="$(mktemp -d)"
  curl -fsSL "$bb_url" -o "$tmp_bb/$bb_asset"
  sudo tar -xzf "$tmp_bb/$bb_asset" -C /usr/local/bin
  sudo chmod +x /usr/local/bin/bb
  rm -rf "$tmp_bb"
}

# $1 = lock file
bootstrap_install_node() {
  local lock_file="$1"
  local node_major
  node_major="$(bootstrap_lock_value "$lock_file" "data['secondary_host_substrate']['node']['major']")"
  if command -v node >/dev/null 2>&1 && [[ "$(node --version)" == v${node_major}.* ]]; then
    return
  fi
  if bootstrap_is_dryrun; then
    bootstrap_log_dryrun "install Node.js ${node_major}.x LTS via NodeSource's setup_${node_major}.x"
    return
  fi
  curl -fsSL "https://deb.nodesource.com/setup_${node_major}.x" | sudo -E bash -
  sudo apt-get install -y nodejs
}

# $1 = lock file
bootstrap_install_claude_cli() {
  local lock_file="$1"
  local claude_version
  claude_version="$(bootstrap_lock_value "$lock_file" "data['secondary_host_substrate']['claude_cli']['version']")"
  if ! command -v claude >/dev/null 2>&1 || [[ "$(claude --version 2>/dev/null)" != *"$claude_version"* ]]; then
    if bootstrap_is_dryrun; then
      bootstrap_log_dryrun "install claude CLI $claude_version via https://claude.ai/install.sh"
    else
      curl -fsSL https://claude.ai/install.sh | bash -s "$claude_version"
    fi
  fi

  if bootstrap_is_dryrun; then
    bootstrap_log_dryrun "write DISABLE_AUTOUPDATER=1 into \$HOME/.claude/settings.json"
    return
  fi
  mkdir -p "$HOME/.claude"
  python3 - "$HOME/.claude/settings.json" <<'PYEOF'
import json, sys
path = sys.argv[1]
try:
    with open(path) as f:
        settings = json.load(f)
except (FileNotFoundError, json.JSONDecodeError):
    settings = {}
settings.setdefault("env", {})["DISABLE_AUTOUPDATER"] = "1"
with open(path, "w") as f:
    json.dump(settings, f, indent=2)
    f.write("\n")
PYEOF
  bootstrap_log "DISABLE_AUTOUPDATER=1 written to ~/.claude/settings.json - this box's claude version only moves on a deliberate re-run with a bumped pin"
}

# $1 = clone URL, $2 = project root
bootstrap_clone_repo() {
  local clone_url="$1" project_root="$2"
  if [[ -d "$project_root/.git" ]]; then
    return
  fi
  if bootstrap_is_dryrun; then
    bootstrap_log_dryrun "git clone $clone_url $project_root"
    return
  fi
  git clone "$clone_url" "$project_root"
}
