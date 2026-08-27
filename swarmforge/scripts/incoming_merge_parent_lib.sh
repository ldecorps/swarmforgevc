#!/usr/bin/env bash
# Incoming merge parent — shared by check_pipeline_code_on_main.sh (BL-925/1096)
# and check_property_suite_drift.sh (BL-1121).
#
# Contract: prefer .git/MERGE_HEAD; else a lone GITHEAD_<sha> env that git's
# merge machinery sets for external merge drivers. Empty / multi-GITHEAD
# fails closed (returns 1).

resolve_incoming_merge_parent() {
  local merge_head_sha githead_count githead_candidate env_name
  merge_head_sha="$(git rev-parse -q --verify MERGE_HEAD 2>/dev/null || true)"
  if [[ -n "$merge_head_sha" ]]; then
    printf '%s\n' "$merge_head_sha"
    return 0
  fi
  githead_count=0
  githead_candidate=""
  while IFS='=' read -r env_name _; do
    case "$env_name" in
      GITHEAD_????????????????????????????????????????)
        githead_candidate="${env_name#GITHEAD_}"
        githead_count=$((githead_count + 1))
        ;;
    esac
  done < <(env)
  if [[ "$githead_count" -eq 1 ]]; then
    printf '%s\n' "$githead_candidate"
    return 0
  fi
  return 1
}
