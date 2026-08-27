#!/usr/bin/env bash
# BL-101: generate_secondary_conf.sh customizes packs/second-swarm.conf with
# a per-host swarm_name. Validated the same way test_second_swarm_pack.sh
# validates the template itself: sourcing the real swarmforge.sh parser
# against the generated output, never a hand-rolled re-implementation of its
# rules.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
GENERATOR="$SCRIPT_DIR/../../deploy/generate_secondary_conf.sh"
SWARMFORGE_SH="$SCRIPT_DIR/../swarmforge.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

mk_root() {
  local root; root="$(cd "$(mktemp -d)" && pwd -P)"
  mkdir -p "$root/swarmforge/roles" "$root/.swarmforge"
  touch "$root/swarmforge/constitution.prompt"
  for role in specifier coder cleaner architect hardender documenter QA; do
    echo "role prompt" > "$root/swarmforge/roles/$role.prompt"
  done
  echo "$root"
}

# ── 01: swarm_name is substituted, everything else preserved ────────────────
ROOT="$(mk_root)"
trap 'rm -rf "$ROOT"' EXIT
"$GENERATOR" pi5 > "$ROOT/generated.conf"
cp "$ROOT/generated.conf" "$ROOT/swarmforge/swarmforge.conf"

OUT="$(zsh -c "source '$SWARMFORGE_SH' '$ROOT'; parse_config; check_primacy; \
  echo \"SWARM_NAME=\$SWARM_NAME\"; echo \"SWARM_MODE=\$SWARM_MODE\"; \
  echo \"SWARM_MODE_PRIMARY=\$SWARM_MODE_PRIMARY\"; \
  echo \"ROLES=\${ROLES[*]}\"" 2>&1)"
STATUS=$?

[[ "$STATUS" -eq 0 ]] || fail "01: the generated conf was rejected by the real parser; got: $OUT"
grep -q "^SWARM_NAME=pi5$" <<< "$OUT" || fail "01: expected swarm_name 'pi5'; got: $OUT"
grep -q "^SWARM_MODE=secondary$" <<< "$OUT" || fail "01: expected swarm_mode 'secondary' preserved; got: $OUT"
grep -q "^SWARM_MODE_PRIMARY=primary$" <<< "$OUT" || fail "01: expected swarm_mode_primary 'primary' preserved; got: $OUT"
ROLES_LINE="$(grep '^ROLES=' <<< "$OUT" | sed 's/^ROLES=//')"
for role in specifier coder cleaner architect hardender documenter QA; do
  grep -qw "$role" <<< "$ROLES_LINE" || fail "01: expected role '$role' preserved in the generated conf; got roles: $ROLES_LINE"
done
grep -qw "coordinator" <<< "$ROLES_LINE" && fail "01: generated secondary conf must not declare a coordinator window"
pass "01: generate_secondary_conf.sh substitutes swarm_name and preserves a valid secondary-mode pack"

# ── 02: an unrelated host still gets its own distinct name ───────────────────
"$GENERATOR" vps-hetzner1 > "$ROOT/generated2.conf"
grep -q "^config swarm_name vps-hetzner1$" "$ROOT/generated2.conf" \
  || fail "02: expected swarm_name 'vps-hetzner1' in the generated conf"
pass "02: a second host generates its own distinctly-named conf from the same template"

# ── 03: refuses an invalid swarm-name (rejects before ever writing a conf) ──
set +e
"$GENERATOR" "bad name" > "$ROOT/should-not-exist.conf" 2>"$ROOT/err.txt"
RC=$?
set -e
[[ "$RC" -ne 0 ]] || fail "03: expected a non-zero exit for an invalid swarm-name"
grep -qi "alphanumeric" "$ROOT/err.txt" || fail "03: expected a clear error naming the constraint; got: $(cat "$ROOT/err.txt")"
pass "03: an invalid swarm-name is rejected with a clear error, not silently written"

# ── 04: refuses to regenerate the placeholder name "second" ─────────────────
set +e
"$GENERATOR" second > /dev/null 2>"$ROOT/err2.txt"
RC=$?
set -e
[[ "$RC" -ne 0 ]] || fail "04: expected a non-zero exit when asked to regenerate the placeholder name 'second'"
grep -qi "second" "$ROOT/err2.txt" || fail "04: expected the error to explain the 'second' placeholder conflict; got: $(cat "$ROOT/err2.txt")"
pass "04: refuses to mint a duplicate 'second' - every host must get its own unique swarm_name"

# ── 05: writing to an explicit output path works the same as stdout ────────
"$GENERATOR" pi5 "$ROOT/via-path.conf"
diff <(cat "$ROOT/generated.conf") <(cat "$ROOT/via-path.conf") >/dev/null \
  || fail "05: expected the output-path form to match the stdout form byte-for-byte"
pass "05: an explicit output path produces the same content as stdout"

# ── 06: refuses to overwrite the shared template itself ─────────────────────
set +e
"$GENERATOR" second-swarm "$SCRIPT_DIR/../../packs/second-swarm.conf" 2>"$ROOT/err3.txt"
RC=$?
set -e
[[ "$RC" -ne 0 ]] || fail "06: expected a non-zero exit when the output path is the shared template itself"
grep -qi "shared template" "$ROOT/err3.txt" || fail "06: expected the error to explain the self-overwrite risk; got: $(cat "$ROOT/err3.txt")"
[[ -f "$SCRIPT_DIR/../../packs/second-swarm.conf" ]] || fail "06: the shared template must survive an attempted self-overwrite"
grep -q "^config swarm_name second\$" "$SCRIPT_DIR/../../packs/second-swarm.conf" \
  || fail "06: the shared template's own swarm_name must be untouched after the attempted self-overwrite"
pass "06: refuses to overwrite the shared packs/second-swarm.conf template itself"

echo "ALL PASS"
