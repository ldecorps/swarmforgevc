#!/bin/sh
# Shared by daemon_log_freshness_check.sh (and its tests).
# Belt-and-suspenders: Operator-topic FRESHNESS announces are plain text
# (no parse_mode). Source strings today are ASCII spaces only, but some
# Telegram clients have shown tofu/"box" glyphs between words on those
# lines. Normalize known non-ASCII whitespace to ASCII space before post
# so a stray U+00A0 (or cousin) cannot render as a glyph.
#
# Must stay POSIX /bin/sh (dash) — no bash $'…' strings. Cron invokes the
# checker via /bin/sh.

# Usage: normalize_telegram_plain_text "$msg"  → prints normalized text on stdout.
normalize_telegram_plain_text() {
  # UTF-8 via printf octals (portable):
  #   U+00A0 NBSP          c2 a0
  #   U+202F NNBSP         e2 80 af
  #   U+2007 figure space  e2 80 87
  #   U+2008 punctuation   e2 80 88
  #   U+2009 thin space    e2 80 89
  #   U+200A hair space    e2 80 8a
  #   U+200B ZWSP          e2 80 8b
  #   U+FEFF BOM           ef bb bf
  _nbsp=$(printf '\302\240')
  _nnbsp=$(printf '\342\200\257')
  _fig=$(printf '\342\200\207')
  _punc=$(printf '\342\200\210')
  _thin=$(printf '\342\200\211')
  _hair=$(printf '\342\200\212')
  _zwsp=$(printf '\342\200\213')
  _bom=$(printf '\357\273\277')
  printf '%s' "$1" | sed \
    -e "s/${_nbsp}/ /g" \
    -e "s/${_nnbsp}/ /g" \
    -e "s/${_fig}/ /g" \
    -e "s/${_punc}/ /g" \
    -e "s/${_thin}/ /g" \
    -e "s/${_hair}/ /g" \
    -e "s/${_zwsp}/ /g" \
    -e "s/${_bom}/ /g"
}
