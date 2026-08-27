#!/usr/bin/env bash
# BL-1169 hardener: surgical mutation over babysitterd_sweep_lib.bb.
# Soft Gherkin inapplicable (no Scenario Outline) — BL-638.
# Production file is skip-cooldown; this sweep mutates temporarily then restores.
set -uo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

TARGET=swarmforge/scripts/babysitterd_sweep_lib.bb
BACKUP="$(mktemp)"
cp "$TARGET" "$BACKUP"

restore() { cp "$BACKUP" "$TARGET"; }
cleanup() { restore; rm -f "$BACKUP" /tmp/bl1169_from.txt /tmp/bl1169_to.txt; }
trap cleanup EXIT

killed=0; survived=0; skipped=0

suite_fails() {
  if ! bb swarmforge/scripts/test/babysitterd_sweep_lib_test_runner.bb >/dev/null 2>&1; then return 0; fi
  if ! bb swarmforge/scripts/test/babysitterd_sweep_lib_property_runner.bb >/dev/null 2>&1; then return 0; fi
  if ! bash specs/pipeline/scripts/run_acceptance.sh specs/features/BL-1169-babysitter-half-launch-starvation-auto-repair.feature >/dev/null 2>&1; then return 0; fi
  return 1
}

mutate_file() {
  local label="$1"
  restore
  if ! python3 - <<'PY'
from pathlib import Path
a = Path('/tmp/bl1169_from.txt').read_text()
b = Path('/tmp/bl1169_to.txt').read_text()
s = Path('swarmforge/scripts/babysitterd_sweep_lib.bb').read_text()
if a not in s:
    raise SystemExit(3)
Path('swarmforge/scripts/babysitterd_sweep_lib.bb').write_text(s.replace(a, b, 1))
PY
  then echo "  skip     $label"; skipped=$((skipped + 1)); return; fi
  if suite_fails; then echo "  killed   $label"; killed=$((killed + 1)); return; fi
  echo "  SURVIVED $label"; survived=$((survived + 1))
}

write_pair() {
  python3 -c 'import pathlib,sys; pathlib.Path("/tmp/bl1169_from.txt").write_text(sys.argv[1]); pathlib.Path("/tmp/bl1169_to.txt").write_text(sys.argv[2])' "$1" "$2"
}

echo "mutation sweep over babysitterd_sweep_lib (BL-1169)"

write_pair '(and should-stand? (session-repair-allowed? opts))' '(and false (session-repair-allowed? opts))'
mutate_file "half-launch repair gate always false"

write_pair ':severity "CRIT"
               :message (str "swarmforge-" role ": pane alive but NO " proc-name' \
            ':severity "WARN"
               :message (str "swarmforge-" role ": pane alive but NO " proc-name'
mutate_file "half-launch CRIT becomes WARN"

write_pair '(def default-swarm-starved-ensure-streak 3)' '(def default-swarm-starved-ensure-streak 99)'
mutate_file "starved ensure threshold raised to 99"

write_pair '(>= new-streak (long starved-ensure-streak))' 'false'
mutate_file "starved ensure streak gate never fires"

write_pair \
  '(assoc :repair {:action :ensure-control-plane})' \
  '(assoc :repair {:action :ensure-session})'
mutate_file "starved repair mislabeled ensure-session"

echo "summary: killed=$killed survived=$survived skipped=$skipped"
[[ "$survived" -eq 0 ]] || exit 1
[[ "$skipped" -eq 0 ]] || exit 1
