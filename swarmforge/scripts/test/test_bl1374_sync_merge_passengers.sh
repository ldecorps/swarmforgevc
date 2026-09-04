#!/usr/bin/env bash
# BL-1374: a sync merge is not credited with its passengers.
#
# Drives the REAL land_step_lib.bb over real git fixtures, and - the check the
# ticket's own qa_e2e_procedure step 6 asks for - over the LIVE history that
# produced the report, so the regression is measured rather than argued.
#
# The shape that bites is not the one a first fixture reaches for. git's
# path-scoped history walk already elides a merge TREESAME to a parent on the
# path, so a sync merge that merely carried a passenger through is invisible.
# What it does not elide is the clean AUTO-MERGE: both sides changed the same
# file in different places, the result differs from both parents, the walk
# reports the merge, and its subject decides the owner of content its merger
# never wrote.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

PREFIX="bl1374-sync-merge"
# BL-971: a killed run traps nothing, so sweep the prefix before this one too.
rm -rf "${TMPDIR:-/tmp}/${PREFIX}".* 2>/dev/null || true
TMPROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"
trap 'rm -rf "$TMPROOT"' EXIT

fails=0
pass() { echo "  ok   $1"; }
fail() { echo "  FAIL $1"; fails=$((fails + 1)); }
contains() { if grep -qF -- "$3" <<<"$2"; then pass "$1"; else fail "$1 (missing '$3')"; fi; }
absent()   { if grep -qF -- "$3" <<<"$2"; then fail "$1 (unexpectedly found '$3')"; else pass "$1"; fi; }

git_q() { git -C "$1" "${@:2}"; }
# The fixture builders print their root on stdout, so every git command inside
# one must be silent: `git merge` says "Auto-merging <file>", and that line
# would become part of the path the caller then cd's to.
git_s() { git -C "$1" "${@:2}" >/dev/null 2>&1; }

# A branch carrying two OTHER tickets' edits to one file, and a sync merge
# named after the ticket being worked on that combines them.
mk_autofix() {
  local root; root="$(mktemp -d "$TMPROOT/fix.XXXXXX")"
  git_s "$root" init -q -b main .
  git_s "$root" config user.email t@t
  git_s "$root" config user.name t
  git_s "$root" config commit.gpgsign false
  printf 'a\nb\nc\nd\ne\nf\ng\nh\ni\nj\n' > "$root/shared.txt"
  git_s "$root" add -A; git_s "$root" commit -qm seed
  git_s "$root" update-ref refs/remotes/origin/main HEAD
  printf 'a\nb\nc\nd\ne\nf\ng\nh\ni\nj\nBL-9002 bounce history\n' > "$root/shared.txt"
  git_s "$root" add -A; git_s "$root" commit -qm "BL-9002: sibling appends its bounce history"
  git_q "$root" checkout -q -b tA "$(git_q "$root" rev-parse refs/remotes/origin/main)"
  printf 'BL-9003 header\nb\nc\nd\ne\nf\ng\nh\ni\nj\n' > "$root/shared.txt"
  git_s "$root" add -A; git_s "$root" commit -qm "BL-9003: a different sibling edits the top"
  printf 'own\n' > "$root/own.txt"
  git_s "$root" add -A; git_s "$root" commit -qm "BL-9001: own work"
  git_s "$root" merge --no-ff -q -m "BL-9001: sync main into the branch" main
  echo "$root"
}

# The same branch, except this ticket's OWN commit edits the shared file.
mk_entangled() {
  local root; root="$(mktemp -d "$TMPROOT/fix.XXXXXX")"
  git_s "$root" init -q -b main .
  git_s "$root" config user.email t@t
  git_s "$root" config user.name t
  git_s "$root" config commit.gpgsign false
  printf 'a\nb\nc\n' > "$root/shared.txt"
  git_s "$root" add -A; git_s "$root" commit -qm seed
  git_s "$root" update-ref refs/remotes/origin/main HEAD
  printf 'a\nb\nc\nBL-9002 line\n' > "$root/shared.txt"
  git_s "$root" add -A; git_s "$root" commit -qm "BL-9002: sibling appends"
  git_q "$root" checkout -q -b tA "$(git_q "$root" rev-parse refs/remotes/origin/main)"
  printf 'BL-9001 line\na\nb\nc\n' > "$root/shared.txt"
  git_s "$root" add -A; git_s "$root" commit -qm "BL-9001: own edit to the shared file"
  git_s "$root" merge --no-ff -q -m "BL-9001: sync main into the branch" main
  echo "$root"
}

