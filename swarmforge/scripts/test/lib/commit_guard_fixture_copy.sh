#!/usr/bin/env bash
# BL-1484: shared "derive the copy set, then copy it" step for the four
# hook-installing fixtures (test_ticket_deletion_guard.sh,
# test_commit_size_guard.sh, test_merge_deletion_guard.sh,
# test_retirement_readdition_guard.sh). Each called deriveCommitGuardFixtureSet
# via an identical `node -e` block and copy loop, differing only in the
# options object passed to the helper - ported into one function rather than
# four copies of the same node invocation and while-read loop.
#
# Usage:
#   source "$SCRIPT_DIR/lib/commit_guard_fixture_copy.sh"
#   derive_and_copy_chain_files "$HELPER" "$DERIVE_ROOT" "$ROOT" '{"hookRels":["swarmforge/git-hooks/pre-commit"]}'
#
# The options JSON is spread onto { repoRoot } before calling
# deriveCommitGuardFixtureSet, so any of its named options (hookRels,
# runnerRel, ...) can be passed through untouched.

derive_and_copy_chain_files() {
  local helper="$1" derive_root="$2" dest_root="$3" options_json="$4"
  local chain_files
  chain_files="$(node -e '
    const { deriveCommitGuardFixtureSet } = require(process.argv[1]);
    const opts = JSON.parse(process.argv[3]);
    const r = deriveCommitGuardFixtureSet({ repoRoot: process.argv[2], ...opts });
    process.stdout.write(r.files.join("\n"));
  ' "$helper" "$derive_root" "$options_json")"
  echo "derived copy set: $(echo "$chain_files" | tr '\n' ' ')"
  while IFS= read -r rel; do
    [ -n "$rel" ] || continue
    mkdir -p "$dest_root/$(dirname "$rel")"
    cp "$derive_root/$rel" "$dest_root/$rel"
  done <<< "$chain_files"
}
