#!/usr/bin/env bash
# BL-419: subprocess-level proof that commit_integrity_cli.bb is a real,
# invocable wiring of commit_integrity_lib.bb - the same "drive the CLI as
# a real subprocess against a real git fixture" posture as
# test_operator_file_question.sh.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI="$SCRIPT_DIR/../commit_integrity_cli.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

git_repo() {
  local d; d="$(mktemp -d)"
  (cd "$d" && git init -q && git config user.email t@t && git config user.name t && git commit -q -m init --allow-empty)
  printf '%s' "$d"
}

# ── a real commit succeeds and reports its sha ──────────────────────────
ROOT="$(git_repo)"
trap 'rm -rf "$ROOT"' EXIT

printf 'human_approval: approved\n' > "$ROOT/ticket.yaml"
OUT="$(bb "$CLI" "$ROOT" --message "Approve BL-000" --path ticket.yaml)"
echo "$OUT" | grep -q '"success":true' || fail "expected success:true, got: $OUT"

SHA="$(echo "$OUT" | grep -oE '"sha":"[^"]+"' | sed -E 's/"sha":"([^"]+)"/\1/')"
[[ -n "$SHA" ]] || fail "expected a non-empty sha in the CLI output, got: $OUT"
[[ "$(git -C "$ROOT" show "$SHA:ticket.yaml")" == "human_approval: approved" ]] \
  || fail "expected git show of the reported sha to carry the committed content"
[[ -z "$(git -C "$ROOT" status --porcelain -- ticket.yaml)" ]] \
  || fail "expected the working tree to be clean for the committed path"
pass "commit_integrity_cli commits a real path and reports the real sha"
rm -rf "$ROOT"
trap - EXIT

# ── multiple --path flags land in one commit, pathspec-scoped ──────────
ROOT2="$(git_repo)"
trap 'rm -rf "$ROOT2"' EXIT

printf 'a\n' > "$ROOT2/a.txt"
printf 'b\n' > "$ROOT2/b.txt"
OUT2="$(bb "$CLI" "$ROOT2" --message "add a and b" --path a.txt --path b.txt)"
echo "$OUT2" | grep -q '"success":true' || fail "expected success:true for a two-path commit, got: $OUT2"
SHA2="$(echo "$OUT2" | grep -oE '"sha":"[^"]+"' | sed -E 's/"sha":"([^"]+)"/\1/')"
STAT="$(git -C "$ROOT2" show --stat --format= "$SHA2")"
echo "$STAT" | grep -q "a.txt" || fail "expected the commit to include a.txt"
echo "$STAT" | grep -q "b.txt" || fail "expected the commit to include b.txt"
pass "commit_integrity_cli commits multiple --path flags together"
rm -rf "$ROOT2"
trap - EXIT

# ── a non-repo target fails loudly, never a false success ──────────────
NOT_A_REPO="$(mktemp -d)"
printf 'x\n' > "$NOT_A_REPO/x.txt"
set +e
OUT3="$(bb "$CLI" "$NOT_A_REPO" --message "m" --path x.txt 2>&1)"
CODE=$?
set -e
[[ "$CODE" -ne 0 ]] || fail "expected non-zero exit for a non-git-repo target, got 0: $OUT3"
[[ "$OUT3" == *'no-git-dir'* ]] || fail "expected the no-git-dir reason to be named, got: $OUT3"
[[ "$OUT3" != *'"success":true'* ]] || fail "expected no false success report, got: $OUT3"
pass "commit_integrity_cli fails loudly (non-zero, no false success) against a non-git-repo target"
rm -rf "$NOT_A_REPO"

# ── missing required flags print usage and exit non-zero ───────────────
set +e
OUT4="$(bb "$CLI" "/tmp" --message "m" 2>&1)"
CODE4=$?
set -e
[[ "$CODE4" -ne 0 ]] || fail "expected non-zero exit with no --path given, got 0: $OUT4"
[[ "$OUT4" == *'Usage:'* ]] || fail "expected a usage message, got: $OUT4"
pass "commit_integrity_cli refuses to run with no --path given"

