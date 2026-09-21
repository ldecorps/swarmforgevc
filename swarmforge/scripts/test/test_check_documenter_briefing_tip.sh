#!/usr/bin/env bash
# BL-1459: swarmforge/scripts/check_documenter_briefing_tip.sh, exercised
# directly (both entry modes) as REAL git subprocesses against a real
# throwaway repo - never a parallel reimplementation of its decision
# logic. Complements specs/features/BL-1459-a-documenter-briefing-lands-
# through-a-qa-note-inside-its-lane.feature, which drives the same guard
# through the REAL wired pre-merge-commit hook chain end to end; this
# suite is the fast, narrower layer that exercises the guard's own two
# entry modes without installing hooks. Hook mode is reached the same way
# a real `git merge --no-ff` reaches it - MERGE_HEAD present, mid-merge -
# via `git merge --no-ff --no-commit`, never a hand-simulated substitute
# for that file. BL-1444's own test (test_bl1444_art_director_tip_guard.sh)
# is this suite's direct template.
#
# BL-1390: every git command below runs through g()/gq(), which refuses
# (via in_fixture) unless the target directory's own `rev-parse
# --git-common-dir` resolves inside this run's $WORK - never the live
# repository, never `git -C ""`.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
GUARD="$REPO_ROOT/swarmforge/scripts/check_documenter_briefing_tip.sh"

status=0
fail() { echo "FAIL: $*"; status=1; }
pass() { echo "PASS: $*"; }

FIXTURE_PREFIX="sfvc-bl1459-e2e"
source "$SCRIPT_DIR/lib/fixture_isolation.sh"
fixture_isolation_begin "$FIXTURE_PREFIX" "${BL1459_SUITE_BOUND_SECONDS:-600}" "$@"
trap 'rm -rf "$WORK"' EXIT

