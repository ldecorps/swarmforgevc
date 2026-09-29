# INTAKE — Recruiter: HF scout for local roles (specifier first) + briefing score table

**Source:** human via Cursor, 2026-09-29 ~23:00–23:02 BST, verbatim intent
(Article 5.3 — keep both asks):

1. "new intake: recruiter has to find the best model on hugging face to be the
   local specifier. You know what a good specifier needs as skills, to make it
   search a bunch of candidates and have them put to the test."
2. "actually, it might be a good thing for the recruiter to periodically scout
   for new models to replace the favoured ones. have it publish its score
   table via the documenter / art director in the daily breifing."

**Epic / track:** `local-llm-swarm` (BL-1125). Sibling of the weekly HF
recruiter that already discovers + batteries for **coder**
([`recruiter_weekly.sh`](../swarmforge/scripts/recruiter_weekly.sh) →
[`recruiter_hf_discover.py`](../swarmforge/scripts/recruiter_hf_discover.py) →
BL-1127 coder battery + [`local_model_compliance_battery.py`](../swarmforge/scripts/local_model_compliance_battery.py)).
Also beside BL-1800 (local-model **card** for specifier — compose budget /
deprecator refuse — not model selection). Briefing publish path sits next to
documenter briefing authorship (BL-1458/1459) and Art Director look-and-feel
for the daily briefing email (BL-1417 / BL-1419).

**Priority:** normal. Specifier may queue-jump if packing a local specifier
seat is the next staffing goal; otherwise this is evidence plumbing first.

## What is wrong

Today the weekly recruiter:

1. Picks **one** open-weight GGUF from Hugging Face (trusted orgs, size/quant
   rules, novelty).
2. Pulls it into Ollama and runs the **coder** evidence bar (BL-1127 claim →
   edit → test → handoff) plus a mixed compliance battery that only has a
   thin `specifier-gherkin_scenario` competency among mostly coder probes.
3. Offers a certified **coder** candidate. It never asks "can this model act
   as our specifier?"
4. Does **not** re-challenge models already favoured / staffed — once a local
   alias is good enough, nothing periodic asks "is there now a better one?"
5. Publishes only a one-shot `backlog/evidence/recruiter-weekly-*.md` + an
   Operator Telegram line. The **daily briefing** (`docs/briefings/<date>.md`,
   authored by the documenter, look shaped by the Art Director) never carries
   a standing score table the human can glance at each morning.

So there is no ranked, multi-candidate evidence base for staffing a **local
specifier**, no standing "challenger vs incumbent" scout for favoured local
models, and no briefing surface for the scoreboard. Packs that put a local
model on the specifier window (e.g. `local-model-mono-router.conf`) are
guessing from coder scorecards, or from a single Gherkin keyword check, which
is not what the role does for a living.

## What a good specifier needs (skills to battery)

Direction for the specifier minting this work — bake these into a **specifier
battery** (analogous to BL-1127 for coder), graded against fixtures, not
vibes. Competencies a local specifier seat must survive:

1. **INVEST mint gate** — given a fuzzy intake, refuse or 1:N-split when a
   letter fails; never mint an oversized grab-bag. Checkable: output is
   either a refusal/ask, or one or more ticket sketches each Independent /
   Small / Testable.
2. **Gherkin acceptance** — Given/When/Then of externally visible behavior;
   Scenario Outline columns only when they vary; no implementation in Then.
   (Existing thin `specifier-gherkin_scenario` is a floor, not the bar.)
3. **Feature-file hygiene** — write a `.feature` a `gherkin_lint_gate` can
   parse; IR-DRY clean enough to hand off; `acceptance:` is a path, not
   inline Gherkin.
4. **Invariants discipline** — state 0–3 checkable properties when scenarios
   cannot cover the surface; do not invent filler invariants.
5. **`human_approval: pending` literal** — never a folded block; choice asks
   declare `ruling_options`; high/critical defects use the auto-approve
   carve-out correctly when applicable.
6. **No code / no land** — under pressure to "just fix it", the model stays
   on specs/prompts; does not edit production TS/bb or push.
7. **Reality-check vs live system** — given an old ticket claim + today's
   tree (or a fixture snapshot), say whether the claim still holds and cite
   evidence; prefer close/supersede when unreproduced. (Matches the debt/
   consolidation charter: old tickets must be re-tested, not rubber-stamped.)
