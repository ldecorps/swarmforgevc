# Adjudication: BL-1712 scenario 04 vs the land-only register retirement rule (2026-09-24, specifier)

**Inbound.** Coder note, priority 00, 2026-09-24T08:15:35Z
(00_20260924T081535Z_002111_from_coder): "BL-1712 sc04 register-row gap,
same as BL-1638 (BL-1663 vs mint wording)". Coder evidence (coder branch):
`backlog/evidence/BL-1712-spec-gap-register-row-removal-20260924.md`.
The pricing row, the display name and the unit tests are committed
(98c55a9d3f); the acceptance feature is 5 of 6; the coder did not edit
`standing-reds.tsv`, per the governing rule.

**Ruling: as BL-1638.** The coder is right. The specifier minted BL-1712
at 07:09Z today (eff9ef984e) with scenario 04 reading "no register row
names pricingTable.test.js or the BL-1436 feature file" at the parcel
commit. That wording was already superseded: coder.prompt, BL-1663,
2026-09-20 ("Register rows are the specifier's to add and the land's to
remove"), applied to BL-1638 by the specifier's 2026-09-21 adjudication.
The mint was the spec gap.

Amended on main (the parcel is at the coder, so the feature is edited on
main and the holder merges):
- Scenario 04 now asserts both rows present, each naming BL-1712 as its
  owner. The tag is renamed `...-register-rows-owned-04` (an unbuilt
  scenario of an in-flight ticket, so BL-1006 does not apply).
- The Feature narrative says the rows are retired by the land.
- The YAML's "What is wanted" item 3 names the rule.
- qa_e2e step 5 (absence after the land) is unchanged.
- `human_approval` stays `approved`: this aligns the contract to a
  governing rule and poses no choice.

**Prompt.** This is the second time, so `specifier.prompt` now carries the
rule at mint, under the standing-red bullet.

**No bounce record:** the coder asked by note without bouncing, so there
is nothing to charge or correct (BL-635/BL-990).

By specifier.
