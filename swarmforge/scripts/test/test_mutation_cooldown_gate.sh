#!/usr/bin/env bash
# BL-149/BL-463: mutation-testing eligibility gate CLI. Host load is forced
# via SWARMFORGE_MUTATION_GATE_FORCE_LOAD_AVG/_FORCE_CORES so these scenarios
# are deterministic - never dependent on this test machine's real ambient
# load. Covers acceptance scenarios BL-149 cooldown-gate-01..04 and BL-463's
# own "ignores its own parcel's commits" scenarios.
#
# BL-463: the gate measures a file's last touch on the INTEGRATED `main`
# branch, never the current checkout's own HEAD - every fixture below
# commits a `main` baseline, then simulates an in-flight parcel by
# committing FURTHER changes on a separate branch WITHOUT ever advancing
# main, mirroring how a real role worktree (already carrying its own
# just-committed change) only ever integrates on main once QA lands it.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
GATE="$SCRIPT_DIR/../mutation_cooldown_gate.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT

git -C "$ROOT" init -q -b main
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

iso_days_ago() {
  date -u -d "$1 days ago" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -v-"$1"d +%Y-%m-%dT%H:%M:%SZ
}

# ── 01: within cooldown on main (1 day old) -> skip-cooldown, even with a busy host ──
commit_at "$(iso_days_ago 1)"

OUT="$(SWARMFORGE_MUTATION_GATE_FORCE_LOAD_AVG=99 SWARMFORGE_MUTATION_GATE_FORCE_CORES=4 bb "$GATE" "$ROOT" "$FILE")"
echo "$OUT" | grep -q "^DECISION: skip-cooldown$" || fail "01: expected skip-cooldown for a 1-day-old main commit; got: $OUT"
pass "01: file recently committed on main is skipped even on a busy host"

# ── 02: past cooldown on main (4 days old), busy host -> skip-busy (deferred) ──
echo "export const thing = 2;" > "$FILE"
commit_at "$(iso_days_ago 4)"

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
echo "$OUT" | grep -q "^DECISION: skip-cooldown$" || fail "04: a 4-day-old main commit under a 7-day cooldown must still skip; got: $OUT"
pass "04: cooldown period is read from swarmforge.conf, not hardcoded"

# Restore the shorter cooldown for the remaining scenarios below.
cat > "$ROOT/swarmforge/swarmforge.conf" <<'EOF'
config active_backlog_max_depth 5
config mutation_cooldown_days 3
EOF

# ── BL-463 05: the parcel's OWN in-flight commit never resets the clock ─────
# main's last touch to FILE is still the 4-day-old commit from scenario
# 02/04 above (past the 3-day cooldown). Branch off and commit a FRESH
# change to the SAME file WITHOUT advancing main - simulating a role
# worktree that already committed its own change but has not yet integrated
# it - and confirm the gate still measures against main's own history, not
# this fresh commit.
git -C "$ROOT" checkout -q -b parcel-branch
echo "export const thing = 3; // parcel's own in-flight change" > "$FILE"
git -C "$ROOT" add -A
git -C "$ROOT" commit -q -m "parcel's own fresh commit (not yet on main)"

OUT="$(SWARMFORGE_MUTATION_GATE_FORCE_LOAD_AVG=0.1 SWARMFORGE_MUTATION_GATE_FORCE_CORES=4 bb "$GATE" "$ROOT" "$FILE")"
echo "$OUT" | grep -q "^DECISION: run$" || fail "05: expected run - the parcel's own fresh commit must not reset the cooldown clock; got: $OUT"
pass "05: the parcel's own in-flight commit does not reset the cooldown clock (BL-463)"

# ── BL-463 06: genuine OTHER churn already integrated on main still skips ───
# A DIFFERENT ticket lands a change to the SAME file directly on main today
# - real integrated churn (not the current parcel's own commit) - and must
# still trigger skip-cooldown.
git -C "$ROOT" checkout -q main
echo "export const thing = 4; // other ticket's change" > "$FILE"
commit_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)"

OUT="$(SWARMFORGE_MUTATION_GATE_FORCE_LOAD_AVG=0.1 SWARMFORGE_MUTATION_GATE_FORCE_CORES=4 bb "$GATE" "$ROOT" "$FILE")"
echo "$OUT" | grep -q "^DECISION: skip-cooldown$" || fail "06: expected skip-cooldown - genuine churn already on main must still skip; got: $OUT"
pass "06: genuine churn by other integrated work still skips cooldown (BL-463)"

# ── BL-463 07: a brand-new file (no history on main at all) is eligible to run ──
NEW_FILE="$ROOT/src/brand-new.ts"
git -C "$ROOT" checkout -q -b another-parcel-branch
echo "export const x = 1;" > "$NEW_FILE"
git -C "$ROOT" add -A
git -C "$ROOT" commit -q -m "introduce a brand-new file on the parcel branch"

