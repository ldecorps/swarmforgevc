Feature: BL-1635 The Android JVM build reads sources as UTF-8 regardless of locale

  Four of the 275 Bubble JVM unit tests fail on main with a comparison
  between two compiles of the same em-dash: the test's literal compiled
  into three replacement characters while production's compiled intact,
  because the charset each source set was compiled with followed the
  locale of whichever daemon compiled it, and the acceptance handlers'
  Gradle lib launches with no locale at all. Five landed features that
  shell the suite are red with it. This feature is that every JVM the
  build launches reads sources as UTF-8 whatever the caller's locale, that
  the lib's launch environment says so explicitly, and that no Kotlin
  source carries a byte a text tool cannot read. The suite going green
  and the five features going green are QA's e2e steps, not scenarios
  (BL-1541).

  # BL-1635 jvm-build-reads-sources-as-utf-8-01
  Scenario: every JVM the build launches is told its source charset
    When the Android build's Gradle properties and the app module's build script are read
    Then the Gradle daemon JVM arguments pin file.encoding to UTF-8
    And the Kotlin compile daemon JVM arguments pin file.encoding to UTF-8
    And the app module's Java compile options set the encoding to UTF-8

  # BL-1635 jvm-build-reads-sources-as-utf-8-02
  Scenario: the handlers' Gradle lib launches with an explicit UTF-8 locale
    Given a base environment carrying only PATH and HOME
    When the handlers' Gradle lib builds the environment it launches gradlew with
    Then that environment sets LC_ALL and LANG to a UTF-8 locale
    And it sets JAVA_TOOL_OPTIONS to pin file.encoding to UTF-8

  # BL-1635 jvm-build-reads-sources-as-utf-8-03
  Scenario: no Kotlin source carries a byte a text tool cannot read
    When every Kotlin source under android/app/src is read as bytes
    Then none contains a NUL byte or an invalid UTF-8 sequence
    And the population read is at least 70 files
