#!/usr/bin/env bash
# BL-224: the repo-root ./swarm launcher's mutation_cost pre-pass loop over
# backlog/paused/*.yaml is unguarded against a non-matching glob (bash
# nullglob is off by default) - an empty paused/ used to fabricate a real
# file literally named "*.yaml" (grep failing on the non-expanded literal
# pattern, then the else branch appending to it) and print glob-not-found
# noise to stderr on every launch.
#
# Drives the REAL repo-root ./swarm script end to end against a throwaway
# fixture tree: the real script file is copied to the fixture root (its own
# SCRIPT_DIR is derived from BASH_SOURCE - the script's OWN file location,
# not the cwd or an argument - so this is the only way to point it at a
# fixture instead of the real repo); swarmforge/scripts/shared-articles
# already exists so the tarball-download branch is skipped, and
# swarmforge.sh is replaced with a harmless stub so the final exec never
# launches a real swarm.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REAL_SWARM_SCRIPT="$(cd "$SCRIPT_DIR/../../.." && pwd)/swarm"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

make_fixture() {
  ROOT="$(mktemp -d)"
  mkdir -p "$ROOT/backlog/paused" "$ROOT/swarmforge/scripts/shared-articles"
  cp "$REAL_SWARM_SCRIPT" "$ROOT/swarm"
  chmod +x "$ROOT/swarm"
  cat > "$ROOT/swarmforge/scripts/swarmforge.sh" <<'STUB'
#!/usr/bin/env bash
echo "swarmforge.sh invoked with: $*"
exit 0
STUB
  chmod +x "$ROOT/swarmforge/scripts/swarmforge.sh"
}

run_swarm() {
  bash "$ROOT/swarm" 1>"$ROOT/stdout.txt" 2>"$ROOT/stderr.txt"
}

# ── 01 (empty-paused-glob-01): an empty paused/ creates no junk ticket, no glob noise ──
make_fixture
trap 'rm -rf "$ROOT"' EXIT
run_swarm

if compgen -G "$ROOT/backlog/paused/*.yaml" >/dev/null; then
  fail "01: expected no *.yaml file created in backlog/paused/, found: $(ls "$ROOT/backlog/paused/")"
fi
[[ ! -e "$ROOT/backlog/paused/*.yaml" ]] || fail "01: a file literally named '*.yaml' was created"
grep -qi "No such file or directory" "$ROOT/stderr.txt" && fail "01: expected no glob-not-found noise on stderr; got: $(cat "$ROOT/stderr.txt")"
grep -q "swarmforge.sh invoked" "$ROOT/stdout.txt" || fail "01: expected the launcher to still reach and exec swarmforge.sh"
pass "01 (BL-224 empty-paused-glob-01): an empty paused backlog creates no junk ticket and no glob noise"

# ── 02 (estimation-preserved-02): a paused item missing mutation_cost still gets one ──
make_fixture
trap 'rm -rf "$ROOT"' EXIT
cat > "$ROOT/backlog/paused/BL-9001.yaml" <<'EOF'
id: BL-9001
title: "a small fix"
status: todo
EOF
run_swarm

grep -q "^mutation_cost:" "$ROOT/backlog/paused/BL-9001.yaml" \
  || fail "02: expected BL-9001.yaml to gain a mutation_cost field; got: $(cat "$ROOT/backlog/paused/BL-9001.yaml")"
pass "02 (BL-224 estimation-preserved-02): a paused item missing mutation_cost still gets one estimated"

# ── 03 (estimation-untouched-03): a paused item that already has mutation_cost is unchanged ──
make_fixture
trap 'rm -rf "$ROOT"' EXIT
cat > "$ROOT/backlog/paused/BL-9002.yaml" <<'EOF'
id: BL-9002
title: "already estimated"
status: todo
mutation_cost: high
EOF
BEFORE_SHA="$(sha256sum "$ROOT/backlog/paused/BL-9002.yaml" | awk '{print $1}')"
run_swarm
AFTER_SHA="$(sha256sum "$ROOT/backlog/paused/BL-9002.yaml" | awk '{print $1}')"

[[ "$BEFORE_SHA" == "$AFTER_SHA" ]] \
  || fail "03: expected BL-9002.yaml to be byte-for-byte unchanged; before=$BEFORE_SHA after=$AFTER_SHA content=$(cat "$ROOT/backlog/paused/BL-9002.yaml")"
COUNT="$(grep -c "^mutation_cost:" "$ROOT/backlog/paused/BL-9002.yaml")"
[[ "$COUNT" == "1" ]] || fail "03: expected exactly one mutation_cost line, got $COUNT"
pass "03 (BL-224 estimation-untouched-03): a paused item that already has mutation_cost is left byte-for-byte unchanged"

# ── 04: re-running the pre-pass a second time over the same freshly-estimated item is idempotent ──
make_fixture
trap 'rm -rf "$ROOT"' EXIT
cat > "$ROOT/backlog/paused/BL-9003.yaml" <<'EOF'
id: BL-9003
title: "a small fix"
status: todo
EOF
run_swarm
AFTER_FIRST_SHA="$(sha256sum "$ROOT/backlog/paused/BL-9003.yaml" | awk '{print $1}')"
run_swarm
AFTER_SECOND_SHA="$(sha256sum "$ROOT/backlog/paused/BL-9003.yaml" | awk '{print $1}')"

[[ "$AFTER_FIRST_SHA" == "$AFTER_SECOND_SHA" ]] \
  || fail "04: expected a second pre-pass run to be idempotent (no duplicate mutation_cost line); content=$(cat "$ROOT/backlog/paused/BL-9003.yaml")"
COUNT="$(grep -c "^mutation_cost:" "$ROOT/backlog/paused/BL-9003.yaml")"
[[ "$COUNT" == "1" ]] || fail "04: expected exactly one mutation_cost line after two runs, got $COUNT"
pass "04: a second pre-pass run over the same item is idempotent, no duplicate mutation_cost line"

echo "ALL PASS"
