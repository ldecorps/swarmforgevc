#!/usr/bin/env bash
# BL-567 hardener: mutation sweep over expedite_lib.bb.
#
# WHY THIS EXISTS. The two mutation gates the hardener normally runs cannot see
# this ticket's code:
#
#   * Stryker mutates extension/out/ (JavaScript). expedite_lib.bb is babashka.
#   * The BL-113 Gherkin acceptance mutator mutates Examples-table CELLS only
#     (`discover` in swarmforge/vendor/aps/bb/src/aps/mutation.clj iterates
#     `(:examples scenario)`). This feature has no Scenario Outlines by design, so
#     the mutator generates ZERO mutants and reports
#     Total 0 / Killed 0 / Survived 0 - which reads exactly like a pass while
#     proving nothing. Same shape as the recorded repo-wide Stryker 0-kill.
#
# So the gate is built here rather than declared satisfied. Each mutation is a
# single surgical edit that a correct suite MUST reject. A SURVIVOR is a real test
# gap, not a curiosity.
#
# Deliberately includes mutants nobody designed a test for - those are the ones
# that find gaps. A sweep that only re-checks the assertions you already wrote is
# the non-vacuity proof, not hardening.
set -uo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
LIB=swarmforge/scripts/expedite_lib.bb
UNIT=swarmforge/scripts/test/expedite_lib_test_runner.bb
PROP=swarmforge/scripts/test/expedite_lib_property_runner.bb

restore() { git checkout -q -- "$LIB"; }
trap restore EXIT

killed=0; survived=0; skipped=0
declare -a SURVIVORS=()

# mutate <label> <from> <to>
mutate() {
  local label="$1" from="$2" to="$3"
  restore
  if ! python3 - "$LIB" "$from" "$to" <<'PY'
import sys
p, a, b = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(p).read()
if a not in s:
    sys.exit(3)
open(p, 'w').write(s.replace(a, b, 1))
PY
  then
    echo "  skip     $label (anchor not found)"
    skipped=$((skipped + 1)); return
  fi

  # A mutant is KILLED if either suite rejects it. Both are cheap and pure.
  if ! bb "$UNIT" >/dev/null 2>&1; then
    echo "  killed   $label (unit)"; killed=$((killed + 1)); return
  fi
  if ! PROPERTY_RUNS=200 bb "$PROP" >/dev/null 2>&1; then
    echo "  killed   $label (property)"; killed=$((killed + 1)); return
  fi
  echo "  SURVIVED $label"
  SURVIVORS+=("$label")
  survived=$((survived + 1))
}

echo "mutation sweep over $LIB"

# ── liveness ────────────────────────────────────────────────────────────────
mutate "liveness: servers >0 -> >1" \
  '(pos? servers) (conj "tmux-server")' '(> servers 1) (conj "tmux-server")'
mutate "liveness: agents >0 -> >1" \
  '(pos? agents) (conj "role-agents")' '(> agents 1) (conj "role-agents")'
mutate "liveness: operator dropped" \
  '(:operator probe) (conj "operator")' '(and false (:operator probe)) (conj "operator")'
mutate "liveness: handoffd-supervisor dropped" \
  '(:handoffd-supervisor probe) (conj "handoffd-supervisor")' \
  '(and false (:handoffd-supervisor probe)) (conj "handoffd-supervisor")'
mutate "liveness: stopped? empty -> seq" \
  '{:stopped? (empty? alive) :alive alive}' '{:stopped? (boolean (seq alive)) :alive alive}'
mutate "liveness: nil-safe default flipped" \
  '(or (:tmux-servers-answering probe) 0)' '(or (:tmux-servers-answering probe) 1)'

# ── start / teardown gate ───────────────────────────────────────────────────
mutate "start: refuses even when stopped" \
  'stopped? {:start? true :reason :swarm-stopped :override-used? false}' \
  'stopped? {:start? false :reason :swarm-stopped :override-used? false}'
mutate "start: override reported as unused" \
  'override? {:start? true :reason :override :override-used? true :alive alive}' \
  'override? {:start? true :reason :override :override-used? false :alive alive}'
mutate "teardown: exit-code lie never flagged" \
  '(and (zero? (or exit-code 0)) (not stopped?))' 'false'
mutate "teardown: clean? ignores the probe" \
  '{:clean? stopped?' '{:clean? true'

# ── bounces ─────────────────────────────────────────────────────────────────
mutate "bounce: default bound 3 -> 8" \
  '(def default-bounce-bound 3)' '(def default-bounce-bound 8)'
