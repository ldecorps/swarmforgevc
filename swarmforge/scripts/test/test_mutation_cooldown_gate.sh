#!/usr/bin/env bash
# BL-149: mutation-testing eligibility gate CLI. Host load is forced via
# SWARMFORGE_MUTATION_GATE_FORCE_LOAD_AVG/_FORCE_CORES so these scenarios are
# deterministic - never dependent on this test machine's real ambient load.
# Covers acceptance scenarios BL-149 cooldown-gate-01..04.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
GATE="$SCRIPT_DIR/../mutation_cooldown_gate.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT

git -C "$ROOT" init -q
git -C "$ROOT" config user.email "test@test"
git -C "$ROOT" config user.name "test"

mkdir -p "$ROOT/swarmforge"
cat > "$ROOT/swarmforge/swarmforge.conf" <<'EOF'
config active_backlog_max_depth 5
config mutation_cooldown_days 3
EOF

FILE="$ROOT/src/thing.ts"
mkdir -p "$(dirname "$FILE")"
echo "export const thing = 1;" > "$FILE"

commit_at() {
  local iso="$1"
  git -C "$ROOT" add -A
  GIT_AUTHOR_DATE="$iso" GIT_COMMITTER_DATE="$iso" git -C "$ROOT" commit -q -m "commit at $iso"
}

# ── 01: within cooldown (1 day old) -> skip-cooldown, even with a busy host ──
ONE_DAY_AGO="$(date -u -d '1 day ago' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -v-1d +%Y-%m-%dT%H:%M:%SZ)"
commit_at "$ONE_DAY_AGO"

OUT="$(SWARMFORGE_MUTATION_GATE_FORCE_LOAD_AVG=99 SWARMFORGE_MUTATION_GATE_FORCE_CORES=4 bb "$GATE" "$ROOT" "$FILE")"
echo "$OUT" | grep -q "^DECISION: skip-cooldown$" || fail "01: expected skip-cooldown for a 1-day-old file; got: $OUT"
pass "01: file within cooldown is skipped even on a busy host"

# ── 02: past cooldown (4 days old), busy host -> skip-busy (deferred) ───────
FOUR_DAYS_AGO="$(date -u -d '4 days ago' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -v-4d +%Y-%m-%dT%H:%M:%SZ)"
echo "export const thing = 2;" > "$FILE"
commit_at "$FOUR_DAYS_AGO"

OUT="$(SWARMFORGE_MUTATION_GATE_FORCE_LOAD_AVG=99 SWARMFORGE_MUTATION_GATE_FORCE_CORES=4 bb "$GATE" "$ROOT" "$FILE")"
echo "$OUT" | grep -q "^DECISION: skip-busy$" || fail "02: expected skip-busy for a past-cooldown file on a busy host; got: $OUT"
pass "02: past-cooldown file defers to the busy-host bypass"

# ── 03: past cooldown, quiet host -> run ────────────────────────────────────
OUT="$(SWARMFORGE_MUTATION_GATE_FORCE_LOAD_AVG=0.1 SWARMFORGE_MUTATION_GATE_FORCE_CORES=4 bb "$GATE" "$ROOT" "$FILE")"
echo "$OUT" | grep -q "^DECISION: run$" || fail "03: expected run for a past-cooldown file on a quiet host; got: $OUT"
pass "03: past-cooldown file on a quiet host runs"

# ── 04: cooldown period is configurable ─────────────────────────────────────
cat > "$ROOT/swarmforge/swarmforge.conf" <<'EOF'
config active_backlog_max_depth 5
config mutation_cooldown_days 7
EOF
OUT="$(SWARMFORGE_MUTATION_GATE_FORCE_LOAD_AVG=0.1 SWARMFORGE_MUTATION_GATE_FORCE_CORES=4 bb "$GATE" "$ROOT" "$FILE")"
echo "$OUT" | grep -q "^DECISION: skip-cooldown$" || fail "04: a 4-day-old file under a 7-day cooldown must still skip; got: $OUT"
pass "04: cooldown period is read from swarmforge.conf, not hardcoded"

# ── never crashes on a file with no commit history ──────────────────────────
UNCOMMITTED="$ROOT/src/brand-new.ts"
echo "export const x = 1;" > "$UNCOMMITTED"
OUT="$(SWARMFORGE_MUTATION_GATE_FORCE_LOAD_AVG=0.1 SWARMFORGE_MUTATION_GATE_FORCE_CORES=4 bb "$GATE" "$ROOT" "$UNCOMMITTED")"
echo "$OUT" | grep -q "^DECISION: skip-cooldown$" || fail "05: a brand-new uncommitted file must skip (no cooldown clock yet); got: $OUT"
pass "05: a file with no commit history skips rather than crashing"

echo "ALL PASS"
