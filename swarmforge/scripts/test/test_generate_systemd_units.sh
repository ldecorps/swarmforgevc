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

echo "ALL PASS"
