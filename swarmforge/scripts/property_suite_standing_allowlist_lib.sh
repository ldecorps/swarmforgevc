#!/usr/bin/env bash
# BL-1175: explicit standing-red allowlist for the property-suite drift guard.
# Source from check_property_suite_drift.sh; unit-tested via shell + property tests.

set -euo pipefail

ps_allowlist_tsv_path() {
  local script_dir="${1:-}"
  if [[ -z "$script_dir" ]]; then
    echo "property_suite_standing_allowlist_lib.sh: script_dir required" >&2
    return 1
  fi
  echo "${script_dir}/property_suite_standing_allowlist.tsv"
}

# extension/test/foo.property.test.js -> test/foo.property.test.js
ps_allowlist_normalize_file() {
  local file="$1"
  file="${file#extension/}"
  file="${file#./}"
  printf '%s' "$file"
}

# True when file has disposition allowlist in the TSV.
ps_allowlist_file_is_allowlisted() {
  local tsv="$1"
  local file="$2"
  [[ -f "$tsv" ]] || return 1
  awk -F'\t' -v target="$file" '
    NR == 1 { next }
    $1 == target && $2 == "allowlist" { found = 1 }
    END { exit found ? 0 : 1 }
  ' "$tsv"
}

# One path per line from vitest FAIL lines (deduped).
#
# BL-1234: ps_allowlist_normalize_file emits its path with NO trailing
# newline (its own contract is "normalize a path", not "decide line
# framing") - the newline belongs here, at the one call site, so every
# normalized path lands on its own line before sort -u sees the stream.
# Without it, two or more failing files concatenate onto a single line,
# sort -u treats that concatenation as ONE (unmatchable) path, and the
# allowlist gate refuses every commit whenever 2+ allowlisted tests are red
# - which is the only case that occurs in practice once the allowlist names
# more than one file.
ps_suite_extract_failing_files() {
  local output="$1"
  printf '%s\n' "$output" \
    | grep -E '^ FAIL  (test/|extension/test/)' \
    | sed -E 's/^ FAIL  ([^ ]+).*/\1/' \
    | while IFS= read -r raw; do
        [[ -z "$raw" ]] && continue
        printf '%s\n' "$(ps_allowlist_normalize_file "$raw")"
      done \
    | sort -u
}

# Exit 0 when every parsed failure is allowlisted and at least one was parsed.
ps_suite_failures_all_allowlisted() {
  local tsv="$1"
  local output="$2"
  local files=()
  local file unlisted=()

  while IFS= read -r file; do
    [[ -z "$file" ]] && continue
    files+=("$file")
  done < <(ps_suite_extract_failing_files "$output")

  if (( ${#files[@]} == 0 )); then
    return 1
  fi

  for file in "${files[@]}"; do
    if ! ps_allowlist_file_is_allowlisted "$tsv" "$file"; then
      unlisted+=("$file")
    fi
  done

  if (( ${#unlisted[@]} > 0 )); then
    printf '%s\n' "${unlisted[@]}"
    return 1
  fi
  return 0
}

# Inventory rows for acceptance: file<TAB>disposition (header skipped).
ps_allowlist_inventory_rows() {
  local tsv="$1"
  [[ -f "$tsv" ]] || return 1
  awk -F'\t' 'NR > 1 && NF >= 2 { print $1 "\t" $2 }' "$tsv"
}
