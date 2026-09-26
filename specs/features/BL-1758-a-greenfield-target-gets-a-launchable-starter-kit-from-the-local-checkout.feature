Feature: BL-1758 A greenfield target gets a launchable starter kit from the local swarmforgevc checkout

  A target with nothing but a README cannot reach "./swarm <path> --pack
  mono-router" today. The wrapper's self-install copies only the scripts
  and articles of upstream unclebob/swarm-forge's floating main, and that
  engine rejects this project's own config vocabulary ("Invalid config
  line 6: config active_backlog_max_depth 2"). Upstream ships no packs and
  no pipeline role prompts, and the target never gets swarmforge/git-hooks.
  Found live onboarding gpu-bargain-hunter on 2026-09-25 and hand-fixed
  there. With this feature a starter kit is installed from the local
  swarmforgevc checkout: its own engine, hooks, protocol, generic
  constitution, the mono-router pack and a generic role-prompt set, so the
  engine and the pack it ships always agree. The wrapper never fetches
  upstream (ruling A, recommended; if the human rules otherwise, the
  specifier rewrites this feature and re-pends).

  # BL-1758 readme-only-target-gets-the-kit-01
  Scenario: a target holding only a README receives every file a pipeline launch needs
    Given a fixture target containing only README.md
    When the starter kit is installed into it from the local checkout
    Then the target holds swarmforge/scripts, swarmforge/git-hooks and swarmforge/handoff-protocol.md
    And it holds swarmforge/constitution.prompt and constitution articles 01 to 05 and workflow.prompt
    And it holds swarmforge/packs/mono-router.conf and mono-router.prompt
    And it holds one role prompt for every role mono-router.conf names

  # BL-1758 engine-accepts-the-kits-own-config-02
  Scenario: the installed engine accepts every line of the installed pack and conf
    Given a fixture target the starter kit was installed into
    When the installed swarmforge.sh parses the installed swarmforge.conf and mono-router.conf
    Then every line is accepted

  # BL-1758 project-specific-files-stay-home-03
  Scenario: nothing that describes swarmforgevc itself is copied
    Given a fixture target the starter kit was installed into
    Then it holds no project.prompt, engineering.prompt or local-engineering.prompt from the checkout
    And it holds no constitution/articles/reference directory
    And none of its role prompts is a copy of the checkout's own swarmforge/roles prompt

  # BL-1758 kit-records-its-source-04
  Scenario: the installed conf records the checkout and the commit it came from
    Given a fixture target the starter kit was installed into
    Then its swarmforge.conf carries "config tooling_root" naming the local checkout
    And it records the checkout commit the kit was copied from
    And it declares "config swarm_name" with the swarm name the install was given

  # BL-1758 commits-are-guarded-05
  Scenario: the target's first launch guards its commits through the kit's hooks
    Given a fixture target the starter kit was installed into
    When the target's launch runs its git setup
    Then core.hooksPath is swarmforge/git-hooks and that directory holds the kit's hooks
    And no .git/hooks/commit-msg exists

  # BL-1758 wrapper-never-fetches-upstream-06
  Scenario: the swarm wrapper in a target with no engine fetches nothing and points at the kit
    Given a fixture target holding the swarm wrapper and no swarmforge/scripts
    When the swarm wrapper runs
    Then no download is attempted
    And it exits non-zero naming the starter kit install

  # BL-1758 existing-tree-is-refused-untouched-07
  Scenario: a target that already has a swarmforge tree is refused and left untouched
    Given a fixture target that already holds a swarmforge directory
    When the starter kit is installed into it from the local checkout
    Then the install exits non-zero naming the existing swarmforge directory
    And every file in the target is byte-identical to before