ask() {
  # <root> <commit> <ticket> -> the own-paths answer, printed
  bb -e "
(require '[babashka.fs :as fs])
(load-file \"$REPO_ROOT/swarmforge/scripts/land_step_lib.bb\")
(let [root \"$1\" commit \"$2\" ticket \"$3\"
      {:keys [unlanded warning]} (land-step-lib/entangled-siblings root commit ticket)]
  (println \"UNLANDED\" (pr-str (sort (or unlanded #{}))))
  (println \"DETECT-WARNING\" (pr-str warning))
  (println \"OWN-PATHS\" (pr-str (land-step-lib/own-paths root commit ticket (or unlanded #{})))))"
}

# ═══════════════════════════════════════════════════════════════════════════
# 01 / 02 / 04: a sync merge's passengers are not the ticket's own paths
# ═══════════════════════════════════════════════════════════════════════════
echo "01/02/04: a clean auto-merge's passengers"
R="$(mk_autofix)"
COMMIT="$(git_q "$R" rev-parse HEAD)"

# The premise, measured rather than assumed: the walk DOES reach the merge for
# the shared path, and the merge wrote nothing anywhere.
WALK="$(git_q "$R" log --format='%s' refs/remotes/origin/main..HEAD -- shared.txt)"
contains "01 premise: the path-scoped walk reaches the sync merge" "$WALK" "BL-9001: sync main into the branch"
CCPATCH="$(git_q "$R" diff-tree --no-commit-id --cc -r "$COMMIT")"
if [[ -z "$CCPATCH" ]]; then pass "01 premise: and the merge authored no line anywhere"; else fail "01 premise: the merge authored content: $CCPATCH"; fi

OUT="$(ask "$R" "$COMMIT" BL-9001)"
absent "01: the passenger file is not this ticket's own path" "$(sed -n 's/^OWN-PATHS //p' <<<"$OUT")" "shared.txt"
contains "01: so the land is not refused" "$OUT" ":warning nil"
contains "02: and this ticket's own work still replays" "$OUT" "own.txt"
contains "04: the first passenger's ticket is still reported as unlanded" "$OUT" "BL-9002"
contains "04: and the second passenger's" "$OUT" "BL-9003"
contains "04: detection itself read cleanly" "$OUT" "DETECT-WARNING nil"

# ═══════════════════════════════════════════════════════════════════════════
# 03: a genuine entanglement is still refused
# ═══════════════════════════════════════════════════════════════════════════
echo "03: a genuine entanglement"
R2="$(mk_entangled)"
OUT2="$(ask "$R2" "$(git_q "$R2" rev-parse HEAD)" BL-9001)"
contains "03: the land is refused" "$OUT2" ":paths nil"
contains "03: as the shared-path refusal, not some other one" "$OUT2" "is shared with unlanded sibling(s)"
contains "03: naming the sibling" "$OUT2" "BL-9002"
contains "03: and naming the path" "$OUT2" "shared.txt"

# ═══════════════════════════════════════════════════════════════════════════
# 05: the live regression the ticket asks for (qa_e2e_procedure step 6)
# ═══════════════════════════════════════════════════════════════════════════
echo "05: the live tip that produced the report"
REPORTED_MERGE="5d4486eb08"
REPORTED_PATH="backlog/active/BL-1296-bubble-answers-from-its-own-seat.yaml"
if git -C "$REPO_ROOT" cat-file -e "${REPORTED_MERGE}^{commit}" 2>/dev/null; then
  LIVE="$(bb -e "
(require '[babashka.fs :as fs])
(load-file \"$REPO_ROOT/swarmforge/scripts/land_step_lib.bb\")
(let [root \"$REPO_ROOT\"
      om (land-step-lib/origin-main-sha root)]
  (println (pr-str (#'land-step-lib/path-owner-tickets root om \"522584ed85\" \"$REPORTED_PATH\"
                                                       #'land-step-lib/path-attributing-commits))))")"
  contains "05: the passenger's own ticket still owns its file" "$LIVE" "BL-1296"
  absent "05: and the landing ticket is no longer credited with it" "$LIVE" "BL-1309"
  absent "05: nor is the other passenger's ticket" "$LIVE" "BL-1328"
  # The premise: without the narrowing this really did credit all three.
  CC="$(git -C "$REPO_ROOT" diff-tree --no-commit-id --cc -r "$REPORTED_MERGE" -- "$REPORTED_PATH")"
  if [[ -z "$CC" ]]; then pass "05 premise: the reported merge wrote no line at that path"; else fail "05 premise: it did write there: $CC"; fi
  NAMES="$(git -C "$REPO_ROOT" diff-tree --no-commit-id --cc --name-only -r "$REPORTED_MERGE")"
  contains "05 premise: while its --cc NAME list does name the path - the trap" "$NAMES" "$REPORTED_PATH"
else
  echo "  skip 05: $REPORTED_MERGE is not reachable from this checkout"
fi

if [[ $fails -gt 0 ]]; then
  echo "test_bl1374_sync_merge_passengers: $fails FAILURE(S)"
  exit 1
fi
echo "test_bl1374_sync_merge_passengers: ALL PASS"
