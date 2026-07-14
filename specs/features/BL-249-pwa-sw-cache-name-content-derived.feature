Feature: the PWA service worker cache is invalidated when the shell changes

  # Bug (coordinator 2026-07-10): pwa/sw.js CACHE_NAME is a hand-edited constant
  # ('swarmforge-dashboard-v2', sw.js:20) that nobody bumps. The activate handler
  # (sw.js:37) already purges caches whose key != CACHE_NAME, and install caches
  # SHELL_ASSETS — but only when CACHE_NAME CHANGES. Since it never changes,
  # returning users keep the stale cached shell: BL-117/BL-118/BL-150 all shipped
  # shell changes to pwa/ that never reached users. Fix: derive CACHE_NAME from the
  # shell content at deploy time (the Pages deploy, .github/workflows/
  # backlog-dashboard.yml), so it changes iff the shell changes — no manual bump.

  Background:
    Given the PWA is deployed to GitHub Pages, its served sw.js CACHE_NAME derived from the shell assets

  # BL-249 shell-change-reaches-users-01
  Scenario: a deploy that changes the shell delivers the update to a returning user
    Given a returning user holding the previously-cached shell
    When a shell asset changes and the PWA is redeployed
    Then the served sw.js CACHE_NAME differs from the previous deploy
    And the new service worker installs the updated shell and the activate handler purges the old cache
    And the returning user receives the updated shell rather than the stale cached one

  # BL-249 unchanged-shell-no-churn-02
  Scenario: a deploy that does not change the shell keeps the same CACHE_NAME
    Given the shell assets are byte-for-byte unchanged since the last deploy
    When the PWA is redeployed
    Then the served sw.js CACHE_NAME is unchanged
    And returning users are not forced to re-download an identical shell

  # BL-249 no-manual-bump-03
  Scenario: CACHE_NAME is derived automatically, not hand-edited per release
    Given the shell assets for a deploy
    When the deploy stamps the served sw.js
    Then CACHE_NAME is derived from the shell content with no hand-edited version string required
