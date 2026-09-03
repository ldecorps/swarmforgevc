#!/usr/bin/env bash
# BL-1377: a suite's failure set is recorded once per base commit.
#
# Drives the REAL suite_baseline.sh over a throwaway git repo. The suite itself
# is stubbed through the CLI's own SUITE_BASELINE_RUNNER seam - running the real
# 143-second property suite to test a cache would be its own joke - but every
# other moving part is real: real git, a real base worktree, the real record
# file, the real decision.
#
# The runner tells the two runs apart by a marker file that exists only in the
# parcel commit, so "ran once" and "ran twice" are read off a log rather than
# assumed.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI="$SCRIPT_DIR/../suite_baseline.sh"

PREFIX="bl1377-suite-baseline"
# BL-971: a killed run traps nothing, so sweep the prefix before this one too.
rm -rf "${TMPDIR:-/tmp}/${PREFIX}".* 2>/dev/null || true
TMPROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"
trap 'rm -rf "$TMPROOT"' EXIT

fails=0
pass() { echo "  ok   $1"; }
fail() { echo "  FAIL $1"; fails=$((fails + 1)); }
contains() { if grep -qF -- "$3" <<<"$2"; then pass "$1"; else fail "$1 (missing '$3')"; fi; }
absent()   { if grep -qF -- "$3" <<<"$2"; then fail "$1 (unexpectedly found '$3')"; else pass "$1"; fi; }
check()    { if [[ "$2" == "$3" ]]; then pass "$1"; else fail "$1 (expected '$3', got '$2')"; fi; }

# ── a repo with a base commit and a parcel commit on top ───────────────────
mkfix() {
  local root="$TMPROOT/$1"
  mkdir -p "$root"
  git -C "$root" init -q -b main
  git -C "$root" config user.email "fix@fix"
  git -C "$root" config user.name "fix"
  git -C "$root" config commit.gpgsign false
  mkdir -p "$root/extension"
  echo "config v1" > "$root/extension/vitest.config.mjs"
  echo '{"name":"fixture"}' > "$root/extension/package.json"
  echo "base" > "$root/base.txt"
  git -C "$root" add -A
  git -C "$root" commit -qm "base"
  # the marker: present only with the parcel, so the runner can tell the two
  # checkouts apart without being told which run it is in.
  echo "parcel" > "$root/parcel-marker.txt"
  git -C "$root" add -A
  git -C "$root" commit -qm "parcel"

  cat > "$root/runner.sh" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
SUITE="$1"; DIR="$2"
FIX="$(cd "$(dirname "$0")" && pwd)"
if [[ -f "$DIR/parcel-marker.txt" ]]; then MODE=head; else MODE=base; fi
echo "$MODE" >> "$FIX/runs.log"
[[ -f "$FIX/benign.txt" ]] && cat "$FIX/benign.txt" >&2
cat "$FIX/reds-$MODE.txt"
SH
  chmod +x "$root/runner.sh"
  printf 'a.test.js > red one\nb.test.js > red two\n' > "$root/reds-base.txt"
  printf 'a.test.js > red one\nb.test.js > red two\n' > "$root/reds-head.txt"
  : > "$root/runs.log"
  echo "$root"
}

base_sha() { git -C "$1" rev-parse HEAD~1; }

# The record the CLI would itself have written, so a "fresh record" case starts
# from the real shape rather than a hand-made lookalike.
seed_record() {
  local root="$1" sha="$2" hash="$3"; shift 3
  mkdir -p "$root/.swarmforge/suite-baselines"
  local reds="["
  local first=1
  for r in "$@"; do
    [[ $first -eq 0 ]] && reds+=","
    reds+="\"$r\""
    first=0
  done
  reds+="]"
  printf '{"key":{"suite":"unit","base-sha":"%s","config-hash":"%s"},"reds":%s,"recorded-by":"coder"}\n' \
    "$sha" "$hash" "$reds" > "$root/.swarmforge/suite-baselines/unit.jsonl"
}

# The config hash the CLI computes for this tree - read from the CLI itself
# rather than reimplemented here, so the fixture cannot pin a hash the code
# does not produce.
live_hash() {
  local root="$1"
  ( cd "$root" && SUITE_BASELINE_RUNNER="$root/runner.sh" bash "$CLI" unit --base "$(base_sha "$root")" --json ) \
    | sed -n 's/.*"config-hash":"\([^"]*\)".*/\1/p' | head -1
}

