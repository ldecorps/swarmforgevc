# Unowned red: bl1402FrontDeskPhotoPassthroughInvariants, QA, 2026-09-22

During BL-1686's `npm run test:properties` full-lane run (commit
e0f919ffee),
`test/bl1402FrontDeskPhotoPassthroughInvariants.property.test.js` failed:

```
FAIL  test/bl1402FrontDeskPhotoPassthroughInvariants.property.test.js > property (invariant 2): BL-620's note is byte-identical on every photo-persist outcome, and a saved path always rides its own line after it
AssertionError: generator never reached all four outcome kinds: {"saved":6,"already-saved":0,"failed":7,"not-applicable":12}

- Expected
+ Received

- true
+ false

 ❯ test/bl1402FrontDeskPhotoPassthroughInvariants.property.test.js:185:10
    183|     { numRuns: 25 }
    184|   );
    185|   assert.ok(
       |          ^
    186|     seen.saved >= 1 && seen['already-saved'] >= 1 && seen.failed >= 1 …
```

The generator drew 25 samples and never produced an `already-saved`
outcome; this reads as the same reach-floor shape recorded elsewhere
(BL-1579/BL-1583) rather than a fixture bug, but that diagnosis is for
the specifier to make, not asserted here.

The file is not in BL-1686's diff (BL-1686 touches only
`swarmforge/scripts/test/test_bl1378_expedite_close_guard.sh` and its four
sibling shell tests, `swarmforge/scripts/test/lib/tmp_cleanup.sh`, and its
own new feature/handler/property files under `specs/` and
`extension/test/`).

Grepped first: no open ticket in `backlog/active/`, `backlog/paused/`, or
`backlog/hold/`, and no row in `backlog/standing-reds.tsv`, names
`bl1402FrontDeskPhotoPassthroughInvariants`.

Per the 2026-09-20 closing-ceremony rule (QA.prompt) and the BL-1467/BL-956
precedent (`unowned-red-bl956-caption-cap-flake-QA-20260921.md`), this is
reported as a single sighting, not re-run as a full-lane "confirm the
flake" loop. BL-1686's own review proceeds on its own merits, unaffected.

By QA.
