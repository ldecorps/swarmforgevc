#!/usr/bin/env bash
# BL-1058: a stand-in `mktemp` that accepts exactly ONE userland's syntax.
#
# `mktemp -t <prefix>` is BSD/macOS syntax, where the operand is a prefix. GNU
# coreutils reads the operand as a TEMPLATE needing three trailing X's and
# refuses, so a BSD-only call is a hard error on a GNU host and vice versa.
# Any test that runs against whatever mktemp THIS host happens to ship proves
# only that this host works - which is exactly the assumption that let the
# defect land and stay invisible until the host moved from macOS to WSL2.
#
# This shim is that missing seam. Put it first on PATH and a call that only
# one userland accepts fails HERE, on either host, instead of after a
# migration. It is deliberately faithful about the one axis under test - which
# operand forms each userland accepts - and it creates the file or directory
# ITSELF rather than delegating to the host's mktemp, so the host cannot
# quietly rescue a call the modelled userland would have refused.
#
#   gnu                - the operand is a TEMPLATE and must end in three X's,
#                        `-t` or not.
#   bsd                - `-t` takes a PREFIX; without it the operand is a
#                        template; GNU-only options are refused.
#   refuses-everything - creates nothing, for the fail-loud path.
#
# Note what this does NOT claim: `<dir>/<prefix>.XXXXXX` is valid on BOTH
# userlands, which is precisely why it is the portable call. The two dialect
# arms exist to catch a regression toward either one's EXCLUSIVE syntax.
#
# Two consumers drive this one implementation - test_tmp_cleanup_lib.sh
# sources it, and the BL-1058 acceptance step handlers exec it as a CLI:
#
#   source lib/mktemp_dialect_shim.sh && write_mktemp_shim "$bindir" gnu
#   bash lib/mktemp_dialect_shim.sh "$bindir" gnu

write_mktemp_shim() {
  local bindir="$1" dialect="$2"
  case "$dialect" in
    gnu|bsd|refuses-everything) ;;
    *)
      echo "write_mktemp_shim: unknown dialect '$dialect' - expected gnu, bsd or refuses-everything" >&2
      return 1
      ;;
  esac
  printf '#!/usr/bin/env bash\nDIALECT=%s\n' "$dialect" > "$bindir/mktemp"
  cat >> "$bindir/mktemp" <<'SHIM'
if [ "$DIALECT" = refuses-everything ]; then
  echo "mktemp: this shim refuses every invocation" >&2
  exit 1
fi

kind=file; tflag=0; operand=""; gnu_only=""
for arg in "$@"; do
  case "$arg" in
    -d) kind=dir ;;
    -t) tflag=1 ;;
    --*|-p) gnu_only="$arg" ;;
    -*) ;;
    *) operand="$arg" ;;
  esac
done

if [ "$DIALECT" = gnu ]; then
  # GNU reads the operand as a template whatever -t says, and refuses one it
  # cannot make unique - the exact error the defect produced.
  template="${operand:-tmp.XXXXXXXXXX}"
  case "$template" in
    *XXX) ;;
    *) echo "mktemp: too few X's in template '$template'" >&2; exit 1 ;;
  esac
  case "$template" in
    */*) dir="${template%/*}" ;;
    *) if [ "$tflag" = 1 ]; then dir="${TMPDIR:-/tmp}"; else dir="."; fi ;;
  esac
  prefix="${template##*/}"; prefix="${prefix%%XXX*}"
else
  [ -n "$gnu_only" ] && { echo "mktemp: illegal option -- $gnu_only" >&2; exit 1; }
  if [ "$tflag" = 1 ]; then
    dir="${TMPDIR:-/tmp}"; prefix="${operand:-tmp}."
  else
    [ -n "$operand" ] || { echo "mktemp: usage: mktemp [-d] [-t prefix] template" >&2; exit 1; }
    case "$operand" in
      *XXX) ;;
      *) echo "mktemp: insufficient X's in template '$operand'" >&2; exit 1 ;;
    esac
    case "$operand" in
      */*) dir="${operand%/*}" ;;
      *) dir="." ;;
    esac
    prefix="${operand##*/}"; prefix="${prefix%%XXX*}"
  fi
fi

attempt=0
while [ "$attempt" -lt 100 ]; do
  candidate="$dir/$prefix$$-$RANDOM"
  if [ "$kind" = dir ]; then
    mkdir "$candidate" 2>/dev/null && { printf '%s\n' "$candidate"; exit 0; }
  else
    (set -o noclobber; : > "$candidate") 2>/dev/null && { printf '%s\n' "$candidate"; exit 0; }
  fi
  attempt=$((attempt + 1))
done
echo "mktemp: failed to create a unique name under $dir" >&2
exit 1
SHIM
  chmod +x "$bindir/mktemp"
}

# Executed rather than sourced: write one shim and exit. `$0` differs from
# BASH_SOURCE only when this file is sourced, which is how the shell suite
# gets the function without tripping the CLI.
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  set -euo pipefail
  write_mktemp_shim "${1:?Usage: mktemp_dialect_shim.sh <bindir> <gnu|bsd|refuses-everything>}" \
                    "${2:?Usage: mktemp_dialect_shim.sh <bindir> <gnu|bsd|refuses-everything>}"
fi
