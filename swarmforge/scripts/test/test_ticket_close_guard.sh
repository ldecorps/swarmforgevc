#!/usr/bin/env bash
# Close/pipeline desync guards: QA-only close via commit_integrity_cli, refuse
# git_handoff for done tickets via swarm_handoff.bb.

set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp_cleanup.sh"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI="$SCRIPT_DIR/../commit_integrity_cli.bb"
SWARM_HANDOFF="$SCRIPT_DIR/../swarm_handoff.bb"
RUNNER="$SCRIPT_DIR/ticket_close_guard_lib_test_runner.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

OUT="$(bb "$RUNNER" 2>&1)" || { echo "$OUT"; fail "ticket_close_guard_lib_test_runner.bb exited non-zero"; }
echo "$OUT" | grep -q "ALL PASS" || fail "expected ticket_close_guard_lib assertions to pass"
pass "ticket_close_guard_lib unit tests"

mk_fixture() {
  local root
  root="$(cd "$(mktemp -d)" && pwd -P)"
  register_tmp_dir "$root"
  git -C "$root" init -q
  git -C "$root" config user.email test@test
  git -C "$root" config user.name test
  git -C "$root" commit -q --allow-empty -m init
  mkdir -p "$root/.swarmforge/handoffs/coordinator/inbox/new" \
           "$root/architect/.swarmforge/handoffs/inbox/new" \
           "$root/backlog/active" "$root/backlog/done" "$root/swarmforge"
  printf "coordinator\tmaster\t%s\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n" "$root" > "$root/.swarmforge/roles.tsv"
  printf "architect\tarchitect-wt\t%s/architect\tswarmforge-architect\tArchitect\tclaude\ttask\n" "$root" >> "$root/.swarmforge/roles.tsv"
  echo "$root"
}

# ── close blocked without QA approval ────────────────────────────────────
ROOT="$(mk_fixture)"
printf 'id: BL-551\ntitle: x\nstatus: active\n' > "$ROOT/backlog/active/BL-551-slug.yaml"
git -C "$ROOT" add backlog/active/BL-551-slug.yaml
git -C "$ROOT" mv backlog/active/BL-551-slug.yaml backlog/done/BL-551-slug.yaml
OUT="$(bb "$CLI" "$ROOT" \
  --message "Close BL-551: move to done" \
  --path backlog/active/BL-551-slug.yaml \
  --path backlog/done/BL-551-slug.yaml 2>&1)" && fail "close without QA approval should exit non-zero"
echo "$OUT" | grep -q "CLOSE BLOCKED" || fail "expected CLOSE BLOCKED message; got: $OUT"
pass "commit_integrity_cli blocks close without QA approval"

# ── close allowed with QA git_handoff + abandons in-flight mail ────────────
ROOT="$(mk_fixture)"
printf 'id: BL-551\ntitle: x\nstatus: active\n' > "$ROOT/backlog/active/BL-551-slug.yaml"
git -C "$ROOT" -c user.email=test@test -c user.name=test add backlog/active/BL-551-slug.yaml
git -C "$ROOT" commit -q -m "seed active ticket"
printf 'id: x\nfrom: QA\nto: coordinator\npriority: 00\ntype: git_handoff\ntask: BL-551-slug\ncommit: a1b2c3d4e5\n\nbody\n' \
  > "$ROOT/.swarmforge/handoffs/coordinator/inbox/new/00_qa.handoff"
printf 'id: y\nfrom: architect\nto: hardender\npriority: 20\ntype: git_handoff\ntask: BL-551-slug\ncommit: a1b2c3d4e5\n\nbody\n' \
  > "$ROOT/architect/.swarmforge/handoffs/inbox/new/20_arch.handoff"
git -C "$ROOT" mv backlog/active/BL-551-slug.yaml backlog/done/BL-551-slug.yaml
OUT="$(bb "$CLI" "$ROOT" \
  --message "Close BL-551: move to done" \
  --path backlog/active/BL-551-slug.yaml \
  --path backlog/done/BL-551-slug.yaml 2>&1)" || fail "close with QA approval should succeed; got: $OUT"
echo "$OUT" | grep -q '"success":true' || fail "expected success JSON; got: $OUT"
test ! -f "$ROOT/architect/.swarmforge/handoffs/inbox/new/20_arch.handoff" \
  || fail "architect in-flight handoff should be abandoned on close"
test -f "$ROOT/architect/.swarmforge/handoffs/inbox/abandoned/20_arch.handoff" \
  || fail "architect handoff should land in abandoned/"
pass "commit_integrity_cli closes with QA approval and abandons in-flight mail"

# ── swarm_handoff refuses git_handoff for done ticket ──────────────────────
ROOT="$(mk_fixture)"
printf 'id: BL-551\ntitle: x\nstatus: done\n' > "$ROOT/backlog/done/BL-551-slug.yaml"
git -C "$ROOT" add backlog/done/BL-551-slug.yaml
git -C "$ROOT" commit -q -m "seed done ticket"
printf 'type: git_handoff\nto: hardender\npriority: 20\ntask: BL-551-slug\ncommit: a1b2c3d4e5\n' > "$ROOT/draft.txt"
OUT="$(cd "$ROOT" && SWARMFORGE_ROLE=architect SWARMFORGE_SKIP_DAEMON=1 SWARMFORGE_MAILBOX_ONLY=1 \
  bb "$SWARM_HANDOFF" "$ROOT/draft.txt" 2>&1)" && fail "git_handoff for done ticket should fail"
echo "$OUT" | grep -qi "closed ticket BL-551" || fail "expected closed-ticket error; got: $OUT"
pass "swarm_handoff refuses git_handoff for done ticket"

echo "ALL PASS: ticket close/pipeline guards"
