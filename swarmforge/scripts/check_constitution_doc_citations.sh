#!/usr/bin/env bash
# BL-1440: refuses a commit that touches swarmforge/constitution/articles/**
# and leaves a dangling `docs/...` citation - the SAME question
# extension/test/constitutionDocCitations.test.js (BL-945) asks, asked here
# too so a dangling citation is caught at commit time, not merely reported
# by a suite run nobody re-triggers. Uses the SAME resolver
# (specs/pipeline/steps/lib/constitutionDocCitations.js's
# findUnresolvedCitations) the suite test calls - never a second
# implementation of what counts as a citation or a resolution (invariant
# 2): the two can never disagree about what is dangling.
#
# Skips cleanly (exit 0) when no staged path is under
# swarmforge/constitution/articles/ - the common case, and cheap (a git
# diff --cached name-only read, same cost class as this file's cheap-tier
# siblings).
#
# Checks the STAGED content of touched article files (via `git show
# :<path>`, written to a temp mirror of the articles dir - the reference/
# subdirectory included), never the working-tree file, which can differ
# from what is about to be committed. Cited docs/ paths are resolved
# against the real working tree (fs.existsSync, exactly as
# findUnresolvedCitations already does for every other caller) - a doc
# this SAME commit adds is present on disk by the time this guard runs,
# so a citation and its own new target landing together still resolves.
#
# Usage: check_constitution_doc_citations.sh [commit-message-file]
#   The message-file argument is accepted for interface parity with the
#   other pre-commit guards but unused.

set -uo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
if [[ -z "$REPO_ROOT" ]]; then
  echo "check_constitution_doc_citations: WARNING - could not resolve the repo root; skipping." >&2
  exit 0
fi
cd "$REPO_ROOT" || { echo "check_constitution_doc_citations: WARNING - could not cd to $REPO_ROOT; skipping." >&2; exit 0; }

ARTICLES_PREFIX="swarmforge/constitution/articles/"

mapfile -t TOUCHED < <(git diff --cached --name-only --diff-filter=ACMR -- "$ARTICLES_PREFIX" 2>/dev/null)
if (( ${#TOUCHED[@]} == 0 )); then
  exit 0
fi

RESOLVER="specs/pipeline/steps/lib/constitutionDocCitations.js"
if [[ ! -r "$RESOLVER" ]]; then
  echo "check_constitution_doc_citations: WARNING - resolver missing at $RESOLVER; skipping." >&2
  exit 0
fi

SNAPSHOT_DIR="$(mktemp -d)"
trap 'rm -rf "$SNAPSHOT_DIR"' EXIT

# Mirror the full staged articles corpus (not just the touched files) into
# the snapshot - a citation the resolver reports names its OWN file, and a
# file this commit does not touch but that still cites something dangling
# is not this guard's business to introduce, but leaving it out of the
# corpus would silently narrow what the resolver walks vs. what the suite
# test walks (invariant 2 - same corpus). List every staged path under the
# prefix, not only the diff-filtered touched set, so a deletion this commit
# makes is reflected too (a citation in a file this commit REMOVES must not
# be reported).
# `git ls-files --cached` already reflects the INDEX - a staged deletion is
# already absent from this listing, so no separate diff-filter pass is
# needed to exclude it.
mapfile -t ALL_STAGED_PATHS < <(git ls-files --cached -- "$ARTICLES_PREFIX" 2>/dev/null)

for path in "${ALL_STAGED_PATHS[@]}"; do
  rel="${path#"$ARTICLES_PREFIX"}"
  dest="$SNAPSHOT_DIR/$rel"
  mkdir -p "$(dirname "$dest")"
  if git show ":$path" > "$dest" 2>/dev/null; then
    :
  else
    rm -f "$dest"
  fi
done

NODE_OUT="$(node -e '
const path = require("path");
const { findUnresolvedCitations } = require(path.join(process.cwd(), process.argv[1]));
const unresolved = findUnresolvedCitations(process.argv[2], process.cwd());
if (unresolved.length > 0) {
  for (const u of unresolved) {
    console.log(`${u.file}\t${u.citation}`);
  }
  process.exit(1);
}
process.exit(0);
' "$RESOLVER" "$SNAPSHOT_DIR")"
NODE_STATUS=$?

if (( NODE_STATUS != 0 )); then
  echo "check_constitution_doc_citations: COMMIT REFUSED - a staged constitution article cites a docs/ path that does not resolve:" >&2
  # findUnresolvedCitations names its own `file` argument relative to the
  # repoRoot it was given - here that is $SNAPSHOT_DIR (a throwaway temp
  # tree, not this repo), so the reported name is junk unless translated
  # back to the real repo-relative path this guard already knows (it built
  # the snapshot from it): everything after the snapshot dir's own
  # basename, with the articles prefix restored.
  SNAPSHOT_BASENAME="$(basename "$SNAPSHOT_DIR")"
  while IFS=$'\t' read -r file citation; do
    [[ -n "$file" ]] || continue
    real_rel="${file#*"$SNAPSHOT_BASENAME"/}"
    echo "  - ${ARTICLES_PREFIX}${real_rel}: $citation" >&2
  done <<< "$NODE_OUT"
  exit 1
fi

exit 0
