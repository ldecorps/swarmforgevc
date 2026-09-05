# AMENDMENT (INCORPORATED 2026-09-05): A standing red is never swept under the carpet

Ratified by the human's "go" on 2026-09-05. Three articles carry one line
each (3.2.4, 3.5, 4.2); this file is the full text, the evidence, and the
human's own words, kept verbatim because the rule has to answer them
(Article 5.3).

## 1. The human's words

Human, in the specifier pane, 2026-09-05:

> "is something being done for tests failing but not raising any concerns
> that's not healthy. QA should observe the boyscoot rule? how does this
> work in practice? shoud we keep an epic of debt where we have failing
> tests that are treated as ok? i would be more of the school of.stoping
> everything and fix failing tests before doing anything else. this is tol
> naive and extreem but my point is that we should not sweep failing tests
> under the carpet."

To the specifier's three-piece proposal, thresholds 10 reds or 7 days,
cap to 1: "go".

Human, 2026-08-05, via the BL-816 intake (that ticket is superseded by
BL-1428 and retired; its sentence survives here):

> "Surface the meta-defect: QA/hardener/coder parcels that observe a red
> `npm test` and proceed with 'unrelated / environmental, not bouncing'
> leave the safety signal broken."

## 2. What was true on 2026-09-05

| Measure | Count |
|---|---|
| Property allowlist rows, all "tracked under BL-1175 pending fix", BL-1175 closed | 25 |
| Of those, red when run alone | 20 |
| Of those, green and still listed | 5 |
| Unit test files red (`npx vitest run`) | 7 (26 tests) |
| Reds with an open owner ticket | 25 of 27 |
| Owner tickets, all paused, all `severity: medium` or `low`, 6-8 days old | 8 |
| Reds with no owner anywhere | 2 |
| Evidence files that day saying "pre-existing" | 35 |
| Standing bb suite runs since 2026-09-02 (inventory refused, BL-1423) | 0 |

The rules in force were followed: a red outside the parcel is presumed
ticketed until grepped (QA prompt, BL-1063); the hardener may measure
through an unowned red but must surface it; BL-816 asked for a recorded
decision and sat approved and unpromoted for a month. Nothing in that set
moved a fix. The coder in the human's screenshot did exactly what the
rule said - "Only the known pre-existing scenario 07 fails" - and that
scenario (`test_property_suite_drift_guard.sh` case 07, red since
BL-1252 on 2026-08-30) had an owner, BL-1409, paused for six days.

## 3. The rule, in full

1. **A standing red is a defect, severity high, at first sighting.** A test
   that fails on `main` in any lane (unit, property, bb, shell,
   acceptance) is a broken safety signal. The first role to observe it
   with no open owner sends the specifier a priority-`00` note
   (`unowned-red`); the specifier mints `type: defect`, `severity: high`
   the same pass, so the fix rides Article 3.2.4's expedite lane ahead of
   every feature. A ticket that already owns a red is re-classed to
   `severity: high` if it is not. Retiring a red test that asserts retired
   behaviour is a legitimate fix (BL-1006, Article 3.6), never rewording it.
2. **The register.** `backlog/standing-reds.tsv`, the property-suite
   allowlist, and the hardening-debt ledger are the only places a
   tolerated red may be recorded; a row names an OPEN ticket. BL-1428
   builds the one reader and a cheap-tier commit guard that refuses a
   commit adding or changing a row without an open ticket; rows a commit
   does not touch never refuse it. A land that turns a test green removes
   its row in the same commit.
3. **QA approves no parcel over an unowned red** (Article 4.2). QA's
   evidence names every standing red it met with the ticket that owns it;
   a red with no open ticket withholds approval until the specifier's
   ticket exists (a `note`, never a parcel bounce - the parcel did not
   cause it). This is BL-816's "record a decision" with the decision made
   mechanical: the decision is the owner's id.
4. **Standing reds throttle intake** (Article 3.5). BL-1429 folds the
   register into BL-432's throttle recommendation: more than
   `standing_red_max_count` (10) reds, an oldest red older than
   `standing_red_max_age_days` (7), or any unowned red recommends a cap of
   1; the lower of the rework and standing-red recommendations wins; the
   recommendation is withdrawn when the register is back under every
   threshold. This is "stop everything and fix failing tests", made
   proportional: with 27 reds registered on 2026-09-05, the cap drops to 1
   the moment BL-1429 lands and stays there until the expedited owner
   tickets bring the register under 10.
5. **Boy Scout for QA, in practice.** QA does not fix what it finds: the
   task-scope gate refuses out-of-scope edits (BL-1192/BL-1276), and
   cross-ticket edits inside a parcel produced the last two land
   deadlocks. QA refuses instead (rule 3). The Boy Scout epic (BL-1013)
   remains the on-demand path for debt that is not a red.
6. **No epic of debt.** The register is the debt list, with an owner per
   row and an age; an epic without a cap and an age is another carpet.

## 4. What this supersedes

- BL-816 (approved 2026-08-05, never promoted): retired
  `closed_as: superseded-by-BL-1428`; its draft feature file is removed.
- The allowlist rows' "tracked under BL-1175" rationale: re-pointed by
  BL-1428 to the real owners recorded in the register.
- The "Transition" bullet of Article 3.2.4 (legacy `type: bug` matching)
  moved from the boot-inlined article to
  `expedite-defects-amendment-2026-07-25.md` §3.1, where its evidence
  already lived, to keep the boot prefix under budget (BL-859).

## 5. Where it lands

- `03_backlog.md` §3.2.4 (one bullet), §3.5 (signal list).
- `04_quality_gates.md` §4.2 (one bullet).
- `roles/QA.prompt`, `roles/hardender.prompt`, `roles/coder.prompt`,
  `roles/coordinator.prompt`, `roles/specifier.prompt` (one paragraph each).
- Tickets: BL-1428 (register, guard, allowlist clean-up), BL-1429
  (throttle signal), BL-1430 (the unowned bl874 red); BL-1206 gains the
  unowned bl1200 red; BL-1206, BL-1212, BL-1221, BL-1229, BL-1263, BL-1289,
  BL-1290, BL-1291 re-classed `severity: high`.
