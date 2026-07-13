#!/usr/bin/env bash
# BL-101: generate_systemd_units.sh renders the boot-time swarm unit for a
# headless secondary host, parameterized per box (project root, pack name,
# linux user) - asserts the required directives are present and correctly
# substituted, and that the launch/stop paths match the existing ./swarm
# and ./swarm-kill scripts rather than a bespoke start/stop mechanism.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
GENERATOR="$SCRIPT_DIR/../../deploy/generate_systemd_units.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT

# ── 01: correct substitution of every per-host parameter ────────────────────
UNIT="$("$GENERATOR" /home/pi/swarmforgevc pi5 pi)"

grep -q "^WorkingDirectory=/home/pi/swarmforgevc$" <<< "$UNIT" || fail "01: expected WorkingDirectory to name the project root"
grep -q "^User=pi$" <<< "$UNIT" || fail "01: expected User to name the linux user"
grep -q "^ExecStart=/home/pi/swarmforgevc/swarm /home/pi/swarmforgevc --pack pi5\$" <<< "$UNIT" \
  || fail "01: expected ExecStart to invoke the real ./swarm launcher with the right pack"
grep -q "^ExecStop=/home/pi/swarmforgevc/swarm-kill$" <<< "$UNIT" \
  || fail "01: expected ExecStop to invoke the real ./swarm-kill teardown, not a bespoke one"
pass "01: project root, linux user, and pack name are correctly substituted"

# ── 01b (architect violation fix): secrets set for the Option B headless-
#     auth path (CLAUDE_CODE_OAUTH_TOKEN) must reach the swarm process even
#     though systemd services start with a clean env, not the launching
#     user's shell profile - EnvironmentFile= is the fix; '-' tolerates the
#     file being absent for Option A/interactive-auth operators. ───────────
grep -q "^EnvironmentFile=-/etc/swarmforge/pi5.env$" <<< "$UNIT" \
  || fail "01b: expected an optional EnvironmentFile= naming a per-pack file outside the repo clone; got: $UNIT"
pass "01b: EnvironmentFile= lets operator-set secrets (e.g. CLAUDE_CODE_OAUTH_TOKEN) reach the systemd-launched process"

# ── 02: boots unattended (enabled at multi-user.target, no manual step) ─────
grep -q "^WantedBy=multi-user.target$" <<< "$UNIT" || fail "02: expected WantedBy=multi-user.target so 'systemctl enable' makes it boot-persistent"
pass "02: the unit installs against multi-user.target for unattended boot"

# ── 03: RemainAfterExit so the launched tmux/daemon session is not torn down
#     the instant ./swarm's own launch step returns ─────────────────────────
grep -q "^Type=oneshot$" <<< "$UNIT" || fail "03: expected Type=oneshot (./swarm launches and returns; the tmux server/daemon persist independently)"
grep -q "^RemainAfterExit=yes$" <<< "$UNIT" || fail "03: expected RemainAfterExit=yes so the unit stays 'active' after ./swarm exits"
pass "03: Type=oneshot + RemainAfterExit=yes matches how ./swarm actually launches and returns"

# ── 04: headless, no terminal emulator spawned ──────────────────────────────
grep -q "^Environment=SWARMFORGE_TERMINAL=none$" <<< "$UNIT" || fail "04: expected SWARMFORGE_TERMINAL=none for a headless box"
pass "04: launches headless (SWARMFORGE_TERMINAL=none), matching the WSL2 bring-up precedent"

# ── 05: no listening/inbound directives (BL-101 headless-03 outbound-only) ──
grep -qiE "^(Socket|Listen)" <<< "$UNIT" && fail "05: unit must not declare any inbound-listening directive"
pass "05: the unit declares nothing that opens an inbound listener"

# ── 06: rejects a relative project-root (systemd units need absolute paths) ─
set +e
"$GENERATOR" relative/path pi5 pi >/dev/null 2>"$ROOT/err.txt"
RC=$?
set -e
[[ "$RC" -ne 0 ]] || fail "06: expected a non-zero exit for a relative project-root"
grep -qi "absolute" "$ROOT/err.txt" || fail "06: expected a clear error naming the constraint; got: $(cat "$ROOT/err.txt")"
pass "06: a relative project-root is rejected with a clear error"

# ── 07: writing to an explicit output path matches stdout byte-for-byte ────
"$GENERATOR" /home/pi/swarmforgevc pi5 pi "$ROOT/via-path.service"
diff <(printf '%s\n' "$UNIT") <(cat "$ROOT/via-path.service") >/dev/null \
  || fail "07: expected the output-path form to match the stdout form byte-for-byte"
pass "07: an explicit output path produces the same content as stdout"

# ── 08 (BL-304): omitting --unit still defaults to the swarm unit
#     (backward compatibility - every call site above uses the 3/4-arg
#     form with no --unit= flag at all) ──────────────────────────────────
UNIT_DEFAULT="$("$GENERATOR" /home/pi/swarmforgevc pi5 pi)"
diff <(printf '%s\n' "$UNIT") <(printf '%s\n' "$UNIT_DEFAULT") >/dev/null \
  || fail "08: expected the no-flag form to still render the swarm unit unchanged"
