#!/usr/bin/env bash
# BL-432 (epic BL-429 slice 3 - ACT): effective_backlog_depth_cli.bb - the
# shell-callable entry point the coordinator's promotion decision uses to get
# the EFFECTIVE cap = min(configured, recommended). Drives the REAL compiled
# script end to end against synthetic fixtures. The node refresh step
# (emit-throttle-recommendation.js) is exercised exhaustively in its own
# extension/test/emitThrottleRecommendationCli.test.js - these fixtures have
# no extension/out/ tree at all, which proves the OTHER half of this
# script's own contract: a failed/missing refresh degrades gracefully
# (logged, never a crash) and the effective-cap combination still reads
# whatever recommendation already sits on disk, exactly as a stale-but-
# present recommendation would in production.

set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp_cleanup.sh"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI="$SCRIPT_DIR/../effective_backlog_depth_cli.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

mk_fixture() {
  local cap="$1"
  local root
  root="$(mktemp -d)"
  register_tmp_dir "$root"
  mkdir -p "$root/swarmforge"
  printf 'config active_backlog_max_depth %s\n' "$cap" > "$root/swarmforge/swarmforge.conf"
  echo "$root"
}

write_recommendation() {
  local root="$1" cap="$2"
  mkdir -p "$root/.swarmforge/coordinator"
  printf '{"recommendedCap":%s,"severity":null,"reworkRate":null,"baselineRate":null,"updated_at":"2026-07-16T00:00:00Z"}\n' "$cap" \
    > "$root/.swarmforge/coordinator/throttle-recommendation.json"
}

# ── no recommendation on disk, no node CLI to refresh one -> degrades to
#    the configured cap, never a crash ────────────────────────────────────
ROOT="$(mk_fixture 3)"
OUT="$(bb "$CLI" "$ROOT" 2>/dev/null)"
[[ "$OUT" == "3" ]] || fail "expected the configured cap (3) with no recommendation and a missing node CLI, got: $OUT"
pass "effective_backlog_depth_cli.bb degrades to the configured cap when no recommendation exists and the refresh CLI is missing"
rm -rf "$ROOT"

# ── a degraded recommendation already on disk lowers the effective cap,
#    even though the refresh step itself fails (missing node CLI) ────────
ROOT="$(mk_fixture 3)"
write_recommendation "$ROOT" 1
OUT="$(bb "$CLI" "$ROOT" 2>/dev/null)"
[[ "$OUT" == "1" ]] || fail "expected the degraded recommendation (1) applied over the configured cap (3), got: $OUT"
pass "effective_backlog_depth_cli.bb applies an existing degraded recommendation (1) even when the refresh step fails"
rm -rf "$ROOT"

# ── a severe recommendation (0) freezes intake entirely ──────────────────
ROOT="$(mk_fixture 3)"
write_recommendation "$ROOT" 0
OUT="$(bb "$CLI" "$ROOT" 2>/dev/null)"
[[ "$OUT" == "0" ]] || fail "expected the severe recommendation (0) applied, got: $OUT"
pass "effective_backlog_depth_cli.bb applies an existing severe recommendation (0)"
rm -rf "$ROOT"

# ── acceptance scenario 04: a recommendation never raises the cap above
#    the configured value ─────────────────────────────────────────────────
ROOT="$(mk_fixture 2)"
write_recommendation "$ROOT" 5
OUT="$(bb "$CLI" "$ROOT" 2>/dev/null)"
[[ "$OUT" == "2" ]] || fail "expected the configured cap (2) unraised by a higher recommendation (5), got: $OUT"
pass "effective_backlog_depth_cli.bb never raises the cap above the configured value"
rm -rf "$ROOT"

# ── an unlimited (-1) configured cap still respects a finite recommendation
#    (the ticket's own 'a -1 configured cap is no CEILING, not immunity') ──
ROOT="$(mk_fixture -1)"
write_recommendation "$ROOT" 1
OUT="$(bb "$CLI" "$ROOT" 2>/dev/null)"
[[ "$OUT" == "1" ]] || fail "expected the finite recommendation (1) applied over an unlimited configured cap, got: $OUT"
pass "effective_backlog_depth_cli.bb applies a finite recommendation even over an unlimited (-1) configured cap"
rm -rf "$ROOT"

# ── acceptance scenario 03: once the recommendation clears (removed/nulled),
#    the effective cap restores to the configured value ──────────────────
ROOT="$(mk_fixture 3)"
write_recommendation "$ROOT" 1
OUT="$(bb "$CLI" "$ROOT" 2>/dev/null)"
[[ "$OUT" == "1" ]] || fail "setup: expected the degraded recommendation applied first, got: $OUT"
printf '{"recommendedCap":null,"severity":null,"reworkRate":null,"baselineRate":null,"updated_at":"2026-07-16T01:00:00Z"}\n' \
  > "$ROOT/.swarmforge/coordinator/throttle-recommendation.json"
OUT="$(bb "$CLI" "$ROOT" 2>/dev/null)"
[[ "$OUT" == "3" ]] || fail "expected the configured cap (3) restored once the recommendation cleared, got: $OUT"
pass "effective_backlog_depth_cli.bb restores the configured cap once the recommendation clears"
rm -rf "$ROOT"

