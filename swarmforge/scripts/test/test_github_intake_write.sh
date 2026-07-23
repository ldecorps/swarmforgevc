#!/usr/bin/env bash
# BL-560 architect bounce: github_intake_write.sh generates a YAML
# `description: |` block scalar from an arbitrary GitHub issue body. A bare
# `|` with no explicit indentation indicator takes its indent from the block
# scalar's first non-empty line - an issue body whose first line is itself
# indented (an indented code block, extremely common) pushes the block
# indent past the writer's own 2-space `sed` prefix, so every following
# normally-indented line falls OUTSIDE the scalar and is parsed as a sibling
# YAML key, corrupting the generated backlog/GH-<n>-*.yaml. Fixed with an
# explicit `|2` indentation indicator. This is a plain bash/YAML-parse test,
# not a Gherkin scenario - the writer is a shell script, not a feature the
# coder owns authoring acceptance criteria for.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WRITER="$SCRIPT_DIR/../github_intake_write.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(mktemp -d)"
mkdir -p "$ROOT/backlog"
cd "$ROOT"

# ── 01: a body whose first line is indented still produces parseable YAML,
#        with the body content preserved byte for byte ───────────────────────
BODY=$'    indented code block\nback to normal text'
FILE="$("$WRITER" 42 "Repro title" "$BODY" "https://example.com/issues/42")"

[[ -f "$FILE" ]] || fail "01: writer did not report the file it wrote"

PARSED_BODY="$(python3 - "$FILE" <<'EOF'
import sys, yaml
with open(sys.argv[1]) as f:
    doc = yaml.safe_load(f)
sys.stdout.write(doc["description"])
EOF
)"

[[ "$PARSED_BODY" == "    indented code block"$'\n'"back to normal text" ]] \
  || fail "01: an indented-first-line body corrupted the generated YAML or lost content; got: $PARSED_BODY"
[[ "$(python3 -c "import yaml; print(yaml.safe_load(open('$FILE'))['id'])")" == "GH-42" ]] \
  || fail "01: id field did not survive alongside the body fix"
pass "01: an issue body starting with an indented line still produces parseable YAML with content preserved"

# ── 02: a plain, unindented multi-line body still round-trips unchanged
#        (guards against the |2 fix breaking the common case) ───────────────
BODY2=$'first line\nsecond line'
FILE2="$("$WRITER" 43 "Plain title" "$BODY2" "https://example.com/issues/43")"
PARSED_BODY2="$(python3 -c "import yaml; print(yaml.safe_load(open('$FILE2'))['description'], end='')")"
[[ "$PARSED_BODY2" == "$BODY2" ]] \
  || fail "02: a plain multi-line body did not round-trip unchanged; got: $PARSED_BODY2"
pass "02: a plain unindented multi-line body still round-trips unchanged"

rm -rf "$ROOT"
echo "ALL PASS"
