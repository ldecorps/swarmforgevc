Feature: BL-1975 A pinned JDK and Clojure CLI install user-locally on a swarm host

  BL-472 slice 1 of 3. clj-mutate, crap4clj and dry4clj declare :deps that
  Babashka resolves through the Clojure CLI, which needs java; this host has
  babashka and no java, so `bb tasks` fails in all three before any tool
  code runs (measured 2026-09-02). The human ruled to provision a JVM and the
  Clojure CLI on swarm hosts. Seats may not run sudo or apt, so the install
  is user-local, pinned by version and sha256 in swarmforge.lock.json, and
  never resolves "latest".

  Background:
    Given the lock file pins a JDK archive and a Clojure CLI installer, each by version and sha256

  # BL-1975 the-toolchain-installs-at-the-pinned-versions-01
  Scenario: the install puts java and clojure at the pinned versions under a user-local directory
    Given a download source serving archives that match their pins
    When the JVM toolchain install runs
    Then java and clojure at the pinned versions are installed under the user-local tool directory
    And the install ran no sudo and no package manager

  # BL-1975 a-second-install-downloads-nothing-02
  Scenario: running the install again downloads nothing
    Given the toolchain is already installed at the pinned versions
    When the JVM toolchain install runs
    Then nothing is downloaded and the installed toolchain is unchanged

  # BL-1975 a-checksum-mismatch-installs-nothing-03
  Scenario: an archive whose sha256 does not match its pin installs nothing
    Given a download source serving a JDK archive whose sha256 does not match its pin
    When the JVM toolchain install runs
    Then the install exits non-zero naming that archive
    And nothing is installed

  # BL-1975 callers-find-the-pinned-java-04
  Scenario: the install writes the one environment file callers source to find the pinned toolchain
    Given a download source serving archives that match their pins
    When the JVM toolchain install runs
    Then an environment file names the pinned toolchain's JAVA_HOME and puts its java and clojure first on PATH
