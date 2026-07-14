Feature: A CLI's behavior is proven in-process, with one spawned smoke test to lock the wiring

# BL-363: 32 test files (every CLI test except the dependency gate's, which BL-362 owns) spawn a
# fresh `node` per test case to exercise the CLI under test. Node startup is ~150-200ms before a
# single assertion runs, and it is paid once per test, not once per file. The worst case compounds
# it: negotiateOnboardingContractCli also runs `git init` plus two `git config` calls per test —
# four processes per test case.
#
# The rule this retroactively applies is already accepted (99ad07d, 2026-07-13): a CLI's logic must
# be proven by calling its exported helpers and its main() IN-PROCESS, because logic reachable only
# by spawning a subprocess is invisible to in-process coverage and mutation — its CRAP sits
# unmeasured and its mutants survive. `notifyDeadLettersCli.test.js` already shows the working seam
# (chdir into a fixture root, await main() directly, capture stdout, restore cwd in a finally).
#
# LOAD-BEARING CONSTRAINT: the rule is "in-process BY DEFAULT", not "never spawn". Each CLI keeps
# exactly ONE genuine end-to-end spawn as a smoke test, so the shebang/argv/exit-code wiring stays
# locked. This ticket removes the per-test spawn tax, not the wiring proof.

# BL-363 clis-tested-in-process-01
Scenario: A CLI's behavior is proven without spawning a process
  Given a CLI whose behavior is covered by tests
  When those tests exercise its behavior
  Then they call it in-process rather than spawning it

# BL-363 clis-tested-in-process-02
Scenario: Each CLI keeps exactly one end-to-end spawn as a wiring smoke test
  Given a CLI whose behavior is covered by tests
  When those tests run
  Then exactly one of them spawns the CLI end to end

# BL-363 clis-tested-in-process-03
Scenario: What the CLI prints and the code it exits with are still asserted
  Given a CLI whose behavior is covered by tests
  When those tests exercise its behavior
  Then what it prints and the code it exits with are still asserted

# BL-363 clis-tested-in-process-04
Scenario: A test needing a repository fixture builds it once, not once per test
  Given a CLI whose tests need a repository fixture
  When those tests run
  Then the repository fixture is built once and reused

# BL-363 clis-tested-in-process-05
Scenario: A test that leaves the working directory moved is a defect, not a hazard to live with
  Given a CLI test that changes the working directory to reach its fixture
  When that test finishes, whether it passed or failed
  Then the working directory is back where it started
