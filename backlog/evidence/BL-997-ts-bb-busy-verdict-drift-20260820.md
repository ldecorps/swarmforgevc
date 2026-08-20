# BL-997 arrival finding: the two busy classifiers ALREADY disagree

Recorded by the specifier, 2026-08-20, on a coder note
(`20260820T183008Z_000002`) reporting real TS/BB busy-verdict drift while
working BL-997. BL-997's `qa_e2e_procedure` step 1 anticipated exactly this:
"if it fails on arrival, the sides have ALREADY drifted and that is a finding
to report before proceeding, not a test to adjust."

The finding is confirmed independently, by running BOTH real classifiers over
the SAME fixtures rather than by reading either one.

## What was run

- Babashka: `chase-sweep-lib/actively-processing?` loaded from
  `swarmforge/scripts/chase_sweep_lib.bb` at `main`.
- TypeScript: the real exported `isPaneActivelyProcessing` from the compiled
  `extension/out/panel/agentPaneState.js`.
- Fixtures: all seven of `specs/features/fixtures/BL-970/`, which is where
  BL-970 quarantined the marker so that prose about the gate cannot reproduce
  the string the gate matches.

## Result: 3 of 7 fixtures disagree, in BOTH directions

| fixture | Babashka | TypeScript | |
|---|---|---|---|
| `empty-capture.txt` | idle | idle | agree |
| `idle-bg-shell-running-chrome.txt` | idle | idle | agree |
| `idle-quoted-busy-marker.txt` | idle | **BUSY** | **disagree — false-busy** |
| `idle-real-qa-4-shells.txt` | idle | idle | agree |
| `midturn-esc-footer.txt` | busy | busy | agree |
| `midturn-unlisted-verb-no-counter.txt` | **BUSY** | **idle** | **disagree — false-idle** |
| `midturn-unlisted-verb-real-capture.txt` | **BUSY** | **idle** | **disagree — false-idle** |

## Why this is worse than BL-997 predicted

BL-997 predicted ONE direction, and held `severity: medium` on the strength of
it: "a pane quoting the marker in old scrollback is IDLE to the swarm and BUSY
to the extension host", whose consequence is "a refused respawn - visible,
recoverable, and rare."

That direction is real (`idle-quoted-busy-marker.txt`). But the measured drift
also runs the OTHER way, which the ticket did not anticipate and which is not
recoverable: on `midturn-unlisted-verb-real-capture.txt` — a REAL pane capture,
not a synthetic one — the Babashka side says BUSY and the TypeScript side says
IDLE. Its live status frame reads `✢ Precipitating… (10m 13s · ↓ 16.7k tokens)`:
a pane ten minutes into a genuine turn, whose frame simply does not carry the
substring the TypeScript side keys on. Neither false-idle fixture contains that
substring at all (`grep -c` = 0 on both).

The consequence is the BL-137 direction: `tmuxClient.ts:441`'s precheck exists
solely to refuse typing a forced respawn into a pane that is provably mid-turn,
and on this capture it now returns "not busy" and lets the respawn through. The
one safety check in that path no longer fires for the case it was built for.

## Root cause

BL-970 (landed, `152f8331e`) REPLACED the Babashka definition rather than
tweaking it: a structural frame match (spinner-glyph-led line, verb words,
ellipsis, digit-led parenthesized elapsed) consulted only against the
snapshot's 20-line TAIL WINDOW, with the hand-maintained verb list removed.

The TypeScript side was not part of that parcel and still does what it always
did: a case-insensitive substring test for the marker, anywhere in the pane
text, with no structure and no zone. Both halves of BL-970's fix are missing
there, and each missing half produces one of the two disagreement directions —
no tail window gives the false-busy, no structural frame match gives the
false-idle.

## Disposition

BL-997 is the agreement GATE and its firm lines forbid it from changing what
"busy" means on either side, so it cannot itself close this. The port is
BL-1003; BL-997's gate can only go green once BL-1003 has landed.

Reproduce with the compiled extension present:

```
bb -e '(load-file "swarmforge/scripts/chase_sweep_lib.bb")
       (doseq [f (sort (map str (babashka.fs/list-dir "specs/features/fixtures/BL-970")))]
         (println (babashka.fs/file-name f) (chase-sweep-lib/actively-processing? (slurp f))))'
cd extension && node -e '
  const fs=require("fs"),p=require("path");
  const {isPaneActivelyProcessing}=require("./out/panel/agentPaneState.js");
  const d="../specs/features/fixtures/BL-970";
  for(const f of fs.readdirSync(d).sort())
    console.log(f, isPaneActivelyProcessing(fs.readFileSync(p.join(d,f),"utf8")));'
```
