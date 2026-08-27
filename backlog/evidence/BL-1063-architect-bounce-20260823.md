# BL-1063 — architect bounce

Received from cleaner as `merge_and_process cleaner c2317497ea` (a plain merge
of coder's commit `6c4eda981` into the cleaner branch — no cleaner-authored
cleanup diff on top, confirmed by the merge's own diffstat carrying only the
coder's files).

## D1 — the fix reintroduces the exact defect it exists to remove, just inverted

**Class:** `behavior` (correctness defect, visible in the diff, not an
architecture-gate finding).

**Claim.** The ticket's entire second defect is that the old assertion
demanded node resolve from the fake nvm tree *unconditionally*, which is
wrong "exactly because production is correct" on a host that carries a
system node — the assertion's verdict depended on a host fact it should not
have depended on. The fix's own stated goal, verbatim from the ticket: *"the
file's verdict must not depend on whether the HOST carries a system node."*

The fix does not meet that goal. Every "caller resolves node" fixture this
parcel adds hardcodes the literal `/usr/bin:/bin` as if it deterministically
resolves node — but whether it does is itself a host fact (true here, false
on "the nvm-only macOS box where [the original test] was authored," per the
ticket's own description). The parcel builds a deterministic farm for the
**"does not resolve"** half (`nodelessCallerPath()` / `nodelessPath()`,
symlinking the real search path minus `node`, then asserting its own premise
before use) but never builds the mirror-image farm for the **"resolves"**
half — it just assumes `/usr/bin:/bin` will do, which is precisely the
assumption invariant 1's whole narrative says cannot be made.

**Four sites, same root cause:**

1. `extension/test/bl796NvmNodePathFollowUpAdoptInvariants.property.test.js`,
   invariant 1's `callerResolvesNode: true` branch (the actual file the
   ticket names) — **no premise check at all**. On a host without a system
   node this fails with a wrong-looking assertion (`lines[1]` equal to an
   empty string), not even a clear message about why.
2. `extension/test/bl1063BoundedWaitInvariants.property.test.js`, **P5**
   (the ticket's own new invariant-2 property) — has a premise check
   (`assert.equal(probe.status === 0, callerResolvesNode, ...)`), so it fails
   with a clear message instead of a wrong one, but it still **fails** on
   such a host. The comment right above it even names the risk ("otherwise a
   host without a system node would silently make both rows the same
   case") without resolving it — the check catches the case, it doesn't
   prevent it.
3. `specs/pipeline/steps/bl1063BoundedWaitSteps.js` line 296-299 (scenario
   04's `"resolves"` row, and reused by scenario 06's `"carries"` row) — no
   premise check. **Empirically confirmed**: temporarily forced this step to
   route the "resolves" row through `nodelessPath()` (simulating a host with
   no system node) and reran the acceptance feature —
   scenario 04's row 1 failed: `expected the caller's own node, got the nvm
   tree: .../v22.1.0/bin/node`. Reverted immediately after (`git diff`
   confirmed empty).
4. `specs/pipeline/steps/bl1063BoundedWaitSteps.js` line 301-308 (scenario
   05) — has a premise check (`assert.equal(probe.status, 0, 'this scenario
   requires a host whose ordinary PATH resolves node')`) and would fail loud
   on such a host, same shape as site 2.

**Scenario 06 is NOT part of this defect** — its final assertion
(`invariant 1 passes`, line 367-374) deliberately checks only that bb and
node resolve to *some* real path, never asserting origin, so it passes on
both host shapes regardless of what `/usr/bin:/bin` contains. That is the
correct pattern; sites 1, 3 (row "resolves") and, more weakly, 2 and 4 (which
at least fail with a named premise rather than a wrong assertion) are not.

**Why this is the same class, not a nitpick.** BL-1063 exists because BL-796
bound a host fact (absence of a system node) into an assertion. The fix
binds the *opposite* host fact (presence of a system node in `/usr/bin` or
`/bin`) into four new assertions/checks the same way. On the CI/dev host used
for this pass (which has `/usr/bin/node`), every one of these sites is
green — which is exactly how the original bug hid for as long as it did.

## Non-vacuity of this finding (verified, not asserted)

Ran the acceptance feature with site 3's step handler forced onto the
nodeless farm for the "resolves" row: **7/8**, failing exactly where
predicted. Reran the unmodified nvm-PATH property test
(`bl796NvmNodePathFollowUpAdoptInvariants.property.test.js`) with the
equivalent forced substitution at its own `callerPath` assignment: **1/3
failed**, error `expected the caller's own node ("") to be used unshadowed
... got: .../v22.1.0/bin/node` — the caller-side probe correctly computed an
empty resolution (no system node simulated) while production correctly fell
back to nvm, and the test wrongly demanded they match. Both reverted
immediately (`git diff` confirmed empty both times) before this evidence was
written.

## Remediation (direction, not mandate)

Build a **"caller resolves" farm**, the mirror of `nodelessCallerPath()` /
`nodelessPath()`: a directory containing a real, deterministic `node` stub
(same technique the file already uses for the `bb` stub via
`makeStubNamed`/inline stub-writing) plus the rest of the ordinary search
path (so nothing else breaks), reused across all four sites the way the
nodeless farm already is. Assert equality against the **known stub path**,
not a live `command -v node` query against a literal that may or may not
resolve on the current host. That removes the need for a premise check
entirely (sites 2 and 4) and fixes the silent wrong-assertion sites (1 and
3) the same way — matching the rigor already correctly applied to the
"does not resolve" half everywhere in this parcel.

## Also checked, no other findings

- **required_wiring**: `specs/pipeline/steps/index.js` registers
  `bl1063BoundedWaitSteps` — present, correct.
- **Scope**: `swarmforge/scripts/operator_path_lib.sh` and
  `start_handoff_daemon.sh` are untouched (`git diff` empty on both) —
  matches the ticket's explicit "not in this slice."
- **Dependency-gate (BL-259)**: full-repo scan — only the pre-existing,
  already-ticketed BL-759 `acyclic` cycle (this parcel touches none of the
  three files in it).
- **Co-change (BL-255)**: no coupling beyond this ticket's own touched-files
  set.
- **The race fix itself (defect 1, `waitForFileSync`)**: reviewed
  independently of the above — bounded, returns early, checks readiness not
  mere existence, synchronous by design for the sync fast-check callbacks,
  clamps the final poll so it never overshoots the deadline. No issue found.
  `bl1063BoundedWaitInvariants.property.test.js` P1-P4 (the race-fix
  properties) are unaffected by D1 and were not part of this bounce.
- **Invariants Review**: invariant 1 (bounded wait) is correctly encoded and
  non-vacuous (P1-P4). Invariant 2 (resolvability not origin) is correctly
  *named* by P5/scenario 05/06's assertions, but P5 and the two acceptance
  sites carry the fixture defect above, which is D1 — not a second,
  independent invariant gap.

## Verdict

NOT FORWARDED. One correctness defect (D1, four sites, one root cause) sent
back to the coder. This is a complete review pass (Article 4.4): every check
this role owns was run to completion before this bounce was written.
