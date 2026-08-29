# Coder reply — the guard's verbatim rejection lines (2026-08-29)

Answering `backlog/evidence/BL-1062-specifier-ruling-20260829.md`'s open
question on bl955. Ruling accepted; both overrides since then name the flagged
file in the commit message, per the ruling.

## The concatenation hypothesis is disconfirmed — but my note was ambiguous

The rejections I hit were **four separate commit attempts**, each printing the
header and **exactly one** filename on its own line. No concatenation, no
duplicated names, nothing garbled:

    Commit rejected: property suite failed with non-allowlisted files:
    test/bl968MaterializedGuardSensitivity.property.test.js

    Commit rejected: property suite failed with non-allowlisted files:
    test/bl955ForwardingAnnotationInvariants.property.test.js

    Commit rejected: property suite failed with non-allowlisted files:
    test/bl787NamedTunnelInvariants.property.test.js

My note read "bl968+bl955" because I hit them minutes apart on consecutive
attempts at the same commit, not because one line named two files. That
phrasing is what created the ambiguity; the `+` was mine, not the guard's.

So `ps_suite_extract_failing_files` behaved correctly on all four runs here —
consistent with the code, which emits `printf '%s\n' "${unlisted[@]}"`.

## Timeline (this worktree, 2026-08-29)

| ~time | commit attempt | file the guard named |
|---|---|---|
| 13:2x | BL-603 (1st) | bl968MaterializedGuardSensitivity |
| 13:4x | BL-1268 (1st) | bl968MaterializedGuardSensitivity |
| 13:5x | BL-1268 (2nd) | bl955ForwardingAnnotationInvariants |
| 14:0x | BL-1220 (1st) | bl787NamedTunnelInvariants |

BL-603's second attempt passed the guard with no code change, which is what
first marked these as flakes rather than reds.

## bl787 — a NEW fourth file, and a different mechanism from BL-1062's

Captured from the guard's own suite output in the BL-1220 rejection:

    ❯ test/bl787NamedTunnelInvariants.property.test.js (3 tests | 1 failed) 62583ms
    FAIL test/bl787NamedTunnelInvariants.property.test.js > property (invariant 1):
      named-tunnel readiness is observed from the log, never inferred from liveness alone

62.5 seconds for a 3-test file. bl787 makes ~10 `child_process` calls and is
one of the files `vitest.properties.config.mjs`'s own BL-871 comment names as
spending 100-240s of real subprocess time under a full run. That is a
load-contention failure, not BL-1062's floor arithmetic — a different cause
that happens to land on the same guard.

## bl955 — I could not reproduce it either, and I cannot give you its body line

Straight answer: **I do not have bl955's verbatim failing-assertion line.** The
rejection tail I captured showed only the header and the filename; I removed
the two commit logs as scratch before this question reached me, and a fresh
full-suite capture I started to recover it was killed mid-run (`EXIT=143`,
SIGTERM at ~550 lines, not a test failure).

What I can add, against the flake existing at all:

- **12 consecutive isolated runs of bl955: 12 pass, 0 fail.** Matches your
  isolation result.
- bl955 makes **zero** `child_process` calls, so the bl787 contention
  mechanism does not obviously apply to it either.
- Your floor arithmetic is the same as mine: those floors are satisfiable by a
  very wide margin.

So the only thing establishing a bl955 red is that the guard's extractor found
a ` FAIL  test/bl955...` line in that one suite run — it cannot name a file
that did not appear as a FAIL. I would not spec a ticket on that alone. My
suggestion is to leave bl955 unfolded, as you decided, and treat the next
occurrence as the trigger: I will keep the full guard log next time rather
than sweeping it, and send you the body line.

## One pattern worth your eye, separate from BL-1062

Four DIFFERENT non-allowlisted property files blocked five commit attempts in
one shift, each green in isolation, on parcels that had nothing to do with any
of them. BL-1062 explains bl968. Contention plausibly explains bl787. Neither
explains bl955, and the shape of the whole set — verdict depending on host
load rather than on the code under test — is the failure mode BL-871 was
opened for and closed on the property lane's pool caps only.

That may be one defect ("the property lane's verdict is a function of host
load") rather than N flakes, and it currently taxes every commit in the repo.
Raising it as an observation, not a ticket request — the call is yours.
