# mutation-stamp: sha256=d62af66b6c33336e3a89f5db85c7cb9e215d9b560a10b39fb33f5ef988659ee9
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-07-16T16:27:40.327695127Z","feature_name":"shell and babashka test harnesses clean up the temp dirs they create","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-459-shell-bb-tempdir-cleanup-trap.feature","background_hash":"74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b","implementation_hash":"unknown","scenarios":[{"index":0,"name":"a test harness removes its temp root on both clean and failing exit","scenario_hash":"74e063f60a81055287eb34b796ffd8ecef897d050f8e3d60ec177df05439adf2","mutation_count":8,"result":{"Total":8,"Killed":8,"Survived":0,"Errors":0},"tested_at":"2026-07-16T16:27:40.327695127Z"}]}
# acceptance-mutation-manifest-end

Feature: shell and babashka test harnesses clean up the temp dirs they create

  # BL-420 made the EXTENSION Vitest suite self-clean its mkdtemp dirs via a
  # shared helper + a raw-mkdtemp guard, but that was extension-only. The
  # shell (swarmforge/scripts/test/*.sh) and babashka (*_test_runner.bb, the
  # vendored aps generator) harnesses still `mktemp -d` / `fs/create-temp-dir`
  # with NO cleanup trap, so every run keeps feeding the /tmp accumulation
  # (~377k stale sfvc-*/aps-* dirs measured 2026-07-16). Close the gap: register
  # a cleanup trap that removes the temp root on exit — including a failing exit.
  # (SIGKILL/OOM still defeats a trap by design; the periodic BL-413 sweep is the
  # backstop for that, out of scope here.)

  # BL-459 tempdir-cleanup-trap-01
  Scenario Outline: a test harness removes its temp root on both clean and failing exit
    Given a "<harness_kind>" test harness that creates a temp root under /tmp
    When the harness exits "<exit_mode>"
    Then its temp root is removed

    Examples:
      | harness_kind | exit_mode |
      | shell        | clean     |
      | shell        | failing   |
      | babashka     | clean     |
      | babashka     | failing   |

  # BL-459 tempdir-cleanup-trap-02
  Scenario: every shell and babashka test harness that creates a temp root registers a cleanup trap
    Given the shell and babashka test harnesses under swarmforge/scripts
    When each harness that creates a mktemp or create-temp-dir root is inspected
    Then it registers a cleanup trap that removes that root on exit
