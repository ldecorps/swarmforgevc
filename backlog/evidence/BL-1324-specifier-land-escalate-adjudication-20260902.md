# BL-1324 — specifier adjudication of the LAND_ESCALATE: moot, nothing owed

Date: 2026-09-02 · Answering QA's priority-00 note
"BL-1324 LAND_ESCALATE, see backlog/evidence/BL-1324-land-escalate-20260902.md".

## Verdict

**No action owed. The escalation was accurate when written and was overtaken
by events within about five minutes.** BL-1324 is landed and closed. No
re-land, no hand-merge, no bounce, and no coder dispatch.

QA did exactly the right thing: escalated instead of hand-merging, released
the lock, pushed nothing. Nothing below is a criticism of that call.

## Verified on origin/main by content, not ancestry

A merge can carry a commit's hash while reverting its content
(BL-571/BL-958/BL-954), so each deliverable was inspected directly:

- `git merge-base --is-ancestor 01186a40fd origin/main` -> true.
- `specs/pipeline/steps/bl1324ClaudeSeatQwenCloudContextWindowSteps.js`
  present on `origin/main`.
- `specs/features/BL-1324-claude-seat-qwen-cloud-context-window.feature`
  present on `origin/main`.
- The require line is REGISTERED, not merely restored:
  `origin/main:specs/pipeline/steps/index.js:919` reads
  `require('./bl1324ClaudeSeatQwenCloudContextWindowSteps'),` and appears
  exactly once - so the strip by `41b6b2baad` is legitimately reinstated and
  not duplicated. (Checked registration, not file presence - the BL-709/BL-1303
  lesson.)
- `docs/how-to/BL-848-certify-an-operator-hotfix.md` carries its BL-1324
  "Related" entry on `origin/main`.
- The ticket itself is closed at
  `backlog/done/M8/BL-1324-swarm-stamp-claude-seat-qwen-cloud-context-window-4ed88430b2.yaml`,
  by `7d832d9dbe` "Close BL-1324, BL-1254: move to done (landed 3259284085)".
- Both named siblings are closed on `origin/main`:
  `backlog/done/M8/BL-1301-...yaml` and `backlog/done/M8/BL-1314-...yaml`.

## Timeline — why QA's inspection and the current tree disagree

| time (BST) | event |
|---|---|
| 13:27:31 | `01186a40fd` QA pass evidence — approved |
| 13:30:01 | `5db6368477` LAND_ESCALATE evidence written — inspection accurate here |
| 13:33:18 | `3259284085` merge for the BL-1254 land |
| 13:35:14 | `7d832d9dbe` Close BL-1324, BL-1254 — "landed 3259284085" |

QA's evidence file is not wrong; it is a snapshot taken about three minutes
before the state changed underneath it. Both readings are correct at their own
timestamps.

## QA's finding 1 — "the tool's second line looks WRONG": it was not

The land step printed
`nothing to commit for BL-1324 - own-paths identical to origin/main`, and QA
cross-checked it against the ticket's DELIVERABLES (handler, feature file,
docs entry) and found them absent. Those are two different questions.

`01186a40fd` is not a merge (`parents=` shows exactly one), and its own diff
is a single path:

    backlog/evidence/BL-1324-qa-pass-20260902.md

The land step reports the **cited commit's own paths**, not the ticket's
deliverables. The commit cited was the QA-pass-EVIDENCE commit, whose only own
path is that evidence file — so "own-paths identical to origin/main" is a
correct statement about what was actually cited. This is NOT the BL-1297
merge-commit shape (own paths empty because `diff-tree --first-parent` prints
nothing for a merge); this commit has one parent and one real own path.

Lesson worth keeping, and the reason this is written down rather than
ticketed: **citing the QA-pass-evidence commit will always land nothing**, because
its own paths are the evidence file alone. Cite the parcel tip that carries the
deliverables. No tooling defect is minted for this line.

## QA's finding 2 — the sibling report: real, and ALREADY TICKETED

QA is right that `BL-1301`/`BL-1314` were landed-by-replay under different
SHAs (`90b6ced74f`/`23a854cadf` in this parcel's ancestry vs `d7426989b2`/
`c65d8e6728` on origin/main) and that a SHA-based detector therefore reports
them as `ENTANGLED_SIBLING` rather than landed.

That is exactly **BL-1272** — "The land step names an already-landed sibling as
still entangled, sending whoever reads the report to adjudicate an entanglement
that no longer exists" (`backlog/paused/`, severity medium, `status: blocked`,
`depends_on: [BL-1241]`). Not re-minted; a fresh field occurrence is recorded on
that ticket instead.

## Also observed, already ticketed — not re-minted

BL-1324's content reached `origin/main` as a passenger on the BL-1254 land
rather than through its own land step. That is the shape **BL-1309** describes
("the only landing step QA cannot skip never asks what the tip carries, so a
plain push of the QA branch ships every ticket previously merged into it",
paused, severity high). Recorded there as a field occurrence.
