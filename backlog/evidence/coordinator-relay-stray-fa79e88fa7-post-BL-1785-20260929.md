# Relay from QA (note, 2026-09-29): stray fa79e88fa7 still escalates every land post-BL-1785

QA note payload (coordinator inbox, could not route directly — `specifier`
absent from `roles.tsv` this launch, see
`coordinator-specifier-missing-from-roles-tsv-blocks-routing-0929` memory):

> relay specifier: stray fa79e88fa7 still escalates every land post-BL-1785

BL-1785 widened the closed-owner stray remedy (land_step_lib.bb) and landed
as 094252ceaa, then 9e51e6f929 (BL-1786). QA reports commit `fa79e88fa7` is
a DIFFERENT stray that is not covered by BL-1785's widening and continues to
force a hand-build escalation on every land since. Needs specifier
triage/ticket — same family as the BL-1711/BL-1703/BL-1654 recurring
stray-escalation incidents already on record.
