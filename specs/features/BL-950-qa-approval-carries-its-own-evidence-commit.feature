# BL-806 refuses a review role's forward-direction git_handoff when it names
# exactly the commit that role received - Article 4.4's structural backstop,
# forcing a clean pass to commit its explicit-NONE inventory and forward THAT
# commit. Its approved scope covered the four forward-chain review roles only;
# QA's own send paths were excluded that slice.
#
# QA's approval to the coordinator was the last hop before a ticket closes,
# and it was the excluded one. These scenarios extended the same refusal to
# it, and pinned the exclusions that had to survive: a bounce, a merge-up
# note, a marked detour, and every shape where there is nothing to compare
# against.
#
# BL-1565 (2026-09-14) retired the premise every scenario below relied on:
# a git_handoff naming the coordinator is now refused at send, before
# `validate` (and so before review_forward_evidence_gate_lib.bb) ever runs -
# categorically, whatever its commit, reroute_reason, or whether that
# commit even resolves to a real Git object (Article 1.1 - the coordinator
# holds no code worktree; QA's approval reaches it only as a `note` now).
# The scenario that asserted a same-commit forward was refused FOR ARTICLE
# 4.4 REASONS is now refused for an unrelated, earlier reason instead - a
# claim as false as the "delivered" ones - so every QA-to-coordinator
# scenario is retired here, never reworded (BL-1006). Not a coverage loss:
# BL-806's own feature already covers the same-commit refusal, the
# fail-open case, and the reroute_reason exemption generically for
# non-coordinator recipients, and BL-1565's own feature covers the
# coordinator refusal itself. Only the non-approval-forward coverage below
# (a bounce, a merge-up note) still describes a reachable QA send path.
Feature: A QA approval names the commit QA made, never the bare commit it received

  Background:
    Given the handoff gate reads the commit a role received for a task from that role's own in-process mailbox

  # BL-950 qa-approval-evidence-03
  Scenario Outline: a QA send that is not an approval-forward passes untouched
    Given QA received the parcel for task "T" naming commit "aaaaaaaaaa"
    When QA sends <send> for task "T"
    Then the send is delivered

    Examples:
      | send                                                        |
      | a bounce git_handoff to the coder naming the same commit    |
      | a merge-up note to the worktree roles                       |
