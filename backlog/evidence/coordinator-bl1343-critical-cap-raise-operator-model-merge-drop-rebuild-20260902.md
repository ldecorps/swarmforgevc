# Coordinator — 18:20–18:38 UTC 2026-09-02: BL-1343 critical, cap raise, operator model, specifier merge drop, rebuild pending

Deliberately UNCOMMITTED until the human rules on the local-main rebuild:
an untracked file survives `reset --hard`; a commit here would just be one
more cherry-pick.

## 1. BL-1343 raised to critical → cap raise + promote (within powers)
Specifier note: "BL-1343 raised to critical: 3 approved parcels held,
landing is down". BL-1343 = `land_step_lib.bb` drops a ticket's own paths
on a merge tip (the BL-1338 diagnosis). Active was 4/4, every slot held by
a parcel waiting on this fix → `headroom_cap_raise_cli.bb . raise`:
`{"action":"raise","to":5,"from":4}` (committed `ade60c93b7`, the CLI
had left `packs/full-forge.conf` dirty). `promote_and_route_next.sh BL-1343`
→ promoted (`8d382e764b`), routed to coder (`003457`). Gates ran inside the
script (deprecator/onboarding/freshness audit clean; orthogonality
ADVISORY only — same epic, different files).
Ceremony adjustments could NOT be recorded — "no ceremony run found for
shift 2026-09-02" (the run is created by `finish-shift`). Replay then:
```
node extension/out/tools/closing-ceremony-adjustment.js --shift 2026-09-02 --kind promotion_order --detail "BL-1343 (critical, approved) expedited into the slot opened by the headroom cap raise; land step down for merge tips" --form ticket --ref BL-1343
node extension/out/tools/closing-ceremony-adjustment.js --shift 2026-09-02 --kind throttle_posture --detail "headroom_cap_raise_cli: active_backlog_max_depth 4 -> 5 (packs/full-forge.conf) so the land-step fix could enter" --form ticket --ref BL-1343
```
Expeditor recommendation (human call, BL-567 charter): BL-1343's own fix
would hit the same land-step bug on the way in; `expedite.sh BL-1343
--no-restart` is the designed lane. Not asked via role_ask — the slot was
used for the more urgent rebuild question (§4).

## 2. Operator seat model → claude-opus-5 (human directive)
Human: "operator should update its model to version 5" (screenshot: the
Operator session on Opus 4.8). Source of the pin: `launch_operator.sh:31`
`MODEL="${OPERATOR_MODEL:-$(ancillary_provider_default_model operator)}"` →
`ancillary_provider_lib.sh:286` (`claude_direct`, role operator →
`claude-opus-4-8`) and the settings TEMPLATE
`swarmforge/scripts/operator.claude-settings.json` (used directly by
`attend_operator.sh`). Changed both to `claude-opus-5` (exactly 4 lines),
committed `cba2ac2f43` with the directive verbatim + `By coordinator.`
(first attempt failed only for the missing byline). Takes effect at the
operator's next per-tick launch; no daemon restart. NOT changed (not
named by the directive): `support.claude-settings.json` and
`front-desk-operator.claude-settings.json` still pin `claude-opus-4-8`.
The 07-25 memory directive (upgrade 4.8 seats to Opus 5, cost-neutral)
is now applied for the operator seat only.

