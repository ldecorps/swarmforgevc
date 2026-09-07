# BL-1470 — land escalate: bounced sibling shares a replayed path

Verification passed cleanly (`BL-1470-QA-20260907.md`): acceptance 6/6
(own feature), `land_step_lib_test_runner.bb` and
`bl1470_bounce_check_shared_store_property_runner.bb` both green,
BL-1466's own 4 scenarios stay green, full unit suite 611/611 (one
pre-existing unrelated red, `bridgeServer.test.js`, already registered
`BL-1460`), property suite clean on isolation reruns (4 files flaked on
contention alone, confirmed passing standalone) — approved.

At land: `bb swarmforge/scripts/land_step_cli.bb BL-1470 1fe15b0e2c`
returned `LAND_ESCALATE`, naming 9 `ENTANGLED_SIBLING` tickets
(BL-1348, BL-1408, BL-1444, BL-1463, BL-1466, BL-1468, BL-1479, BL-940,
BL-968), with reason:

> land-step: refusing to replay BL-1470 - docs/reference/Specification.MD
> is shared with unlanded sibling(s) BL-1348 (bounced: BL-1348 bounced
> 2026-09-07T16:40:46.096Z at 3b16f8c73c, not re-fixed), and a replayed
> path is taken whole, so landing it would carry the sibling's lines into
> main (BL-1332/BL-1375)

This is BL-1470's OWN fix working as intended (BL-1466's bounce check,
restored to reading the shared store by this very ticket) — it is
correctly refusing to replay `docs/reference/Specification.MD` because
BL-1348 (still bounced, un-refixed) shares that path and a replay takes a
shared path whole. Not a defect in BL-1470's own work; a real conflict
this land step cannot resolve on its own (BL-1332/BL-1375's stated
posture for a bounced-sibling shared path).

Per QA.prompt's LAND_ESCALATE routing: not a bounce to the author (no
role can un-bounce BL-1348 by rebuilding BL-1470's tip), not re-running
by hand. Escalating once, naming the conflicting path and the bounced
sibling.

By QA.