pass "08: no --unit= flag still defaults to the swarm unit (backward compatible)"

# ── BL-304: --unit=operator renders the operator-runtime unit ──────────────
OP_UNIT="$("$GENERATOR" /home/pi/swarmforgevc pi5 pi --unit=operator)"

# ── operator-autostart-01: restarts on any exit, never permanently gives up ─
grep -q "^Restart=always$" <<< "$OP_UNIT" || fail "operator-autostart-01: expected Restart=always"
grep -q "^StartLimitIntervalSec=0$" <<< "$OP_UNIT" \
  || fail "operator-autostart-01: expected StartLimitIntervalSec=0 (disables systemd's own start-rate-limit - the exact analogue of the BL-303 sticky-give-up defect)"
pass "operator-autostart-01: Restart=always + StartLimitIntervalSec=0 - a crash burst never permanently stops the unit"

# ── operator-autostart-02: boot-enabled ──────────────────────────────────
grep -q "^WantedBy=multi-user.target$" <<< "$OP_UNIT" \
  || fail "operator-autostart-02: expected WantedBy=multi-user.target so the runtime comes back after a reboot"
pass "operator-autostart-02: the operator unit installs against multi-user.target for boot autostart"

# ── operator-autostart-03: carries secrets via EnvironmentFile ──────────────
grep -q "^EnvironmentFile=-/etc/swarmforge/pi5.env$" <<< "$OP_UNIT" \
  || fail "operator-autostart-03: expected an optional EnvironmentFile= naming the SAME per-pack file the swarm unit uses, so CLAUDE_CODE_OAUTH_TOKEN etc. reach the runtime and the disposable LLM it launches"
pass "operator-autostart-03: EnvironmentFile= carries the operator's secrets into the clean systemd environment"

# ── the ExecStart runs operator_runtime.bb in the FOREGROUND (Type=simple
#     main-pid tracking), never start_operator_runtime.sh (which
#     backgrounds via nohup and returns - wrong for systemd) ──────────────
grep -q "^Type=simple$" <<< "$OP_UNIT" || fail "expected Type=simple (a real foreground main pid for systemd to track/restart)"
grep -q "^ExecStart=bb /home/pi/swarmforgevc/swarmforge/scripts/operator_runtime.bb /home/pi/swarmforgevc\$" <<< "$OP_UNIT" \
  || fail "expected ExecStart to run operator_runtime.bb directly in the foreground, not start_operator_runtime.sh; got: $OP_UNIT"
pass "the operator unit's ExecStart runs operator_runtime.bb directly in the foreground"

# ── ExecStop touches the runtime's OWN stop-file (graceful, matches
#     start_operator_runtime.sh's own stop convention) ─────────────────────
grep -q "^ExecStop=.*touch /home/pi/swarmforgevc/.swarmforge/operator/stop\$" <<< "$OP_UNIT" \
  || fail "expected ExecStop to gracefully touch the runtime's own stop-file; got: $OP_UNIT"
pass "the operator unit's ExecStop gracefully signals the runtime's own stop-file"

# ── User=/WorkingDirectory= substitution matches the swarm unit's own
#     posture (same host, same clone) ───────────────────────────────────────
grep -q "^WorkingDirectory=/home/pi/swarmforgevc$" <<< "$OP_UNIT" || fail "expected WorkingDirectory to name the project root"
grep -q "^User=pi$" <<< "$OP_UNIT" || fail "expected User to name the linux user"
pass "the operator unit's WorkingDirectory/User are correctly substituted"

# ── an unknown --unit= value is rejected with a clear error, never a
#     silent fall-through to either unit ───────────────────────────────────
set +e
"$GENERATOR" /home/pi/swarmforgevc pi5 pi --unit=bogus >/dev/null 2>"$ROOT/unit-err.txt"
RC=$?
set -e
[[ "$RC" -ne 0 ]] || fail "expected a non-zero exit for an unknown --unit= value"
grep -qi "unit" "$ROOT/unit-err.txt" || fail "expected a clear error naming the constraint; got: $(cat "$ROOT/unit-err.txt")"
pass "an unknown --unit= value is rejected with a clear error"

# ── --unit= interacts correctly with an explicit output path regardless of
#     argument order ────────────────────────────────────────────────────────
"$GENERATOR" /home/pi/swarmforgevc pi5 pi "$ROOT/via-path-operator.service" --unit=operator
diff <(printf '%s\n' "$OP_UNIT") <(cat "$ROOT/via-path-operator.service") >/dev/null \
  || fail "expected the operator unit written via an explicit output path to match its stdout form byte-for-byte"
pass "the operator unit's explicit-output-path form matches its stdout form byte-for-byte"

# ── BL-351: --unit=front-desk renders the front-desk unit ──────────────────
FD_UNIT="$("$GENERATOR" /home/pi/swarmforgevc pi5 pi --unit=front-desk)"

