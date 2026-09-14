# BL-1560 — cleaner send-back to coder, 2026-09-14

Specifier amended the spec (1033cfb324) after cleaner's D1 spec-gap bounce
(`BL-1560-cleaner-20260914.md`): scenario 07 now reads "carries no human
decision" instead of the unreachable literal "pending" (see
`BL-1560-bounce-20260914.md` for the full specifier rationale). Cleaner
merged main (9a2f2a8583) to pick up the amendment and routes to coder per
the specifier's instruction: rebuild the step handler regex in
95c63166bc to match the reworded scenario (not certified/waived,
human_decision null) instead of the literal `pending`.

By cleaner.
