#!/usr/bin/env bash
# BL-359: provision_primary_host.sh - the missing PRIMARY-host installer
# that actually enables the operator and front-desk systemd units
# (generate_systemd_units.sh already rendered both correctly since
# BL-304/BL-351/BL-366; nothing on this host ever installed them).
# PROVISION_PRIMARY_DRYRUN=1 is the real seam this script itself defines -
# no sudo, no real systemd state change - so this test proves the exact
# install/enable command sequence without touching the real host's
# systemd, mirroring launch_operator.sh's own OPERATOR_LAUNCH_DRYRUN
# convention. Unit files ARE still generated for real (a /tmp path, no
# root needed) via the REAL generate_systemd_units.sh - never a
# hand-rolled substitute for it.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALLER="$SCRIPT_DIR/../../deploy/provision_primary_host.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

mk_fixture() {
  local d; d="$(mktemp -d)"
  mkdir -p "$d/swarmforge"
  printf '%s' "$d"
}

# ── always-on-operator-presence-03/04: no swarmforge.conf swarm_name -
#    defaults to "primary" (swarmforge.sh's own single-swarm default) ────
F="$(mk_fixture)"
OUT="$(PROVISION_PRIMARY_DRYRUN=1 bash "$INSTALLER" "$F" 2>&1)"

echo "$OUT" | grep -q "DRYRUN: sudo mv .* /etc/systemd/system/swarmforge-operator-primary.service" \
  || fail "expected the operator unit to be installed under the default 'primary' pack name, got:\n$OUT"
echo "$OUT" | grep -q "DRYRUN: sudo mv .* /etc/systemd/system/swarmforge-front-desk-primary.service" \
  || fail "expected the front-desk unit to be installed under the default 'primary' pack name, got:\n$OUT"
pass "always-on-operator-presence-03/04: defaults to the 'primary' pack name when swarmforge.conf has none"

echo "$OUT" | grep -q "DRYRUN: sudo systemctl enable --now swarmforge-operator-primary.service" \
  || fail "expected the operator unit to be enabled --now, got:\n$OUT"
echo "$OUT" | grep -q "DRYRUN: sudo systemctl enable --now swarmforge-front-desk-primary.service" \
  || fail "expected the front-desk unit to ALSO be enabled --now (BL-336's own gap: front-desk had no boot unit installed anywhere), got:\n$OUT"
pass "always-on-operator-presence-04: BOTH the operator unit and the front-desk unit are installed and enabled - not just the operator half"

echo "$OUT" | grep -q "DRYRUN: sudo systemctl daemon-reload" || fail "expected a daemon-reload before enabling"
pass "a daemon-reload runs before the units are enabled"
rm -rf "$F"

# ── the generated units carry the actual boot/crash-recovery guarantee -
#    reuses generate_systemd_units.sh's own rendering, never re-derives it ──
F="$(mk_fixture)"
PROVISION_PRIMARY_DRYRUN=1 bash "$INSTALLER" "$F" >/dev/null
[[ -f /tmp/swarmforge-operator-primary.service ]] || fail "expected the operator unit to actually be generated (even in dry-run mode - only install/enable are skipped)"
grep -q "^Restart=always$" /tmp/swarmforge-operator-primary.service || fail "expected the generated operator unit to carry Restart=always"
grep -q "^WantedBy=multi-user.target$" /tmp/swarmforge-operator-primary.service || fail "expected the generated operator unit to carry WantedBy=multi-user.target"
[[ -f /tmp/swarmforge-front-desk-primary.service ]] || fail "expected the front-desk unit to actually be generated"
grep -q "^Restart=always$" /tmp/swarmforge-front-desk-primary.service || fail "expected the generated front-desk unit to carry Restart=always"
pass "always-on-operator-presence-04: the installed units genuinely carry Restart=always + WantedBy=multi-user.target - the mechanical proof a crash or a reboot recovers with no human"
rm -f /tmp/swarmforge-operator-primary.service /tmp/swarmforge-front-desk-primary.service
rm -rf "$F"

# ── a configured swarm_name overrides the "primary" default ──────────────
F="$(mk_fixture)"
cat > "$F/swarmforge/swarmforge.conf" <<'EOF'
config swarm_name dogfood
EOF
OUT="$(PROVISION_PRIMARY_DRYRUN=1 bash "$INSTALLER" "$F" 2>&1)"
echo "$OUT" | grep -q "swarmforge-operator-dogfood.service" || fail "expected the configured swarm_name (dogfood) to be used instead of the default, got:\n$OUT"
pass "an explicit swarmforge.conf swarm_name overrides the 'primary' default"
rm -rf "$F"

# ── idempotent: a second run against the same host is a safe no-op shape
#    (systemctl enable/enable --now are themselves idempotent; this proves
#    THIS script does not error or duplicate work on a re-run) ───────────
F="$(mk_fixture)"
PROVISION_PRIMARY_DRYRUN=1 bash "$INSTALLER" "$F" >/dev/null
PROVISION_PRIMARY_DRYRUN=1 bash "$INSTALLER" "$F" >/dev/null
pass "always-on-operator-presence-04: re-running the installer is safe (no error on a second, idempotent run)"
rm -rf "$F"
rm -f /tmp/swarmforge-operator-primary.service /tmp/swarmforge-front-desk-primary.service /tmp/swarmforge-operator-dogfood.service /tmp/swarmforge-front-desk-dogfood.service

echo "provision_primary_host smoke: ALL CHECKS PASSED"
