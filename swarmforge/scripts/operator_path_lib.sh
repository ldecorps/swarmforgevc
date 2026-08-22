#!/bin/sh
# Shared PATH helpers for cron / freshness / daemon starts.
# POSIX sh — safe to source from bash or sh.
#
# Hotfix follow-up 2026-08-03: the 2026-08-02 Mac PATH bake found `bb` but
# not nvm-only `node`. handoffd then inherited that PATH and every
# process/sh ["node" …] sweep failed with "No such file or directory".
#
# BL-796: adopted from the hand hotfix with two corrections — (1) the
# no-alias and alias-prefix-match fallbacks now compare MAJOR.MINOR.PATCH
# numerically instead of picking the lexicographically-last directory name
# (a byte sort ranks "v9.11.2" after "v22.1.0"); (2) install_freshness_cron.sh
# calls swarmforge_nvm_node_bin_dir directly instead of reimplementing nvm
# resolution inline, so there is exactly one nvm resolver, used by both the
# runtime PATH prepend below and the install-time crontab bake.

# Print the path with the highest MAJOR.MINOR.PATCH version among
# "<path>\t<vX.Y.Z>" lines read from stdin. Numeric, not lexicographic — a
# byte sort would rank "v9.11.2" after "v22.1.0".
_swarmforge_newest_version_path() {
  awk -F'\t' '
    {
      ver = $2
      sub(/^v/, "", ver)
      n = split(ver, parts, ".")
      key = ""
      for (i = 1; i <= 3; i++) {
        c = (i <= n) ? parts[i] + 0 : 0
        key = key sprintf("%06d.", c)
      }
      if (key > best) { best = key; bestpath = $1 }
    }
    END { if (bestpath != "") print bestpath }
  '
}

# Print the bin directory of an nvm-installed node, or nothing.
# Prefers ~/.nvm/alias/default when it resolves; else the newest v* under
# ~/.nvm/versions/node BY VERSION ORDER (never lexicographic — see above).
swarmforge_nvm_node_bin_dir() {
  _base="${HOME:-}/.nvm/versions/node"
  [ -d "$_base" ] || return 0

  if [ -f "${HOME:-}/.nvm/alias/default" ]; then
    _ver=$(cat "${HOME:-}/.nvm/alias/default")
    _ver=${_ver#v}
    for _cand in "$_base/v$_ver" "$_base/$_ver"; do
      if [ -x "$_cand/bin/node" ]; then
        printf '%s\n' "$_cand/bin"
        return 0
      fi
    done
    _match=$(
      for _dir in "$_base"/v"${_ver}"*; do
        [ -d "$_dir" ] && [ -x "$_dir/bin/node" ] || continue
        printf '%s\t%s\n' "$_dir" "$(basename "$_dir")"
      done | _swarmforge_newest_version_path
    )
    if [ -n "$_match" ]; then
      printf '%s\n' "$_match/bin"
      return 0
    fi
  fi

  _latest=$(
    for _dir in "$_base"/v*; do
      [ -d "$_dir" ] && [ -x "$_dir/bin/node" ] || continue
      printf '%s\t%s\n' "$_dir" "$(basename "$_dir")"
    done | _swarmforge_newest_version_path
  )
  if [ -n "$_latest" ]; then
    printf '%s\n' "$_latest/bin"
  fi
}

# Resolve $1's bin directory by searching $2 (a colon-joined PATH string),
# without touching the caller's own PATH — the whole body runs in a
# subshell. Prints nothing if $1 is not found on $2.
_swarmforge_resolve_bin_dir() (
  PATH=$2
  if command -v "$1" >/dev/null 2>&1; then
    CDPATH= cd -- "$(dirname -- "$(command -v "$1")")" && pwd
  fi
)

# Prepend standard operator bins + resolved bb/node (or nvm node) onto PATH.
# Resolution searches the CALLER's existing PATH first, the curated
# fallback dirs second — a binary the caller's PATH already resolves (e.g.
# a test's own stub, or a real interactive install) is never shadowed by a
# different installation the curated/nvm fallback would otherwise find.
swarmforge_prepend_operator_bins() {
  _fallback_dirs="/usr/local/bin:/opt/homebrew/bin:${HOME:-}/.local/bin:${HOME:-}/.npm-global/bin"
  _search_path="${PATH:-/usr/bin:/bin}:${_fallback_dirs}"

  _bb_dir=$(_swarmforge_resolve_bin_dir bb "$_search_path")
  _node_dir=$(_swarmforge_resolve_bin_dir node "$_search_path")
  if [ -z "$_node_dir" ]; then
    _nvm_bin=$(swarmforge_nvm_node_bin_dir || true)
    [ -n "${_nvm_bin:-}" ] && _node_dir="$_nvm_bin"
  fi

  PATH="${_bb_dir:+$_bb_dir:}${_node_dir:+$_node_dir:}${PATH:-/usr/bin:/bin}:${_fallback_dirs}"
  export PATH
}