OUT="$(SWARMFORGE_MUTATION_GATE_FORCE_LOAD_AVG=0.1 SWARMFORGE_MUTATION_GATE_FORCE_CORES=4 bb "$GATE" "$ROOT" "$NEW_FILE")"
echo "$OUT" | grep -q "^DECISION: run$" || fail "07: expected run for a file with no history on main; got: $OUT"
pass "07: a file the parcel newly introduces (no history on main) is eligible to run, not skipped (BL-463)"

# ── BL-797: missing host probe binaries degrade to their documented ─────────
# fallbacks instead of crashing the gate. babashka's process/sh THROWS for a
# binary that does not exist at all (distinct from a binary that exists and
# exits nonzero), so these drive the real gate under a PATH restricted to a
# throwaway fixture dir - never the real host's PATH, so the scenarios are
# deterministic regardless of what this test machine actually has installed.
# Stub probe scripts use an absolute `#!/bin/bash` shebang (never
# `#!/usr/bin/env bash`) because under a PATH this narrow, `env` itself
# cannot resolve `bash` by searching a PATH that doesn't contain it.
BB_BIN="$(command -v bb)"
GIT_BIN="$(command -v git)"

FAKE_BIN_SYSCTL_ONLY="$ROOT/fakebin-sysctl-only"
mkdir -p "$FAKE_BIN_SYSCTL_ONLY"
ln -sf "$GIT_BIN" "$FAKE_BIN_SYSCTL_ONLY/git"
printf '#!/bin/bash\necho 8\n' > "$FAKE_BIN_SYSCTL_ONLY/sysctl"
chmod +x "$FAKE_BIN_SYSCTL_ONLY/sysctl"

# ── 08: missing nproc falls back to sysctl instead of crashing ──────────────
OUT="$(PATH="$FAKE_BIN_SYSCTL_ONLY" SWARMFORGE_MUTATION_GATE_FORCE_LOAD_AVG=0.1 "$BB_BIN" "$GATE" "$ROOT" "$NEW_FILE")"
echo "$OUT" | grep -q "^DECISION:" || fail "08: expected the gate to print a DECISION line, not crash, with nproc missing; got: $OUT"
echo "$OUT" | grep -q "cores: 8" || fail "08: expected the sysctl fallback (8 cores) when nproc is missing; got: $OUT"
pass "08: a missing nproc falls back to sysctl without crashing (BL-797)"

FAKE_BIN_NONE="$ROOT/fakebin-none"
mkdir -p "$FAKE_BIN_NONE"
ln -sf "$GIT_BIN" "$FAKE_BIN_NONE/git"

# ── 09: missing nproc AND sysctl falls back to the default core count ───────
OUT="$(PATH="$FAKE_BIN_NONE" SWARMFORGE_MUTATION_GATE_FORCE_LOAD_AVG=0.1 "$BB_BIN" "$GATE" "$ROOT" "$NEW_FILE")"
echo "$OUT" | grep -q "^DECISION:" || fail "09: expected the gate to print a DECISION line, not crash, with nproc and sysctl missing; got: $OUT"
echo "$OUT" | grep -q "cores: 4" || fail "09: expected the last-resort default (4 cores) when nproc and sysctl are both missing; got: $OUT"
pass "09: missing nproc and sysctl both fall back to the default core count without crashing (BL-797)"

# ── 10: missing uptime degrades to an idle (0.0) load average ───────────────
OUT="$(PATH="$FAKE_BIN_NONE" SWARMFORGE_MUTATION_GATE_FORCE_CORES=4 "$BB_BIN" "$GATE" "$ROOT" "$NEW_FILE")"
echo "$OUT" | grep -q "^DECISION:" || fail "10: expected the gate to print a DECISION line, not crash, with uptime missing; got: $OUT"
echo "$OUT" | grep -q "load_avg: 0.00" || fail "10: expected load_avg 0.00 when uptime is missing; got: $OUT"
pass "10: a missing uptime probe degrades to an idle load average without crashing (BL-797)"

# ── 11: the forced core-count seam still bypasses probes entirely ───────────
OUT="$(PATH="$FAKE_BIN_NONE" SWARMFORGE_MUTATION_GATE_FORCE_CORES=16 SWARMFORGE_MUTATION_GATE_FORCE_LOAD_AVG=0.1 "$BB_BIN" "$GATE" "$ROOT" "$NEW_FILE")"
echo "$OUT" | grep -q "cores: 16" || fail "11: expected the forced core count to bypass probes entirely with all probes missing; got: $OUT"
pass "11: the forced core-count seam bypasses probes entirely even when every probe binary is missing (BL-797)"

echo "ALL PASS"
