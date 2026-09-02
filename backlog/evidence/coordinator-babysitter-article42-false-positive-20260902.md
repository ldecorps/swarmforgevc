# Coordinator — babysitter Article 4.2 false positive on two land-step replays

Date: 2026-09-02. Babysitter health sweep flagged:
- `d7426989b2` "BL-1301: tip-pure replay onto origin/main (BL-1241 land-step remedy)"
- `c65d8e6728` "BL-1314: tip-pure replay onto origin/main (BL-1241 land-step remedy)"

as pipeline code landed on `main` outside QA (Article 4.2/BL-247).

## Investigation

Both are legitimate QA-approved lands, not a bypass:
- `backlog/evidence/BL-1301-qa-pass-20260902.md` — verdict "APPROVED... By QA.",
  describes running `land_step_cli.bb` for the BL-1241 entangled-sibling
  (BL-1324) remedy and landing the resulting tip-pure replay.
- `backlog/evidence/BL-1314-qa-pass-20260902.md` — same pattern, same
  verdict "APPROVED... By QA.", same `land_step_cli.bb` replay procedure.

Both evidence files landed IN THE SAME COMMIT as the code they describe
(`git show <sha> --stat` includes the evidence file itself), so provenance
is verifiable — just not from the commit message alone.

## Root cause (false positive, not a violation)

`land_step_cli.bb`'s replay commits carry only the bare ticket subject
("BL-XXXX: tip-pure replay onto origin/main (BL-1241 land-step remedy)") —
no "By QA." trailer, no `Co-Authored-By`, nothing a machine gate can grep
for. Every OTHER commit in this repo's history that QA lands carries "By
QA." in the body; these two don't, because the replay mechanism generates
the commit programmatically and never added that stamp.

This is the same root gap that forced me to `--override`
`build_freshness_cli.bb sync` earlier today for `c65d8e6728`
(`qa_approval.approved: false`, same missing-trailer reason) — see
`backlog/evidence/coordinator-main-commit-blocked-bl1324-leak-20260902.md`.
Two independent gates (build-freshness's QA-approval check, and this
babysitter Article 4.2 sweep) both rely on commit-trailer attribution that
`land_step_cli.bb` never writes.

## Minimal correct action taken

None to the commits themselves — both are correct, wanted, QA-approved
content; reverting or altering them would be wrong. Recording this as a
gate-accuracy defect for the specifier to fold into the land-step-replay
work (BL-1298 territory, or its own ticket) — see coordinator note to
specifier, non-blocking priority. No live commit-blocking or data-integrity
issue exists here (unlike the separate BL-1324 leak, which is still open
and blocking `main`).

By coordinator.
