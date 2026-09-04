#!/usr/bin/env bash
# BL-1382 invariant 2: the shell predicate and the reconcile strip decide
# ownership by ONE rule, proven by classifying one shared corpus with BOTH.
#
# Two readers carried the same list by hand
# (swarmforge_cron_lib.sh::swarmforge_cron_line_belongs_to_root and
# reconcile_shift_schedule_crontab.bb::strip-schedule-lines). Both claimed any
# line naming a script under the root, and on 2026-09-04 that erased three
# hand-installed shift lines from the live crontab. The rule is now
# marker-only in both, and this suite is what keeps them from drifting apart
# again (BL-897: a constant mirrored across a language boundary needs a test
# asserting both literals agree).
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
SCRIPTS="$REPO_ROOT/swarmforge/scripts"

status=0
fail() { echo "FAIL: $*"; status=1; }
pass() { echo "PASS: $*"; }

FIXTURE_PREFIX="sfvc-bl1382-agree"
source "$SCRIPT_DIR/lib/fixture_isolation.sh"
fixture_isolation_begin "$FIXTURE_PREFIX" "${BL1382_SUITE_BOUND_SECONDS:-600}" "$@"
trap 'rm -rf "$WORK"' EXIT

R="/fixture/root-r"
S="/fixture/root-s"

# The corpus: every shape a crontab line can take around a project root. It is
# written ONCE and handed to both readers, so neither can be tested against a
# corpus tailored to itself.
CORPUS="$WORK/corpus.txt"
cat > "$CORPUS" <<EOF
*/2 * * * * FRESHNESS_ROOT=$R /bin/sh $R/swarmforge/scripts/daemon_log_freshness_check.sh # swarmforge-freshness root=[$R]
0 9 * * 1-5 $R/.swarmforge/operator/day-shift-start.sh # swarmforge-operator-schedule root=[$R]
# swarmforge-shift-schedule-begin $R
30 17 * * 1-5 $R/stop-swarm.sh
# swarmforge-shift-schedule-end $R
0 9 * * 1-5 $R/.swarmforge/operator/day-shift-start.sh
30 17 * * 1-5 $R/.swarmforge/operator/day-shift-bedtime.sh
0 22 * * 5 $R/.swarmforge/operator/night-start.sh
45 16 * * 1-5 $R/swarmforge/scripts/wait_for_expedite_then_bedtime.sh $R
0 3 * * * $R/start-swarm.sh
0 4 * * * $R/stop-swarm.sh
*/2 * * * * FRESHNESS_ROOT=$S /bin/sh $S/swarmforge/scripts/daemon_log_freshness_check.sh # swarmforge-freshness root=[$S]
0 9 * * 1-5 $S/.swarmforge/operator/day-shift-start.sh
0 6 * * * /usr/local/bin/unrelated-backup.sh
EOF

# Reader 1: the shell predicate, line by line.
shell_owned() {  # shell_owned <corpus> <root> -> the OWNED lines
  # shellcheck disable=SC1091
  source "$SCRIPTS/swarmforge_cron_lib.sh"
  local line
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "${line//[[:space:]]/}" ]] && continue
    if swarmforge_cron_line_belongs_to_root "$line" "$2"; then printf '%s\n' "$line"; fi
  done < "$1"
}