# ── BL-856: a close-guard rejection leaves no residue - it exits before
#    commit-with-integrity! (and therefore any staging) ever runs, so the
#    snapshot/restore guarantee holds trivially: nothing changed, so there
#    is nothing to restore. ──────────────────────────────────────────────
ROOT5="$(git_repo)"
trap 'rm -rf "$ROOT5"' EXIT

mkdir -p "$ROOT5/backlog/active" "$ROOT5/backlog/done"
printf 'id: BL-777\n' > "$ROOT5/backlog/active/BL-777-x.yaml"
git -C "$ROOT5" add -- backlog/active/BL-777-x.yaml
git -C "$ROOT5" commit -q -m "seed BL-777"
git -C "$ROOT5" mv backlog/active/BL-777-x.yaml backlog/done/BL-777-x.yaml
BEFORE5="$(git -C "$ROOT5" status --porcelain -- backlog/active/BL-777-x.yaml backlog/done/BL-777-x.yaml)"

set +e
OUT5="$(bb "$CLI" "$ROOT5" --message "Close BL-777" --path backlog/active/BL-777-x.yaml --path backlog/done/BL-777-x.yaml 2>&1)"
CODE5=$?
set -e
AFTER5="$(git -C "$ROOT5" status --porcelain -- backlog/active/BL-777-x.yaml backlog/done/BL-777-x.yaml)"

[[ "$CODE5" -ne 0 ]] || fail "expected non-zero exit for a close-guard rejection (no QA approval evidence), got 0: $OUT5"
[[ "$OUT5" == *'CLOSE BLOCKED'* ]] || fail "expected a CLOSE BLOCKED message, got: $OUT5"
[[ "$BEFORE5" == "$AFTER5" ]] || fail "expected the close-guard rejection to leave the index exactly as found (before: '$BEFORE5', after: '$AFTER5')"
pass "commit_integrity_cli: a close-guard rejection leaves the caller's pre-staged rename exactly as it found it"
rm -rf "$ROOT5"
trap - EXIT

# ── BL-869: a multi-ticket close validates AND runs post-close side
#    effects (abandon-inflight) for EVERY ticket the commit closes, not
#    just the first one parse-close-move used to collapse onto. ─────────
ROOT6="$(git_repo)"
trap 'rm -rf "$ROOT6"' EXIT

mkdir -p "$ROOT6/backlog/active" "$ROOT6/backlog/done" \
         "$ROOT6/.swarmforge/handoffs/coordinator/inbox/new" \
         "$ROOT6/architect/.swarmforge/handoffs/inbox/new"
printf "coordinator\tmaster\t%s\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n" "$ROOT6" > "$ROOT6/.swarmforge/roles.tsv"
printf "architect\tarchitect-wt\t%s/architect\tswarmforge-architect\tArchitect\tclaude\ttask\n" "$ROOT6" >> "$ROOT6/.swarmforge/roles.tsv"

printf 'id: BL-857\n' > "$ROOT6/backlog/active/BL-857-a.yaml"
printf 'id: BL-849\n' > "$ROOT6/backlog/active/BL-849-b.yaml"
git -C "$ROOT6" add -- backlog/active/BL-857-a.yaml backlog/active/BL-849-b.yaml
git -C "$ROOT6" commit -q -m "seed BL-857 and BL-849"

printf 'id: x\nfrom: QA\nto: coordinator\npriority: 00\ntype: note\nmessage: QA approved BL-857,BL-849 @ a1b2c3d4e5, landed on main.\n\nbody\n' \
  > "$ROOT6/.swarmforge/handoffs/coordinator/inbox/new/00_qa.handoff"
printf 'id: y\nfrom: architect\nto: hardender\npriority: 20\ntype: git_handoff\ntask: BL-857-a\ncommit: a1b2c3d4e5\n\nbody\n' \
  > "$ROOT6/architect/.swarmforge/handoffs/inbox/new/20_bl857.handoff"
printf 'id: z\nfrom: architect\nto: hardender\npriority: 20\ntype: git_handoff\ntask: BL-849-b\ncommit: a1b2c3d4e5\n\nbody\n' \
  > "$ROOT6/architect/.swarmforge/handoffs/inbox/new/21_bl849.handoff"

