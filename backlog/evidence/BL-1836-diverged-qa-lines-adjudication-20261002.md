# BL-1836: the two diverged QA lines (specifier adjudication, 2026-10-02)

Asked by coordinator note 015101 and
`bl1836-dropped-parcel-diverged-qa-lines-20261002.md`.

## The two lines

| commit | what | contains BL-1836's work |
|---|---|---|
| `838d643744` | QA pass, 1 defect: the unowned `confirmPoleAloneOutcomeShapes.test.js` pole red | all of it: coder `ff15be1e29`, hardener `1c63610bdf` + `2fcb5b6f15`, documenter `125447f009` + `e6bb3d93c6` |
| `f1cb7ecbf1` | QA pass, NONE, after hotfix `8ed4173ce4` (BL-1893) | coder and hardener only. Its parent is `9b21296a49`, BL-1887's queued land commit. |

`git merge-base --is-ancestor 125447f009 f1cb7ecbf1` fails, and so does the
check for `e6bb3d93c6`. `125447f009` is the documenter's Article 3.6
retirement: it moves the BL-1641 headless-composer page to `docs/deprecated/`
and edits `docs/index.md`, `docs/deprecated/README.md`,
`docs/reference/Specification.MD` and the briefing-trigger page.

## How it happened

The specifier's note 002174 told QA: "BL-1836: pole test hotfixed 8ed4173ce4
(BL-1893) - merge main, re-run, resume". Under BL-1871 parcel lines, QA's
branch had already moved onto BL-1887's parcel. QA merged main into that line
and re-ran there. The NONE pass is real for what it checked, but its tree is
missing the documenter's commits.

## It was not dropped

QA queued it: `.swarmforge/lander/queue/BL-1836-f1cb7ecbf1.edn`,
`:status :queued`, behind `BL-1887-9b21296a49` (`:running` at 15:18). The
land step checks unlanded siblings in the landing commit's ancestry. It
cannot see a commit of this ticket's own that is missing from that ancestry,
so landing `f1cb7ecbf1` would close BL-1836 without its doc retirement.

## Ruling

- Resume from `f1cb7ecbf1` with `e6bb3d93c6` merged in. Keep `f1cb7ecbf1` in
  the ancestry: the documenter and hardender branches already descend from
  it, so landing it turns their passenger copies into landed siblings.
  `git merge-tree --write-tree f1cb7ecbf1 e6bb3d93c6` is clean and adds
  exactly the documenter's five files.
- `838d643744` is superseded. Its only content is the 1-defect evidence at
  `backlog/evidence/BL-1836-QA-20261002.md`, which `f1cb7ecbf1`'s NONE
  replaces at the same path, and its one defect was fixed by `8ed4173ce4`.
  It is recorded under the ticket's `abandoned_commits:`.
- QA (note 002180, priority 00): unqueue `f1cb7ecbf1`, merge `e6bb3d93c6`,
  requeue. QA owns the queue entry. The specifier does not touch it.

## Process point for the specifier

Under parcel lines a "merge main, re-run, resume" note to a role that has
since moved to another parcel lands the re-run on the wrong line. From now on
the note names the parcel's commit to resume from:
"take up <task> at <commit>, merge main, re-run".

By specifier.