mutate "bounce: off-by-one <" '(if (< n bound)' '(if (<= n bound)'
mutate "bounce: round number off by one" \
  ':round (inc n) :bound bound' ':round n :bound bound'
mutate "bound-in-force: raise never flagged" \
  ':raised? (> b default-bounce-bound)' ':raised? false'
mutate "bound-in-force: explicit never flagged" \
  ':explicit? (some? requested)' ':explicit? false'
mutate "repeated-class: threshold 1 -> 2" '(< 1 n)' '(< 2 n)'
mutate "repeated-class: picks the RAREST instead" \
  '(sort-by (comp - val))' '(sort-by val)'
mutate "exhaustion: routes to coder" \
  ':route-to "specifier"' ':route-to "coder"'
mutate "exhaustion: blames the gate" \
  ':blame-stage nil
       :rounds (count bounces)}' ':blame-stage stage
       :rounds (count bounces)}'

# ── park ────────────────────────────────────────────────────────────────────
mutate "park: destination paused" '(def park-dir "hold")' '(def park-dir "paused")'
mutate "park: keeps the run ticket" \
  '(vec (remove #{run-ticket} active-tickets))' '(vec active-tickets)'
mutate "stop-flags: --sweep-inbox allowed" \
  '#{"--sweep-inbox" "--reset-worktrees" "--full"}' '#{"--reset-worktrees" "--full"}'
mutate "stop-flags: gate inverted" \
  '(empty? (filter forbidden-stop-flags (map str args)))' \
  '(seq (filter forbidden-stop-flags (map str args)))'

# ── restart ─────────────────────────────────────────────────────────────────
mutate "run-result: restart retracts the ticket" \
  '{:ticket ticket
     :ticket-ok? ticket-ok?' '{:ticket (if restart-ok? ticket :failed)
     :ticket-ok? ticket-ok?'
mutate "run-result: degraded counts as ok" \
  '(#{:ok :not-attempted} restart)' '(#{:ok :not-attempted :degraded} restart)'
mutate "run-result: always exits 0" \
  ':exit-code (if (and ticket-ok? restart-ok?) 0 1)' ':exit-code 0'
mutate "run-result: failed-half never named" \
  ':failed-half (cond (not ticket-ok?) :ticket' ':failed-half (cond false :ticket'
mutate "live-set-delta: reports matches too" '(not= want got)' 'true'
mutate "live-set-delta: missing key skipped" '(get observed k 0)' '(get observed k want)'
mutate "expected-live-set: agents 8 -> 0" ':role-agents 8}' ':role-agents 0}'
mutate "parked-report: claims a promotion" ':promoted []' ':promoted (vec parked)'

# ── stages / timeout ────────────────────────────────────────────────────────
mutate "stage-timeout: >= becomes >" '(>= elapsed budget)' '(> elapsed budget)'
mutate "stage-timeout: never overruns" '(>= elapsed budget)' 'false'
mutate "stages: coder/QA no longer forced" \
  '(conj declared "coder" "QA")' 'declared'
mutate "next-stage: wraps around" \
  '(< -1 idx (dec (count stages)))' '(< -1 idx (count stages))'

# ── argument parsing ────────────────────────────────────────────────────────
mutate "args: value-flag dropped from the set" \
  '(def value-flags #{"--bounce-bound" "--stage-timeout-ms"})' \
  '(def value-flags #{"--bounce-bound"})'
mutate "args: root/ticket swapped" \
  ':project-root (first pos)
     :ticket (second pos)' ':project-root (second pos)
     :ticket (first pos)'
mutate "args: missing value swallows the next flag" \
  '(when (and v (not (str/starts-with? (str v) "--"))) v)' 'v'

# ── forbidden sets ──────────────────────────────────────────────────────────
mutate "forbidden-path: mailboxes allowed" \
  '(def forbidden-path-fragments
  [".swarmforge/handoffs/"])' '(def forbidden-path-fragments
  [])'
mutate "forbidden-command: basename check removed" \
  '(map #(last (str/split (str %) #"/")) argv)' 'argv'
mutate "machinery-findings: unknown kind is a breach" \
  ':exec (forbidden-command? (if (coll? target) target [target]))
                     false)' ':exec (forbidden-command? (if (coll? target) target [target]))
                     true)'

restore

echo
echo "mutants: killed=$killed survived=$survived skipped=$skipped"
if [[ "${#SURVIVORS[@]}" -gt 0 ]]; then
  echo "SURVIVORS (each is a real test gap):"
  for s in "${SURVIVORS[@]}"; do echo "  - $s"; done
  exit 1
fi
echo "ALL MUTANTS KILLED"
