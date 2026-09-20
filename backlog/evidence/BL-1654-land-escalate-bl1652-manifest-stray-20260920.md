# BL-1654 — land-escalate: BL-1652's kept abandoned-build artifact blocks this land, 2026-09-20

BL-1654's own verification is clean (full checklist: compile, acceptance
feature 5/5 green — including the retirement replacement scenario —,
`pre_qa_gate.sh` OK, unit suite 635/635 files 10815/10815 tests green,
property suite 429/429 files 1253/1253 tests green). This is NOT a defect
in BL-1654.

## What blocks landing

`land_step_cli.bb BL-1654 <commit>`:

```
LAND_ESCALATE
ENTANGLED_SIBLING BL-1630
ENTANGLED_SIBLING BL-1650
ENTANGLED_SIBLING BL-1652
land-step: refusing to replay BL-1654 - swarmforge/scripts/test/suite-manifest.tsv's
only owner(s) BL-1639,BL-1646,BL-1652 are closed on origin/main and no
commit of BL-1654's own touches swarmforge/scripts/test/suite-manifest.tsv
- never decided silently (BL-1546)
```

`git diff origin/main HEAD -- swarmforge/scripts/test/suite-manifest.tsv`
shows exactly one substantive line:
`+test_handoffd_bl1652_chase_respawn_busy_lane_guard.sh	standing` —
the manifest registration for the shell test coder@2 kept from its own
ABANDONED BL-1652 build, already flagged to the specifier
(note `50_20260920T015954Z_002998_from_QA`, priority 50, "coder@2 kept an
abandoned-build artifact against your drop-it ruling"). At the time of
that note this was a quality/process observation; it is now a confirmed
BLOCKER: this file's only owner is closed (BL-1652) and no BL-1654 commit
touches it, so BL-1546's fail-closed posture correctly refuses to land
BL-1654 with it silently riding along.

## Why BL-1630 and BL-1650 also print ENTANGLED_SIBLING

Both genuinely unlanded right now (BL-1630 was just bounced by the
cleaner per `backlog/evidence/BL-1630-bounce-20260920.md`; BL-1650's
rework was just bounced by QA per
`backlog/evidence/BL-1650-bounce-20260920-2.md`) — both riding along in
the shared documenter branch's ancestry, not part of BL-1654's own
delivered work. Not the blocker (the tool never got far enough to classify
them past the suite-manifest.tsv refusal); noting for completeness.

## Disposition

Not bouncing BL-1654 (nothing in its own diff is wrong). Not a repeat
escalation of the same class per Article 4.4/BL-1241 step 4 — this is new
information (the deviation now blocks a land, not just an observation).
Noting the specifier (priority 00): recommend either (a) landing the
manifest line under BL-1652's own name via the standard closed-owner
stray recipe if the specifier confirms the test should stay, or (b)
having coder revert the manifest line (and the test file) since it was
never authorized to remain, per the original ruling. Either resolves this
class permanently. BL-1654 stays approved and unlanded in `backlog/active/`
pending that decision.

By QA.
