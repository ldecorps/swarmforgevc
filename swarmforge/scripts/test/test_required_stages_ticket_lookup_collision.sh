#!/usr/bin/env bash
# BL-606 hardening: active-ticket-yaml-content (swarm_handoff.bb) must match a
# ticket by its own `id:` field, never by a filename-prefix glob. Every
# BL-606 review pass (architect bounce/pass evidence) NAMED the BL-900 vs
# BL-9005 false-collision failure mode as something the implementation
# guards against, but no existing test actually puts both ticket files on
# disk at once and drives a real send through them - the claim was verified
# by reading the code, never by a repro (this swarm's own hardener lesson:
# exercise a selector with 2+ candidates, never just one). This test is that
# repro: with BOTH BL-900-*.yaml and BL-9005-*.yaml present, a naive
# filename-prefix match for "BL-900" would ALSO match "BL-9005-demo.yaml"
# (both start with the six characters "BL-900"), so the two tickets are
# given deliberately DIFFERENT required_stages declarations - a wrong lookup
# changes the observable routing decision, not just an internal value.

set -euo pipefail
unset SWARMFORGE_ROLE

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SWARM_HANDOFF="$SCRIPT_DIR/../swarm_handoff.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$ROOT"' EXIT

git -C "$ROOT" init -q
git -C "$ROOT" -c user.email=t@t -c user.name=t commit -q --allow-empty -m one
HEAD10="$(git -C "$ROOT" rev-parse --short=10 HEAD)"

mkdir -p "$ROOT/.swarmforge" "$ROOT/swarmforge" "$ROOT/backlog/active"
{
  printf 'coordinator\tmaster\t%s\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n' "$ROOT"
  printf 'specifier\tmaster\t%s\tswarmforge-specifier\tSpecifier\tclaude\ttask\n' "$ROOT"
  printf 'coder\tcoder\t%s\tswarmforge-coder\tCoder\tclaude\ttask\n' "$ROOT"
  printf 'cleaner\tcleaner\t%s\tswarmforge-cleaner\tCleaner\tclaude\tbatch\n' "$ROOT"
  printf 'architect\tarchitect\t%s\tswarmforge-architect\tArchitect\tclaude\ttask\n' "$ROOT"
  printf 'hardender\thardender\t%s\tswarmforge-hardender\tHardender\tclaude\tbatch\n' "$ROOT"
  printf 'documenter\tdocumenter\t%s\tswarmforge-documenter\tDocumenter\tclaude\ttask\n' "$ROOT"
  printf 'QA\tQA\t%s\tswarmforge-QA\tQA\tclaude\ttask\n' "$ROOT"
} > "$ROOT/.swarmforge/roles.tsv"
echo 'config required_stages_routing_enabled false' > "$ROOT/swarmforge/swarmforge.conf"

# BL-900: declares [coder, qa] - cleaner is skipped, so a coder->cleaner send
# routes forward to QA.
cat > "$ROOT/backlog/active/BL-900-demo.yaml" <<'EOF'
id: BL-900
title: "demo"
status: active
required_stages: [coder, qa]
EOF

# BL-9005: declares the FULL chain (cleaner included), so a coder->cleaner
# send for THIS ticket is never rewritten - identity, `to:` stays cleaner.
# Its filename ("BL-9005-demo.yaml") shares the same first six characters
# ("BL-900") as BL-900's own filename.
cat > "$ROOT/backlog/active/BL-9005-demo.yaml" <<'EOF'
id: BL-9005
title: "demo"
status: active
required_stages: [coder, cleaner, architect, hardender, documenter, qa]
EOF

send() {
  local task="$1"
  local draft="$ROOT/draft.txt"
  printf 'type: git_handoff\nto: cleaner\npriority: 50\ntask: %s\ncommit: %s\n' "$task" "$HEAD10" > "$draft"
  local out
  out="$(cd "$ROOT" && SWARMFORGE_ROLE=coder SWARMFORGE_SKIP_SYNC_INJECT=1 SWARMFORGE_REQUIRED_STAGES_ROUTING=1 bb "$SWARM_HANDOFF" draft.txt)"
  local outfile
  outfile="$(echo "$out" | sed -n 's/^.*:\(\/[^[:space:]]*\.handoff\)$/\1/p' | tail -1)"
  [ -n "$outfile" ] || fail "no installed handoff file reported for task=$task: $out"
  grep '^to: ' "$outfile" | sed 's/^to: //'
}

TO_900="$(send 'BL-900-demo-task')"
[ "$TO_900" = "QA" ] || fail "BL-900 send: expected to be rewritten to QA (its own [coder,qa] declaration skips cleaner), got '$TO_900' - looks like the lookup read the wrong ticket file"
pass "BL-900: routed on its own declaration (to: QA), not BL-9005's"

TO_9005="$(send 'BL-9005-demo-task')"
[ "$TO_9005" = "cleaner" ] || fail "BL-9005 send: expected identity (to: cleaner, its own declaration includes cleaner), got '$TO_9005' - looks like the lookup read the wrong ticket file"
pass "BL-9005: routed on its own declaration (to: cleaner, unchanged), not BL-900's"

echo "ALL PASS"
