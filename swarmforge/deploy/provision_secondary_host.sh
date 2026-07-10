#!/usr/bin/env bash
# BL-101: provisions a fresh, always-on Linux box (Raspberry Pi 5 or a VPS)
# into a headless SwarmForge secondary swarm. Automates every step that is
# actually scriptable; steps that inherently need a human in the loop
# (SSH access already established, a GitHub PAT/deploy key, the one-time
# `claude` login, the GitHub Actions runner registration token) are called
# out loudly and are NOT attempted here - see
# docs/runbooks/BL-101-pi-vps-secondary-swarm-bringup.md for the full
# walkthrough this script is one half of.
#
# Usage: provision_secondary_host.sh <swarm-name> <repo-clone-url> [project-root]
#   swarm-name:      this box's unique swarm_name (see generate_secondary_conf.sh)
#   repo-clone-url:  the repo-scoped credential's clone URL (deploy key or
#                    fine-grained PAT already configured - see the runbook's
#                    "repo-scoped credentials only" section BEFORE running this)
#   project-root:    where to clone; defaults to $HOME/swarmforgevc
#
# Substrate versions come from swarmforge.lock.json's secondary_host_substrate
# section - never a floating "latest" URL (engineering.prompt pin rule).
# Bumping a pin is a human commit to that file, not something this script
# decides at runtime.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOCK_FILE="$REPO_ROOT/swarmforge.lock.json"

SWARM_NAME="${1:?Usage: provision_secondary_host.sh <swarm-name> <repo-clone-url> [project-root]}"
CLONE_URL="${2:?Usage: provision_secondary_host.sh <swarm-name> <repo-clone-url> [project-root]}"
PROJECT_ROOT="${3:-$HOME/swarmforgevc}"

log() { echo "[provision] $*"; }
die() { echo "[provision] ERROR: $*" >&2; exit 1; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "required command '$1' not found on PATH"
}

lock_value() {
  # $1 = python-expression path into the parsed lock JSON, e.g.
  #   data['secondary_host_substrate']['babashka']['version']
  python3 -c "import json,sys; data=json.load(open('$LOCK_FILE')); print($1)"
}

detect_arch() {
  case "$(uname -m)" in
    aarch64|arm64) echo "aarch64" ;;
    x86_64|amd64) echo "x86_64" ;;
    *) die "unsupported architecture: $(uname -m) (BL-101 targets ARM64 Pi 5 or x86_64 VPS only)" ;;
  esac
}

log "1/6 installing base packages (tmux, git, gh, curl, python3 - required to run this script and the swarm scripts)"
sudo apt-get update -y
sudo apt-get install -y tmux git curl python3 gnupg

require_cmd python3
[[ -f "$LOCK_FILE" ]] || die "swarmforge.lock.json not found at $LOCK_FILE - run this script from a cloned repo checkout"

ARCH="$(detect_arch)"
log "detected architecture: $ARCH"

log "2/6 installing gh (GitHub CLI) via its official apt repo (pinned channel, not a floating PPA)"
if ! command -v gh >/dev/null 2>&1; then
  sudo install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg >/dev/null
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    | sudo tee /etc/apt/sources.list.d/github-cli.list >/dev/null
  sudo apt-get update -y
  sudo apt-get install -y gh
fi

log "3/6 installing babashka $(lock_value "data['secondary_host_substrate']['babashka']['version']") (pinned)"
BB_VERSION="$(lock_value "data['secondary_host_substrate']['babashka']['version']")"
BB_ARCH="$(lock_value "data['secondary_host_substrate']['babashka']['arch_map']['$ARCH']")"
BB_ASSET="babashka-${BB_VERSION}-linux-${BB_ARCH}-static.tar.gz"
BB_URL="https://github.com/babashka/babashka/releases/download/v${BB_VERSION}/${BB_ASSET}"
if ! command -v bb >/dev/null 2>&1 || [[ "$(bb --version 2>/dev/null)" != *"$BB_VERSION"* ]]; then
  TMP_BB="$(mktemp -d)"
  curl -fsSL "$BB_URL" -o "$TMP_BB/$BB_ASSET"
  sudo tar -xzf "$TMP_BB/$BB_ASSET" -C /usr/local/bin
  sudo chmod +x /usr/local/bin/bb
  rm -rf "$TMP_BB"