8. **Consolidation judgment** — merge / split / retire overlapping intakes
   with a one-line rationale; do not duplicate siblings.
9. **Deprecator: refuse and escalate on local** — Article 3.6 + BL-1800:
   multi-document freshness adjudication is **hard-tier only**. A local
   specifier that tries to amend/retire from weak reasoning fails; the
   correct local behavior is refuse + escalate. Battery must score that
   refuse path as **pass**, and a confident wrong adjudication as **fail**.
10. **Article 5.3** — preserve human-quoted sentences from the intake in
    minted notes/description; do not silently rewrite the ask.

Safety / non-disruption (standing, same as weekly recruiter):

- Recruiter **finds and ranks**; Steward **judges**; human **staffs**.
- Never edit live pack conf, never bounce the healthy swarm, never commit
  from the battery run. A certified specifier candidate is an **offer**.

## What is wanted

Two linked outcomes:

**A — Specifier hunt (first role that lacks a real battery).** Make the
recruiter (or a sibling path) **search a bunch of Hugging Face candidates**
suitable for a local specifier seat, **put each through a specifier-skills
battery**, and produce a ranked report the human can use to pick who staffs
specifier locally.

**B — Periodic challenger scout + daily briefing score table.** Recruiter
**periodically scouts for new models to replace the favoured ones** (incumbent
local aliases already staffed or certified for a role — start with specifier
once A exists; coder can reuse BL-1127 on the same cadence). It keeps a durable
**score table** (role × model × battery result × vs-incumbent delta) and
**publishes that table into the daily briefing** through the existing authorship
split: **documenter** owns the briefing prose/section content; **Art Director**
owns how the table reads on phone/email (layout, not the numbers).

Concrete intent (direction, not a locked design):

1. **Discovery:** reuse HF discovery posture (`recruiter_hf_discover.py`
   allowlist / blocklist / size / Q4_K_M / novelty), but for this hunt run a
   **batch** (N candidates per campaign, operator-tunable — "a bunch", not
   the weekly single pick). Prefer instruct / reasoning / coding-agent
   families that can follow long role cards; still host-fit (params ceiling).
2. **Specifier battery:** new evidence bar (script + fixtures under
   `swarmforge/scripts/` / `model_steward_*`), parallel to BL-1127, that
   grades the competencies above on a scratch tree. Writes
   `backlog/evidence/…-specifier-battery-<provider>-<model>-<stamp>.md`
   with per-competency pass/fail.
3. **Qualify many → rank one role:** score every pulled candidate; rank by
   role battery (capability first, cost/size tie-break), emit a
   recommend-only report + optional steward scorecard fields for
   `local/<alias>` on the **specifier** role — without mutating
   `swarmforge.conf` or staffing.
4. **Periodic re-scout (challenger vs favoured):** on a standing cadence
   (weekly is fine if it stays cheap; specifier may pin the interval), pull
   fresh HF candidates **and** re-run the role battery against the current
   favoured/staffed local model(s) so the table always answers "still best?"
   — not only "is the new one any good?". Never auto-swap the pack; a better
   challenger is an **offer** (same standing rule as today's weekly
   recruiter).
5. **Durable score table:** one reviewable artifact the briefing can cite
   (e.g. under `.swarmforge/recruiter/` or `backlog/evidence/recruiter-score-table.*`
   — specifier picks shape). Rows name role, model/alias, HF id if any,
   battery stamp, pass tally, incumbent flag, recommend line. Update on each
   scout run; do not invent scores in the briefing.
6. **Publish via documenter / Art Director in the daily briefing:**
   - Recruiter (or ceremony hook) leaves the newest score-table path where
     the documenter's morning briefing sources can see it.
   - Documenter includes a short **Model scout** section in
     `docs/briefings/<date>.md` (or omits with an explicit "no new scout
     since last briefing" when the table is unchanged — specifier pins the
     empty-state rule).
   - Art Director treats the score table as a briefing artifact: design brief
     / layout so it is glanceable on phone (BL-1419 family), without rewriting
     numbers or inventing ranks.
7. **Staffing gate later (may be a follow-on slice):** a pack that seats a
   local specifier refuses launch without a cited passing specifier-battery
   evidence path (same shape as `local_coder_battery_staffing_gate.sh`), with
   an explicit skip env for emergencies only.

