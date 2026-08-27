# BL-777 / BL-844 / BL-845 — hardener batch pass (Android/Kotlin)

Three Android (Kotlin) tickets forwarded fresh from the architect, merged
into this worktree in the same batch. Per the "Testability Boundary —
Bubble" article, Kotlin/Android has **no mutation/CRAP/DRY tooling wired**
— gated ONLY by its own JVM unit-test suite
(`android/gradlew :app:testDebugUnitTest`, no emulator). No TypeScript
files were touched by any of the three tickets.

## Environmental note: the JDK is at the MAIN checkout's `.swarmforge/tooling/jdk-17`, not `jdk-17` directly

An initial check (`which java`, `.swarmforge/jdk-17/Contents/Home` per this
prompt's own documented macOS-shaped path) found nothing — this host has no
system Java and no worktree-local JDK. Before concluding the JVM gate was
genuinely unsatisfiable here (which would have meant recording a degraded
fallback), checked `specs/pipeline/steps/lib/androidGradle.js`'s own
`portableJdk17Candidates` search order directly: it also checks
`.swarmforge/tooling/jdk-17` (a **second** provisioned location, `BL-777`'s
own comment names this exact trap) at both this worktree and the MAIN
checkout via `resolveMainCheckout`. Found: a real, working Linux JDK 17 at
`/home/carillon/swarmforgevc/.swarmforge/tooling/jdk-17` (confirmed via
`gradlew --version`: `JVM: 17.0.20 (Eclipse Adoptium 17.0.20+8)`,
`OS: Linux ... WSL2`) — genuinely usable, not a dead end.

## Registry load gotcha, second occurrence this pass

The same batch's earlier BL-1050-history merges (see the BL-713 evidence
file for the first occurrence) reintroduced a step file
(`bl1050CursorRunFailureLogSteps.js`) requiring uncompiled
`extension/out/`. `npm run compile` fixed it before any acceptance run in
this pass; confirmed via `node -e "require('./specs/pipeline/steps/index.js')"`
loading clean afterward.

## Verification, re-run live

- **Acceptance, all three features, independently**:
  - `BL-777-barge-in-detector-and-playback-abort.feature`: **6/6**.
  - `BL-844-hands-free-session-state-machine.feature`: **14/14**.
  - `BL-845-offline-hey-bubble-wake.feature`: **13/13**.
  Each drives the REAL `gradlew :app:testDebugUnitTest` task via the
  shared `androidGradle.js` helper and asserts the specific,
  coder-authored JVM test claimed by each scenario actually exists and
  passed (BL-769/BL-826 pattern — never a passthrough on test names alone)
  plus each ticket's own `required_wiring` check against the live Kotlin
  sources.
- **Full JVM unit suite, clean rebuild** (`rm -rf android/app/build
  android/.gradle` first, per the BL-829 staleness lesson — a merge that
  touches `res/`/sources can leave a stale `R-def.txt`/incremental state
  behind): `JAVA_HOME=.../tooling/jdk-17 android/gradlew -p android
  :app:testDebugUnitTest` — **BUILD SUCCESSFUL, 27/27 tasks executed
  fresh** (not up-to-date/cached). Every one of the ~50 test report XML
  files under `android/app/build/test-results` shows `failures="0"
  errors="0"`, including every test class this batch's three tickets
  touch: `BargeInDetectorTest` (20), `BargeInDetectorPropertyTest` (7),
  `WakeSpotterTest` (15), `WakeSpotterPropertyTest` (6),
  `HandsFreeSessionTest` (22), `HandsFreeSessionPropertyTest` (7),
  `HandsFreeReArmGateTest` (9), `HandsFreeReArmGatePropertyTest` (5).
- Build artifacts (`android/app/build`, `android/.gradle`) removed after
  verification — both gitignored, nothing tracked was left behind.

## Verdict

All three tickets' Kotlin implementation and its JVM-level test coverage
were already correct and complete when this pass received them — no code
change was needed to satisfy the Bubble testability-boundary gate, which
this pass genuinely ran (not assumed) via a clean rebuild. Forwarding all
three, unchanged, to documenter — a hardening pass that finds nothing to
harden must still forward the parcel, not stall the pipeline (per this
role's own "no-op hardening" duty).

— By hardender.
