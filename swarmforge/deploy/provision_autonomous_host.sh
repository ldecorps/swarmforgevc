#!/usr/bin/env bash
# BL-628: provisions a fresh, always-on Linux box into a headless
# AUTONOMOUS SwarmForge swarm - its own coordinator, its own backlog, its
# own target repo, its own Telegram front-desk channel. Reuses
# provision_secondary_host.sh's own shape-agnostic bootstrap (packages,
# pinned substrate, DISABLE_AUTOUPDATER, clone - lib/host_bootstrap.sh) and
# generate_systemd_units.sh's own unit rendering; never re-derives either.
# provision_secondary_host.sh itself is untouched by this ticket (invariant
# 2) - this is a SEPARATE script for a SEPARATE shape, not a flag on it.
#
# Usage: provision_autonomous_host.sh <swarm-name> <repo-clone-url> [project-root]
#   swarm-name:      this box's unique swarm_name (see generate_autonomous_conf.sh) -
#                     validated FIRST, before any package/substrate step, so a
#                     refused name leaves the host untouched (autonomous-bootstrap-05).
#   repo-clone-url:  the repo-scoped credential's clone URL (deploy key or
#                    fine-grained PAT - see the runbook's "repo-scoped
#                    credentials only" section BEFORE running this).
#   project-root:    where to clone; defaults to $HOME/swarmforgevc
#
# Env:
#   PROVISION_AUTONOMOUS_DRYRUN=1  print every action this script would take
#                                  (package install, file write, unit
#                                  enable) instead of taking it - no sudo,
#                                  no download, no clone, no systemd state
#                                  change (invariant 1). The conf/unit files
#                                  ARE still rendered for real to a scratch
#                                  path (no root needed, mutates no
#                                  installed state) - the seam a test drives
#                                  to prove which units it would act on.
#   PROVISION_AUTONOMOUS_UNIT_TMP_DIR  where generated units are rendered
#                                  before being moved into place (default
#                                  /tmp) - overridable so concurrent test
#                                  runs never share a filename.

set -euo pipefail

USAGE="Usage: provision_autonomous_host.sh <swarm-name> <repo-clone-url> [project-root]"
SWARM_NAME="${1:?$USAGE}"
CLONE_URL="${2:?$USAGE}"
PROJECT_ROOT="${3:-$HOME/swarmforgevc}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOCK_FILE="$REPO_ROOT/swarmforge.lock.json"

# shellcheck source=lib/host_bootstrap.sh
source "$SCRIPT_DIR/lib/host_bootstrap.sh"

if [[ "${PROVISION_AUTONOMOUS_DRYRUN:-}" == "1" ]]; then
  BOOTSTRAP_DRYRUN=1
fi

# ── step 0: validate the swarm name BEFORE any host mutation ──────────────
# autonomous-bootstrap-05: a refused name must leave the host untouched -
# validated against THIS checkout's own copy of the generator/template
# (the one running right now), since $PROJECT_ROOT may not exist yet on a
# genuinely bare box. Writes to a throwaway path; the real per-project conf
# is (re)generated at step 6 below, against the CLONED repo's own copy, the
# same precedent provision_secondary_host.sh's own step 6 already sets.
NAME_CHECK_TMP="$(mktemp)"
trap 'rm -f "$NAME_CHECK_TMP"' EXIT
if ! "$SCRIPT_DIR/generate_autonomous_conf.sh" "$SWARM_NAME" "$NAME_CHECK_TMP" 2>"$NAME_CHECK_TMP.err"; then
  cat "$NAME_CHECK_TMP.err" >&2
  rm -f "$NAME_CHECK_TMP.err"
  exit 1
fi
rm -f "$NAME_CHECK_TMP.err"

bootstrap_log "1/7 installing base packages (tmux, git, gh, curl, python3)"
bootstrap_install_base_packages

bootstrap_require_cmd python3
[[ -f "$LOCK_FILE" ]] || bootstrap_die "swarmforge.lock.json not found at $LOCK_FILE - run this script from a cloned repo checkout"

ARCH="$(bootstrap_detect_arch)"
bootstrap_log "detected architecture: $ARCH"

bootstrap_log "2/7 installing gh (GitHub CLI)"
bootstrap_install_gh

bootstrap_log "3/7 installing babashka (pinned)"
bootstrap_install_babashka "$LOCK_FILE" "$ARCH"

bootstrap_log "4/7 installing Node.js (pinned major line)"
bootstrap_install_node "$LOCK_FILE"

bootstrap_log "5/7 installing claude CLI (pinned version, auto-update disabled)"
bootstrap_install_claude_cli "$LOCK_FILE"

bootstrap_log "6/7 cloning the repo and generating this box's AUTONOMOUS conf + units"
bootstrap_clone_repo "$CLONE_URL" "$PROJECT_ROOT"

# Conf/unit RENDERING is never dry-run-gated, matching
# provision_primary_host.sh's own precedent: writing to a scratch path
# needs no root and mutates no INSTALLED host state, so it is the seam a
# test (or an operator) inspects to see exactly what would be installed.
# Only the mv-into-/etc/systemd-system and systemctl steps below - the
# actual host mutation - are dry-run-gated.
mkdir -p "$PROJECT_ROOT/swarmforge/packs"
"$PROJECT_ROOT/swarmforge/deploy/generate_autonomous_conf.sh" "$SWARM_NAME" \
  "$PROJECT_ROOT/swarmforge/packs/${SWARM_NAME}.conf"

