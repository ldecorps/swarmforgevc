#!/usr/bin/env bash
# BL-628: provision_autonomous_host.sh - the composed bare-host-to-
# autonomous-swarm bootstrap. PROVISION_AUTONOMOUS_DRYRUN=1 is this
# script's own seam (mirrors provision_primary_host.sh's own
# PROVISION_PRIMARY_DRYRUN convention, test_provision_primary_host.sh) - no
# sudo, no download, no clone, no real systemd state change - so this suite
# proves the exact action sequence without touching the real host. Conf and
# unit files ARE still rendered for real (a /tmp path, no root needed) via
# the REAL generate_autonomous_conf.sh / generate_systemd_units.sh - never
# a hand-rolled substitute for either.

set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp_cleanup.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALLER="$SCRIPT_DIR/../../deploy/provision_autonomous_host.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

# A fixture repo good enough to stand in for $PROJECT_ROOT after cloning -
# provision_autonomous_host.sh reads swarmforge.lock.json relative to ITS
# OWN checkout (this repo) for steps 1-5, but calls the CLONED copy's own
# generate_autonomous_conf.sh/generate_systemd_units.sh at step 6+, so a
# fixture clone must carry those for real.
REAL_REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

mk_fixture_repo() {
  local d; d="$(mktemp -d)"; register_tmp_dir "$d"
  mkdir -p "$d/swarmforge/deploy/lib" "$d/swarmforge/packs" "$d/swarmforge/scripts"
  cp "$REAL_REPO_ROOT/swarmforge/deploy/generate_autonomous_conf.sh" "$d/swarmforge/deploy/"
  cp "$REAL_REPO_ROOT/swarmforge/deploy/generate_systemd_units.sh" "$d/swarmforge/deploy/"
  cp "$REAL_REPO_ROOT/swarmforge/packs/autonomous-swarm.conf" "$d/swarmforge/packs/"
  git init -q "$d"
  (cd "$d" && git config user.email t@t && git config user.name t && git add -A && git commit -q -m seed)
  printf '%s' "$d"
}

# ── every case drives the installer with its own unit-tmp dir - this suite
#    runs from several worktrees at once, and a shared filename would let
#    one run's assertions read another run's generated unit ──────────────

# ── autonomous-bootstrap-05: a refused swarm-name leaves the host
#    untouched - no package install line appears at all ───────────────────
UNIT_TMP="$(mktemp -d)"; register_tmp_dir "$UNIT_TMP"
CLONE_TARGET="$(mktemp -d)"; register_tmp_dir "$CLONE_TARGET"
rm -rf "$CLONE_TARGET"
set +e
OUT="$(PROVISION_AUTONOMOUS_UNIT_TMP_DIR="$UNIT_TMP" PROVISION_AUTONOMOUS_DRYRUN=1 bash "$INSTALLER" autonomous "$REAL_REPO_ROOT" "$CLONE_TARGET" 2>&1)"
RC=$?
set -e
[[ "$RC" -ne 0 ]] || fail "expected a non-zero exit for the placeholder swarm-name 'autonomous'"
grep -qi "placeholder" <<< "$OUT" || fail "expected the refusal reason to name the placeholder conflict; got: $OUT"
echo "$OUT" | grep -q "^\[bootstrap\] 1/7" && fail "autonomous-bootstrap-05: nothing must be installed for a refused name - package-install step 1/7 must never start; got: $OUT"
[[ ! -d "$CLONE_TARGET" ]] || fail "autonomous-bootstrap-05: nothing must be cloned for a refused name"
pass "autonomous-bootstrap-05: a swarm-name that is the placeholder shipped in the pack is refused before any host mutation"

# ── autonomous-bootstrap-05: a name already claimed by a live swarm ────────
COLLIDE_DIR="$(mktemp -d)"; register_tmp_dir "$COLLIDE_DIR"
touch "$COLLIDE_DIR/swarmforge-taken.service"
UNIT_TMP="$(mktemp -d)"; register_tmp_dir "$UNIT_TMP"
CLONE_TARGET="$(mktemp -d)"; register_tmp_dir "$CLONE_TARGET"
rm -rf "$CLONE_TARGET"
set +e
OUT="$(SWARMFORGE_SYSTEMD_UNIT_DIR="$COLLIDE_DIR" PROVISION_AUTONOMOUS_UNIT_TMP_DIR="$UNIT_TMP" PROVISION_AUTONOMOUS_DRYRUN=1 bash "$INSTALLER" taken "$REAL_REPO_ROOT" "$CLONE_TARGET" 2>&1)"
RC=$?
set -e
[[ "$RC" -ne 0 ]] || fail "expected a non-zero exit for a swarm-name already claimed by a live swarm"
grep -qi "already live" <<< "$OUT" || fail "expected the refusal reason to name the live-swarm collision; got: $OUT"
echo "$OUT" | grep -q "^\[bootstrap\] 1/7" && fail "nothing must be installed for a refused name; got: $OUT"
pass "autonomous-bootstrap-05: a swarm-name already claimed by a live swarm on this host is refused before any host mutation"

