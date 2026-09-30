#!/usr/bin/env bash
# BL-1665: refuses a commit that stages a shell test under
# swarmforge/scripts/test/ which sets pipefail and pipes a captured,
# possibly multi-line output into `grep` with a `-q` anywhere in its flag
# cluster. Under `set -o pipefail`, bash writes a multi-line string to a
# pipe line by line, and `grep -q` exits as soon as it finds its match -
# if the producer is still writing, it dies of SIGPIPE, the pipeline
# reports 141, and `|| fail` fires on a present needle. It fails only
# under load, so it reads as a flake (test_merge_deletion_guard.sh case 02
# on 2026-09-20, BL-1660's library instance). This guard keeps the class
# fixed once swept: no new instance can be staged.
#
# Judges only the STAGED content of touched swarmforge/scripts/test/*.sh
# files (`git show :<path>` - never the working tree, same posture as
# check_constitution_doc_citations.sh) that set pipefail; a file without
# pipefail is not judged (BL-1665 scenario 03). test_merge_deletion_guard.sh
# is explicitly excluded - its one remaining instance
# (`git ls-tree ... | grep -q keep17.txt`, a single-line producer, not the
# multi-line race this guard targets) is BL-1664's to fix, not this
# guard's to refuse (BL-1665's FIRM constraint).
#
# Detector: a pipe feeding grep with a -q anywhere in its flag cluster -
# `\|\s*grep\s+-[A-Za-z]*q` (the ticket's own stated detector). Production
# scripts outside swarmforge/scripts/test are BL-1660's census, not this
# guard's (constraints:).
#
# Usage: check_shell_test_early_exit_pipe.sh [commit-message-file]
#   Runs from the pre-commit chain (run_commit_guards.sh). The message-file
#   argument is accepted for interface parity with the other guards but
#   unused - the decision never depends on commit message text.
# Usage: check_shell_test_early_exit_pipe.sh --scan-tree
#   Scans the WORKING TREE (not the index) for every
#   swarmforge/scripts/test/*.sh file - a standalone census tool (the QA
#   e2e procedure, BL-1665 scenario 04's own check) - never called from
#   the hook chain.

set -uo pipefail

EXCLUDE_BASENAME="test_merge_deletion_guard.sh"
PIPE_RE='\|[ \t]*grep[ \t]+-[A-Za-z]*q'

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
if [[ -z "$REPO_ROOT" ]]; then
  echo "check_shell_test_early_exit_pipe: WARNING - could not resolve the repo root; skipping." >&2
  exit 0
fi
cd "$REPO_ROOT" || { echo "check_shell_test_early_exit_pipe: WARNING - could not cd to $REPO_ROOT; skipping." >&2; exit 0; }

find_violations() {
  # $1 = display name, $2 = path to a file holding the content to judge.
  local display="$1" content_file="$2"
  grep -q 'pipefail' "$content_file" || return 0
  while IFS=: read -r lineno rest; do
    [[ -n "$lineno" ]] || continue
    printf '%s:%s: %s\n' "$display" "$lineno" "$rest"
  done < <(grep -nE "$PIPE_RE" "$content_file")
}

if [[ "${1:-}" == "--scan-tree" ]]; then
  TEST_DIR="$REPO_ROOT/swarmforge/scripts/test"
  FILES=()
  while IFS= read -r f; do
    FILES+=("$f")
  done < <(cd "$TEST_DIR" && find . -maxdepth 1 -type f -name '*.sh' -print | sed 's#^\./##' | sort)

  VIOLATIONS=""
  SCANNED=0
  for base in ${FILES[@]+"${FILES[@]}"}; do
    SCANNED=$((SCANNED + 1))
    [[ "$base" == "$EXCLUDE_BASENAME" ]] && continue
    found="$(find_violations "swarmforge/scripts/test/$base" "$TEST_DIR/$base")"
    [[ -n "$found" ]] && VIOLATIONS="${VIOLATIONS}${VIOLATIONS:+$'\n'}${found}"
  done

  echo "check_shell_test_early_exit_pipe: scanned $SCANNED file(s) under swarmforge/scripts/test."
  if [[ -n "$VIOLATIONS" ]]; then
    printf '%s\n' "$VIOLATIONS"
    exit 1
  fi
  exit 0
fi

TOUCHED=()
while IFS= read -r f; do
  TOUCHED+=("$f")
done < <(git diff --cached --name-only --diff-filter=ACMR -- 'swarmforge/scripts/test/*.sh' 2>/dev/null)

if (( ${#TOUCHED[@]} == 0 )); then
  exit 0
fi

TMP_CONTENT="$(mktemp)"
trap 'rm -f "$TMP_CONTENT"' EXIT

VIOLATIONS=""
for path in ${TOUCHED[@]+"${TOUCHED[@]}"}; do
  base="$(basename "$path")"
  [[ "$base" == "$EXCLUDE_BASENAME" ]] && continue
  git show ":$path" > "$TMP_CONTENT" 2>/dev/null || continue
  found="$(find_violations "$path" "$TMP_CONTENT")"
  [[ -n "$found" ]] && VIOLATIONS="${VIOLATIONS}${VIOLATIONS:+$'\n'}${found}"
done

if [[ -n "$VIOLATIONS" ]]; then
  echo "check_shell_test_early_exit_pipe: COMMIT REFUSED. A staged shell test under swarmforge/scripts/test sets pipefail and pipes a captured output into an early-exit grep -q:" >&2
  printf '%s\n' "$VIOLATIONS" >&2
  echo "check_shell_test_early_exit_pipe: rewrite as 'grep <flags> <needle> >/dev/null' (or a bash pattern test on the captured output) - same needle, same flags, a consumer that reads to end of input." >&2
  exit 1
fi

exit 0