UNIT_TMP_DIR="${PROVISION_AUTONOMOUS_UNIT_TMP_DIR:-/tmp}"
GENERATOR="$PROJECT_ROOT/swarmforge/deploy/generate_systemd_units.sh"

# BL-628 scenario 07: unit content has exactly one author - every unit
# below is rendered by generate_systemd_units.sh, never composed here.
SWARM_UNIT_NAME="swarmforge-${SWARM_NAME}.service"
OPERATOR_UNIT_NAME="swarmforge-operator-${SWARM_NAME}.service"
# The front-desk unit provision_secondary_host.sh never installs at all -
# BL-359 called that omission "exactly as dark as no unit at all", and an
# autonomous swarm's own Telegram channel is not an optional extra.
FRONT_DESK_UNIT_NAME="swarmforge-front-desk-${SWARM_NAME}.service"

SWARM_UNIT_TMP="${UNIT_TMP_DIR}/${SWARM_UNIT_NAME}"
OPERATOR_UNIT_TMP="${UNIT_TMP_DIR}/${OPERATOR_UNIT_NAME}"
FRONT_DESK_UNIT_TMP="${UNIT_TMP_DIR}/${FRONT_DESK_UNIT_NAME}"

"$GENERATOR" "$PROJECT_ROOT" "$SWARM_NAME" "$(whoami)" "$SWARM_UNIT_TMP"
"$GENERATOR" "$PROJECT_ROOT" "$SWARM_NAME" "$(whoami)" "$OPERATOR_UNIT_TMP" --unit=operator
"$GENERATOR" "$PROJECT_ROOT" "$SWARM_NAME" "$(whoami)" "$FRONT_DESK_UNIT_TMP" --unit=front-desk

bootstrap_log "7/7 installing and enabling the swarm, operator and front-desk units"
if bootstrap_is_dryrun; then
  bootstrap_log_dryrun "sudo mv $SWARM_UNIT_TMP /etc/systemd/system/$SWARM_UNIT_NAME"
  bootstrap_log_dryrun "sudo mv $OPERATOR_UNIT_TMP /etc/systemd/system/$OPERATOR_UNIT_NAME"
  bootstrap_log_dryrun "sudo mv $FRONT_DESK_UNIT_TMP /etc/systemd/system/$FRONT_DESK_UNIT_NAME"
  bootstrap_log_dryrun "install -d -m 0755 /etc/swarmforge; touch /etc/swarmforge/${SWARM_NAME}.env; chmod 600 /etc/swarmforge/${SWARM_NAME}.env"
  bootstrap_log_dryrun "sudo systemctl daemon-reload"
  bootstrap_log_dryrun "sudo systemctl enable --now $OPERATOR_UNIT_NAME"
  bootstrap_log_dryrun "sudo systemctl enable --now $FRONT_DESK_UNIT_NAME"
  bootstrap_log_dryrun "sudo systemctl enable $SWARM_UNIT_NAME"
else
  sudo mv "$SWARM_UNIT_TMP" "/etc/systemd/system/$SWARM_UNIT_NAME"
  sudo mv "$OPERATOR_UNIT_TMP" "/etc/systemd/system/$OPERATOR_UNIT_NAME"
  sudo mv "$FRONT_DESK_UNIT_TMP" "/etc/systemd/system/$FRONT_DESK_UNIT_NAME"

  # Same per-pack secrets file both generated units' EnvironmentFile=
  # reads - provision_secondary_host.sh's own precedent (a systemd service
  # starts with a clean environment; a token exported to a shell profile
  # never reaches it).
  sudo install -d -m 0755 /etc/swarmforge
  sudo touch "/etc/swarmforge/${SWARM_NAME}.env"
  sudo chmod 600 "/etc/swarmforge/${SWARM_NAME}.env"

  sudo systemctl daemon-reload
  sudo systemctl enable --now "$OPERATOR_UNIT_NAME"
  sudo systemctl enable --now "$FRONT_DESK_UNIT_NAME"
  # Not --now: the swarm unit needs claude auth in place first (step 1
  # below) - matches provision_secondary_host.sh's own posture.
  sudo systemctl enable "$SWARM_UNIT_NAME"
fi

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
     what the generated units' EnvironmentFile= actually reads).

  2. Give this box its OWN Telegram bot token (BL-622 - a second swarm
     that inherits the primary's token steals its messages) and write it
     into /etc/swarmforge/${SWARM_NAME}.env alongside the claude token.

  3. Register the GitHub Actions self-hosted runner for this box's arch
     ($ARCH) using its own installer and systemd unit (./svc.sh install &&
     ./svc.sh start) - the runner project maintains that unit itself, so it
     is not generated here.

  4. Run the onboarding ceremony (survey/propose/negotiate/gate) on the
     PRIMARY box against this project's repository URL BEFORE this remote
     box's swarm is started - the contract (project.prompt/engineering.prompt)
     is committed there and pulled here, never negotiated on the remote box.

  5. Start the swarm for the first time:
       sudo systemctl start swarmforge-${SWARM_NAME}.service
     (subsequent boots start it automatically - that is what
     'systemctl enable' above already configured).

Note: swarmforge-operator-${SWARM_NAME}.service and
swarmforge-front-desk-${SWARM_NAME}.service are already enabled AND
started (systemd supervises both - Restart=always, never permanently gives
up on a crash burst, survives a reboot). They will retry harmlessly until
steps 1-2's credentials are in place; nothing further to do for them here.

EOF