# ── front-desk-survives-reboot-01: is generated at all, alongside the others ─
grep -q "front desk" <<< "$FD_UNIT" || fail "front-desk-survives-reboot-01: expected a front-desk unit description"
pass "front-desk-survives-reboot-01: a front-desk service is generated alongside swarm/operator"

# ── front-desk-survives-reboot-02: restarts on any exit, never permanently
#     gives up (the daemon-side bounded-restart already lives in
#     front_desk_supervisor.bb; THIS is what brings the supervisor itself
#     back if IT dies, or after a reboot) ───────────────────────────────────
grep -q "^Restart=always$" <<< "$FD_UNIT" || fail "front-desk-survives-reboot-02: expected Restart=always"
grep -q "^StartLimitIntervalSec=0$" <<< "$FD_UNIT" \
  || fail "front-desk-survives-reboot-02: expected StartLimitIntervalSec=0, the same anti-sticky-give-up posture as the operator unit"
pass "front-desk-survives-reboot-02/04: Restart=always + StartLimitIntervalSec=0 - a dead front desk is restarted without a human"

# ── boot-enabled ─────────────────────────────────────────────────────────────
grep -q "^WantedBy=multi-user.target$" <<< "$FD_UNIT" \
  || fail "front-desk-survives-reboot-01: expected WantedBy=multi-user.target so the front desk comes back after a reboot"
pass "front-desk-survives-reboot-01: the front-desk unit installs against multi-user.target for boot autostart"

# ── carries secrets via the SAME per-pack EnvironmentFile the other units use
#     (TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID/TELEGRAM_PRINCIPAL_USER_ID) ───────
grep -q "^EnvironmentFile=-/etc/swarmforge/pi5.env$" <<< "$FD_UNIT" \
  || fail "expected the SAME per-pack EnvironmentFile= the swarm/operator units use, so Telegram credentials reach the front desk"
pass "the front-desk unit's EnvironmentFile= carries its Telegram secrets into the clean systemd environment"

# ── Type=forking + PIDFile=, NOT Type=simple: launch_front_desk.sh forks the
#     supervisor into the background and exits - Type=simple would track
#     THAT near-immediate exit as "the service stopped" and relaunch the
#     launcher in a tight loop instead of ever tracking the real supervisor ──
grep -q "^Type=forking$" <<< "$FD_UNIT" \
  || fail "expected Type=forking (launch_front_desk.sh forks and exits; the real daemon is tracked via PIDFile)"
grep -q "^PIDFile=/home/pi/swarmforgevc/.swarmforge/operator/front-desk-supervisor.pid$" <<< "$FD_UNIT" \
  || fail "expected PIDFile= naming front_desk_supervisor.bb's own real pid file; got: $FD_UNIT"
pass "the front-desk unit uses Type=forking + PIDFile=, matching launch_front_desk.sh's own fork-and-exit shape"

# ── ExecStart runs the REAL launch_front_desk.sh (idempotent already-running
#     guard reused unchanged - front-desk-survives-reboot-05 depends on this,
#     never a bespoke launcher) ─────────────────────────────────────────────
grep -q "^ExecStart=/home/pi/swarmforgevc/swarmforge/scripts/launch_front_desk.sh /home/pi/swarmforgevc\$" <<< "$FD_UNIT" \
  || fail "expected ExecStart to invoke the real launch_front_desk.sh; got: $FD_UNIT"
pass "the front-desk unit's ExecStart reuses the real launch_front_desk.sh, including its own idempotent already-running guard"

# ── ExecStop touches front_desk_supervisor.bb's OWN stop-file (graceful,
#     matches its real stop-file loop exactly, never a bespoke teardown) ────
grep -q "^ExecStop=.*touch /home/pi/swarmforgevc/.swarmforge/operator/front-desk-supervisor.stop\$" <<< "$FD_UNIT" \
  || fail "expected ExecStop to gracefully touch front_desk_supervisor.bb's own stop-file; got: $FD_UNIT"
pass "the front-desk unit's ExecStop gracefully signals front_desk_supervisor.bb's own real stop-file"

# ── User=/WorkingDirectory= substitution ─────────────────────────────────────
grep -q "^WorkingDirectory=/home/pi/swarmforgevc$" <<< "$FD_UNIT" || fail "expected WorkingDirectory to name the project root"
grep -q "^User=pi$" <<< "$FD_UNIT" || fail "expected User to name the linux user"
pass "the front-desk unit's WorkingDirectory/User are correctly substituted"

# ── --unit= interacts correctly with an explicit output path ────────────────
"$GENERATOR" /home/pi/swarmforgevc pi5 pi "$ROOT/via-path-front-desk.service" --unit=front-desk
diff <(printf '%s\n' "$FD_UNIT") <(cat "$ROOT/via-path-front-desk.service") >/dev/null \
  || fail "expected the front-desk unit written via an explicit output path to match its stdout form byte-for-byte"
pass "the front-desk unit's explicit-output-path form matches its stdout form byte-for-byte"

echo "ALL PASS"
