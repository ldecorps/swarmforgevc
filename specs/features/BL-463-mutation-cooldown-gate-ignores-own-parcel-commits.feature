Feature: The mutation cooldown gate ignores the current parcel's own commits, so it does not skip-cooldown every fresh parcel

  # BL-463 (bug, expedite — raised by the hardener via rule_proposal 2026-07-16, dispositioned as a
  # tool defect rather than a prompt rule). The BL-149 file-change cooldown gate
  # (swarmforge/scripts/mutation_cooldown_gate.bb, decided by mutation_cooldown_lib.bb) is meant to
  # SKIP mutation-testing a file that is still "actively churning" — last committed-touched within
  # mutation_cooldown_days (default 3) — and RUN mutation on a file that has settled. Its
  # last-committed-ms helper reads `git log -1 --format=%at -- <file>` and its own docstring justifies
  # this as "ignoring the change at hand … any uncommitted/in-flight diff is already excluded by
  # construction."
  #
  # THE DEFECT: that justification is false for SwarmForge's pipeline. Every role COMMITS its work and
  # forwards a commit via git_handoff, so by the time a parcel reaches the hardener the coder / cleaner
  # / architect have ALREADY committed the changed file. `git log -1 -- <file>` in the hardener's
  # worktree therefore returns the PARCEL'S OWN commit from minutes ago, age < cooldown window, so the
  # gate returns skip-cooldown on essentially EVERY parcel's changed files — the mutation gate is
  # vacuous for fresh work (the same "hardener gate does nothing" family as BL-446). Observed live on
  # BL-461: the gate skip-cooldown'd swarm_ensure.bb because it had been committed 20 minutes prior.
  #
  # THE FIX (behavior; exact git incantation is a build detail): the cooldown clock must genuinely
  # "ignore the change at hand" — measure the file's last committed touch that is NOT part of the
  # in-flight parcel (i.e. the last commit on the integration branch `main`, which by construction does
  # not yet contain the parcel's role-branch commits), never the parcel's own just-made commit. So a
  # file the parcel itself just changed is decided on its PRIOR integrated history, and genuine churn
  # by OTHER recent tickets still triggers skip-cooldown. A file the parcel newly introduces (no prior
  # integrated history) is eligible to RUN, not skipped.
  #
  # Scope: swarmforge/scripts/mutation_cooldown_gate.bb (last-committed-ms), its shell gate
  # swarmforge/scripts/test/test_mutation_cooldown_gate.sh (add the ignore-own-parcel scenarios via git
  # fixtures with a main branch + an in-flight branch). mutation_cooldown_lib.bb's pure decide logic is
  # correct and unchanged — the bug is the INPUT it is fed. The DECISION vocabulary (skip-cooldown /
  # skip-busy / run) is unchanged, so hardender.prompt's decision handling stays as-is; the specifier
  # clarifies the skip-cooldown prose ("by work OTHER than the current parcel") when the fix lands.

  # BL-463 cooldown-ignore-own-01
  Scenario: A file changed only by the current parcel's own commits is eligible to run
    Given a file whose only recent commits are the current in-flight parcel's own commits
    And no commit already on the integration branch touched it within the cooldown window
    And the host is quiet
    When the mutation cooldown gate runs for that file
    Then it decides to run mutation testing
    And it does not report skip-cooldown

  # BL-463 cooldown-ignore-own-02
  Scenario: A file recently churned by other integrated work is still skipped for cooldown
    Given a file last committed-touched on the integration branch within the cooldown window by earlier integrated work
    And the host is quiet
    When the mutation cooldown gate runs for that file
    Then it reports skip-cooldown

  # BL-463 cooldown-ignore-own-03
  Scenario: A settled file past the cooldown window runs on a quiet host
    Given a file last committed-touched on the integration branch before the cooldown window
    And no in-flight parcel commit resets its cooldown clock
    And the host is quiet
    When the mutation cooldown gate runs for that file
    Then it decides to run mutation testing

  # BL-463 cooldown-ignore-own-04
  Scenario: A file newly introduced by the parcel is eligible to run, not skipped
    Given a file that the current parcel introduces with no prior integrated history
    And the host is quiet
    When the mutation cooldown gate runs for that file
    Then it decides to run mutation testing
    And it does not report skip-cooldown