# ── autonomous-bootstrap-02/06: a valid name proceeds through every step,
#    dry-run prints every action, real state is never touched ─────────────
FIXTURE="$(mk_fixture_repo)"
UNIT_TMP="$(mktemp -d)"; register_tmp_dir "$UNIT_TMP"
CLONE_TARGET="$FIXTURE"
OUT="$(PROVISION_AUTONOMOUS_UNIT_TMP_DIR="$UNIT_TMP" PROVISION_AUTONOMOUS_DRYRUN=1 bash "$INSTALLER" acme-vps "$FIXTURE" "$CLONE_TARGET" 2>&1)"

echo "$OUT" | grep -q "^\[bootstrap\] 1/7" || fail "expected the package-install step to run for a valid name; got:\n$OUT"
pass "a valid swarm-name proceeds past step 0's name check into the bootstrap steps"

echo "$OUT" | grep -qi "DRYRUN: apt-get" || fail "autonomous-bootstrap-06 (package install): expected apt-get to be printed, not run; got:\n$OUT"
pass "autonomous-bootstrap-06: every package install is printed, never run"

echo "$OUT" | grep -q "DRYRUN: sudo mv .*swarmforge-acme-vps.service" \
  || fail "autonomous-bootstrap-02: expected the swarm unit to be installed under the given swarm name; got:\n$OUT"
echo "$OUT" | grep -q "DRYRUN: sudo mv .*swarmforge-operator-acme-vps.service" \
  || fail "autonomous-bootstrap-02: expected the operator unit to be installed; got:\n$OUT"
echo "$OUT" | grep -q "DRYRUN: sudo mv .*swarmforge-front-desk-acme-vps.service" \
  || fail "autonomous-bootstrap-02: expected the FRONT-DESK unit to be installed (the secondary path never installs this one - BL-359's own gap); got:\n$OUT"
pass "autonomous-bootstrap-02: the swarm, operator AND front-desk units are all installed and enabled"

echo "$OUT" | grep -q "DRYRUN: sudo systemctl enable --now swarmforge-operator-acme-vps.service" \
  || fail "expected the operator unit to be enabled --now; got:\n$OUT"
echo "$OUT" | grep -q "DRYRUN: sudo systemctl enable --now swarmforge-front-desk-acme-vps.service" \
  || fail "expected the front-desk unit to be enabled --now; got:\n$OUT"
echo "$OUT" | grep -q "DRYRUN: sudo systemctl enable swarmforge-acme-vps.service" \
  || fail "expected the swarm unit to be enabled (not --now - needs claude auth first); got:\n$OUT"
echo "$OUT" | grep -q "DRYRUN: sudo systemctl enable --now swarmforge-acme-vps.service" \
  && fail "the SWARM unit must not be started --now (it needs claude auth in place first)"
pass "autonomous-bootstrap-06 (unit enable): every enable is printed, never run; the swarm unit is enabled but not started"

[[ -f "$UNIT_TMP/swarmforge-acme-vps.service" ]] || fail "expected the swarm unit to actually be generated (dry-run only skips install/enable)"
grep -q "^Restart=on-failure$" "$UNIT_TMP/swarmforge-acme-vps.service" || fail "expected the generated swarm unit to carry Restart=on-failure"
[[ -f "$UNIT_TMP/swarmforge-operator-acme-vps.service" ]] || fail "expected the operator unit to actually be generated"
[[ -f "$UNIT_TMP/swarmforge-front-desk-acme-vps.service" ]] || fail "expected the front-desk unit to actually be generated"
pass "scenario 07: every rendered unit came from the real generate_systemd_units.sh, not a hand-authored substitute"

[[ -f "$FIXTURE/swarmforge/packs/acme-vps.conf" ]] || fail "expected the autonomous conf to be generated into the cloned repo"
grep -q "^config swarm_name acme-vps$" "$FIXTURE/swarmforge/packs/acme-vps.conf" || fail "expected the generated conf to carry the given swarm name"
grep -qi "^config swarm_mode" "$FIXTURE/swarmforge/packs/acme-vps.conf" && fail "the generated conf must carry no swarm_mode line (autonomous is the default)"
pass "autonomous-bootstrap-01: the generated conf (a file write, real even in dry-run - no root needed) declares an autonomous swarm"

echo "ALL PASS"
