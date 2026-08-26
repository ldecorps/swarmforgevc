# BL-860 architect review — CERTIFY, all five dispositions confirmed (one evidence correction)

**Ticket:** BL-860 — swarm stamp-off certifying the host-switch WIP park
commit `f175bc56d1` (2026-08-01, swarm-intake[bot]/Cursor co-author, 4052
insertions across 11 files, landed straight to `main` outside the pipeline).
**Reviewed commit:** `e651523e2c` (coder's forward — a no-op per this
ticket's own `stage_skip_reasons.coder`: nothing is implemented, the
deliverable is this evidence file).
**Role:** architect.
**Required stages for this ticket:** `[architect, qa]` — cleaner, hardener,
documenter declared skipped in the ticket YAML (no code authored to clean,
harden, or document).

## Scope check

`git log --oneline --no-merges` restricted to BL-860's own commits
(`bf1968ab2` spec, `4ff36083a` promote, `e14068898` topic record) touches
only `backlog/paused|active/BL-860-*.yaml` and `backlog/topics/BL-860.json`.
No `.ts`/`.js`/production file is part of this parcel.

## Dependency-rule gate (BL-259, hard gate) — NOT APPLICABLE, confirmed not skipped

No file under `extension/src` (or any compiled-tree source) changed by this
parcel. `dependency-gate.js` has nothing to run against; this is a
confirmed no-op, not an assumed-clean skip (same posture as BL-879's
architect pass).

## Co-change report (BL-255) — NOT APPLICABLE

Same reason: zero production files changed by this parcel.

## Invariant review

Declared invariant: *"Every functional path in the park commit ends this
ticket with a recorded owner — a ticket id or an explicit disposition — and
none is left unexamined."*

Per `stage_skip_reasons.hardender`, this invariant has no executable
encoding — it is a property of the review process itself (does every path
get a recorded owner), not of running code. The audit below, and its
resulting evidence file, is the invariant's verification surface. No
property-test gap: there is no pure module in this parcel to encode one
against.

## Independent re-derivation of the five dispositions

Re-ran each check against the repo as it stands today (2026-08-13), not
against the ticket's 2026-08-08 audit snapshot.

1. **`pilotSafeDefects.ts` / `pilotSafeDefects.test.js` — owned by BL-722.**
   `backlog/done/BL-722-pilot-safe-defects.yaml` exists; both files present
   at their described paths. **CONFIRMED.**

2. **`letsTalkBubbleConfig.ts`, `letsTalkChiptunes.ts`/`.json` — owned by
   BL-765 (`backlog/paused/`, `human_approval: approved`).** Ownership and
   BL-860's own disposition (NO ACTION beyond BL-765's ordinary promotion)
   **CONFIRMED** — nothing here is orphaned, dangerous, or needs reverting.

   **Correction to the ticket's supporting evidence** (the disposition
   itself is unchanged, but its "zero callers" claim is now stale): since
   the 2026-08-08 audit, two *other*, already-`done` tickets exercised
   `letsTalkBubbleConfig.ts` without going through BL-765:
   - **BL-763** (done) wired `GET /lets-talk/bubble-config.json` as a live
     served route (`bridgeServer.ts:1571-1578`, its own comment says so
     explicitly) and made Android `BridgeClient.kt` fetch it
     (`BridgeClient.kt:212-224`).
   - **BL-864** (done) reads `getLetsTalkBubbleConfig(...).features.voiceEngineSwitch`
     internally (`letsTalkAudioEngineRoutes.ts:10,47,70`) to gate its own
     selector.

   So 2 of BL-765's 3 declared `required_wiring` items
   (`letsTalkBubbleConfig.ts::served over GET /lets-talk/bubble-config.json`
   and the Android fetch half) are **already satisfied in practice** — not
   by BL-765 itself (still `status: todo`, none of its own
   `required_stages` has run), but as a side effect of BL-763/BL-864's own
   work reusing the same module. `letsTalkChiptunes.ts`/`.json` remains a
   true orphan exactly as the ticket describes: no route registered in
   `bridgeServer.ts`, no caller anywhere outside its own file, no Android
   fetch.

   This doesn't change BL-860's verdict (still NO ACTION; promoting BL-765
   is explicitly out of this ticket's scope) but it is worth the
   specifier's attention before BL-765 is promoted, since part of its
   declared `required_wiring` may already be a no-op. Flagged via a
   non-blocking `note` alongside this handoff — not a bounce, since nothing
   in BL-860's own parcel is defective.

3. **`swarmforge/packs/mono-router.conf` `active_backlog_max_depth`.**
   Current value: `config active_backlog_max_depth 3` (line 25) — not `0`.
   Superseded, no live effect. **CONFIRMED.**

4. **`.cursor/rules/bugfix-process-tdd.mdc` — track vs. gitignore.**
   `git show --stat f175bc56d1` confirms the park commit touched exactly
   this one file under `.cursor/rules/` (45 lines, matches the ticket).
   `.gitignore` has no `.cursor` entry. Two more `.cursor/rules/` files
   (`operator-intake-local.mdc`, `swarm-code-explicit-request-only.mdc`)
   were added later by an unrelated commit (`7a10ea6e0`) and are also
   tracked, un-gitignored — confirming tracking (not gitignoring `.cursor/`)
   is the repo's established, consistent convention, not a one-off. The
   live decision this ticket asks for: **confirmed — keep tracking, do not
   gitignore `.cursor/`.**

5. **Answer-archive files (4).** `ANSWER-BL-764-approve.md`,
   `ANSWER-BL-765-approve.md`, `ANSWER-BL-766-option-b.md`,
   `ANSWER-BL-768-approve.md` all present under `backlog/answers-archive/`.
   Bookkeeping only. **CONFIRMED.**

## Out-of-scope compliance

No code in the park commit was implemented, reverted, or re-derived; BL-765
was not promoted by this pass; no ledger `human_decision` was written (that
is reserved for a human, after this ticket reaches `done`, per
`docs/how-to/BL-848-certify-an-operator-hotfix.md`).

## Disposition

CERTIFY. All five dispositions confirmed; the one live decision
(`.cursor/rules/` tracking) confirmed as-is. One non-blocking correction
surfaced for the specifier re: BL-765's required_wiring overlap with
BL-763/BL-864 — sent as a `note`, not a bounce. Forwarding to hardender
(this ticket's own `required_stages: [architect, qa]` routes it straight to
QA; hardener/documenter are declared skipped with stated reasons).

By architect.
