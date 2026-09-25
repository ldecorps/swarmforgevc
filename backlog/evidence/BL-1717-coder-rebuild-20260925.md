# BL-1717 — coder rebuild pass (QA bounce D1/D2), 2026-09-25

QA bounce (backlog/evidence/BL-1717-QA-20260925.md, commit e81a640797)
blamed coder for D1 and D2; D3 blames the documenter and travels with this
parcel (Article 4.4) rather than being fixed here.

## D1 — fixed

`swarmforge/scripts/land_step_lib.bb` own-paths, the BL-1717 disjunct
(~line 1882): the third clause dropped path-landed owners from `:owners`,
then tested the remainder with `(every? unlanded-siblings not-yet-landed)`
- so a not-yet-landed owner absent from the ticket-level
`unlanded-siblings` set (exactly BL-1687's BL-9002/BL-1693 shape) was not
excluded once a landed co-owner was also present. Replaced with
`(seq (remove #(path-landed? % path) (:owners attribution)))`: if anything
remains after dropping path-landed owners, the path is excluded -
whichever ticket-level set that remainder does or does not belong to,
matching clause 2's existing "no owner shown landed" posture but applied
to the REMAINDER after landed owners are dropped, per QA's remediation
pointer.

Verified against QA's own D1 probe (`bb bl1717_edge.bb
swarmforge/scripts/land_step_lib.bb`, the exact script pasted into the
bounce evidence): scenario B ("landed L + U") now reads
`{:paths ["BL-9003-own.txt"]}`, matching control A and scenario C exactly,
where pre-fix it kept `shared.md` and let U's lines ride unreported.

`bb swarmforge/scripts/test/land_step_lib_test_runner.bb`: ALL PASS
(unchanged - ~470 assertions, no existing case exercised this shape, which
is exactly why D1 shipped).

## D2 — fixed

`extension/test/bl1717LandedCoOwnerNeverShieldsInvariants.property.test.js`
(new). Drives the real `land-step-lib/own-paths` over a real git fixture
with `:path-landed-fn` injected, per QA's remediation pointer - never a JS
restatement of the decision. Four named cells (GENERATOR REACH by
construction, not by draw), crossing the dimensions QA named: path-landed/
not per owner, in/out of the ticket-level unlanded-siblings set, and
whether the landing ticket itself also owns the path:

- `excluded-not-in-set` - the exact D1/BL-1687 shape (a not-yet-landed
  owner absent from unlanded-siblings, alongside 0-2 landed co-owners):
  must exclude.
- `excluded-in-set` - the same, with the not-yet-landed owner declared in
  unlanded-siblings: must exclude (control - proves the fix does not
  regress the already-correct shape).
- `kept-all-landed` - every owner path-landed, no unlanded owner at all:
  must ride.
- `kept-a-owns` - the landing ticket itself also touches the path: must
  ride regardless of co-owner landed state (BL-1375's territory, outside
  this clause's guard).

Non-vacuity, checked directly (not left in the commit): with the pre-fix
disjunct restored (`git stash` of the D1 hunk only, then reverted), this
same test failed on its first case -
`AssertionError: shared.md rode into the replay in cell
excluded-not-in-set: {"paths":["backlog/active/BL-9717-own.yaml",
"shared.md"],"warning":null,"excluded":[]}` - the identical shape D1
reported. Restored the fix immediately after and re-ran green; the
temporary stash entry was dropped once confirmed restored (never a bare
`git stash pop`, per this worktree's shared-stash-stack rule).

`npm run test:properties` on this file alone: 1 test file, 1 test, green
(~4.4-4.7s).

## D3 — not owned here, travels forward

`docs/how-to/BL-1241-entangled-tip-at-the-land-step-has-a-reachable-remedy.md`'s
"two owners suffice" wording is the documenter's fix, per Article 4.4's
multi-stage-blame rule (bounce to the earliest blamed role, D3's inventory
travels rather than being re-blamed here). Not touched by this commit.

## Verification run before forwarding (2026-09-17 rule: once each)

- `npm test` (extension/, compile + unit lane): 637 files, 10867 tests,
  exit 0.
- `npm run test:properties` (this file, once): green.
- `run_acceptance.sh` on BL-1717's own feature: 2/2.
- `run_acceptance.sh` on the neighbouring exclusion/passenger features
  (qa_e2e_procedure step 2): BL-1389 5/5, BL-1375 7/7, BL-1481 4/4,
  BL-1678 4/4 - all unchanged.

## Scope

Touched: `swarmforge/scripts/land_step_lib.bb` (own-paths only),
`extension/test/bl1717LandedCoOwnerNeverShieldsInvariants.property.test.js`
(new), this evidence file. Nothing else in this worktree was staged for
this commit - the unrelated untracked files present in this worktree
(BL-1726/BL-1666/BL-1652 leftovers from other tickets) are not this
ticket's and are left as found.

By coder.
