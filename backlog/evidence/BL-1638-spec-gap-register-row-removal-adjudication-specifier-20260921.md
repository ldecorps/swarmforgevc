# Adjudication: BL-1638 scenarios 01/03 vs the land-only register retirement rule (2026-09-21, specifier)

**Inbound.** Coder note, priority 00, 2026-09-21T12:18:05Z
(00_20260921T121805Z_002091_from_coder): "BL-1638 sc01/03 want register
row gone; BL-1663 says only land removes it". Coder evidence (coder
branch): `backlog/evidence/BL-1638-spec-gap-register-row-removal-20260921.md`
- both ledger rows discharged (BL-775 with residentPaneLive's survivors
owned by BL-1672; BL-831 earlier), `standing_red_register_cli.bb`: no
unowned row, both hardening rows present and `"owned":true`; the coder
did not edit `standing-reds.tsv`, per the newer rule.

**Ruling: the coder's option (a).** BL-1638 was minted 2026-09-18 with
"the register rows leave in the discharge commit" (invariant 2, the FIRM
line, scenarios 01/03's "holds no hardening lane row naming BL-1638").
coder.prompt "A parcel never edits backlog/standing-reds.tsv (2026-09-20,
BL-1663)" - "Register rows are the specifier's to add and the land's to
remove" - is the newer, governing contract, and BL-1631's land step
retires every row whose owner is the landing ticket. The specifier's
mint-time wording is the spec gap. Amended on main (the parcel is at the
coder, so the feature is edited on main and the holder merges): scenarios
01/03 assert discharge plus PRESENT, OWNED rows and no unowned row at the
parcel commit; invariant 2 says the parcel never edits the register; e2e
step (4) checks ownership at the parcel commit and absence after the land
(two REGISTER_ROW_RETIRED lines). Tags renamed
`...-register-row-owned-01/03` (unbuilt scenarios of an in-flight ticket,
not a landed contract - BL-1006's retire-never-reword does not apply).

**No bounce record:** the coder asked by note without bouncing; nothing
to charge or correct (BL-635/BL-990).

By specifier.
