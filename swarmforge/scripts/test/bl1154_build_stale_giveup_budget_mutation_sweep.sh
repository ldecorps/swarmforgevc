#!/usr/bin/env bash
# BL-1154 hardener: surgical mutation over voluntary build-stale restart path.
# Soft Gherkin inapplicable (no Scenario Outline).
set -uo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SRC=swarmforge/scripts/front_desk_supervisor_lib.bb
PROP=(bb swarmforge/scripts/test/bl1154_build_stale_giveup_budget_property_runner.bb)
UNIT=(bb swarmforge/scripts/test/front_desk_supervisor_lib_test_runner.bb)
INT=(bash swarmforge/scripts/test/test_bl1154_build_stale_not_crash_giveup_budget.sh)

BACKUP="$(mktemp)"
cp "$SRC" "$BACKUP"
restore() { cp "$BACKUP" "$SRC"; }
cleanup() { restore; rm -f "$BACKUP"; }
trap cleanup EXIT

killed=0; survived=0; skipped=0

suite_fails() {
  if ! "${PROP[@]}" >/dev/null 2>&1; then return 0; fi
  if ! "${UNIT[@]}" 2>&1 | rg -q 'ALL PASS'; then return 0; fi
  if ! "${INT[@]}" >/dev/null 2>&1; then return 0; fi
  return 1
}

mutate() {
  local label="$1"
  restore
  if ! python3 - "$SRC" <<'PY'
import sys
from pathlib import Path
p = Path(sys.argv[1])
s = p.read_text()
a = Path('/tmp/bl1154_from.txt').read_text()
b = Path('/tmp/bl1154_to.txt').read_text()
if a not in s:
    sys.exit(3)
p.write_text(s.replace(a, b, 1))
PY
  then echo "  skip     $label"; skipped=$((skipped + 1)); return; fi
  if suite_fails; then echo "  killed   $label"; killed=$((killed + 1)); return; fi
  echo "  SURVIVED $label"; survived=$((survived + 1))
}

write_pair() {
  python3 -c "open('/tmp/bl1154_from.txt','w').write($1); open('/tmp/bl1154_to.txt','w').write($2)"
}

echo "mutation sweep over voluntary build-stale restart path (BL-1154)"

write_pair \
  "r':attempts (:attempts entry)'" \
  "r':attempts (inc (:attempts entry))'"
mutate "voluntary restart increments attempts like crash path"

write_pair \
  "r'voluntary-build-stale-started-entry entry now-ms (spawn!)'" \
  "r'started-entry entry now-ms (spawn!)'"
mutate "stale-build uses crash started-entry"

write_pair \
  "r'(max 1 (:attempts entry))'" \
  "r'(:attempts entry)'"
mutate "stale-build backoff uses raw attempts not max-1 floor"

python3 - <<'PY'
from pathlib import Path
a = """     "stale-build"
     ;; BL-1154: voluntary build-stale restarts share backoff spacing with
     ;; crash recovery but never burn or read the crash give-up budget.
     (let [backoff-attempt (max 1 (:attempts entry))
           due-ms (+ (:crashed-at-ms entry) (compute-backoff-ms backoff-attempt restart-config))]
       (if (< now-ms due-ms)
         {:entry entry :event nil}
         (do
           (when (:pid entry) (kill-pid! (:pid entry)))
           {:entry (voluntary-build-stale-started-entry entry now-ms (spawn!)) :event :started})))"""
b = """     ("waiting" "stalled" "stale-build")
     (let [due-ms (+ (:crashed-at-ms entry) (compute-backoff-ms (:attempts entry) restart-config))]
       (if (< now-ms due-ms)
         {:entry entry :event nil}
         (if (= :restart (decide-restart-action (:attempts entry) restart-config))
           (do
             (when (:pid entry) (kill-pid! (:pid entry)))
             {:entry (started-entry entry now-ms (spawn!)) :event :started})
           {:entry (assoc entry :status "gave-up" :gave-up-at-ms now-ms) :event :gave-up})))"""
open('/tmp/bl1154_from.txt','w').write(a)
open('/tmp/bl1154_to.txt','w').write(b)
PY
mutate "stale-build merged into crash waiting branch"

python3 - <<'PY'
from pathlib import Path
a = """(defn- voluntary-build-stale-started-entry [entry now-ms pid]
  {:pid pid :attempts (:attempts entry) :status \"running\" :crashed-at-ms nil :started-at-ms now-ms
   :gave-up-at-ms nil :build-stale-since-ms nil})"""
b = """(defn- voluntary-build-stale-started-entry [entry now-ms pid]
  {:pid pid :attempts (:attempts entry) :status \"running\" :crashed-at-ms now-ms :started-at-ms now-ms
   :gave-up-at-ms nil :build-stale-since-ms nil})"""
open('/tmp/bl1154_from.txt','w').write(a)
open('/tmp/bl1154_to.txt','w').write(b)
PY
mutate "voluntary restart clears crashed-at-ms anchor"

echo "---"
echo "surgical killed=$killed survived=$survived skipped=$skipped"
[[ "$survived" -eq 0 && "$skipped" -eq 0 ]]
