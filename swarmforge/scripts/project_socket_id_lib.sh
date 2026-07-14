# BL-367: the same cksum-derived project id gates both where the swarm's
# control socket is CREATED (swarmforge.sh, primary .swarmforge/tmux/ path)
# and where kill_all_swarm.sh looks for one at the legacy /tmp/swarmforge-
# <uid>/ location. The two computations must stay byte-identical or the
# legacy lookup silently stops matching a socket the launcher actually
# created - share one implementation instead of two copies that could drift.
# Sourced from both zsh (swarmforge.sh) and bash (kill_all_swarm.sh); uses
# only constructs common to both.
project_socket_id() {
  local id
  id="$(printf '%s' "$1" | cksum)"
  printf '%s' "${id%% *}"
}
