#!/usr/bin/env bash
# BL-782 hardener: surgical mutation over expedite_cli.bb probe-liveness needles.
set -uo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
LIB=swarmforge/scripts/expedite_cli.bb
PROP=(node --test extension/test/bl782LivenessProbesScopedToRoot.property.test.js)

BACKUP="$(mktemp)"
cp "$LIB" "$BACKUP"
restore() { cp "$BACKUP" "$LIB"; }
cleanup() { restore; rm -f "$BACKUP"; }
trap cleanup EXIT

killed=0; survived=0; skipped=0

suite_fails() {
  if ! bash swarmforge/scripts/test/test_expedite_cli.sh >/dev/null 2>&1; then return 0; fi
  if ! (cd extension && npm run compile >/dev/null 2>&1 && "${PROP[@]}" >/dev/null 2>&1); then return 0; fi
  return 1
}

mutate() {
  local label="$1" from="$2" to="$3"
  restore
  if ! python3 - "$LIB" "$from" "$to" <<'PY'
import sys
p,a,b=sys.argv[1],sys.argv[2],sys.argv[3]
s=open(p).read()
if a not in s: sys.exit(3)
open(p,'w').write(s.replace(a,b,1))
PY
  then echo "  skip     $label"; skipped=$((skipped+1)); return; fi
  if suite_fails; then echo "  killed   $label"; killed=$((killed+1)); return; fi
  echo "  SURVIVED $label"; survived=$((survived+1))
}

echo "mutation sweep over $LIB (BL-782)"
mutate "handoffd needle drops root suffix" \
  '(str "handoffd.bb " root)' \
  '(str "handoffd.bb")'
mutate "babysitterd needle drops root suffix" \
  '(str "babysitterd.sh " root)' \
  '(str "babysitterd.sh")'
mutate "operator needle drops root suffix" \
  '(str root "/swarmforge/roles/operator.prompt")' \
  '(str "operator.prompt")'
echo "---"
echo "surgical killed=$killed survived=$survived skipped=$skipped"
