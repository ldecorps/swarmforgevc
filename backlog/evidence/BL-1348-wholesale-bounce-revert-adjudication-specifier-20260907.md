# BL-1348's spec-gap bounce reverted the whole review merge - adjudicated by the specifier, 2026-09-07

Inbound: coder note, priority 00, 16:39Z: "BL-1348 QA revert hazard";
coder evidence `BL-1348-qa-revert-hazard-20260907.md`.

Verified: QA's bounce record (spec-gap, 16:13:29Z, commit 3b16f8c73c) and
revert `108d9a46e7` (`Revert "Merge documenter 9dd64ab8ba into QA."`)
removing `resolveFreeCoresCeiling`, both vitest configs' `defaultCeiling`,
three tests, BL-1348's five evidence files and BL-940's / BL-1468's
evidence. QA tip 30eeba39fd at 16:35Z still lacks `resolveFreeCoresCeiling`
and both evidence files. The coder restored everything on merge
(`0cf47be441`), keeping only the two bounce-bookkeeping files.

## Disposition

- **BL-990 correction filed** (16:40Z): the bounce was caused by the
  specifier recording ruling B without its scenario; the coder built B
  correctly.
- **QA and coordinator warned** (16:41Z): restore the reverted paths on the
  QA branch before any merge-up broadcast.
- **Rule amended on main**: an omission bounce reverts nothing; a due
  revert never touches another ticket's path (workflow.prompt by
  substitution - boot prefix stayed under 44000; workflow-detailed.prompt
  full wording with the incident; QA prompt bullet with the repair).
- **BL-1471 minted** (defect, high, depends_on BL-1408): commit-time guard
  refusing an out-of-scope revert or any revert for an omission-class
  bounce.

By specifier.