run_cli() {
  local root="$1"; shift
  ( cd "$root" && SUITE_BASELINE_RUNNER="$root/runner.sh" bash "$CLI" "$@" 2>&1 )
}

runs_of() { grep -c . "$1/runs.log" 2>/dev/null || echo 0; }

# ═══════════════════════════════════════════════════════════════════════════
# 01: a fresh, matching record means ONE run
# ═══════════════════════════════════════════════════════════════════════════
echo "01: fresh baseline"
R="$(mkfix fresh)"
HASH="$(live_hash "$R")"
: > "$R/runs.log"
seed_record "$R" "$(base_sha "$R")" "$HASH" "a.test.js > red one" "b.test.js > red two"
OUT="$(run_cli "$R" unit --base "$(base_sha "$R")")"

check "01: the suite ran once" "$(runs_of "$R")" "1"
check "01: and it was the parcel run, not the base one" "$(tr -d '\n' < "$R/runs.log")" "head"
contains "01: the evidence names the base sha" "$OUT" "$(base_sha "$R")"
contains "01: it names the recorded count" "$OUT" "2 recorded reds"
contains "01: it names the observed count" "$OUT" "2 observed reds"
contains "01: and says the sets agree" "$OUT" "same set"
contains "01: and names the stage that recorded the baseline" "$OUT" "recorded by coder"

# The default (unstubbed) path must refuse an output it cannot read rather
# than report no failures - an empty observed set beside an empty record would
# look like a clean hit and skip the base run.
UNREADABLE="$(cd "$R" && SUITE_BASELINE_RUNNER="" bash "$CLI" unit --base "$(base_sha "$R")" 2>&1)"
contains "01b: an unrunnable suite is refused, never reported as no failures"   "$UNREADABLE" "Refusing rather than reporting no failures"

# ═══════════════════════════════════════════════════════════════════════════
# 02 / 04: a red the record does not name is NEW, never excused
# ═══════════════════════════════════════════════════════════════════════════
echo "02/04: a new red"
R2="$(mkfix newred)"
HASH2="$(live_hash "$R2")"
: > "$R2/runs.log"
seed_record "$R2" "$(base_sha "$R2")" "$HASH2" "a.test.js > red one" "b.test.js > red two"
printf 'a.test.js > red one\nb.test.js > red two\nc.test.js > fresh red\n' > "$R2/reds-head.txt"
OUT2="$(run_cli "$R2" unit --base "$(base_sha "$R2")")"

check "02: the suite ran twice" "$(runs_of "$R2")" "2"
contains "02: the base run happened" "$(cat "$R2/runs.log")" "base"
contains "02: the evidence names the new red" "$OUT2" "c.test.js > fresh red"
contains "04: and calls it new" "$OUT2" "new:"
absent "04: it is never reported as pre-existing" "$OUT2" "same set"

# ═══════════════════════════════════════════════════════════════════════════
# 03: a red the record names that has vanished is also a mismatch
# ═══════════════════════════════════════════════════════════════════════════
echo "03: a vanished red"
R3="$(mkfix vanished)"
HASH3="$(live_hash "$R3")"
: > "$R3/runs.log"
seed_record "$R3" "$(base_sha "$R3")" "$HASH3" "a.test.js > red one" "b.test.js > red two"
printf 'a.test.js > red one\n' > "$R3/reds-head.txt"
OUT3="$(run_cli "$R3" unit --base "$(base_sha "$R3")")"

check "03: the suite ran twice" "$(runs_of "$R3")" "2"
contains "03: the vanished red is named" "$OUT3" "vanished:"
contains "03: by name, not as a count" "$OUT3" "b.test.js > red two"

# ═══════════════════════════════════════════════════════════════════════════
# 05: every way of not having a usable record falls back to two runs
# ═══════════════════════════════════════════════════════════════════════════
echo "05: unusable records"
R4="$(mkfix absent)"
: > "$R4/runs.log"
OUT4="$(run_cli "$R4" unit --base "$(base_sha "$R4")")"
check "05a absent: two runs" "$(runs_of "$R4")" "2"
absent "05a absent: nothing is excused by a record" "$OUT4" "same set"
check "05a absent: the observed base set was recorded" \
  "$(grep -c 'red one' "$R4/.swarmforge/suite-baselines/unit.jsonl")" "1"
