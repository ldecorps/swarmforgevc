Feature: BL-961 launcher exports the resolved pack into every role shell

  The default launcher resolves the pack conf (--pack NAME selects
  swarmforge/packs/NAME.conf, else swarmforge.conf) but never exports
  SWARMFORGE_PACK itself, so every env-keyed consumer (BL-935's vitest CPU
  cap, ancillary_provider_lib's primary resolution path) sees it only when
  the launching shell happened to export it - today's live full-forge value
  rides the tmux server environment inherited at the 2026-08-19 relaunch,
  not launcher wiring. The generated .swarmforge/launch/<role>.sh must
  carry the export itself so a pane respawned via that script, or a swarm
  relaunched from a clean shell, still has it.

  Background:
    Given a scratch fixture project root with the minimal swarm layout

  # BL-961 launcher-exports-resolved-pack-01
  Scenario Outline: a generated role launch script exports the pack the launcher loaded
    Given the launcher is invoked with the pack conf "<conf>"
    When the launcher writes the launch script for role "coder"
    Then the generated launch script contains the line "export SWARMFORGE_PACK='<pack>'"

    Examples:
      | conf                   | pack        |
      | packs/full-forge.conf  | full-forge  |
      | packs/mono-router.conf | mono-router |
      | swarmforge.conf        | swarmforge  |

  # BL-961 launcher-exports-resolved-pack-02
  Scenario: every role's generated launch script carries the same export
    Given the launcher is invoked with the pack conf "packs/full-forge.conf"
    And the pack conf declares the roles "coder" and "QA"
    When the launcher writes each declared role's launch script
    Then every generated launch script contains the line "export SWARMFORGE_PACK='full-forge'"
