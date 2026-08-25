#!/usr/bin/env bash
# BL-628: generate_autonomous_conf.sh customizes packs/autonomous-swarm.conf
# with a per-host swarm_name. Validated the same way
# test_generate_secondary_conf.sh validates its own generator: sourcing the
# real swarmforge.sh parser against the generated output, never a
# hand-rolled re-implementation of its rules.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib/tmp_cleanup.sh"
GENERATOR="$SCRIPT_DIR/../../deploy/generate_autonomous_conf.sh"
SWARMFORGE_SH="$SCRIPT_DIR/../swarmforge.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

mk_root() {
  local d; d="$(mktemp -d)"; register_tmp_dir "$d"
  local root; root="$(cd "$d" && pwd -P)"
  mkdir -p "$root/swarmforge/roles" "$root/.swarmforge"
  touch "$root/swarmforge/constitution.prompt"
  for role in specifier coder cleaner architect hardender documenter QA; do
    echo "role prompt" > "$root/swarmforge/roles/$role.prompt"
  done
  echo "$root"
}

# ── 01: swarm_name is substituted, autonomous mode/coordinator preserved ────
ROOT="$(mk_root)"
"$GENERATOR" acme-vps > "$ROOT/generated.conf"
cp "$ROOT/generated.conf" "$ROOT/swarmforge/swarmforge.conf"

OUT="$(XDG_RUNTIME_DIR=/tmp zsh -c "source '$SWARMFORGE_SH' '$ROOT'; parse_config; check_primacy; \
  echo \"SWARM_NAME=\$SWARM_NAME\"; echo \"SWARM_MODE=\$SWARM_MODE\"; \
  echo \"ROLES=\${ROLES[*]}\"" 2>&1)"
STATUS=$?

[[ "$STATUS" -eq 0 ]] || fail "01: the generated conf was rejected by the real parser; got: $OUT"
grep -q "^SWARM_NAME=acme-vps$" <<< "$OUT" || fail "01: expected swarm_name 'acme-vps'; got: $OUT"
grep -q "^SWARM_MODE=autonomous$" <<< "$OUT" || fail "01: expected swarm_mode 'autonomous'; got: $OUT"
ROLES_LINE="$(grep '^ROLES=' <<< "$OUT" | sed 's/^ROLES=//')"
for role in specifier coder cleaner architect hardender documenter QA coordinator; do
  grep -qw "$role" <<< "$ROLES_LINE" || fail "01: expected role '$role' present (including coordinator - autonomous-bootstrap-01); got roles: $ROLES_LINE"
done
pass "01: generate_autonomous_conf.sh substitutes swarm_name and produces a valid autonomous-mode pack with a coordinator window"

# ── 02: an unrelated host still gets its own distinct name ───────────────────
"$GENERATOR" widget-pi > "$ROOT/generated2.conf"
grep -q "^config swarm_name widget-pi$" "$ROOT/generated2.conf" \
  || fail "02: expected swarm_name 'widget-pi' in the generated conf"
pass "02: a second host generates its own distinctly-named conf from the same template"

# ── 03: refuses an invalid swarm-name (rejects before ever writing a conf) ──
set +e
"$GENERATOR" "bad name" > "$ROOT/should-not-exist.conf" 2>"$ROOT/err.txt"
RC=$?
set -e
[[ "$RC" -ne 0 ]] || fail "03: expected a non-zero exit for an invalid swarm-name"
grep -qi "alphanumeric" "$ROOT/err.txt" || fail "03: expected a clear error naming the constraint; got: $(cat "$ROOT/err.txt")"
pass "03: an invalid swarm-name is rejected with a clear error, not silently written"

# ── 04: refuses to regenerate the placeholder name "autonomous"
#    (autonomous-bootstrap-05: "the placeholder name shipped in the pack") ──
set +e
"$GENERATOR" autonomous > /dev/null 2>"$ROOT/err2.txt"
RC=$?
set -e
[[ "$RC" -ne 0 ]] || fail "04: expected a non-zero exit when asked to regenerate the placeholder name 'autonomous'"
grep -qi "placeholder" "$ROOT/err2.txt" || fail "04: expected the error to explain the placeholder conflict; got: $(cat "$ROOT/err2.txt")"
pass "04: refuses to mint a duplicate 'autonomous' - every host must get its own unique swarm_name"

# ── 05: refuses a name already claimed by a live swarm on this host
#    (autonomous-bootstrap-05: "already claimed by another live swarm") ──────
UNIT_DIR="$(mktemp -d)"; register_tmp_dir "$UNIT_DIR"
touch "$UNIT_DIR/swarmforge-taken.service"
set +e
SWARMFORGE_SYSTEMD_UNIT_DIR="$UNIT_DIR" "$GENERATOR" taken > /dev/null 2>"$ROOT/err3.txt"
RC=$?
set -e
[[ "$RC" -ne 0 ]] || fail "05: expected a non-zero exit for a name already claimed by a live swarm unit"
grep -qi "already live" "$ROOT/err3.txt" || fail "05: expected the error to explain the live-swarm collision; got: $(cat "$ROOT/err3.txt")"
pass "05: refuses a swarm_name already claimed by a live swarm unit on this host"

SWARMFORGE_SYSTEMD_UNIT_DIR="$UNIT_DIR" "$GENERATOR" not-taken > "$ROOT/via-unit-dir.conf"
grep -q "^config swarm_name not-taken$" "$ROOT/via-unit-dir.conf" \
  || fail "05b: a NON-colliding name in the same unit dir must still generate normally"
pass "05b: a distinct name against the same unit dir generates normally (the check is name-specific, not dir-wide)"

# ── 06: writing to an explicit output path works the same as stdout ────────
"$GENERATOR" acme-vps "$ROOT/via-path.conf"
diff <(cat "$ROOT/generated.conf") <(cat "$ROOT/via-path.conf") >/dev/null \
  || fail "06: expected the output-path form to match the stdout form byte-for-byte"
pass "06: an explicit output path produces the same content as stdout"

# ── 07: refuses to overwrite the shared template itself ─────────────────────
set +e
"$GENERATOR" acme-vps "$SCRIPT_DIR/../../packs/autonomous-swarm.conf" 2>"$ROOT/err4.txt"
RC=$?
set -e
[[ "$RC" -ne 0 ]] || fail "07: expected a non-zero exit when the output path is the shared template itself"
grep -qi "shared template" "$ROOT/err4.txt" || fail "07: expected the error to explain the self-overwrite risk; got: $(cat "$ROOT/err4.txt")"
[[ -f "$SCRIPT_DIR/../../packs/autonomous-swarm.conf" ]] || fail "07: the shared template must survive an attempted self-overwrite"
grep -q "^config swarm_name autonomous\$" "$SCRIPT_DIR/../../packs/autonomous-swarm.conf" \
  || fail "07: the shared template's own swarm_name must be untouched after the attempted self-overwrite"
pass "07: refuses to overwrite the shared packs/autonomous-swarm.conf template itself"

echo "ALL PASS"