## 3. Specifier merge `a427bacdb4` dropped QA's BL-1338 landing (2nd drop today)
BL-1310 guard self-note: "local-ahead commits present, 1 behind - refused,
not reset" (the reset-guard working). Investigation:
- `a427bacdb4` "Merge remote-tracking branch 'origin/main'" (no byline, no
  session trailer), parents `59f58cee68` (specifier's tip) + `a1450efaa3`
  (origin). Tree byte-identical to parent 1; vs parent 2: 14 files
  +209/−761 — it took NONE of origin's content.
- Dropped = QA's BL-1338 hand-land per my recipe (`95e96ef217`) + its
  abandoned_commits record (`a1450efaa3`): handler, `index.js` line,
  `deprecate-check.ts`, 2 tests, 4 evidence files, topic, ticket YAML.
- `push_sweep_lib.bb:170 noop-landing-merge?` flags exactly this shape;
  the push-sweep logs `noop-merge-refused noop-landing-merge a427bacdb4`
  every ~22 s and pushes nothing. **Correct behaviour.**
- `origin/main` is intact and complete (handler present, 1 registration,
  `deprecate-check.ts` identical to the approved tip, tests present).
- Local `main` is now 15 ahead (14 real commits + the merge) and
  UNPUSHABLE. A restore commit on top does NOT unblock: the guard filters
  every ahead commit and the merge commit itself stays flagged.
- Specifier self-corrected: restored the backlog half (`d2dd2d7ac2`,
  `467672de55`), staged the 5 pipeline paths for QA (`faeecf8b1b`), and
  sent "no more merges from me on main" (001203). The 3310a24dfb prompt
  fix from this morning did not prevent this one.
Notes sent: QA (hold; origin OK; local-only drop), specifier ×2 (stop
merging; restore won't unblock push). Human `role_ask` (18:31Z, slot was
free) with the recipe below.

### Rebuild recipe (human runs; or coordinator on explicit authorization)
```
cd /home/carillon/swarmforgevc && git status --porcelain | grep -v '^??'   # must be empty (tracked-clean)
git fetch origin main
git rev-list --reverse --no-merges origin/main..main > /tmp/cp.txt          # 14 real commits
git reset --hard origin/main                                              # drops ONLY the no-op merge
git cherry-pick -x $(cat /tmp/cp.txt)     # --skip any that come up empty (the restore commits are no-ops vs origin)
```
Then the push-sweep pushes on its next tick. Untracked files (this
evidence) survive. Specifier and QA are on hold until then.

## 4. Bookkeeping done meanwhile
- **BL-1338 CLOSED** on QA note 002134 (`3222685ab3`): QA hand-landed on
  origin at `a1450efaa3`. Caveat written on the ticket: local-main
  lineage lacks the pipeline half until the rebuild. Freshness sync
  refused (unapproved commits) and deliberately NOT overridden this time
  — restarting daemons onto a tree known to be missing content is not
  what BL-328 is for; 4 daemons report stale, said loudly here.
- **BL-1340 promoted+routed** into the freed slot (`57174f3af6`, coder
  `003463`); first attempt `commit-failed` transiently, rolled back
  cleanly, retry succeeded. Active 5/5: BL-1056, BL-1271, BL-1317,
  BL-1340, BL-1343.
- BL-1271 / BL-1056: NOT dropped — QA APPROVED both (`002130` BL-1056 @
  `6e6e544400`, `002132` BL-1271 @ `0ea1c8cb3b`, merge-up broadcasts sent)
  but cannot land until the rebuild (landing commits+pushes on local main).
  Stage store showed them "in-transit-to coder" — it reads the merge-up
  broadcast note as a hop; BL-464 contract miss, note for the specifier.
- BL-1272 closed earlier (`bd3cd0afca`, landed 08-30) — already on origin.
- BL-1344 (medium, approved) and BL-1345 (high, approved — the stale
  marker launcher bug; the specifier minted it from the operator's intake
  despite my supersede note; harmless, it is the review vehicle for
  hotfix `195de28861`) are paused, spec-ready; cap full.
- Hotfix `195de28861` stamp: root intake exists
  (`INTAKE-operator-hotfix-rc-launch-role-stale-marker-*`), nudged the
  specifier. Ledger still `stamp_ticket: null`.
- ACTIVE-POOL-FRESHNESS-HOLD on BL-1271: its deprecator adjudication is
  `confirm_promote` (14:49Z) but the fingerprint moved when the bounce
  record was appended — the very thing BL-1338 fixes, and BL-1338's code
  is what local main is missing. Harmless (already active, QA-approved).
- Specifier declined `--resolve` on its 08-30 ask, correctly: the verb is
  for answered-but-unpaired, not stale. My own resolve of the BL-1300 ask
  stretched that; the question was moot (BL-1300 already done/), so the
  outcome was right but the verb was not. Its drift question still awaits
  the human (answer, or direct a withdrawal — `role_ask` has no withdraw
  verb; that is a ticket).

By coordinator.
