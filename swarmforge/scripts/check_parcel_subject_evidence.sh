#!/usr/bin/env bash
# BL-711: refuse a commit whose subject uses the bare parcel prefix
# "BL-<n>:" while touching backlog/evidence/. Acceptance suites for
# prose-only tickets (BL-711 vocabulary-04, BL-715 modes-05, and peers)
# discover every commit whose subject starts with that bare prefix and
# assert an allowlisted file set — evidence commits that reuse the prefix
# are counted as parcel content and fail QA. Downstream roles must use
# scoped prefixes instead: evidence(BL-n):, docs(BL-n):, chore(BL-n):, etc.
#
# Usage: check_parcel_subject_evidence.sh <commit-message-file>
#   Reads staged paths via `git diff --cached` and the first line of the
#   commit message from the file git passes to commit-msg.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

MSG_FILE="${1:-}"
if [[ -z "$MSG_FILE" || ! -f "$MSG_FILE" ]]; then
  exit 0
fi

subject="$(head -n 1 "$MSG_FILE")"

# Bare parcel prefix only — "chore(BL-711):" and "docs(BL-711):" are fine.
if [[ ! "$subject" =~ ^BL-[0-9]+: ]]; then
  exit 0
fi

ticket_id="${subject%%:*}"

evidence_paths=()
while IFS=$'\t' read -r status path; do
  [[ -n "$status" && -n "$path" ]] || continue
  case "$path" in
    backlog/evidence/*)
      evidence_paths+=("$path")
      ;;
  esac
done < <(git diff --cached --name-status)

if ((${#evidence_paths[@]} == 0)); then
  exit 0
fi

echo "commit-msg guard (BL-711): refuse bare parcel subject \"${ticket_id}:\" on evidence commits." >&2
echo "  subject: ${subject}" >&2
echo "  evidence paths:" >&2
for p in "${evidence_paths[@]}"; do
  echo "    - ${p}" >&2
done
echo "  remedy: use a scoped prefix, e.g. evidence(${ticket_id}):, docs(${ticket_id}):, or chore(${ticket_id}): — never bare \"${ticket_id}:\" for backlog/evidence/." >&2
exit 1
