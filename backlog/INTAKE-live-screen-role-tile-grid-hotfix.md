# Raw intake — Live Screen role tiles crushed into thin strips; Cursor-agent hotfix needs swarm stamp

Status: new intake, not minted. Capture only (human via Cursor 2026-08-20
afternoon). **Operator/Cursor hotfix is live in the master checkout and
captured as a patch** — same posture as BL-956 (pipeline-board caption/cap):
`extension/src/` cannot land on `main` outside QA
(`check_pipeline_code_on_main.sh`, Article 1.8/4.2, BL-247 / BL-632). Do
**not** attempt a `Hotfix-Certification: pending` commit of the `.ts` file
on `main`; ride the normal chain from the captured patch.

The human asked for square-ish tiles with only the role name + Expand on
the Live Screen webpage, then confirmed the first pass still crushed four
workers into a thin letter-stacked strip; the layout fix landed the same
afternoon. Human directive: "Let the coordinator know about this webpage
hotfix."

Related (do not conflate)
- **BL-609** (paused) — Resident Spy font-size +/- control. Adjacent
  surface (`residentSpyUiHtml.ts`) but a different ask (fullscreen text
  size), not this grid-tile layout. Do not fold together.
- **BL-526** / **BL-522** (done lineage) — console menu + original
  resident-spy Mini App. This is a follow-on UX defect on that shell.
- **BL-881** (done) — TTL cache for resident-pane live capture. Feed
  data path, not the HTML grid layout.
- **BL-956** (done) — prior example of a human webpage/pipeline hotfix
  that existed only as a patch until the chain landed it. Same gate.

## Goal

1. Specifier mints a **medium/high** defect ticket (BL-956 shape, not a
   BL-848 stamp-off of an already-on-main commit): apply the captured
   patch through coder → … → QA so the Live Screen tile layout reaches
   `main` legally.
2. Acceptance must prove the live failure mode: with 4 workers visible,
   the split view used a flex row with `flex-basis: 33%` so panes shrank
   into thin vertical strips, and `word-break: break-word` stacked role
   names letter-by-letter. After the hotfix, phone portrait shows a
   stable 2×2 of square-ish tiles, each showing only the role name
   (COORDINATOR, SPECIFIER, …) and an Expand control.
3. Also prove: Expand fullscreen still shows full metadata + transcript
   (grid tiles hide the pane `<pre>`; fullscreen sync is unchanged).
4. Do **not** widen into BL-609's font-size control, console-menu work,
   or pack/layout selection logic.

## What landed (Cursor agent, 2026-08-20 ~15:30–15:50 local)

Diff captured verbatim at
`backlog/evidence/INTAKE-live-screen-role-tile-grid-hotfix.patch`.
Until the parcel lands, the behaviour the human is looking at exists in
that patch and in the dirty master working tree / compiled `out/`.

### Observable incident

- Human opened the Live Screen webpage expecting all worker tiles with
  just the role name + Expand.
- First change hid transcripts but left the flex shrink layout — four
  panes collapsed into one thin strip with letter-stacked labels.
- Root cause: `.split` was `display: flex` + wrap with percentage
  `flex-basis` that allowed horizontal crush; tile headers still used
  `word-break: break-word`.

### Fix in tree (file)

- `extension/src/bridge/residentSpyUiHtml.ts`
  - `.split` → CSS grid; phone default `repeat(2, minmax(0, 1fr))`
    (2×2 for 4 workers); 1 pane = single column; 5–8 panes stay
    2-col on narrow, 3/4-col from 700px up.
  - Grid tile header is role name + Expand only (`renderPane`);
    `.split .pane-col > pre { display: none }` so transcripts are
    fullscreen-only.
  - Larger centered `.pane-kind`, no letter-break; Expand hint
    absolutely positioned top-right.

### Live verification already done

- Human iterated on the phone/webpage the same afternoon: first asked
  for role-only tiles, then reported the thin-strip failure, then got
  the grid layout fix. Directive to notify the coordinator followed.

## Out of scope for this stamp ticket

- BL-609 font-size +/- control.
- Changing which roles appear in the live feed / pack layout.
- Pipeline-grid / console menu surfaces.
- Attempting to bypass BL-632 by committing `extension/src/` to `main`
  with a hotfix trailer — that path is refused; this ticket *is* the
  landing path.

## Locked human decisions

1. Treat this as **pipeline landing of a captured human hotfix**, not a
   greenfield redesign (same posture as BL-956).
2. Grid tiles show **role name + Expand only**; transcript stays in
   Expand fullscreen.
3. Phone portrait stays **2-column** so four workers read as a 2×2 of
   square-ish tiles — do not restore the flex shrink layout that
   crushed them into thin strips.
