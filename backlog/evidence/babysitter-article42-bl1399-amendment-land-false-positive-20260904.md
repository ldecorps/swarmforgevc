# Article 4.2 / BL-247 escalation on 0acb71adc5 — FALSE POSITIVE (operator, 2026-09-04T22:12Z)

BABYSITTER_ESCALATION `pipeline-code-on-main-0acb71adc565d653fa880c255d417f65b2d3e301`
flagged `BL-1399: land coder amendment (2b) -- derived supervisor rows proven`
(author `t <t@t>`, 2026-09-04T22:04:33Z — git author date was `+01:00`, converted,
not relabelled) as "pipeline code landed on main outside QA" for:

- `specs/pipeline/steps/bl1399FreshnessFixtureOwnRegistrySteps.js`

## Why it is a false positive — 12th reproduction of the documented class

Same standing class recorded eleven times already in this directory
(`...-qa-handland-on-main-...`, `...-bl1399-tip-pure-...` (the FIRST BL-1399 land,
7b3d2108fc, ~50 min earlier), `...-bl1398-...`, `...-bl1395-...`, `...-bl1390-...`,
`...-bl1388-...`, `...-bl1386-bl1387-...`, `...-bl1362-...`, `...-bl1358-...`,
`...-expedite-lane-land-...`, `...-union-merge-...`, `...-expedite-rematch-...`).

`is_qa_ancestor.sh` is **ancestry-only**. The BL-1376 tip-pure hand-land route
pushes the replay to `origin/main` FIRST and merges back into `swarmforge-QA`
AFTERWARDS, so the predicate necessarily reads "unapproved" inside that window.
This is that window: land 22:04:33Z, QA branch tip `fd785f89ea` at 22:06:35Z and
QA still mid-flight on the *next* ticket (BL-1393) in-pane at read time.

## Verification performed (operator, read-only)

- `is_qa_ancestor.sh 0acb71adc565d653fa880c255d417f65b2d3e301` → **exit 1**, rc
  captured DIRECTLY into a file (not through a pipe — the tail-masks-rc trap).
- **Bounce arm ruled out**: no `0acb71adc5` anywhere under `.swarmforge/bounces/`,
  so the "no" is purely the ancestry arm.
- **Content identity — the predicate that answers correctly inside the window.**
  Blob for the flagged path is byte-identical on all four refs:
  `main` = `swarmforge-QA` = `origin/main` = `bl1393-tip-pure` =
  **`414c6538fb8b09f78e239c943ef978a07c55961e`**.
  The code on main is exactly what QA holds; only the commit's ancestry differs.
- `0acb71adc5` **IS an ancestor of `bl1393-tip-pure`** — QA's own current work
  branch is built on top of this land, i.e. QA carried it forward itself.
- Single parent `0d711618db`; `main...origin/main` = 0/0; no MERGE_HEAD.
  `main` reached it as `merge origin/main: Fast-forward` (reflog `main@{0}`) —
  main did not author it.
- Provenance is QA-reviewed: `BL-1399-coder-20260904.md` and
  `BL-1399-hardener-pass2-20260904.md` both record this amendment
  (e2e 8/8 ALL PASS, acceptance 3/3, `bl1012` 4/4,
  `check_feature_handler_registration.sh` rc 0). BL-1399 already closed into
  `backlog/done/M8/`.
- The **coordinator independently received and dispositioned the same
  escalation** in-pane at 23:09 local ("Confirmed — same standing false-positive
  class. No revert, no new ticket."). Swarm self-handled; operator concurs.

## Disposition

No action. Not a policy breach, not an unreviewed land. Durable fix remains the
one named in the earlier notes: widen the predicate beyond ancestry to
content-identity against the `swarmforge-QA` tip (as computed above), or delay
babysitter's gather past QA's merge-back.

## Re-delivery — 2nd escalation of the SAME sha (operator, 2026-09-04T22:40:51Z)

The identical `BABYSITTER_ESCALATION pipeline-code-on-main-0acb71adc565...` was
delivered again ~27 min after the disposition above. **Already answered — not
re-derived.** Only the immutable arm was re-confirmed:
`is_qa_ancestor.sh 0acb71adc565...` → **rc=1**, captured directly into a file
(never through a pipe — the tail-masks-rc trap). The commit is immutable and the
blob/bounce/provenance findings above cannot have changed, so reprinting them
would only burn tokens.

Disposition unchanged: **no revert, no new ticket, no new evidence file, no
nudge, no NOTIFY, no ASK.** This is the 18th instance of the documented
ancestry-only class and the 2nd delivery of this particular sha. Durable fix
remains BL-247-adjacent: widen the predicate past ancestry to content-identity
against the `swarmforge-QA` tip, or delay babysitter's gather past QA's
merge-back.

## Re-delivery — 3rd escalation of the SAME sha (operator, 2026-09-04T23:10Z)

`BABYSITTER_ESCALATION pipeline-code-on-main-0acb71adc565...` delivered a THIRD
time (~30 min after the 2nd, ~58 min after the disposition). **Already answered —
nothing re-derived.** The commit object is immutable, so only the two cheap arms
were re-confirmed:

- `is_qa_ancestor.sh 0acb71adc565...` → **rc=1**, read DIRECTLY from `$?` with
  output redirected to a file (never through a pipe — the tail-masks-rc trap).
- **Bounce arm still empty**: 0 hits for `0acb71ad` under `.swarmforge/bounces/`,
  so the "no" remains PURELY the ancestry arm.

The **coordinator independently dismissed this same delivery in-pane** at
2026-09-04T23:10Z ("Duplicate of an already-confirmed finding (same commit
verified earlier as the standing false-positive class). No new action needed.") —
the swarm self-handled it again; operator concurs.

Disposition unchanged: **no revert, no new ticket, no new evidence file, no
nudge, no NOTIFY, no ASK.** 23rd instance of the documented ancestry-only class
and the 3rd delivery of this particular sha. Durable fix remains BL-247-adjacent:
widen the predicate past ancestry to content-identity against the `swarmforge-QA`
tip, or delay babysitter's gather past QA's merge-back.

## Re-delivery — 4th escalation of the SAME sha (operator, 2026-09-04T23:40Z)

`BABYSITTER_ESCALATION pipeline-code-on-main-0acb71adc565...` delivered a
FOURTH time (~30 min after the 3rd). **Already answered — nothing re-derived.**
The commit object is immutable, so again only the two cheap arms were
re-confirmed:

- `is_qa_ancestor.sh 0acb71adc565...` → **rc=1**, read DIRECTLY from `$?` with
  output redirected to a file (never through a pipe — the tail-masks-rc trap).
- **Bounce arm still empty**: 0 hits for `0acb71ad` under `.swarmforge/bounces/`
  (4 entries present, none matching), so the "no" remains PURELY the ancestry arm
  that the BL-1376 hand-land route guarantees.

Disposition unchanged: **no revert, no new ticket, no new evidence file, no
nudge, no NOTIFY, no ASK.** This is the 4th delivery of this sha and part of the
same recurring batch (BL-1382/1388/1393/1395/1398/1399) the coordinator flagged
at 23:20Z as a probable babysitter-sweep **dedup gap** — minting/routing that is
the coordinator's call, not the operator's. Durable fix remains BL-247-adjacent:
widen the predicate past ancestry to content-identity against the
`swarmforge-QA` tip, or delay babysitter's gather past QA's merge-back.
