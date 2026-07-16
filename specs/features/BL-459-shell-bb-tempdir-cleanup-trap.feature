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
