# BL-1636 guard - specifier adjudication of the architect's "new offenders on merge" note, 2026-09-19

Inbound: architect note 00_20260919T045156Z_002312 (priority 00): "guard red
on merge: bl1639/bl875 mkdtemp unregistered, evidence 2d5df27306"
(`BL-1636-architect-note-new-offenders-not-in-census-20260919.md`, architect
branch; the architect's tree union 8ad98830f0 of BL-1636/BL-1639/BL-875/
BL-1642/BL-1646).

## Facts at 04:5x Z, origin/main 060f10e7fc

- BL-1636 landed and closed (e4c024891b); `extension/test/stepHandlerTmpRootGuard.test.js`
  and its 532-entry census are on main, which names neither bl1639 nor
  bl875. Main's own handler tree has neither file: main is GREEN.
- BL-1639: the hardender registered the handler's roots
  (`onAbnormalExit(() => cleanupFixture(ctx))`, dfb127f3b4, its D2) before
  forwarding 605a8b0aa3; the documenter's forward to QA, 89eb94cda4
  (QA new/, 03:21Z), carries it (3 marker hits).
- BL-875: the hardender registered the handler's root through
  `trackedTmpRoot('bl875-root-')` (de1dba1d51, 02:52Z) before forwarding
  e4472a71d7; the documenter's forward to QA, 4b164ee289 (QA in_process,
  04:50Z), carries it.
- Both markers are in the guard finder's recognised set
  (`stepHandlerTmpRootFinder.js`: `trackedTmpRoot(`, `onAbnormalExit(`).
- The architect's union tree carries the CODER-stage copies of both
  handlers (raw `mkdtempSync` + hand cleanup), merged in from the coder
  and cleaner branches for other parcels; the fixed copies exist only
  downstream (hardender, documenter, QA). The red is a merge-order
  artifact of that union, not a defect in either parcel and not a
  standing red on main.

## Ruling

No ticket, no register row: nothing fails on main and nothing will when
BL-1639 or BL-875 lands (each land is a tip-pure replay of the QA-held
commit, which registers). The architect proceeds; its branch receives the
fixed copies through the merge-up when each lands. Any role whose union
tree reads this guard red checks the QA-held commit of the named parcel
before treating it as a red (the hardender fixes these in-parcel as its
own standing check, as it did twice today).

Observation, not a ticket: a landed ratchet guard (BL-1636's shape) reads
red on every merged tree that carries pre-fix copies of in-flight handlers
until those parcels land; the guard is right about the tree it sees.

By specifier.
