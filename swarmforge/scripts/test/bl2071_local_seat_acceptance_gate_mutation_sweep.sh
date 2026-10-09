#!/usr/bin/env bash
# BL-2071 hardener: surgical mutation over local_seat_acceptance_gate_lib.bb
# and its two wiring call sites (swarm_handoff.bb, local_seat_phase_cli.bb).
#
# mutation_cost: medium (Babashka, no Stryker lane - BL-567's hand-mutant
# fallback). No standalone unit/property .bb runner exists for this lib:
# its only coverage is the acceptance feature (real swarm_handoff.bb send
# + real local_seat_phase_cli.bb pass) and the two JS property tests, which
# drive BOTH real callers through a real git fixture via
# specs/pipeline/steps/lib/bl2071LocalSeatAcceptanceGateCli.sh. Each mutant
# below is a single edit that whole suite must reject.
set -uo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
LIB=swarmforge/scripts/local_seat_acceptance_gate_lib.bb
HANDOFF=swarmforge/scripts/swarm_handoff.bb
PHASE_CLI=swarmforge/scripts/local_seat_phase_cli.bb
FEATURE=specs/features/BL-2071-a-local-seat-forwards-only-a-ticket-whose-acceptance-passes.feature

LIB_BACKUP="$(mktemp)"
HANDOFF_BACKUP="$(mktemp)"
PHASE_CLI_BACKUP="$(mktemp)"
cp "$LIB" "$LIB_BACKUP"
cp "$HANDOFF" "$HANDOFF_BACKUP"
cp "$PHASE_CLI" "$PHASE_CLI_BACKUP"
restore() { cp "$LIB_BACKUP" "$LIB"; cp "$HANDOFF_BACKUP" "$HANDOFF"; cp "$PHASE_CLI_BACKUP" "$PHASE_CLI"; }
cleanup() { restore; rm -f "$LIB_BACKUP" "$HANDOFF_BACKUP" "$PHASE_CLI_BACKUP"; }
trap cleanup EXIT

killed=0; survived=0; skipped=0
declare -a SURVIVORS=()

suite_fails() {
  if ! node specs/pipeline/cli.js "$FEATURE" >/dev/null 2>&1; then return 0; fi
  if ! ( cd extension && npx vitest run --config vitest.properties.config.mjs \
      test/bl2071ForwardAndPassAgree.property.test.js \
      test/bl2071LocalSeatAcceptanceGateCompleteness.property.test.js ) >/dev/null 2>&1; then
    return 0
  fi
  return 1
}

mutate() {
  local label="$1" file="$2" from="$3" to="$4"
  restore
  if ! python3 - "$file" "$from" "$to" <<'PY'
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
  if suite_fails; then
    echo "  killed   $label"
    killed=$((killed + 1)); return
  fi
  echo "  SURVIVED $label"
  SURVIVORS+=("$label")
  survived=$((survived + 1))
}

echo "mutation sweep over $LIB + wiring"

mutate "blocked? always reports clean (gate can never refuse)" "$LIB" \
  '(defn blocked? [result] (boolean (seq (:findings result))))' \
  '(defn blocked? [result] false)'

mutate "run-check! treats every run as passed regardless of :passed?" "$LIB" \
  '        (:passed? run)
        {:findings []}' \
  '        true
        {:findings []}'

mutate "run-check! never produces a finding (else branch dropped)" "$LIB" \
  '        :else
        {:findings [{:ticket-id ticket-id
                     :feature-path (feature-path root declaration)
                     :timed-out? (:timed-out? run)
                     :failing (failing-lines (:output run))
                     :output (:output run)}]}))' \
  '        :else
        {:findings []}))'

mutate "run-acceptance-feature! always reports infra-missing (fail-open escape hatch)" "$LIB" \
  '    (if-not (fs/exists? cli-js)' \
  '    (if-not false'

mutate "run-acceptance-feature! reads the WRONG exit field (never fails)" "$LIB" \
  '        {:passed? (zero? (:exit result))' \
  '        {:passed? true' \

mutate "findings-for-git-handoff never gates (local-model-seat? check inverted)" "$LIB" \
  '  (if-not (gpu-pause-lib/local-model-seat? (:agent (handoff-lib/load-role-info seat (str root))))
    {:findings []}' \
  '  (if (gpu-pause-lib/local-model-seat? (:agent (handoff-lib/load-role-info seat (str root))))
    {:findings []}'

mutate "findings-for-git-handoff ticket-id extraction always nil (gate never runs)" "$LIB" \
  '    (let [ticket-id (pipeline-stage-lib/extract-ticket-id task-name)]' \
  '    (let [ticket-id nil]'

mutate "swarm_handoff.bb keys the gate off the canonicalized stage, not the raw seat role" "$HANDOFF" \
  '{:root (project-root) :seat (System/getenv "SWARMFORGE_ROLE") :task-name task-name :commit canonical}' \
  '{:root (project-root) :seat sender :task-name task-name :commit canonical}'

mutate "swarm_handoff.bb drops the local-seat-acceptance block from the refusal chain" "$HANDOFF" \
  '                             local-seat-acceptance-block
                             (conj (local-seat-acceptance-gate-lib/refusal-message
                                    {:task-name task-name
                                     :findings (:findings local-seat-acceptance-block)}))' \
  ''

mutate "local_seat_phase_cli.bb applies the move even when the acceptance check refuses" "$PHASE_CLI" \
  '        (cond
          (not (:ok result)) (refuse! (:reason result))
          acceptance-refusal (refuse! acceptance-refusal)
          :else (apply-move! ticket result notes-path)))' \
  '        (cond
          (not (:ok result)) (refuse! (:reason result))
          :else (apply-move! ticket result notes-path)))'

mutate "local_seat_phase_cli.bb skips the check for a local-model seat (gate call dropped)" "$PHASE_CLI" \
  '  (let [role (handoff-lib/current-role)
        agent (:agent (when role (handoff-lib/load-role-info role)))]
    (when (and role (gpu-pause-lib/local-model-seat? agent))' \
  '  (let [role (handoff-lib/current-role)
        agent (:agent (when role (handoff-lib/load-role-info role)))]
    (when false'

echo "---"
echo "surgical killed=$killed survived=$survived skipped=$skipped"
printf 'survivors: %s\n' "${SURVIVORS[*]:-none}"
