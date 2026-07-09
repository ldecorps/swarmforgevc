#!/usr/bin/env bash
# BSD/macOS `stat -f FORMAT` and GNU/Linux `stat -c FORMAT` are not
# interchangeable - on GNU coreutils, `-f` means "filesystem status" instead,
# so it fails (and can dump multi-line filesystem info to stdout) rather than
# honoring FORMAT. Try the BSD form first, fall back to GNU.
portable_stat() {
  local bsd_format="$1" gnu_format="$2" file="$3"
  if stat -f "$bsd_format" "$file" >/dev/null 2>&1; then
    stat -f "$bsd_format" "$file"
  else
    stat -c "$gnu_format" "$file"
  fi
}