contains "05a absent: the record carries the base sha it was observed under" \
  "$(cat "$R4/.swarmforge/suite-baselines/unit.jsonl")" "$(base_sha "$R4")"
contains "05a absent: and the suite config hash" \
  "$(cat "$R4/.swarmforge/suite-baselines/unit.jsonl")" '"config-hash"'

R5="$(mkfix corrupt)"
mkdir -p "$R5/.swarmforge/suite-baselines"
printf 'this is not json at all\n' > "$R5/.swarmforge/suite-baselines/unit.jsonl"
: > "$R5/runs.log"
OUT5="$(run_cli "$R5" unit --base "$(base_sha "$R5")")"
check "05b corrupt: two runs" "$(runs_of "$R5")" "2"
contains "05b corrupt: and it says the record was unreadable" "$OUT5" "unreadable"
absent "05b corrupt: never a pass on a cached set" "$OUT5" "same set"

R6="$(mkfix confighash)"
HASH6="$(live_hash "$R6")"
: > "$R6/runs.log"
seed_record "$R6" "$(base_sha "$R6")" "$HASH6" "a.test.js > red one" "b.test.js > red two"
# the sha is untouched; only the suite's own config moves
echo "config v2" > "$R6/extension/vitest.config.mjs"
OUT6="$(run_cli "$R6" unit --base "$(base_sha "$R6")")"
check "05c config hash moved: two runs" "$(runs_of "$R6")" "2"
contains "05c config hash moved: and it says which hash it was recorded under" "$OUT6" "config hash"
absent "05c config hash moved: nothing is excused" "$OUT6" "same set"

R7="$(mkfix othersha)"
HASH7="$(live_hash "$R7")"
: > "$R7/runs.log"
seed_record "$R7" "0000000000000000000000000000000000000000" "$HASH7" "a.test.js > red one"
OUT7="$(run_cli "$R7" unit --base "$(base_sha "$R7")")"
check "05d other base sha: two runs" "$(runs_of "$R7")" "2"
contains "05d other base sha: and it says which base it was recorded at" "$OUT7" "recorded at base"
absent "05d other base sha: nothing is excused" "$OUT7" "same set"

# ═══════════════════════════════════════════════════════════════════════════
# 06: an allowlisted benign error changes neither the verdict nor the record
# ═══════════════════════════════════════════════════════════════════════════
echo "06: allowlisted benign error"
R8="$(mkfix benign)"
HASH8="$(live_hash "$R8")"
: > "$R8/runs.log"
seed_record "$R8" "$(base_sha "$R8")" "$HASH8" "a.test.js > red one" "b.test.js > red two"
BEFORE="$(cat "$R8/.swarmforge/suite-baselines/unit.jsonl")"
# BL-871's known-benign shape: noise on stderr that the allowlist tolerates and
# that is therefore not a red. It must not become one here by accident.
printf '[vitest-worker]: Timeout calling "onTaskUpdate"\n' > "$R8/benign.txt"
OUT8="$(run_cli "$R8" unit --base "$(base_sha "$R8")")"

check "06: the benign error did not force a second run" "$(runs_of "$R8")" "1"
contains "06: the verdict is unchanged" "$OUT8" "same set"
check "06: and the recorded baseline is untouched" "$(cat "$R8/.swarmforge/suite-baselines/unit.jsonl")" "$BEFORE"

# ═══════════════════════════════════════════════════════════════════════════
# 07: the base run never moves the stage's own HEAD
# ═══════════════════════════════════════════════════════════════════════════
echo "07: the stage's worktree is left alone"
R9="$(mkfix headsafe)"
: > "$R9/runs.log"
HEAD_BEFORE="$(git -C "$R9" rev-parse HEAD)"
run_cli "$R9" unit --base "$(base_sha "$R9")" >/dev/null
check "07: HEAD did not move" "$(git -C "$R9" rev-parse HEAD)" "$HEAD_BEFORE"
check "07: and the base worktree was removed" \
  "$(ls "$R9/.worktrees" 2>/dev/null | wc -l | tr -d ' ')" "0"

if [[ $fails -gt 0 ]]; then
  echo "test_suite_baseline_cli: $fails FAILURE(S)"
  exit 1
fi
echo "test_suite_baseline_cli: ALL PASS"