git -C "$ROOT6" mv backlog/active/BL-857-a.yaml backlog/done/BL-857-a.yaml
git -C "$ROOT6" mv backlog/active/BL-849-b.yaml backlog/done/BL-849-b.yaml
OUT6="$(bb "$CLI" "$ROOT6" \
  --message "Close BL-857 and BL-849: move to done" \
  --path backlog/active/BL-857-a.yaml --path backlog/done/BL-857-a.yaml \
  --path backlog/active/BL-849-b.yaml --path backlog/done/BL-849-b.yaml 2>&1)" \
  || fail "multi-ticket close with a QA note naming both should succeed; got: $OUT6"
echo "$OUT6" | grep -q '"success":true' || fail "expected success JSON for multi-ticket close; got: $OUT6"
echo "$OUT6" | grep -q '"closed-ticket-ids":\["BL-857","BL-849"\]' \
  || fail "expected closed-ticket-ids to name BOTH tickets, not just the first; got: $OUT6"
test ! -f "$ROOT6/architect/.swarmforge/handoffs/inbox/new/20_bl857.handoff" \
  || fail "BL-857's in-flight handoff should be abandoned on close"
test ! -f "$ROOT6/architect/.swarmforge/handoffs/inbox/new/21_bl849.handoff" \
  || fail "BL-849's in-flight handoff should ALSO be abandoned on close, not just the first ticket's"
test -f "$ROOT6/architect/.swarmforge/handoffs/inbox/abandoned/20_bl857.handoff" \
  || fail "BL-857's handoff should land in abandoned/"
test -f "$ROOT6/architect/.swarmforge/handoffs/inbox/abandoned/21_bl849.handoff" \
  || fail "BL-849's handoff should ALSO land in abandoned/"
pass "commit_integrity_cli: a multi-ticket close abandons in-flight mail for every closed ticket"
rm -rf "$ROOT6"
trap - EXIT

# ── BL-869: a multi-ticket close with only ONE ticket QA-approved blocks
#    and names the unapproved ticket, not the approved one. ─────────────
ROOT7="$(git_repo)"
trap 'rm -rf "$ROOT7"' EXIT

mkdir -p "$ROOT7/backlog/active" "$ROOT7/backlog/done" \
         "$ROOT7/.swarmforge/handoffs/coordinator/inbox/new"
printf "coordinator\tmaster\t%s\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n" "$ROOT7" > "$ROOT7/.swarmforge/roles.tsv"

printf 'id: BL-857\n' > "$ROOT7/backlog/active/BL-857-a.yaml"
printf 'id: BL-849\n' > "$ROOT7/backlog/active/BL-849-b.yaml"
git -C "$ROOT7" add -- backlog/active/BL-857-a.yaml backlog/active/BL-849-b.yaml
git -C "$ROOT7" commit -q -m "seed BL-857 and BL-849"

printf 'id: x\nfrom: QA\nto: coordinator\npriority: 00\ntype: git_handoff\ntask: BL-857-a\ncommit: a1b2c3d4e5\n\nbody\n' \
  > "$ROOT7/.swarmforge/handoffs/coordinator/inbox/new/00_qa.handoff"

git -C "$ROOT7" mv backlog/active/BL-857-a.yaml backlog/done/BL-857-a.yaml
git -C "$ROOT7" mv backlog/active/BL-849-b.yaml backlog/done/BL-849-b.yaml
set +e
OUT7="$(bb "$CLI" "$ROOT7" \
  --message "Close BL-857 and BL-849: move to done" \
  --path backlog/active/BL-857-a.yaml --path backlog/done/BL-857-a.yaml \
  --path backlog/active/BL-849-b.yaml --path backlog/done/BL-849-b.yaml 2>&1)"
CODE7=$?
set -e
[[ "$CODE7" -ne 0 ]] || fail "expected non-zero exit when only one of two tickets is QA-approved, got 0: $OUT7"
echo "$OUT7" | grep -q "CLOSE BLOCKED for BL-849" || fail "expected the block to name BL-849 (the unapproved ticket); got: $OUT7"
echo "$OUT7" | grep -q "BL-857" && fail "expected the block to NOT name BL-857 (the already-approved ticket); got: $OUT7"
pass "commit_integrity_cli: a partially-approved multi-ticket close blocks and names only the unapproved ticket"
rm -rf "$ROOT7"
trap - EXIT

echo "ALL PASS"
