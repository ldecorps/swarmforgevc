#!/usr/bin/env bash
# BL-821 Leg A: real-fixture proof for briefing_email_lib.bb's
# commit-sent-marker! against a REAL git process - the injected-sh-fn unit
# tests in briefing_email_test_runner.bb already cover the add/commit
# call-scoping and error-handling logic without a real git process; this
# file is the real-git-process sibling, same split as every other
# tmux/git-touching concern in this codebase (see that function's own
# docstring, which names this file).
#
# Also exercises the cross-host mechanic behind BL-821's first declared
# invariant ("a given briefing file is emailed at most once across every
# host and checkout") at the level this ticket actually owns: a REAL git
# commit made by one checkout, once pulled by a second, durably prevents a
# resend - see bl821_briefing_marker_cross_host_property_runner.bb for the
# generalized (many-hosts, many-orderings) version of the same claim, and
# that file's header for why the "zero pulls ever" case is out of this
# ticket's scope rather than asserted here.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp_cleanup.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB="$SCRIPT_DIR/../briefing_email_lib.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

git_repo() {
  local d; d="$(mktemp -d)"
  register_tmp_dir "$d"
  git -C "$d" init -q
  git -C "$d" config user.email "swarmforge-test@example.com"
  git -C "$d" config user.name "swarmforge-test"
  mkdir -p "$d/docs/briefings"
  printf '# fixture repo\n' > "$d/README.md"
  git -C "$d" add README.md
  git -C "$d" commit -q -m "init"
  printf '%s' "$d"
}

# BL-506: an initial unrelated modification present BEFORE any marker
# write - proves the commit stays scoped even when the working tree is
# already dirty for an unrelated reason, not just when the marker is the
# ONLY change.
dirty_unrelated_file() {
  local repo_dir="$1"
  printf 'unrelated local edit\n' >> "$repo_dir/README.md"
}

commit_marker() {
  # Calls the real commit-sent-marker! (default 1-arg arity - real-sh, real
  # git) against briefings-dir inside repo_dir.
  local briefings_dir="$1"
  bb -e "
    (load-file \"$LIB\")
    (println (pr-str (briefing-email-lib/commit-sent-marker! \"$briefings_dir\")))
  "
}

record_sent() {
  local briefings_dir="$1" file_name="$2"
  bb -e "
    (load-file \"$LIB\")
    (briefing-email-lib/record-briefing-sent! \"$briefings_dir\" \"$file_name\")
  "
}

find_unsent() {
  local briefings_dir="$1"
  bb -e "
    (load-file \"$LIB\")
    (println (pr-str (briefing-email-lib/find-unsent-briefings \"$briefings_dir\")))
  "
}

# ── 01: a clean marker write is committed, scoped to exactly that path ─────
REPO1="$(git_repo)"
BRIEFINGS1="$REPO1/docs/briefings"
printf 'Headline: fixture\n\nBody.\n' > "$BRIEFINGS1/2026-08-17.md"
record_sent "$BRIEFINGS1" "2026-08-17.md"
RESULT1="$(commit_marker "$BRIEFINGS1")"
[[ "$RESULT1" == '{:ok true}' ]] || fail "01: expected {:ok true}, got: $RESULT1"
pass "01: commit-sent-marker! reports ok on a clean commit"

STAT1="$(git -C "$REPO1" show --stat -1 --format="" HEAD)"
echo "$STAT1" | grep -q "docs/briefings/.sent.json" || fail "01: expected the commit to touch docs/briefings/.sent.json, got: $STAT1"
[[ "$(echo "$STAT1" | grep -c "|")" -eq 1 ]] || fail "01: expected the commit to touch EXACTLY one file, got: $STAT1"
pass "01: the commit touches exactly the marker path, nothing else"

# ── 02: re-committing byte-identical content is a no-op, not an error ──────
RESULT2="$(commit_marker "$BRIEFINGS1")"
[[ "$RESULT2" == '{:ok true, :reason :nothing-to-commit}' ]] || fail "02: expected nothing-to-commit, got: $RESULT2"
pass "02: an idempotent re-commit of identical marker content reports :nothing-to-commit, not a failure"

# ── 03: an unrelated dirty file never rides the marker's commit (BL-506) ───
REPO2="$(git_repo)"
BRIEFINGS2="$REPO2/docs/briefings"
printf 'Headline: fixture\n\nBody.\n' > "$BRIEFINGS2/2026-08-17.md"
dirty_unrelated_file "$REPO2"
record_sent "$BRIEFINGS2" "2026-08-17.md"
RESULT3="$(commit_marker "$BRIEFINGS2")"
[[ "$RESULT3" == '{:ok true}' ]] || fail "03: expected {:ok true}, got: $RESULT3"
STAT3="$(git -C "$REPO2" show --stat -1 --format="" HEAD)"
echo "$STAT3" | grep -q "README.md" && fail "03: the unrelated README.md edit must not be in the marker's commit; got: $STAT3"
git -C "$REPO2" status --porcelain | grep -q "README.md" || fail "03: the unrelated README.md edit must remain uncommitted/dirty in the working tree"
pass "03: only the marker is committed; an unrelated modified file stays uncommitted (BL-506)"

# ── 04: cross-host - a real pull propagates the durable record, preventing
#     a resend by a second checkout (the module-owned slice of BL-821's
#     "at most once across every host and checkout" invariant) ────────────
ORIGIN="$(mktemp -d)"; register_tmp_dir "$ORIGIN"
git init -q --bare "$ORIGIN"

HOST_A="$(mktemp -d)"; register_tmp_dir "$HOST_A"
git clone -q "$ORIGIN" "$HOST_A"
git -C "$HOST_A" config user.email "swarmforge-test@example.com"
git -C "$HOST_A" config user.name "swarmforge-test"
mkdir -p "$HOST_A/docs/briefings"
printf '# fixture repo\n' > "$HOST_A/README.md"
printf 'Headline: fixture\n\nBody.\n' > "$HOST_A/docs/briefings/2026-08-17.md"
git -C "$HOST_A" add README.md docs/briefings/2026-08-17.md
git -C "$HOST_A" commit -q -m "seed: README + today's briefing"
git -C "$HOST_A" push -q origin HEAD:main

HOST_B="$(mktemp -d)"; register_tmp_dir "$HOST_B"
git clone -q "$ORIGIN" "$HOST_B"
git -C "$HOST_B" config user.email "swarmforge-test@example.com"
git -C "$HOST_B" config user.name "swarmforge-test"

# host A "sends" (records + commits + pushes) BEFORE host B ever pulls -
# simulating exactly the interleaving the invariant names: a sweep tick, a
# marker write, then a pull on a different checkout.
BRIEFINGS_A="$HOST_A/docs/briefings"
record_sent "$BRIEFINGS_A" "2026-08-17.md"
RESULT4="$(commit_marker "$BRIEFINGS_A")"
[[ "$RESULT4" == '{:ok true}' ]] || fail "04: host A's commit failed: $RESULT4"
git -C "$HOST_A" push -q origin HEAD:main

# host B pulls BEFORE its own sweep tick - matching the precondition this
# module's own property runner documents (see that file's header).
git -C "$HOST_B" pull -q origin main
UNSENT_B="$(find_unsent "$HOST_B/docs/briefings")"
[[ "$UNSENT_B" == "[]" ]] || fail "04: expected host B to see the briefing already sent after pulling, got unsent: $UNSENT_B"
pass "04: a real pull on a second checkout durably reflects host A's commit - the briefing is never offered to host B's sweep again"

echo "ALL PASS"