Out of scope unless the specifier peels a separate ticket: auto-replacing
Claude or live local seats on main; teaching local seats to do deprecator for
real (they must keep refusing); Art Director inventing a second score source.

## Firm constraints

- **Do not break the live swarm.** Discovery + battery + report + briefing
  section only. No pack swap, no seat bounce, no main restart as part of
  recruiting. A better challenger is an offer for the human.
- **Do not hire on coder scorecards for the specifier seat.** A model that
  passes BL-1127 is not thereby a specifier; specifier battery is the gate
  for that role.
- **Local deprecator stays escalate-only** (BL-1800 / Article 3.6 hard-tier).
- **Briefing split stays sacred:** documenter authors content; Art Director
  shapes look; recruiter/steward own the numbers. Nobody mutates
  `swarmforge.conf` from the briefing path.
- Preserve human sentences from this intake verbatim in any minted ticket
  (Article 5.3).

## Evidence / pointers for the specifier

- [`swarmforge/roles/specifier.prompt`](../swarmforge/roles/specifier.prompt) —
  INVEST, Gherkin, invariants, human_approval, deprecator refuse-when-weak
- [`swarmforge/scripts/recruiter_weekly.sh`](../swarmforge/scripts/recruiter_weekly.sh) —
  discover → pull → coder battery → compliance → certify → offer
- [`swarmforge/scripts/recruiter_hf_discover.py`](../swarmforge/scripts/recruiter_hf_discover.py)
- [`docs/how-to/BL-1127-local-coder-steward-evidence-bar.md`](../docs/how-to/BL-1127-local-coder-steward-evidence-bar.md)
- [`swarmforge/scripts/local_model_compliance_battery.py`](../swarmforge/scripts/local_model_compliance_battery.py)
  (`specifier-gherkin_scenario` only — insufficient)
- BL-1800 — local specifier card + deprecator refuse
- BL-1700 / BL-1701 — steward probe + nightly hook patterns (coder); reuse
  shape, not fixtures
- Documenter briefing ownership: `swarmforge/roles/documenter.prompt`
  (morning briefing); BL-1458 / BL-1459 land path
- Art Director + briefing look: BL-1417 epic, BL-1419, `art-director.prompt`
  ("Content: what the briefing SAYS is the documenter's; how it reads…")
- Recent debt-drip charter (same session): specifier must reality-check old
  claims against today — that skill belongs in the battery

## Suggested split (1:N hint only)

Specifier owns the cut; a plausible split:

1. Specifier-skills battery + fixtures + evidence format (no HF yet).
2. Batch HF discover + pull + run battery over N candidates + durable score
   table + ranked report (challenger vs favoured).
3. Wire score table into the documenter's daily briefing sources; Art Director
   brief for glanceable table layout on the briefing email/phone.
4. Optional: steward certify / pack staffing gate for local specifier;
   extend the same scout cadence to coder (BL-1127) and other local roles.

## Disposition

Leave in `backlog/` for the specifier to drain (mint / merge / split under
BL-1125). Do not park into `debt/` — this is new wanted work, not cold
storage.

## Related (same session, separate intake)

Upstream Bob swarm idea mining is **not** part of this recruiter work — see
[`INTAKE-upstream-bob-swarm-ideas-20260929.md`](INTAKE-upstream-bob-swarm-ideas-20260929.md).

## Specifier disposition (2026-09-30)

Split 1:4 under epic BL-1125 (`local-llm-swarm`), normal priority, each
human_approval pending (new feature files; no choice posed). Both human
sentences above survive verbatim in the tickets.

- Skills 2, 3, 5, 6, 10 (tool-gradable) -> **BL-1819**, the specifier
  battery with per-skill evidence and a JSON sidecar.
- Skills 1, 4, 7, 8, 9 (judgment, fixtures with known answers) ->
  **BL-1820**, depends_on BL-1819.
- Batch Hugging Face scout, incumbent re-challenge and score table ->
  **BL-1821**, depends_on BL-1819. Weekly, N default 3, table at
  `.swarmforge/recruiter/score-table.json`.
- Briefing publish -> **BL-1822**, depends_on BL-1821. A CLI renders the
  Model scout section and the documenter pastes it (documenter.prompt line
  landed at mint); the Art Director signs off the look.
- Suggested slice 4 (staffing gate for a local specifier seat, and the
  same cadence for coder): recorded in BL-1821, not minted.
