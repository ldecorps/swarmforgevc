// BL-233 slice 4 (recommend-not-adopt-06): emits a suggested
// swarmforge.conf --model change for a role's leaderboard - RECOMMEND
// ONLY, per the operator's ADOPTION decision ("a human applies it. The
// recruiter never mutates swarmforge.conf or bounces the swarm").
//
// Deliberately imports NOTHING with filesystem or process-spawning
// capability (no `fs`, no `child_process`) - "never modifies swarmforge.conf
// or bounces the swarm" holds structurally, by construction, not by
// convention (the same lesson the architect's secretStore bounce taught in
// slice 2: a comment claiming a safety property is not the same as the
// code actually being unable to violate it). recruiterRecommend.test.js's
// own source-inspection test guards against this file ever gaining that
// capability.

import { ConfChangeSuggestion, RoleLeaderboard } from './candidate';

export function suggestConfChange(leaderboard: RoleLeaderboard): ConfChangeSuggestion | null {
  if (!leaderboard.recommended) {
    return null;
  }
  return {
    role: leaderboard.role,
    suggestedModel: leaderboard.recommended,
    swarmforgeConfLine: `--model ${leaderboard.recommended}`,
  };
}
