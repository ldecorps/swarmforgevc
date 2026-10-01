#!/usr/bin/env bash
# BL-1855: the projection test_bl982_multi_seat_identity.sh case 7 and
# bl982_multi_seat_identity_property_runner.bb's check-byte-identity!
# (BL-1541) both need - current roles.tsv rows cut to the pinned
# pre-change script's first 8 tab-separated columns before comparing. An
# appended 9th+ column (44d2d42591's propagation-mode column) is dropped
# here, never compared; a value inside the first 8 is kept in place, so an
# insertion/reorder/alteration among them still shows up. The pinned side
# is never projected - a pinned row that somehow grew a column still
# diverges.
#
# lib/ per the ticket's own direction: the suite inventory (BL-1239) lists
# test files only, under swarmforge/scripts/test/*.sh - this is a sourced
# helper, not a test.

# bl982_project_row_first_8_cols <line> -> that line's first 8
# tab-separated fields, tab-joined.
bl982_project_row_first_8_cols() {
  cut -f1-8 <<<"$1"
}

# bl982_rows_match_pinned_shape <pinned-file> <current-file>
# Each file holds one or more roles.tsv lines. Every CURRENT line is
# projected onto its first 8 columns; the PINNED side is compared as-is.
# Prints the diff (projected current vs pinned) to stdout on a mismatch.
# Returns 0 when they match line-for-line, 1 otherwise.
bl982_rows_match_pinned_shape() {
  local pinned_file="$1" current_file="$2"
  local projected
  projected="$(while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -n "$line" ]] && bl982_project_row_first_8_cols "$line"
  done < "$current_file")"
  diff <(printf '%s\n' "$projected") "$pinned_file"
}