in_fixture() {
  local dir="${1:-}"
  [[ -n "$dir" && "$dir" == "$WORK"/* && -d "$dir" ]] || return 1
  local common
  common="$(git -C "$dir" rev-parse --git-common-dir 2>/dev/null)" || return 1
  case "$common" in /*) [[ "$common" == "$WORK"/* ]] || return 1 ;; *) : ;; esac
}
g() { in_fixture "$1" || { fail "refusing git outside the fixture: '${1:-<empty>}'"; return 1; }; git -C "$1" "${@:2}"; }
gq() { g "$@" >/dev/null 2>&1; }

DOC_BRANCH="swarmforge-documenter"

mk_repo() {  # mk_repo <name> -> sets `repo` global to a fresh repo with a
             # main branch and a documenter branch based on it.
  repo="$WORK/$1"
  mkdir -p "$repo"
  # git init CREATES the git-common-dir in_fixture's own check depends on,
  # so it runs directly, once, never through g()/gq() (test_bl1366's own
  # pattern) - every git command after this point goes through the
  # wrapper.
  git init -q -b main "$repo"
  g "$repo" config user.email t@t >/dev/null
  g "$repo" config user.name t >/dev/null
  g "$repo" commit -q --allow-empty -m init
  g "$repo" branch "$DOC_BRANCH" main
}

write_commit() {  # write_commit <repo> <branch> <path>... - one commit
                   # touching every given path, on <branch>.
  local r="$1" b="$2"
  shift 2
  g "$r" checkout -q "$b"
  local p
  for p in "$@"; do
    mkdir -p "$r/$(dirname "$p")"
    echo "content" > "$r/$p"
    g "$r" add "$p"
  done
  g "$r" commit -q -m "change: $*"
}

# ── 1. --print-lane ───────────────────────────────────────────────────
out="$(bash "$GUARD" --print-lane)"
if grep -q 'docs/briefings/<date>.md' <<<"$out" && grep -q 'docs/briefings/<date>.json' <<<"$out"; then
  pass "--print-lane prints the lane"
else
  fail "--print-lane did not print the expected lane: $out"
fi

# ── 2. direct mode: a tip that changes only the day's briefing file is OK
mk_repo direct-ok
write_commit "$repo" "$DOC_BRANCH" docs/briefings/2099-01-01.md
tip="$(g "$repo" rev-parse HEAD)"
g "$repo" checkout -q main
out="$(cd "$repo" && bash "$GUARD" --tip "$tip" --branch "$DOC_BRANCH")"; rc=$?
if [[ $rc -eq 0 ]] && grep -q 'DOCUMENTER_BRIEFING_TIP_OK' <<<"$out"; then
  pass "direct mode: a tip that changes only the day's briefing file is OK"
else
  fail "direct mode: expected DOCUMENTER_BRIEFING_TIP_OK exit 0, got rc=$rc: $out"
fi

# ── 2b. direct mode: the day's briefing plus its own same-date .json
#       sidecar is also OK ──────────────────────────────────────────────
mk_repo direct-ok-sidecar
write_commit "$repo" "$DOC_BRANCH" docs/briefings/2099-01-02.md docs/briefings/2099-01-02.json
tip="$(g "$repo" rev-parse HEAD)"
g "$repo" checkout -q main
out="$(cd "$repo" && bash "$GUARD" --tip "$tip" --branch "$DOC_BRANCH")"; rc=$?
if [[ $rc -eq 0 ]] && grep -q 'DOCUMENTER_BRIEFING_TIP_OK' <<<"$out"; then
  pass "direct mode: the day's briefing plus its own same-date .json sidecar is OK"
else
  fail "direct mode: expected DOCUMENTER_BRIEFING_TIP_OK for the briefing+sidecar pair, got rc=$rc: $out"
fi

# ── 3. direct mode: a tip that also changes .sent.json is refused, naming
#      it ───────────────────────────────────────────────────────────────
mk_repo direct-refused-sent-json
write_commit "$repo" "$DOC_BRANCH" docs/briefings/2099-01-03.md docs/briefings/.sent.json
tip="$(g "$repo" rev-parse HEAD)"
g "$repo" checkout -q main
out="$(cd "$repo" && bash "$GUARD" --tip "$tip" --branch "$DOC_BRANCH" 2>&1)"; rc=$?
if [[ $rc -eq 1 ]] && grep -q 'DOCUMENTER_BRIEFING_TIP_REFUSED' <<<"$out" && grep -q 'docs/briefings/.sent.json' <<<"$out"; then
  pass "direct mode: a tip touching docs/briefings/.sent.json is refused, naming it"
else
  fail "direct mode: expected refusal naming docs/briefings/.sent.json, got rc=$rc: $out"
fi

# ── 4. direct mode: a tip that also changes an unrelated doc is refused,
#      naming it ─────────────────────────────────────────────────────────
mk_repo direct-refused-other-doc
write_commit "$repo" "$DOC_BRANCH" docs/briefings/2099-01-04.md docs/index.md
tip="$(g "$repo" rev-parse HEAD)"
g "$repo" checkout -q main
out="$(cd "$repo" && bash "$GUARD" --tip "$tip" --branch "$DOC_BRANCH" 2>&1)"; rc=$?
if [[ $rc -eq 1 ]] && grep -q 'docs/index.md' <<<"$out"; then
  pass "direct mode: a tip touching docs/index.md is refused, naming it"
else
  fail "direct mode: expected refusal naming docs/index.md, got rc=$rc: $out"
fi

# ── 5. direct mode: a tip that also changes a code path is refused,
#      naming it ─────────────────────────────────────────────────────────
mk_repo direct-refused-code
write_commit "$repo" "$DOC_BRANCH" docs/briefings/2099-01-05.md extension/src/extension.ts
tip="$(g "$repo" rev-parse HEAD)"
g "$repo" checkout -q main
out="$(cd "$repo" && bash "$GUARD" --tip "$tip" --branch "$DOC_BRANCH" 2>&1)"; rc=$?
if [[ $rc -eq 1 ]] && grep -q 'extension/src/extension.ts' <<<"$out"; then
  pass "direct mode: a tip touching extension/src/extension.ts is refused, naming it"
else
  fail "direct mode: expected refusal naming extension/src/extension.ts, got rc=$rc: $out"
fi

# ── 6. direct mode: a commit not on the documenter branch is refused,
#      saying so ─────────────────────────────────────────────────────────
mk_repo direct-not-on-branch
write_commit "$repo" main docs/briefings/2099-01-06.md
tip="$(g "$repo" rev-parse HEAD)"
out="$(cd "$repo" && bash "$GUARD" --tip "$tip" --branch "$DOC_BRANCH" 2>&1)"; rc=$?
if [[ $rc -eq 1 ]] && grep -q 'DOCUMENTER_BRIEFING_TIP_REFUSED' <<<"$out" && grep -qi "not on $DOC_BRANCH" <<<"$out"; then
  pass "direct mode: a commit not on the documenter branch is refused, saying so"
else
  fail "direct mode: expected the not-on-branch refusal, got rc=$rc: $out"
fi

# ── 7. direct mode: a day the landed main already carries is refused,
#      naming that day, even with a DIFFERENT byte content ─────────────
mk_repo direct-already-landed
write_commit "$repo" main docs/briefings/2099-01-07.md
write_commit "$repo" "$DOC_BRANCH" docs/index.md  # advance the branch off main's tip harmlessly
g "$repo" checkout -q "$DOC_BRANCH"
mkdir -p "$repo/docs/briefings"
echo "a different version" > "$repo/docs/briefings/2099-01-07.md"
g "$repo" add docs/briefings/2099-01-07.md
g "$repo" commit -q -m "re-send 2099-01-07 with different content"
tip="$(g "$repo" rev-parse HEAD)"
g "$repo" checkout -q main
out="$(cd "$repo" && bash "$GUARD" --tip "$tip" --branch "$DOC_BRANCH" 2>&1)"; rc=$?
if [[ $rc -eq 1 ]] && grep -q '2099-01-07' <<<"$out" && grep -qi 'already on main' <<<"$out"; then
  pass "direct mode: a day the landed main already carries is refused, even with different content"
else
  fail "direct mode: expected the already-landed-day refusal, got rc=$rc: $out"
fi

# ── 7b. direct mode: a tip naming TWO distinct briefing dates resolves no
#       lane at all, so BOTH briefing files are refused as offending paths
#       (find_briefing_date's own documented fail-closed rule: a tip
#       naming zero or more than one distinct date never guesses a lane -
#       every changed path, including both dates' own briefing files, is
#       then judged outside it). Neither date is separately "already
#       landed" here; this is the ambiguous-date branch, not the
#       already-landed-day branch case 7 above covers. ─────────────────
mk_repo direct-refused-two-dates
write_commit "$repo" "$DOC_BRANCH" docs/briefings/2099-01-09.md docs/briefings/2099-01-10.md
tip="$(g "$repo" rev-parse HEAD)"
g "$repo" checkout -q main
out="$(cd "$repo" && bash "$GUARD" --tip "$tip" --branch "$DOC_BRANCH" 2>&1)"; rc=$?
if [[ $rc -eq 1 ]] && grep -q 'DOCUMENTER_BRIEFING_TIP_REFUSED' <<<"$out" \
   && grep -q 'docs/briefings/2099-01-09.md' <<<"$out" \
   && grep -q 'docs/briefings/2099-01-10.md' <<<"$out"; then
  pass "direct mode: a tip naming two distinct briefing dates is refused, naming both dates' files"
else
  fail "direct mode: expected refusal naming both 2099-01-09.md and 2099-01-10.md, got rc=$rc: $out"
fi

# ── 8. hook mode: an in-lane tip is never refused ───────────────────────
mk_repo hook-ok
write_commit "$repo" "$DOC_BRANCH" docs/briefings/2099-01-08.md
g "$repo" checkout -q -b landing main
gq "$repo" merge -q --no-ff --no-commit "$DOC_BRANCH"
out="$(cd "$repo" && bash "$GUARD" --branch "$DOC_BRANCH" 2>&1)"; rc=$?
gq "$repo" merge --abort
if [[ $rc -eq 0 ]]; then
  pass "hook mode: an in-lane tip is not refused"
else
  fail "hook mode: expected exit 0 for an in-lane tip, got rc=$rc: $out"
fi

# ── 9. hook mode: an out-of-lane tip is refused, naming the path ───────
mk_repo hook-refused
write_commit "$repo" "$DOC_BRANCH" docs/briefings/2099-01-09.md extension/src/thing.ts
g "$repo" checkout -q -b landing main
gq "$repo" merge -q --no-ff --no-commit "$DOC_BRANCH"
out="$(cd "$repo" && bash "$GUARD" --branch "$DOC_BRANCH" 2>&1)"; rc=$?
gq "$repo" merge --abort
if [[ $rc -eq 1 ]] && grep -q 'extension/src/thing.ts' <<<"$out"; then
  pass "hook mode: an out-of-lane tip is refused, naming the path"
else
  fail "hook mode: expected refusal naming the path, got rc=$rc: $out"
fi

# ── 10. hook mode: a day the landed main already carries is refused ────
mk_repo hook-already-landed
write_commit "$repo" main docs/briefings/2099-01-10.md
write_commit "$repo" "$DOC_BRANCH" docs/index.md
g "$repo" checkout -q "$DOC_BRANCH"
mkdir -p "$repo/docs/briefings"
echo "a different version" > "$repo/docs/briefings/2099-01-10.md"
g "$repo" add docs/briefings/2099-01-10.md
g "$repo" commit -q -m "re-send 2099-01-10"
g "$repo" checkout -q -b landing main
gq "$repo" merge -q --no-ff --no-commit "$DOC_BRANCH"
out="$(cd "$repo" && bash "$GUARD" --branch "$DOC_BRANCH" 2>&1)"; rc=$?
gq "$repo" merge --abort
if [[ $rc -eq 1 ]] && grep -q '2099-01-10' <<<"$out" && grep -qi 'already' <<<"$out"; then
  pass "hook mode: a day the landed main already carries is refused"
else
  fail "hook mode: expected the already-landed-day refusal, got rc=$rc: $out"
fi

# ── 11. hook mode: a merge whose incoming parent is not reachable from
#       the documenter branch exits 0 without judging ──────────────────
mk_repo hook-not-documenter
write_commit "$repo" main extension/src/other.ts
g "$repo" branch other-role main
write_commit "$repo" other-role extension/src/thing.ts
g "$repo" checkout -q -b landing main
gq "$repo" merge -q --no-ff --no-commit other-role
out="$(cd "$repo" && bash "$GUARD" --branch "$DOC_BRANCH" 2>&1)"; rc=$?
gq "$repo" merge --abort
if [[ $rc -eq 0 ]]; then
  pass "hook mode: a merge not from the documenter branch exits 0 without judging"
else
  fail "hook mode: expected exit 0 for a non-documenter merge, got rc=$rc: $out"
fi

# ── 12. hook mode: a merge of main's own tip is never judged, even after
#       the documenter merged main ──────────────────────────────────────
mk_repo hook-main-sync
early_main="$(g "$repo" rev-parse main)"
write_commit "$repo" main extension/src/main_change.ts
g "$repo" checkout -q "$DOC_BRANCH"
g "$repo" merge -q --no-ff -m "documenter merges main" main
g "$repo" checkout -q -b role-branch "$early_main"
gq "$repo" merge -q --no-ff --no-commit main
out="$(cd "$repo" && bash "$GUARD" --branch "$DOC_BRANCH" 2>&1)"; rc=$?
gq "$repo" merge --abort
if [[ $rc -eq 0 ]]; then
  pass "hook mode: a merge of main's own tip is never judged"
else
  fail "hook mode: expected exit 0 for main's own tip, got rc=$rc: $out"
fi

# ── 13. hook mode: content carried from the landed main is exempt by
#       provenance ────────────────────────────────────────────────────
mk_repo hook-provenance
early_main="$(g "$repo" rev-parse main)"
write_commit "$repo" main extension/src/main_change.ts
g "$repo" checkout -q "$DOC_BRANCH"
g "$repo" merge -q --no-ff -m "documenter merges main" main
write_commit "$repo" "$DOC_BRANCH" docs/briefings/2099-01-13.md
tip="$(g "$repo" rev-parse HEAD)"
g "$repo" checkout -q -b landing "$early_main"
gq "$repo" merge -q --no-ff --no-commit "$tip"
out="$(cd "$repo" && bash "$GUARD" --branch "$DOC_BRANCH" 2>&1)"; rc=$?
gq "$repo" merge --abort
if [[ $rc -eq 0 ]]; then
  pass "hook mode: content carried from the landed main is exempt by provenance"
else
  fail "hook mode: expected exit 0 (provenance exemption), got rc=$rc: $out"
fi

# ── 13b (BL-1459 an-upstream-commit-behind-a-second-parent-is-not-judged-06,
#        specifier ruling 2026-09-20): a commit the documenter branch
#        carries only behind a SECOND parent of an ordinary chain merge
#        (cleaner -> architect -> hardener -> documenter, exactly BL-1459's
#        own live incident) is reachable from the documenter branch but is
#        NOT on its first-parent line - merging it directly elsewhere must
#        never be judged ─────────────────────────────────────────────────
mk_repo chain-second-parent
g "$repo" branch cleaner_branch main
write_commit "$repo" cleaner_branch extension/src/cleaner_change.ts
cleaner_tip="$(g "$repo" rev-parse cleaner_branch)"
g "$repo" checkout -q -b architect_branch main
g "$repo" merge -q --no-ff -m "Merge cleaner into architect" cleaner_branch
g "$repo" checkout -q -b hardener_branch main
g "$repo" merge -q --no-ff -m "Merge architect into hardener" architect_branch
g "$repo" checkout -q "$DOC_BRANCH"
g "$repo" merge -q --no-ff -m "Merge hardener into documenter" hardener_branch
g "$repo" checkout -q -b landing main
gq "$repo" merge -q --no-ff --no-commit "$cleaner_tip"
out="$(cd "$repo" && bash "$GUARD" --branch "$DOC_BRANCH" 2>&1)"; rc=$?
gq "$repo" merge --abort
if [[ $rc -eq 0 ]]; then
  pass "hook mode (06): a commit the documenter branch reached only through a merge's second parent is not judged"
else
  fail "hook mode (06): expected exit 0 (not first-parent, not judged), got rc=$rc: $out"
fi

# ── 13c (BL-1459 a-documenter-commit-behind-the-tip-is-still-judged-07):
#        a documenter commit still on the first-parent line, but no longer
#        the branch tip, is still judged (proves first-parent membership
#        is not exact-tip equality either) ───────────────────────────────
mk_repo old-tip-still-judged
write_commit "$repo" "$DOC_BRANCH" docs/briefings/2099-02-01.md extension/src/out-of-lane.ts
older_tip="$(g "$repo" rev-parse HEAD)"
write_commit "$repo" "$DOC_BRANCH" docs/briefings/2099-02-02.md
g "$repo" checkout -q -b landing main
gq "$repo" merge -q --no-ff --no-commit "$older_tip"
out="$(cd "$repo" && bash "$GUARD" --branch "$DOC_BRANCH" 2>&1)"; rc=$?
gq "$repo" merge --abort
if [[ $rc -eq 1 ]] && grep -q 'extension/src/out-of-lane.ts' <<<"$out"; then
  pass "hook mode (07): a documenter commit behind the tip is still judged"
else
  fail "hook mode (07): expected refusal naming extension/src/out-of-lane.ts even though older_tip is not the current tip, got rc=$rc: $out"
fi

# ── 13d (BL-1459 an-ordinary-forward-is-not-a-briefing-land-08, CRITICAL
#        fix, specifier ruling 2026-09-20): a documenter commit on the
#        first-parent line, not yet landed, that touches NO path under
#        docs/briefings/ at all is an ordinary parcel forward (this is
#        what QA's own merges of the documenter's real work look like) -
#        never judged, however many other paths it changes ───────────────
mk_repo ordinary-forward-not-a-briefing
write_commit "$repo" "$DOC_BRANCH" extension/src/some_feature.ts docs/how-to/some-guide.md
ordinary_tip="$(g "$repo" rev-parse HEAD)"
g "$repo" checkout -q -b landing main
gq "$repo" merge -q --no-ff --no-commit "$ordinary_tip"
out="$(cd "$repo" && bash "$GUARD" --branch "$DOC_BRANCH" 2>&1)"; rc=$?
gq "$repo" merge --abort
if [[ $rc -eq 0 ]]; then
  pass "hook mode (08): an ordinary documenter forward that changes no briefing file is merged without judgment"
else
  fail "hook mode (08): expected exit 0 (no docs/briefings/ content, not judged), got rc=$rc: $out"
fi

# ── 13e (BL-1459 09): an email-sweep commit touching ONLY
#        docs/briefings/.sent.json (no .md file at all) still trips the
#        content trigger (its own path starts with docs/briefings/) - the
#        header's own words are "docs/briefings/.sent.json ... never the
#        landing lane": find_briefing_date resolves no date from a commit
#        with zero .md paths, so judge_tip_paths refuses it by name,
#        exactly as a .sent.json path riding alongside a real briefing
#        already does in direct mode (case 3 above) - this proves the SAME
#        refusal holds for a .sent.json-only commit reached through the
#        hook's own content-trigger gate, never silently passed through
#        because the trigger's own path-prefix match is broad enough to
#        include it but the lane it unlocks is empty ────────────────────
mk_repo sent-json-only-commit
write_commit "$repo" "$DOC_BRANCH" docs/briefings/.sent.json
sent_only_tip="$(g "$repo" rev-parse HEAD)"
g "$repo" checkout -q -b landing main
gq "$repo" merge -q --no-ff --no-commit "$sent_only_tip"
out="$(cd "$repo" && bash "$GUARD" --branch "$DOC_BRANCH" 2>&1)"; rc=$?
gq "$repo" merge --abort
if [[ $rc -eq 1 ]] && grep -q 'docs/briefings/.sent.json' <<<"$out"; then
  pass "hook mode (09): an email-sweep commit touching only .sent.json trips the content trigger and is refused by name"
else
  fail "hook mode (09): expected refusal naming docs/briefings/.sent.json, got rc=$rc: $out"
fi

# ── 13f (BL-1666): the first-parent-membership check's producer
#        (`git rev-list --first-parent`) writes an output far larger than
#        a pipe's buffer (~64 KiB), with INCOMING - the branch tip, so the
#        newest/first line rev-list prints - matching immediately. Before
#        the fix, `grep -qx` piped straight from the producer would exit
#        the instant it read line 1, SIGPIPE-killing rev-list while 2000
#        more lines remained unwritten; `if !` then read the pipeline's
#        141 exit as "not on the line" and exited 0 WITHOUT JUDGING - a
#        real briefing land would pass unjudged. The commit ALSO carries
#        an out-of-lane path, so a silent skip (exit 0) and a real,
#        correct judgment (exit 1, naming the path) are distinguishable -
#        exit 0 here would mean the bug survived. ────────────────────────
mk_repo hook-large-first-parent-list
tree="$(g "$repo" write-tree)"
parent="$(g "$repo" rev-parse "$DOC_BRANCH")"
for _ in $(seq 1 2000); do
  parent="$(g "$repo" commit-tree "$tree" -p "$parent" -m "padding ancestor")"
done
g "$repo" update-ref "refs/heads/$DOC_BRANCH" "$parent"
write_commit "$repo" "$DOC_BRANCH" docs/briefings/2099-03-01.md extension/src/large-list-out-of-lane.ts
large_list_tip="$(g "$repo" rev-parse HEAD)"
line_count="$(g "$repo" rev-list --first-parent "main..$DOC_BRANCH" | wc -l)"
g "$repo" checkout -q -b landing main
gq "$repo" merge -q --no-ff --no-commit "$large_list_tip"
out="$(cd "$repo" && bash "$GUARD" --branch "$DOC_BRANCH" 2>&1)"; rc=$?
gq "$repo" merge --abort
if (( line_count * 41 < 65536 )); then
  fail "13f: fixture's first-parent list ($line_count lines) does not exceed a 64 KiB pipe buffer - strengthen the fixture"
elif [[ $rc -eq 1 ]] && grep -q 'extension/src/large-list-out-of-lane.ts' <<<"$out"; then
  pass "hook mode (13f): a first-parent list far larger than the pipe buffer is still judged correctly, naming the out-of-lane path"
else
  fail "hook mode (13f): expected refusal naming extension/src/large-list-out-of-lane.ts despite a $line_count-line first-parent list, got rc=$rc: $out"
fi

# ── 13g (BL-1666): the content-trigger check's producer (`git diff
#        --name-only`) also writes an output far larger than the pipe
#        buffer, with a docs/briefings/ path sorting first among many
#        filler paths. Before the fix, the same SIGPIPE/141 shape would
#        read as "no briefing path in this commit" and skip the whole
#        lane check - the filler paths themselves are out-of-lane, so a
#        silent skip (exit 0) and real judgment (exit 1, naming a filler
#        path) are distinguishable. ─────────────────────────────────────
mk_repo hook-large-diff-list
g "$repo" checkout -q "$DOC_BRANCH"
mkdir -p "$repo/docs/briefings" "$repo/zzz-filler"
echo "content" > "$repo/docs/briefings/2099-03-02.md"
g "$repo" add docs/briefings/2099-03-02.md
padded_name_prefix="$(printf 'a%.0s' $(seq 1 200))"
for i in $(seq 1 400); do
  fname="$repo/zzz-filler/${padded_name_prefix}${i}.txt"
  echo "content" > "$fname"
  g "$repo" add "zzz-filler/${padded_name_prefix}${i}.txt"
done
g "$repo" commit -q -m "large diff: briefing plus 400 filler paths"
large_diff_tip="$(g "$repo" rev-parse HEAD)"
diff_byte_count="$(g "$repo" diff --name-only main "$large_diff_tip" | wc -c)"
g "$repo" checkout -q -b landing2 main
gq "$repo" merge -q --no-ff --no-commit "$large_diff_tip"
out="$(cd "$repo" && bash "$GUARD" --branch "$DOC_BRANCH" 2>&1)"; rc=$?
gq "$repo" merge --abort
if (( diff_byte_count < 65536 )); then
  fail "13g: fixture's diff --name-only output ($diff_byte_count bytes) does not exceed a 64 KiB pipe buffer - strengthen the fixture"
elif [[ $rc -eq 1 ]] && grep -q "zzz-filler/${padded_name_prefix}1.txt" <<<"$out"; then
  pass "hook mode (13g): a diff --name-only output far larger than the pipe buffer still trips the content trigger and is judged, naming a filler path"
else
  fail "hook mode (13g): expected refusal naming a zzz-filler path despite a $diff_byte_count-byte diff, got rc=$rc: $out"
fi

# ── 13h (BL-1666 amendment): an out-of-lane path whose content the landed
#        main already carries, through a commit built OFF main (never an
#        ancestor of the documenter's own commit - the hand-built
#        tip-pure land-step replay shape, condition (g)), is exempt by
#        CONTENT, not ancestry ────────────────────────────────────────────
mk_repo direct-content-exempt
write_commit "$repo" main docs/index.md   # main's own commit, unrelated to the documenter branch
g "$repo" checkout -q "$DOC_BRANCH"
mkdir -p "$repo/docs/briefings"
echo "today's briefing" > "$repo/docs/briefings/2099-03-03.md"
g "$repo" add docs/briefings/2099-03-03.md
echo "content" > "$repo/docs/index.md"   # byte-identical to main's own write_commit content
g "$repo" add docs/index.md
g "$repo" commit -q -m "briefing plus docs/index.md at main's own content"
tip="$(g "$repo" rev-parse HEAD)"
g "$repo" checkout -q main
out="$(cd "$repo" && bash "$GUARD" --tip "$tip" --branch "$DOC_BRANCH" 2>&1)"; rc=$?
if [[ $rc -eq 0 ]] && grep -q 'DOCUMENTER_BRIEFING_TIP_OK' <<<"$out"; then
  pass "direct mode (13h): an out-of-lane path whose content the landed main already carries is exempt whatever its commit ancestry"
else
  fail "direct mode (13h): expected DOCUMENTER_BRIEFING_TIP_OK (content-equality exemption), got rc=$rc: $out"
fi

# ── 13i (BL-1666 amendment): an out-of-lane path whose content DIFFERS
#        from the landed main is refused, even though an OLDER version of
#        it was once landed (content equality, not "was ever landed") ───
mk_repo direct-content-differs
write_commit "$repo" main docs/index.md   # main's own commit, content "content"
g "$repo" checkout -q "$DOC_BRANCH"
mkdir -p "$repo/docs/briefings"
echo "today's briefing" > "$repo/docs/briefings/2099-03-04.md"
g "$repo" add docs/briefings/2099-03-04.md
echo "a completely different docs/index.md" > "$repo/docs/index.md"
g "$repo" add docs/index.md
g "$repo" commit -q -m "briefing plus a docs/index.md that differs from main's"
tip="$(g "$repo" rev-parse HEAD)"
g "$repo" checkout -q main
out="$(cd "$repo" && bash "$GUARD" --tip "$tip" --branch "$DOC_BRANCH" 2>&1)"; rc=$?
if [[ $rc -eq 1 ]] && grep -q 'docs/index.md' <<<"$out"; then
  pass "direct mode (13i): an out-of-lane path whose content differs from the landed main is refused even when an older version was landed"
else
  fail "direct mode (13i): expected refusal naming docs/index.md (content differs from main), got rc=$rc: $out"
fi

# ── 13j (BL-1666 hardening): an out-of-lane path DELETED at the tip, and
#        also absent on the landed main, has NO BLOB on EITHER side - the
#        content-equality exemption's two `-n` guards both matter here:
#        without them "" == "" reads as a content match and wrongly
#        exempts a deletion that carries no provenance at all. Both
#        branches independently remove the same shared path so tip_blob
#        AND main_blob are genuinely empty, not merely equal-and-present.
mk_repo direct-content-deleted-both-sides
write_commit "$repo" main docs/scratch.md
g "$repo" checkout -q "$DOC_BRANCH"
g "$repo" merge -q --ff-only main
mkdir -p "$repo/docs/briefings"
echo "today's briefing" > "$repo/docs/briefings/2099-03-05.md"
g "$repo" add docs/briefings/2099-03-05.md
g "$repo" rm -q docs/scratch.md
g "$repo" commit -q -m "briefing plus deleting docs/scratch.md"
tip="$(g "$repo" rev-parse HEAD)"
g "$repo" checkout -q main
g "$repo" rm -q docs/scratch.md
g "$repo" commit -q -m "main also removes docs/scratch.md"
out="$(cd "$repo" && bash "$GUARD" --tip "$tip" --branch "$DOC_BRANCH" 2>&1)"; rc=$?
if [[ $rc -eq 1 ]] && grep -q 'docs/scratch.md' <<<"$out"; then
  pass "direct mode (13j): a path deleted at the tip with no blob on either side is refused, never exempted by empty-string equality"
else
  fail "direct mode (13j): expected refusal naming docs/scratch.md (no blob on either side), got rc=$rc: $out"
fi

# ── 14. --branch resolves via .swarmforge/roles.tsv when not given
#        explicitly ───────────────────────────────────────────────────
mk_repo roles-tsv-resolution
mkdir -p "$repo/.swarmforge"
printf 'documenter\tdocumenter\t%s\t%s\tDocumenter\tclaude\ttask\n' "$repo" "$DOC_BRANCH" > "$repo/.swarmforge/roles.tsv"
write_commit "$repo" "$DOC_BRANCH" docs/briefings/2099-01-14.md
tip="$(g "$repo" rev-parse HEAD)"
g "$repo" checkout -q main
out="$(cd "$repo" && bash "$GUARD" --tip "$tip")"; rc=$?
if [[ $rc -eq 0 ]] && grep -q 'DOCUMENTER_BRIEFING_TIP_OK' <<<"$out"; then
  pass "the documenter branch resolves from .swarmforge/roles.tsv when --branch is not given"
else
  fail "expected roles.tsv resolution to find the documenter branch, got rc=$rc: $out"
fi

# ── 15. wiring: joins pre-merge-commit's chain, never
#        run_commit_guards.sh's (out of scope, BL-1459/BL-1444) ─────────
if grep -q 'run_guard check_documenter_briefing_tip\.sh' "$REPO_ROOT/swarmforge/git-hooks/pre-merge-commit"; then
  pass "check_documenter_briefing_tip.sh is wired into pre-merge-commit's chain"
else
  fail "check_documenter_briefing_tip.sh is not wired into pre-merge-commit's chain"
fi
if grep -q 'check_documenter_briefing_tip' "$REPO_ROOT/swarmforge/scripts/run_commit_guards.sh"; then
  fail "check_documenter_briefing_tip.sh must not join run_commit_guards.sh's pre-commit chain (out of scope)"
else
  pass "check_documenter_briefing_tip.sh does not join run_commit_guards.sh's pre-commit chain"
fi

if (( status == 0 )); then echo "ALL PASS"; else echo "FAILURES"; fi
exit $status
