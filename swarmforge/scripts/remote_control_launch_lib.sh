#!/usr/bin/env bash
# BL-1218: the pack config decides a Claude seat's remote-control flag at
# launch, not merely whether one is auto-injected.
#
# Before this, `config remote_control off` governed ONLY the inject side:
# a window line that omitted --remote-control got one added when the default
# was on, and did not when it was off. A window line that NAMED the flag was
# never consulted about the config at all. Both the standing swarmforge.conf
# and packs/full-forge.conf name --remote-control explicitly on every Claude
# window line, so on exactly the packs a human is most likely to be running,
# `remote_control off` switched nothing off - the seats still launched with
# remote control, and the persisted launch script (the artifact the health
# check treats as desired state) still recorded the flag.
#
# The decision is a pure string transform so it can be asserted directly,
# rather than only observed through a written launch script. It is sourced
# by swarmforge.sh (zsh) and by its test (bash), so it must not rely on word
# splitting of an unquoted parameter - zsh does not do that and bash does,
# and a difference there would show up in only one of the two (BL-801's
# shape). Hence sed rather than a token loop.

# Removes --remote-control, and the session name that follows it when there
# is one, from a launch flag string. A following token starting with '-' is
# another flag, not this one's argument, and is kept.
rc_strip_remote_control_flag() {
  printf '%s' "$1" \
    | sed -E 's/(^|[[:space:]])--remote-control([[:space:]]+[^[:space:]-][^[:space:]]*)?//g' \
    | sed -E 's/[[:space:]]+/ /g; s/^ //; s/ $//'
}

# resolve_remote_control_cli <agent> <rc-default 0|1> <session-name> <extra-cli>
#
# Prints the extra-cli a seat should launch with.
#
#   agent is not claude  -> unchanged. Non-Claude seats have no remote
#                           control to govern (BL-1108) and this ticket does
#                           not start rewriting their lines.
#   rc-default 1         -> exactly today's composition: a named flag stays
#                           where the window line put it, an absent one is
#                           appended the way `extra_cli+=" --remote-control"`
#                           always appended it, leading space and all. Config
#                           on, and config absent, are byte-for-byte
#                           indistinguishable from before this change.
#   rc-default 0         -> no remote-control flag survives, whatever the
#                           window line said.
resolve_remote_control_cli() {
  agent="$1"
  rc_default="$2"
  rc_session="$3"
  rc_cli="$4"

  if [ "$agent" != "claude" ]; then
    printf '%s' "$rc_cli"
    return 0
  fi

  if [ "$rc_default" = "1" ]; then
    case "$rc_cli" in
      *--remote-control*) printf '%s' "$rc_cli" ;;
      *) printf '%s --remote-control %s' "$rc_cli" "$rc_session" ;;
    esac
    return 0
  fi

  rc_strip_remote_control_flag "$rc_cli"
}