fi
bb --version

log "4/6 installing Node.js $(lock_value "data['secondary_host_substrate']['node']['major']").x LTS via NodeSource (pinned major line)"
NODE_MAJOR="$(lock_value "data['secondary_host_substrate']['node']['major']")"
if ! command -v node >/dev/null 2>&1 || [[ "$(node --version)" != v${NODE_MAJOR}.* ]]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | sudo -E bash -
  sudo apt-get install -y nodejs
fi
node --version

log "5/6 installing claude CLI $(lock_value "data['secondary_host_substrate']['claude_cli']['version']") (pinned version, auto-update disabled below)"
CLAUDE_VERSION="$(lock_value "data['secondary_host_substrate']['claude_cli']['version']")"
if ! command -v claude >/dev/null 2>&1 || [[ "$(claude --version 2>/dev/null)" != *"$CLAUDE_VERSION"* ]]; then
  curl -fsSL https://claude.ai/install.sh | bash -s "$CLAUDE_VERSION"
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
log "DISABLE_AUTOUPDATER=1 written to ~/.claude/settings.json - this box's claude version only moves on a deliberate re-run of this script with a bumped pin"

log "6/6 cloning the repo and generating this box's conf + systemd unit"
if [[ ! -d "$PROJECT_ROOT/.git" ]]; then
  git clone "$CLONE_URL" "$PROJECT_ROOT"
fi

mkdir -p "$PROJECT_ROOT/swarmforge/packs"
"$PROJECT_ROOT/swarmforge/deploy/generate_secondary_conf.sh" "$SWARM_NAME" \
  "$PROJECT_ROOT/swarmforge/packs/${SWARM_NAME}.conf"

UNIT_PATH="/tmp/swarmforge-${SWARM_NAME}.service"
"$PROJECT_ROOT/swarmforge/deploy/generate_systemd_units.sh" "$PROJECT_ROOT" "$SWARM_NAME" "$(whoami)" "$UNIT_PATH"
sudo mv "$UNIT_PATH" "/etc/systemd/system/swarmforge-${SWARM_NAME}.service"

# A systemd service starts with a clean environment - it does NOT source
# this user's shell profile - so a token exported there (Option B auth,
# below) would never reach the swarm process. The generated unit's
# EnvironmentFile= reads this file instead; root-owned and 600 so the
# token is not readable by anyone but root and whatever reads it as root
# (systemd itself, before dropping to User= in the unit). Left EMPTY here -
# populated only if the operator chooses Option B below.
sudo install -d -m 0755 /etc/swarmforge
sudo touch "/etc/swarmforge/${SWARM_NAME}.env"
sudo chmod 600 "/etc/swarmforge/${SWARM_NAME}.env"

sudo systemctl daemon-reload
sudo systemctl enable "swarmforge-${SWARM_NAME}.service"

cat <<EOF

Automated provisioning finished. Remaining MANUAL steps (see the runbook
for detail on each):

  1. Authenticate the claude CLI once (interactive login opens a URL you can
     complete from ANY device's browser, even though this box has none) -
     run: claude
     Or, for a token-only setup that forgoes Remote Control, run:
       claude setup-token
     and write CLAUDE_CODE_OAUTH_TOKEN=<the printed token> into
       /etc/swarmforge/${SWARM_NAME}.env
     (NOT the shell profile - systemd does not source it; this file is
     what the generated unit's EnvironmentFile= actually reads).

  2. Register the GitHub Actions self-hosted runner for this box's arch
     ($ARCH) using its own installer and systemd unit (./svc.sh install &&
     ./svc.sh start) - the runner project maintains that unit itself, so it
     is not generated here. Give the runner a label naming this box so
     BL-092's wake-up workflow can target it.

  3. Start the swarm for the first time:
       sudo systemctl start swarmforge-${SWARM_NAME}.service
     (subsequent boots start it automatically - that is what
     'systemctl enable' above already configured).

EOF
