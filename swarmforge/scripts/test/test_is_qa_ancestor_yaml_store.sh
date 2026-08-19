#!/usr/bin/env bash
# BL-952 hardener coverage gap (architect's own pass, backlog/evidence/
# BL-952-architect-pass-20260819.md): is_qa_ancestor.sh documents and
# implements TWO independent bounce-verdict stores - the machine-local
# JSONL store record-bounce.js appends, and tracked ticket-YAML
# bounce_history entries (backlog/**) - "each store has missed entries the
# other held" is the whole reason a safety gate unions them. Every test in
# BL-952's own parcel (unit, property, acceptance) drove ONLY the JSONL
# path via the step file's recordBounce() helper; the YAML-store branch
# (is_qa_ancestor.sh lines ~101-115) was verified correct by the architect
# BY HAND, once, and never by anything that runs again. This file closes
# that gap: a bounce recorded EXCLUSIVELY in a tracked ticket's
# bounce_history, with NO .swarmforge/bounces/*.jsonl entry at all, must
# still refuse - if the YAML branch ever regresses (or the JSONL branch
# is ever accidentally the only one consulted again), this is the one
# thing that would catch it.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp_cleanup.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PREDICATE="$SCRIPT_DIR/../is_qa_ancestor.sh"
fail=0
note() { printf '%s\n' "$*"; }
check() { if eval "$2"; then note "ok   - $1"; else note "FAIL - $1"; fail=1; fi; }

ROOT="$(mktemp -d)"
register_tmp_dir "$ROOT"

g() { git -C "$ROOT" -c user.email=t@t -c user.name=t "$@"; }

g init -q -b main
g commit -q --allow-empty -m seed

# The commit QA will bounce, recorded ONLY via a tracked ticket YAML's
# bounce_history - no JSONL store entry anywhere in this fixture.
mkdir -p "$ROOT/extension/src"
printf 'bounced work\n' > "$ROOT/extension/src/bad.ts"
g add -A
g commit -q -m "bounced parcel"
BOUNCED_SHA="$(g rev-parse HEAD)"
BOUNCED_SHORT="${BOUNCED_SHA:0:10}"

# A second, unrelated commit that is genuinely approved: no bounce record
# anywhere, reachable from swarmforge-QA.
printf 'approved work\n' > "$ROOT/extension/src/good.ts"
g add -A
g commit -q -m "approved parcel"
APPROVED_SHA="$(g rev-parse HEAD)"

g branch swarmforge-QA

# The bounce_history entry, in the exact inline-map shape record-bounce.js
# writes (matched by is_qa_ancestor.sh's `by: ... commit: <hex>` regex on
# one line) - present in the WORKING TREE under backlog/, same as every
# real ticket YAML, and also committed so a repo inspection matches
# production shape exactly.
mkdir -p "$ROOT/backlog/active"
cat > "$ROOT/backlog/active/BL-9-fixture-ticket.yaml" <<EOF
id: BL-9
title: "fixture ticket for test_is_qa_ancestor_yaml_store.sh"
status: todo
bounce_count: 1
bounce_history:
  - { at: 2026-08-19, by: QA, blamed: coder, class: unit, commit: ${BOUNCED_SHORT}, evidence: backlog/evidence/BL-9-fixture.md }
EOF
g add -A
g commit -q -m "BL-9 bounce_history"

# ── the check this file exists to add ───────────────────────────────────
set +e
OUT="$(cd "$ROOT" && bash "$PREDICATE" "$BOUNCED_SHA" 2>&1)"
EXIT_CODE=$?
set -e
check "YAML-only bounce refuses (exit 1)" "[[ $EXIT_CODE -eq 1 ]]"
check "YAML-only bounce names the ticket-YAML source in stderr" \
  '[[ "$OUT" == *"appears in a ticket'"'"'s bounce_history"* ]]'
check "no JSONL store exists in this fixture (proves the YAML branch alone fired)" \
  "[[ ! -e \"\$ROOT/.swarmforge/bounces\" ]]"

# ── precision: the bounce record must not blanket-refuse every commit ───
set +e
OUT2="$(cd "$ROOT" && bash "$PREDICATE" "$APPROVED_SHA" 2>&1)"
EXIT_CODE2=$?
set -e
check "an unrelated approved commit (same repo, same YAML file present) still reads exit 0" \
  "[[ $EXIT_CODE2 -eq 0 ]]"

if [[ $fail -ne 0 ]]; then
  note "FAILED"
  exit 1
fi
note "test_is_qa_ancestor_yaml_store: ALL CHECKS PASSED"
