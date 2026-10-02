#!/usr/bin/env bash
# BL-1898: a ticket's land record satisfies the close guard.
#
# Since BL-1872 the lander sends QA's bookkeep note as the coordinator, so the
# guard's QA-mailbox path never sees it. The land step's own land record
# (.swarmforge/land-approvals) is now a third approval path - for the ticket
# it names, and only when its commit is on main. Drives the REAL
# commit_integrity_cli.bb over real git fixtures, as BL-1378's fixture does,
# because a decision that is right and not wired in refuses nothing.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI="$SCRIPT_DIR/../commit_integrity_cli.bb"
source "$SCRIPT_DIR/lib/tmp_cleanup.sh"

PREFIX="bl1898-land-record-close"
sweep_stale_prefix_roots "$PREFIX"
TMPROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.$$.XXXXXX")"
trap 'rm -rf "$TMPROOT"' EXIT

fails=0
pass() { echo "  ok   $1"; }
fail() { echo "  FAIL $1"; fails=$((fails + 1)); }
contains() { if grep -qF -- "$3" <<<"$2"; then pass "$1"; else fail "$1 (missing '$3')"; fi; }

TICKET="BL-9001"

prove_root() {
  local root="$1"
  # The string check FIRST (test_bl1390's own in_fixture, same order): a
  # relative git-common-dir answer ("`.git`") resolves against $root, so it
  # proves nothing on its own unless $root itself is already known to sit
  # under $TMPROOT.
  [[ -n "$root" && "$root" == "$TMPROOT"/* && -d "$root" ]] || {
    echo "test_bl1898_land_record_close_guard: refusing to mutate '$root' - not under $TMPROOT" >&2
    exit 1
  }
  local common
  common="$(git -C "$root" rev-parse --git-common-dir 2>/dev/null)" || {
    # BL-1686: NOT a refusal - `mk_fixture` must call this BEFORE its own
    # `git init` (the first mutating command, per this file's own
    # standing rule), and a root that is not YET a git repository at all
    # answers this git call identically to a root that never will be.
    # The string check above already proved `$root` sits under $TMPROOT,
    # which is the only thing there IS to prove about a path with no
    # `.git` yet - nothing has pointed anywhere else, because nothing has
    # pointed anywhere at all. A caller that expects an EXISTING repo
    # (unlanded_commit, called only after mk_fixture's own `git init` has
    # already run) gets a real git-common-dir answer here and the check
    # below still applies to it in full.
    return 0
  }
  case "$common" in
    /*) [[ "$common" == "$TMPROOT"/* ]] || {
          echo "test_bl1898_land_record_close_guard: refusing to mutate '$root' - its git-common-dir '$common' is not under $TMPROOT" >&2
          exit 1
        } ;;
    *)  : ;;   # relative (.git) - resolved against $root, already proven under $TMPROOT above
  esac
}
mk_fixture() {
  # mktemp, not a counter: a counter incremented inside `$( )` never reaches
  # the caller, so every fixture would be the same directory re-inited on top
  # of the last one.
  local root
  root="$(mktemp -d "$TMPROOT/fix.XXXXXX")"
  # BL-1686: proven BEFORE `git init` - the first mutating command in this
  # function, not the second. The 2026-09-21 architect finding: a
  # concurrent run's blind startup sweep (see below) can delete this
  # file's own live $TMPROOT between its creation and this call, so
  # `mktemp` above fails silently under `set -uo pipefail` (no `-e`) and
  # `root` is the empty string - `git -C "" init` then runs in the
  # process's OWN cwd, the live worktree (BL-1390's exact shape), and
  # only ran here, one line AFTER that init, in this file's first pass at
  # this fix (BL-1516, cd638f1c6f).
  prove_root "$root"
  git -C "$root" init -q -b main
  git -C "$root" config user.email test@test
  git -C "$root" config user.name test
  git -C "$root" config commit.gpgsign false
  mkdir -p "$root/.swarmforge/handoffs/coordinator/inbox/new" "$root/backlog/active" "$root/backlog/done"
  printf "coordinator\tmaster\t%s\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n" "$root" > "$root/.swarmforge/roles.tsv"
  printf 'id: %s\ntitle: x\nstatus: active\n' "$TICKET" > "$root/backlog/active/$TICKET-slug.yaml"
  git -C "$root" add -A
  git -C "$root" commit -q -m "seed active ticket"
  echo "$root"
}
landed_commit() { git -C "$1" rev-parse HEAD; }
unlanded_commit() {
  local root="$1"
  prove_root "$root"
  git -C "$root" checkout -q -b side
  git -C "$root" commit -q --allow-empty -m "work that never reached main"
  local sha; sha="$(git -C "$root" rev-parse HEAD)"
  git -C "$root" checkout -q main
  echo "$sha"
}
close_it() {
  local root="$1"
  # a failed `git mv` would leave the guard deciding about a move that never
  # happened, and every assertion below would then be about nothing.
  git -C "$root" mv "backlog/active/$TICKET-slug.yaml" "backlog/done/$TICKET-slug.yaml" \
    || { echo "fixture: git mv failed in $root"; return 99; }
  bb "$CLI" "$root" \
    --message "Close $TICKET: move to done" \
    --path "backlog/active/$TICKET-slug.yaml" \
    --path "backlog/done/$TICKET-slug.yaml" 2>&1
  return $?
}

write_land_record() {
  mkdir -p "$1/.swarmforge/land-approvals"
  printf '{"ticket":"%s","commit":"%s","source":"9b21296a49"}\n' "$2" "$3" \
    >> "$1/.swarmforge/land-approvals/2026-10.jsonl"
}

write_coordinator_note() {
  printf 'id: x\nfrom: coordinator\nto: coordinator\npriority: 00\ntype: note\nmessage: %s QA-approved feb18315ea - move to done and promote next\n\nbody\n' \
    "$TICKET" > "$1/.swarmforge/handoffs/coordinator/inbox/new/00_lander.handoff"
}

write_qa_handoff() {
  printf 'id: x\nfrom: QA\nto: coordinator\npriority: 00\ntype: git_handoff\ntask: %s-slug\ncommit: a1b2c3d4e5\n\nbody\n' \
    "$TICKET" > "$1/.swarmforge/handoffs/coordinator/inbox/new/00_qa.handoff"
}

echo "01: a land record whose commit is on main allows the close"
R="$(mk_fixture)"
LANDED="$(landed_commit "$R")"
write_land_record "$R" "$TICKET" "${LANDED:0:10}"
OUT="$(close_it "$R")"; S=$?
if [[ $S -eq 0 ]]; then pass "01: the close is allowed"; else fail "01: refused: $OUT"; fi
contains "01: and the guard names the land record it relied on" "$OUT" "land-record"
contains "01: naming its commit" "$OUT" "${LANDED:0:10}"

echo "02: a land record grants a close only for its ticket and a commit on main"
R="$(mk_fixture)"
write_land_record "$R" "BL-9002" "$(landed_commit "$R")"
OUT="$(close_it "$R")"; S=$?
if [[ $S -ne 0 ]]; then pass "02 other-ticket: the close is refused"; else fail "02 other-ticket: allowed: $OUT"; fi
contains "02 other-ticket: as a missing QA approval" "$OUT" "missing-qa-approval"
R="$(mk_fixture)"
UNLANDED="$(unlanded_commit "$R")"
write_land_record "$R" "$TICKET" "$UNLANDED"
OUT="$(close_it "$R")"; S=$?
if [[ $S -ne 0 ]]; then pass "02 not-on-main: the close is refused"; else fail "02 not-on-main: allowed: $OUT"; fi
contains "02 not-on-main: saying the commit is not on main" "$OUT" "land-commit-not-on-main"

echo "03: a note sent as the coordinator is not sign-off"
R="$(mk_fixture)"
write_coordinator_note "$R"
OUT="$(close_it "$R")"; S=$?
if [[ $S -ne 0 ]]; then pass "03: the close is refused"; else fail "03: allowed: $OUT"; fi
contains "03: as a missing QA approval" "$OUT" "missing-qa-approval"

echo "04: an unreadable land record store refuses and says why"
R="$(mk_fixture)"
write_land_record "$R" "$TICKET" "$(landed_commit "$R")"
printf 'not a record\n' >> "$R/.swarmforge/land-approvals/2026-10.jsonl"
OUT="$(close_it "$R")"; S=$?
if [[ $S -ne 0 ]]; then pass "04: the close is refused"; else fail "04: allowed: $OUT"; fi
contains "04: naming the land record store" "$OUT" "land record store"

echo "05: the QA mailbox path still decides first"
R="$(mk_fixture)"
write_qa_handoff "$R"
mkdir -p "$R/.swarmforge/land-approvals"
printf 'not a record\n' > "$R/.swarmforge/land-approvals/2026-10.jsonl"
OUT="$(close_it "$R")"; S=$?
if [[ $S -eq 0 ]]; then pass "05: a corrupt land store does not break the mailbox path"; else fail "05: refused: $OUT"; fi

if [[ $fails -gt 0 ]]; then
  echo "test_bl1898_land_record_close_guard: $fails FAILURE(S)"
  exit 1
fi
echo "test_bl1898_land_record_close_guard: ALL PASS"
