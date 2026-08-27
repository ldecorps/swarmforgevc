# Bubble caches the bridge's companion packages, offline-first (BL-907)

Bubble no longer needs a live bridge connection to show the `backlog` and
`docs` companion packages (BL-866's `/companion-manifest` +
`/companion-package/<name>` contract). It syncs them to the device, serves
reads from what it holds, and labels every read with the generation it was
fetched at. This is the phone-side slice of epic BL-865 (Bubble offline-first
sync); BL-908 builds the browse UI on top of what this ticket stores.

## The pieces

- **`CompanionPackageSync`** (pure Kotlin, no `android.*` type in any
  signature — the Bubble testability boundary, BL-769) owns every sync/cache
  decision: what generation to request for an already-held package
  (`requestedGeneration`), what a read answers before and after a package is
  held (`read`), and what a fetch outcome does to what's already held
  (`applyFetch`). Covered by the JVM unit suite
  (`./gradlew :app:testDebugUnitTest`) plus two BL-654 property tests
  (`CompanionPackageSyncPropertyTest`) proving the two invariants below hold
  across generated fetch/held combinations, not just the handful of example
  cases in the unit tests.
- **`CompanionPackageStore`** (device-surface: `Context`, file I/O) wires
  those decisions to real storage — one JSON file per package under
  app-private storage (`filesDir/companion-packages/<name>.json`), written
  atomically (temp file, then rename) so a sync that dies mid-write never
  corrupts the previous complete copy. `sync(ctx, baseUrl, token)` fetches
  the manifest, then each advertised package at its currently-held
  generation, and reports which packages synced and which failed.
- **`BridgeClient`** gained `fetchCompanionManifest` and
  `fetchCompanionPackage`, parsing BL-866's manifest/package responses
  (including the `304`/`etag` "unchanged" case and each of the failure
  shapes: unknown package, unreadable package, connection failure,
  interrupted transfer) into the sealed `CompanionPackageFetch` outcomes
  `CompanionPackageSync.applyFetch` consumes.

## The two invariants

1. **A held package and its generation always come from the same fetch.**
   `applyFetch` only ever replaces a package's generation, format,
   formatVersion, and data together, in one `HeldPackage` record — never a
   new generation paired with old data or vice versa.
2. **No sync outcome leaves the device holding less than it held before.**
   Every non-`Ok` fetch outcome (unchanged, unknown package, unreadable
   package, connection failure, interrupted transfer) returns the
   already-held copy unchanged and reports a `SyncFailure`; only a
   successful fetch replaces what's held. An unreachable manifest reports
   every currently-held package as failed and touches none of them.

Before any package has ever synced, a read answers `NothingHeld` rather than
an empty package — Bubble never presents "nothing held" as "empty content."

## Verifying it (device-surface — no JVM suite coverage here)

The decisions above are proven by the unit and property suites. The storage
and lifecycle wiring is device-surface (per the Testability Boundary — see
`docs/how-to/BL-769-android-jvm-unit-suite.md`) and is verified by this
recorded manual procedure, Bubble paired to a live bridge:

1. Fresh install, before any sync — a read reports nothing held, not an
   empty package.
2. Sync — both `backlog` and `docs` are held, each labelled with the
   generation `GET /companion-manifest` advertised on the host.
3. Sync again with nothing changed on the host — same generations, no body
   on the wire (a `304`, not just a successful-looking sync).
4. Change the backlog on the host so its generation moves, sync — the new
   body lands and the label moves with it.
5. Airplane mode, read both packages — the cached bodies come back, each
   still labelled at its own generation.
6. Stop the bridge, sync — the refresh failure is reported and both packages
   are still readable at their previous generations.
7. Make one package source unreadable on the host (BL-866 answers `503`),
   sync — the failure is reported for that package only, its previously
   held copy stays intact, and the other package refreshes normally.

## Not in this slice

- Any browse UI over the cached packages (BL-908 reads what this slice
  stores).
- The offline groom mutation outbox (write path) — a later BL-865 slice.
- Packages beyond `backlog` and `docs` — each new corpus root is bridge-side
  work of its own.
- Protobuf — deferred by the human; this is the REST + JSON contract BL-866
  already shipped.
