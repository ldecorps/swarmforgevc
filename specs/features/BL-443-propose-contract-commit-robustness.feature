Feature: propose-onboarding-contract reliably commits the contract into any target repo

# BL-443 (bug): three commit-step defects surfaced by the first real FES onboarding run, 2026-07-15, all
# in the shared commit seam extension/src/config/targetBootstrap.ts (writeFilesAndCommit /
# writeAndCommitBootstrapPlan), reached by extension/src/tools/propose-onboarding-contract.ts:
#   2. `git add .swarmforge/contract.yaml CONTRACT.md` hard-fails when the target's .git/info/exclude or
#      .gitignore ignores .swarmforge/ (FES had a June swarm-era `.swarmforge/` exclude). The contract is
#      DESIGNED to be git-tracked in the target (hybrid artifact, BL-262) and the onboarding gate reads
#      it from the checkout, so an ignored contract silently re-holds every fresh clone.
#   3. `git commit` dies "Author identity unknown / empty ident name" when the target checkout has no
#      user.name/user.email (common on a brand-new or foreign target, e.g. the WSL side).
#   4. Existence-only idempotency: after a partial failure the artifacts exist on disk but are
#      uncommitted, and the re-run reports created:[], skipped:[all], committed:false — so NO number of
#      re-runs ever produces the commit.
# Each was worked around by hand. Fix all three so a first onboarding of an arbitrary target just works.

Background:
  Given a target repo with contract.yaml and CONTRACT.md to be scaffolded and committed

# BL-443 propose-contract-commit-robustness-01
Scenario: The contract commits even when .swarmforge/ is ignored by the target
  Given the target ignores the .swarmforge/ path
  When propose-onboarding-contract commits the contract
  Then the exact contract files are force-added past the ignore rule
  And the commit contains contract.yaml and CONTRACT.md

# BL-443 propose-contract-commit-robustness-02
Scenario: The commit succeeds when the target has no git identity configured
  Given the target repo has no user.name or user.email configured
  When propose-onboarding-contract commits the contract
  Then the commit is made with an explicit fallback author identity
  And the commit succeeds

# BL-443 propose-contract-commit-robustness-03
Scenario: A re-run after a partial failure that left artifacts uncommitted produces the commit
  Given the contract files were written on a prior run but never committed
  When propose-onboarding-contract runs again
  Then it detects the artifacts are present but uncommitted
  And it commits them
  And it reports committed as true

# BL-443 propose-contract-commit-robustness-04
Scenario: A re-run when the artifacts already exist and are committed is a clean no-op
  Given the contract files are present and already committed
  When propose-onboarding-contract runs again
  Then nothing new is written
  And no empty commit is created
  And it reports the artifacts as already present and committed
