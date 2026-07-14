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

# ── BL-366: the swarm unit gets the SAME crash-burst guard as operator/
#    front-desk (acceptance scenario 03 covers all three unit types) -
#    Restart=on-failure (never `always`: a oneshot unit's ExecStart EXITS
#    successfully every normal launch with RemainAfterExit=yes holding it
#    "active" - Restart=always would relaunch it in an infinite loop on
#    every clean success, not just on a genuine crash) and
#    StartLimitIntervalSec=0 in [Unit], never [Service]. ────────────────────
BB_ABS="$(command -v bb)"
[[ -n "$BB_ABS" ]] || fail "this test host has no 'bb' on PATH - cannot verify the absolute-path fix"
SWARM_UNIT_SECTION="$(sed -n '/^\[Unit\]/,/^\[Service\]/p' <<< "$UNIT")"
SWARM_SERVICE_SECTION="$(sed -n '/^\[Service\]/,/^\[Install\]/p' <<< "$UNIT")"
grep -q "^Restart=on-failure$" <<< "$UNIT" \
  || fail "BL-366: expected Restart=on-failure on the swarm unit (never 'always' - a oneshot's successful exit must not loop); got:\n$UNIT"
grep -q "^StartLimitIntervalSec=0$" <<< "$SWARM_UNIT_SECTION" \
  || fail "BL-366: expected StartLimitIntervalSec=0 inside the swarm unit's [Unit] section; got:\n$UNIT"
grep -q "^StartLimitIntervalSec=" <<< "$SWARM_SERVICE_SECTION" \
  && fail "BL-366: StartLimitIntervalSec must not appear in [Service] - systemd v230+ silently discards it there; got:\n$UNIT"
pass "BL-366: the swarm unit restarts on failure without looping on success, and its crash-burst guard lives where systemd honors it"

# ── BL-366 DEFECT A': Environment=PATH= so ./swarm/./swarm-kill (and
#    whatever THEY shell out to - bb, node, claude) find their interpreters
#    under systemd's own minimal PATH, which excludes ~/.local/bin. ─────────
grep -qE "^Environment=PATH=.*$(dirname "$BB_ABS")" <<< "$UNIT" \
  || fail "BL-366: expected the swarm unit's Environment=PATH= to include bb's directory ($(dirname "$BB_ABS")); got:\n$UNIT"
pass "BL-366: the swarm unit's Environment=PATH= includes bb's directory"

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

# ── BL-366 DEFECT B: StartLimitIntervalSec belongs in [Unit] - systemd v230+
#    silently DISCARDS it from [Service] with a warning, so the crash-burst
#    guard the generator's own comment claims is decorative unless it is
#    actually in [Unit]. A bare grep for the key (above) cannot see WHICH
#    section it landed in - assert the section placement directly. ──────────
UNIT_SECTION="$(sed -n '/^\[Unit\]/,/^\[Service\]/p' <<< "$OP_UNIT")"
SERVICE_SECTION="$(sed -n '/^\[Service\]/,/^\[Install\]/p' <<< "$OP_UNIT")"
grep -q "^StartLimitIntervalSec=0$" <<< "$UNIT_SECTION" \
  || fail "BL-366: expected StartLimitIntervalSec=0 inside [Unit] (silently ignored anywhere else); got:\n$OP_UNIT"
grep -q "^StartLimitIntervalSec=" <<< "$SERVICE_SECTION" \
  && fail "BL-366: StartLimitIntervalSec must not appear in [Service] - systemd v230+ discards it there with a warning; got:\n$OP_UNIT"
pass "BL-366: StartLimitIntervalSec=0 lives in [Unit], where systemd actually honors it"

# ── BL-366 DEFECT A': systemd hands units a minimal PATH that excludes a
#    user-local bin dir (~/.local/bin) - an Environment=PATH= naming bb's
#    (and, if resolvable, node's/claude's) directory lets scripts the unit
#    launches find their own interpreters too. ──────────────────────────────
grep -qE "^Environment=PATH=.*$(dirname "$BB_ABS")" <<< "$OP_UNIT" \
  || fail "BL-366: expected Environment=PATH= to include bb's directory ($(dirname "$BB_ABS")); got:\n$OP_UNIT"
pass "BL-366: the operator unit's Environment=PATH= includes bb's directory"

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

# ── BL-366 DEFECT A: systemd does not search PATH for ExecStart - "bb" alone
#    fails every start ("Command bb is not executable"). ExecStart must name
#    bb's real absolute path, resolved at generate time (this host's own
#    `command -v bb`), never the bare command name. ──────────────────────────
BB_ABS="$(command -v bb)"
[[ -n "$BB_ABS" ]] || fail "this test host has no 'bb' on PATH - cannot verify the absolute-path fix"
grep -q "^ExecStart=$BB_ABS /home/pi/swarmforgevc/swarmforge/scripts/operator_runtime.bb /home/pi/swarmforgevc\$" <<< "$OP_UNIT" \
  || fail "BL-366: expected ExecStart to name bb's resolved ABSOLUTE path (systemd cannot search PATH), not the bare command; got: $OP_UNIT"