# ── genuine spawn failure (not just a non-zero exit): "node" itself
#    unresolvable on PATH, so babashka.process/sh throws synchronously
#    instead of returning a nonzero :exit - drives the (catch Exception e ...)
#    branch in refresh-recommendation!, distinct from the "node runs but the
#    script is missing" nonzero-exit branch every fixture above exercises.
#    Without this, a mutant deleting the try/catch entirely would survive:
#    both branches degrade identically (log to stderr, fall through to
#    whatever is on disk), so only an actual spawn failure tells them apart.
BB_DIR="$(dirname "$(command -v bb)")"
ROOT="$(mk_fixture 3)"
OUT="$(env PATH="$BB_DIR" bb "$CLI" "$ROOT" 2>/dev/null)"
[[ "$OUT" == "3" ]] || fail "expected the configured cap (3) to survive a genuine node spawn failure, got: $OUT"
ERR="$(env PATH="$BB_DIR" bb "$CLI" "$ROOT" 2>&1 >/dev/null)"
[[ "$ERR" == *"refresh error"* ]] || fail "expected a 'refresh error' diagnostic on stderr for a genuine spawn failure, got: $ERR"
pass "effective_backlog_depth_cli.bb degrades gracefully on a genuine node spawn failure, not just a nonzero exit"
rm -rf "$ROOT"

# ── live wiring: the REAL compiled emit-throttle-recommendation.js, shelled
#    end to end (never a hand-written recommendation fixture) - symlinks the
#    fixture's extension/ to this checkout's real one (mirrors the Stryker
#    sandbox siblings' own cross-directory-symlink convention) so the exact
#    argv/path wiring effective_backlog_depth_cli.bb uses to shell out is
#    proven live, not merely that the combination logic is correct given a
#    recommendation someone already wrote by hand ─────────────────────────
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
if [[ -f "$REPO_ROOT/extension/out/tools/emit-throttle-recommendation.js" ]]; then
  ROOT="$(mk_fixture 3)"
  ln -s "$REPO_ROOT/extension" "$ROOT/extension"
  # 2026-10-05: the CLI refreshes the rework signal from git history before
  # diagnosing (hotfix 51591aab4a, 2026-10-01), so a hand-written
  # observatory-signals.json is overwritten with "no sample" on a non-git
  # fixture and the cap never drops - this case was red from that hotfix
  # until today. Build the history instead: on main, 10 tickets closed in
  # the last 14 days (5 with bounce evidence) and 10 closed in the 14 days
  # before (1 with bounce evidence) - rate 0.5 against a 0.1 baseline, the
  # same severe signal the old fixture hand-wrote. Dates use git's raw
  # "<epoch> +0000" form, portable to macOS (no date -d).
  git -C "$ROOT" init -q -b main
  # BL-1390: prove the fixture is its own repository before any mutating
  # git command - a failed init under a TMPDIR inside a checkout would
  # otherwise commit into that checkout.
  [[ "$(git -C "$ROOT" rev-parse --show-toplevel)" == "$(cd "$ROOT" && pwd -P)" ]] \
    || fail "live wiring: the fixture root is not its own git repository"
  git -C "$ROOT" config user.email test@test
  git -C "$ROOT" config user.name test
  mkdir -p "$ROOT/backlog/done" "$ROOT/backlog/evidence"
  NOW_S="$(date +%s)"
  close_fixture_ticket() { # id days-ago bounced(0|1)
    local when=$(( NOW_S - $2 * 86400 ))
    printf 'id: %s\n' "$1" > "$ROOT/backlog/done/$1-fixture.yaml"
    if [[ "$3" == 1 ]]; then printf 'bounce\n' > "$ROOT/backlog/evidence/$1-bounce.md"; fi
    git -C "$ROOT" add backlog >/dev/null
    GIT_AUTHOR_DATE="$when +0000" GIT_COMMITTER_DATE="$when +0000" git -C "$ROOT" commit -q -m "close $1"
  }
  for n in 1 2 3 4 5 6 7 8 9 10; do
    close_fixture_ticket "BL-91$(printf '%02d' $n)" "$n" "$(( n <= 5 ? 1 : 0 ))"
    close_fixture_ticket "BL-92$(printf '%02d' $n)" "$(( 14 + n ))" "$(( n == 1 ? 1 : 0 ))"
  done
  # BL-966: stdout only - the no-identity fall-through now (correctly)
  # writes its notice to stderr for this identity-less fixture root.
  OUT="$(bb "$CLI" "$ROOT" 2>/dev/null)"
  [[ "$OUT" == "0" ]] || fail "live wiring: expected the REAL emit-throttle-recommendation.js to diagnose a severe (rate 5x baseline) rework signal and drop the effective cap to 0, got: $OUT"
  [[ -f "$ROOT/.swarmforge/coordinator/throttle-recommendation.json" ]] \
    || fail "live wiring: expected the real CLI to have persisted a throttle-recommendation.json, found none"
  pass "effective_backlog_depth_cli.bb, end to end with the REAL compiled node CLI: a severe rework signal drops the effective cap to 0"
  rm -rf "$ROOT"
else
  echo "SKIP: live-wiring check (extension/out/tools/emit-throttle-recommendation.js not compiled in this checkout - run npm run compile first)"
fi

# ── missing args -> usage + non-zero exit, never a silent default ────────
set +e
bb "$CLI" >/dev/null 2>&1
STATUS=$?
set -e
[[ "$STATUS" -ne 0 ]] || fail "expected a non-zero exit with no project-root argument"
pass "effective_backlog_depth_cli.bb exits non-zero with usage when the project-root argument is missing"

echo "ALL PASS"