# Reader 2: the reconcile strip. It REMOVES what it owns, so what it owns is
# the corpus minus its output - the same question asked from the other side,
# which is the point: a suite that called one reader twice would prove nothing.
# `strip-schedule-lines` is private to the reconcile script, so the probe
# load-files that script and resolves the var rather than copying its body -
# a copy here is the very drift this suite exists to catch.
PROBE="$WORK/strip_probe.bb"
cat > "$PROBE" <<'BB'
(require '[clojure.string :as str])
(let [[script corpus root] *command-line-args*]
  (load-file script)
  ;; The script declares its own ns, and the fn is private, so neither
  ;; `user/...` nor a bare resolve finds it: reach for the var in THAT ns.
  (let [lines (vec (remove str/blank? (str/split-lines (slurp corpus))))
        strip (ns-resolve 'reconcile-shift-schedule-crontab 'strip-schedule-lines)
        kept (set (strip lines root))]
    (doseq [l lines]
      (when-not (kept l) (println l)))))
BB

bb_owned() {  # bb_owned <corpus> <root> -> the OWNED lines
  bb "$PROBE" "$SCRIPTS/reconcile_shift_schedule_crontab.bb" "$1" "$2" 2>&1
}

for root in "$R" "$S"; do
  a="$(shell_owned "$CORPUS" "$root" | sort)"
  b="$(bb_owned "$CORPUS" "$root" | sort)"
  if [[ "$a" == "$b" ]]; then
    pass "both readers classify every corpus line the same for $root"
  else
    fail "the readers disagree for $root:"$'\n'"$(diff <(printf '%s\n' "$a") <(printf '%s\n' "$b") | head -8)"
  fi
done

# The rule itself, asserted once on the corpus rather than trusted: the four
# unmarked operator/start/stop lines for R are NOT owned.
owned_r="$(shell_owned "$CORPUS" "$R")"
unmarked_kept=1
while IFS= read -r probe; do
  grep -qxF "$probe" <<<"$owned_r" && unmarked_kept=0
done <<EOF
0 9 * * 1-5 $R/.swarmforge/operator/day-shift-start.sh
30 17 * * 1-5 $R/.swarmforge/operator/day-shift-bedtime.sh
0 22 * * 5 $R/.swarmforge/operator/night-start.sh
0 3 * * * $R/start-swarm.sh
EOF
if (( unmarked_kept )); then
  pass "an unmarked line naming the root is not the swarm's, however it names it"
else
  fail "an unmarked line is still claimed: $owned_r"
fi

# And the complement, so this is not a reader that owns nothing: the marked
# lines ARE owned.
marked_ok=1
for needle in "swarmforge-freshness root=[$R]" "swarmforge-operator-schedule root=[$R]" \
              "swarmforge-shift-schedule-begin $R"; do
  grep -qF "$needle" <<<"$owned_r" || marked_ok=0
done
if (( marked_ok )); then
  pass "every line the swarm marked for the root IS owned"
else
  fail "a marked line was not claimed: $owned_r"
fi

# Sibling isolation (BL-783/BL-1162), unchanged by this parcel.
if ! grep -qF "$S" <<<"$owned_r"; then
  pass "no sibling root's line is claimed"
else
  fail "a sibling root's line was claimed for $R"
fi

# ── non-vacuity: the suite must FAIL when one reader drifts ──────────────
# qa_e2e item 5, run rather than argued. A copy of the reconcile script gains
# back one of the path clauses BL-1382 removed; the readers must then disagree
# on exactly the lines that clause claims. The copy lives beside the original
# because the script load-files its siblings relative to its own path, and it
# is removed in the trap, named with this run's pid so concurrent runs never
# share one.
DRIFT="$SCRIPTS/.bl1382-drift-probe-$$.bb"
trap 'rm -rf "$WORK"; rm -f "$DRIFT"' EXIT
sed 's|(str/includes? line freshness-root)|(str/includes? line freshness-root)\n            (str/includes? line (str root "/.swarmforge/operator/"))|' \
  "$SCRIPTS/reconcile_shift_schedule_crontab.bb" > "$DRIFT"

drift_owned="$(bb "$PROBE" "$DRIFT" "$CORPUS" "$R" 2>&1 | sort)"
shell_r="$(shell_owned "$CORPUS" "$R" | sort)"
if [[ "$drift_owned" != "$shell_r" ]] && grep -q 'operator/day-shift-start' <<<"$drift_owned"; then
  pass "a marker list edited in one reader and not the other makes this suite fail"
else
  fail "the drifted reader still agrees, so the agreement check proves nothing"
fi

if (( status == 0 )); then echo "ALL PASS"; else echo "FAILURES"; fi
exit $status