pass "BL-366: the operator unit's ExecStart names bb's absolute path, not a bare command systemd cannot resolve"

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

# ── BL-366: when 'bb' cannot be resolved via PATH at all, generation must
#    hard-fail with a clear error rather than silently emitting a unit whose
#    ExecStart would fail systemd's own "Command bb is not executable" check
#    (the operator unit's ExecStart runs bb directly - required, not
#    best-effort, unlike node/claude which are only needed by the SCRIPTS
#    these units launch). Uses a restricted PATH with no 'bb' on it, rather
#    than mutating the real PATH env var, so this test host's own bb (wherever
#    it lives) is never actually reachable to the child process. ───────────
set +e
env -i PATH=/usr/bin:/bin "$GENERATOR" /home/pi/swarmforgevc pi5 pi >/dev/null 2>"$ROOT/bb-missing-err.txt"
RC=$?
set -e
[[ "$RC" -ne 0 ]] || fail "BL-366: expected a non-zero exit when 'bb' cannot be resolved via PATH"
grep -qi "bb" "$ROOT/bb-missing-err.txt" || fail "BL-366: expected a clear error naming 'bb'; got: $(cat "$ROOT/bb-missing-err.txt")"
pass "BL-366: generation hard-fails with a clear error when 'bb' cannot be resolved via PATH"

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

# ── BL-366 DEFECT B: same section-placement check as the operator unit -
#    StartLimitIntervalSec is silently discarded from [Service] (systemd
#    v230+), so the front-desk unit's crash-burst guard is just as decorative
#    unless it actually lives in [Unit]. ────────────────────────────────────
FD_UNIT_SECTION="$(sed -n '/^\[Unit\]/,/^\[Service\]/p' <<< "$FD_UNIT")"
FD_SERVICE_SECTION="$(sed -n '/^\[Service\]/,/^\[Install\]/p' <<< "$FD_UNIT")"
grep -q "^StartLimitIntervalSec=0$" <<< "$FD_UNIT_SECTION" \
  || fail "BL-366: expected StartLimitIntervalSec=0 inside the front-desk unit's [Unit] section; got:\n$FD_UNIT"
grep -q "^StartLimitIntervalSec=" <<< "$FD_SERVICE_SECTION" \
  && fail "BL-366: StartLimitIntervalSec must not appear in [Service]; got:\n$FD_UNIT"
pass "BL-366: the front-desk unit's crash-burst guard lives in [Unit], where systemd actually honors it"

# ── BL-366 DEFECT A': Environment=PATH= so launch_front_desk.sh (and
#    whatever it shells out to - bb, node, claude) finds its interpreters
#    under systemd's own minimal PATH. ──────────────────────────────────────
grep -qE "^Environment=PATH=.*$(dirname "$BB_ABS")" <<< "$FD_UNIT" \
  || fail "BL-366: expected the front-desk unit's Environment=PATH= to include bb's directory ($(dirname "$BB_ABS")); got:\n$FD_UNIT"
pass "BL-366: the front-desk unit's Environment=PATH= includes bb's directory"

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

# ── BL-366 THE ACTUAL FIX: systemd-analyze verify must run in the suite
#    against every rendered unit. This is the gate the ticket says would
#    have caught both defects in one second - a synthetic /home/pi/... path
#    above proves the CONTENT is right, but systemd-analyze verify also
#    checks that ExecStart/ExecStop actually resolve to a real executable
#    file, so it needs units pointing at a project root that genuinely
#    exists on THIS host: this repo's own checkout. ──────────────────────────
if ! command -v systemd-analyze >/dev/null 2>&1; then
  echo "SKIP: systemd-analyze not available on this host - cannot run the verify gate" >&2
else
  REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
  REAL_USER="$(whoami)"
  for unit_type in swarm operator front-desk; do
    unit_path="$ROOT/real-$unit_type.service"
    "$GENERATOR" "$REPO_ROOT" systemd-verify-test "$REAL_USER" "$unit_path" --unit="$unit_type"
    VERIFY_OUTPUT="$(systemd-analyze verify "$unit_path" 2>&1)"
    VERIFY_RC=$?
    [[ "$VERIFY_RC" -eq 0 ]] || fail "BL-366: systemd-analyze verify failed for the $unit_type unit (exit $VERIFY_RC): $VERIFY_OUTPUT"
    grep -qi "unknown key" <<< "$VERIFY_OUTPUT" \
      && fail "BL-366: systemd-analyze verify reported an ignored/unknown key for the $unit_type unit (a decorative guard): $VERIFY_OUTPUT"
    pass "BL-366: systemd-analyze verify accepts the $unit_type unit cleanly, no ignored keys"
  done
fi

echo "ALL PASS"
