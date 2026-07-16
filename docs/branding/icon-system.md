# SwarmForge Icon System — "The Orchestra"

> Status: **design exploration / not yet ratified.** Captured 2026-07-15 from an
> operator ↔ agent design discussion. Assets and generators live alongside this doc.
> Nothing here is committed to product yet — this is the durable record of the idea.

## 1. The metaphor

The icon universe is a **classical-music ensemble**, anchored directly on the
existing **Baton epic** ([BL-242](../../backlog/done/BL-242-baton-fleet-composite-epic.yaml)),
which already frames the system this way:

- an **agent** is a leaf → a **player**
- a **swarm** (coordinator + pack) is a composite → a **conductor + their ensemble**
- a **fleet** (composite of swarms) → an **orchestra of ensembles**
- the console talks to **conductors**, never directly to players → the podium layer

The chosen mark is the **orchestra seen from the podium**: a conductor (the
coordinator) at a podium with a raised baton, and the ensemble fanned out in
concentric **section-arcs** above. This reads three ways at once:

1. To anyone — an orchestra seating chart (instantly legible, no AI/robot cliché).
2. To us — a swarm of agents rolled up under one conductor (the Baton layering).
3. Bonus — each arc is a **section = an agent role**, so the palette carries meaning.

### Palette = sections = roles

| Ring (front→back) | Section     | Colour    |
|-------------------|-------------|-----------|
| inner             | strings     | `#ffd36b` gold |
| 2nd               | woodwinds   | `#3ec9b0` teal |
| 3rd               | brass       | `#3ea6ff` blue |
| outer             | percussion  | `#a68cff` violet |

Backdrop is the app-icon navy gradient `#1c2233 → #0b0f18`; podium/baton are brass
`#ffe9a8 → #e6a53c` and off-white `#f4f7fa`.

## 2. Two dynamic axes (the reason this system exists)

The icon is not static — it **encodes live swarm state** on two independent axes.
See `assets/spec-sheet.png` for the rendered ranges.

### Axis A — DYNAMICS = how busy the swarm is (musical dynamics)

Music conveys mood — peaceful, busy, dramatic — through **dynamics** (pp → ff).
We map activity level onto the same scale:

| Dynamic | Swarm state      | Visual encoding                                   |
|---------|------------------|---------------------------------------------------|
| **pp**  | idle / parked    | small, calm, dim dots; tiny baton spark; no glow  |
| **mf**  | steady dispatch  | mid-size dots; moderate downbeat                  |
| **ff**  | tutti / slammed  | large bright dots; big radiant downbeat + glow; motion |

Driven by an `intensity ∈ [0,1]` parameter: dot size, brightness, and the
downbeat spark (with a glow halo past ~0.55) all scale with it.

### Axis B — FRESHNESS = how recent the information is (colour fade)

Colour **desaturates toward grey and fades in opacity** as the last report ages,
so staleness is visible at a glance — ideal for a fleet dashboard where each
swarm's tile ages in place.

| Freshness | Meaning        | Visual                          |
|-----------|----------------|---------------------------------|
| now       | just reported  | full saturation, full opacity   |
| ~5 min    | recent         | slight desaturation             |
| ~30 min   | aging          | greying, ~half opacity          |
| stale     | silent / lost  | near-grey, faint                |

Driven by a `freshness ∈ [0,1]` parameter: each section colour is mixed toward
its own luminance-grey by `(1-freshness)`, and opacity = `0.22 + 0.78·freshness`.

### The axes are independent — and their combination is meaningful

A swarm can be **ff but stale** — "it was at full tilt 30 min ago and has since
gone silent." That combination is a genuine alarm state the icon expresses for
free (big shapes, greyed-out colour).

## 3. Zoom levels (one system, two densities)

- **Full** (`concept-e-orchestra`) — 4 section-rings. App icon / fleet-console
  tile / anything ≥128px. The fleet-console reading is "many sections = many swarms."
- **Small** (`concept-e-orchestra-small`) — 2 rings, fewer/bigger dots, bolder
  podium. Telegram bot avatar / favicon / ≤96px. Verified legible at 96px.

Rationale: the 4-ring version smears below ~96px; the 2-ring variant holds.

## 4. Files

```
docs/branding/
├── icon-system.md                 ← this doc
├── gen.py                         ← generates the static full + small marks
├── gen2.py                        ← generates the dynamics × freshness spec sheet
├── gen3.py                        ← glyph vocabulary v1 (superseded)
├── gen4.py                        ← glyph vocabulary v2 (base glyph library)
├── gen5.py                        ← monochrome stress-test (v2)
├── gen6.py                        ← glyph vocabulary v3 + mono retest (current)
├── gen7.py                        ← epic-forms flat glyphs (§4d) + mono test
├── gen8.py                        ← epic MARKS: rendered orchestra family (§4d)
└── assets/
    ├── concept-e-orchestra.svg/.png        ← full mark (fresh, mf)
    ├── concept-e-orchestra-small.svg/.png  ← small-size variant
    ├── spec-sheet.svg/.png                 ← the dynamics + freshness ranges
    ├── glyph-sheet.svg/.png                ← vocabulary v1 (draft, superseded)
    ├── glyph-sheet-v2.svg/.png             ← vocabulary v2 (superseded)
    ├── mono-test.svg/.png                  ← v2 mono stress-test (found failures)
    ├── glyph-sheet-v3.svg/.png             ← vocabulary v3 (current)
    ├── mono-test-v3.svg/.png               ← v3 mono retest (fixes verified)
    ├── glyph-sheet-epics.svg/.png          ← epic-forms flat glyphs (§4d)
    ├── mono-test-epics.svg/.png            ← epic-forms mono stress-test
    ├── epic-symphony|concerto|suite|fugue|overture.svg/.png  ← rendered epic MARKS (512px, §4d)
    ├── epic-suite-small.svg/.png           ← ≤96px zoom variant (bold dots)
    ├── epic-fugue-small.svg/.png           ← ≤96px zoom variant (bold dots)
    ├── epic-marks-sheet.svg/.png           ← the rendered family + 96px legibility row
    └── prod/                               ← production set: <form>-{512,192,96,48}.png
```

### Regenerating

Vector, hand-authored SVG → PNG via `cairosvg` (pure-Python, no system deps).

```bash
python3 -m venv /tmp/venv && /tmp/venv/bin/pip install cairosvg
cd docs/branding && /tmp/venv/bin/python gen.py && /tmp/venv/bin/python gen2.py
```

Everything is vector and fully owned — no marketplace licence, no trademark-use
ambiguity. `intensity` and `freshness` are the two knobs to wire to live data.

## 4a. Glyph vocabulary (draft v2)

A full iconographic language in the same orchestra world. Every entity and every
*state* gets a distinct musical glyph, coloured by its section-family. Rendered
sheet: `assets/glyph-sheet-v2.png` (generator: `gen4.py`).

**Agents / roles — each player's instrument or mark**

| Role | Glyph | Colour |
|---|---|---|
| Coordinator | podium + baton + downbeat spark | gold |
| Specifier | treble clef (sets the key/intent) | violet |
| Architect | grand piano (top view) — the harmonic structure | violet |
| Coder | cello — a voice being played | blue |
| QA | tuning fork — in tune? | teal |
| Hardener | timpani — percussion/backbone | teal |
| Cleaner | natural sign ♮ — removes accidentals/cruft | grey |
| Documenter | open book / programme | gold |
| Recruiter | empty chair — fill a seat | blue |
| Support | call bell | coral |

**BL items — a passage + a state mark**

| State | Glyph |
|---|---|
| epic | orchestral brace grouping staves (a symphony) |
| ticket | single staff (a movement) |
| todo | rest (unplayed) |
| in-progress | beamed notes + crescendo hairpin |
| blocked | caesura `//` |
| done | final barline `𝄂` |
| bounced | repeat sign `𝄆` (da capo) |
| needs_design | rest + `?` |

**Structure & signals — larger units and live meters**

| Entity | Glyph |
|---|---|
| Swarm | the mini ensemble fan (a coordinator + its pack) |
| Fleet | concert-hall proscenium with rows (many ensembles) |
| Operator | the patron in a seat (the human, external to the swarm) |
| Handoff | a slur + arrow — a motif passed between voices |
| Cost / burn-rate | a metronome — tempo = spend rate |
| Health | in-tune check ✓ |

**Support / front-desk — the box office**

| Event | Glyph |
|---|---|
| new request | bell with ring-waves |
| message | envelope + note |
| ticket stub | box-office stub |

**Known-weak / still-open glyphs** (honest notes for the next pass):
- Coordinator podium reads slightly like a trophy at tiny sizes; baton is small.
- Todo (rest) / Blocked (caesura) / Done (barline) are all thin vertical marks —
  differentiated today mainly by colour; verify they hold in monochrome.
- Specifier clef and Handoff slur are loose approximations; refine curves.
- Model / provider glyph is still TBD (candidate: a tuning peg / scroll).

## 4b. Monochrome stress-test findings

Rendered every glyph in one ink at 16/20/24/32/48px on dark + a 24px light chip
(`assets/mono-test.png`, generator `gen5.py`). What colour was hiding:

- **Robust (16px, mono, both themes):** QA, Architect, Documenter, Recruiter,
  Support, Health, Message, Ticket-stub, Cost, Operator, Epic, Blocked, In-progress, Fleet.
- **Borderline (ok ≥24px, mushy at 16):** Coder (cello → blob), Swarm (dots lose
  the fan), Specifier, Cleaner, Todo, Needs-design, Handoff.
- **FAIL — Ticket (staff):** the 5 lines merge into a solid block ≤24px. Needs a
  small-size treatment (fewer/thicker lines, or a card-with-one-note).
- **FAIL — Coordinator (podium):** ambiguous at 16px; redesign small (bold baton).
- **LIGHT-MODE BUG:** Coordinator baton + Architect keyboard are hardcoded
  `#f4f7fa` and vanish on light backgrounds. **Rule: internal detail must derive
  from the ink (currentColor), never a literal light/dark colour.**
- **Confusable cluster:** Ticket-block / Done (𝄂) / Bounced (|:) read alike at
  ≤20px in mono; they need shape divergence, not just hue.

## 4c. v3 — fixes verified (current)

`gen6.py` → `assets/glyph-sheet-v3.png` + `assets/mono-test-v3.png`. Scope was
the four actual failures from §4b; all verified fixed in the mono retest:

- **Theme-safe inks (RULE):** a glyph may use only its ink `c` and the known
  tile background `BG` — no hardcoded light/dark literals. Fixes the vanishing
  Coordinator baton / Architect keyboard in light mode.
- **Coordinator v3:** one bold diagonal baton + handle dot + downbeat star.
  Legible at 16px, both themes. (Slightly wand-adjacent; acceptable trade.)
- **Ticket v3:** a score *card* holding a single note — card silhouette
  survives 16px where the 5-line staff smeared solid.
- **Done v3:** fermata over the final barline — no longer a bare vertical.
- **Bounced v3:** repeat sign with dominant dots — dots are the identity.

Still deferred (borderline, revisit at final-set selection): Coder cello blobs
at 16px, Swarm loses the fan, Specifier clef / Todo rest / Handoff slur are
squiggles at 16px. All fine ≥24px.

## 4d. Epic forms — a musical-form family (current)

The collection this grows is the **rendered `concept-e-orchestra` marks** (§1–3),
not the flat glyph tiles. Epics had exactly **one** mark. But an epic is a
*large-scale form*, and the metaphor has more than one — so epics now draw from
an **epic-forms family**: five distinct large-scale musical forms, each rendered
in the identical podium/orchestra language (navy rounded tile, brass podium +
white baton + downbeat star, glossy section-coloured arc-dots). Each form keeps
the treatment and palette and only **rearranges the ensemble** into its own
signature composition, so the family reads as one system.

**Rendered marks** — `gen8.py` → `assets/epic-<form>.png` (512px) +
`assets/epic-marks-sheet.png` (family + 96px legibility row). Reuses `gen.py`'s
`arc_dots` / `arc_line` / `podium`, so podium and dots are pixel-identical to
the flagship mark.

| Form | Composition | Reads as (epic shape) |
|---|---|---|
| **Symphony** | the full 4-section fan + podium (= the flagship mark) | the multi-movement flagship work |
| **Concerto** | two arcs behind one large glowing brass soloist dot | one headline capability the rest supports |
| **Suite** | three separate mini-fans side by side | a themed *set* of loosely-coupled movements |
| **Fugue** | one short fan entering three times, staggered up-right | tightly interdependent parallel workstreams |
| **Overture** | dots radiating in rays under an enlarged burst-star | a foundational / kickoff epic others follow |

Design notes:
- **One source of truth** — Symphony *is* `concept-e-orchestra` (same `gen.FULL`
  sections + `gen.podium`); the other four branch only in dot layout.
- **Distinct compositions, not just palette** — full fan vs. soloist-and-tutti
  vs. three-groups vs. climbing-stagger vs. sunburst.
- **Zoom switch (like the flagship's `-small`)** — Suite and Fugue thin out at
  48px, so each has a `-small` variant that drops to three BOLD dots + a bolder
  podium: Suite = a shallow symmetric bowl (a set side-by-side), Fugue = a
  diagonal climb (staggered entries) — still clearly distinct at 48px. The
  production export uses the small variant at ≤96px and the full composition at
  ≥192px automatically. Symphony / Concerto / Overture hold at all sizes with no
  variant needed.
- **Overture ≠ In-progress** — the radial burst is deliberately distinct from
  the crescendo hairpin that marks in-progress tickets (§4a).

**Flat / mono counterpart** — `gen7.py` renders the same five forms as flat
monochrome glyphs (`assets/glyph-sheet-epics.png`) for small-badge / one-ink
contexts, mono-verified 16–48px on dark + a 24px light chip
(`assets/mono-test-epics.png`), following the v3 ink-only rule. Use the rendered
marks wherever colour + size allow; the flat glyphs are the fallback.

**Where these render (same wall as everything else):** this whole family is
owned SVG for the **PWA / fleet-console** (and Telegram *bot-avatar* imagery,
which is a free-form image like the reference mark). Telegram *topic* icons are
still limited to the free `getForumTopicIconStickers` set (§5a) — no notation or
instruments — so **epic topics on Telegram remain a separate stock-emoji
decision** (or stay on their hand-assigned trophy/lightning/folder until richer
icons exist). This family does not change that; it enriches the surfaces where
the vocabulary actually lives.

## 5. Design journey (for context)

Explored and rejected on the way here:

- **Hex-swarm / anvil-forge** — literal "swarm + forge"; fine, but generic and
  off-metaphor once the orchestra idea landed.
- **Standalone baton** — read as a *magic wand* (white stick + gold star). The
  baton survives only as the conductor's raised stick inside the podium.
- **Standalone pupitre (music stand)** — clean and strong (see earlier concepts),
  a good candidate for a secondary "workstation / single-agent" mark, but the
  orchestra view tells the whole-system story better as the primary.

## 5a. Reconciling with Telegram topics (reality check, 2026-07-15)

**The reconciliation process already exists — BL-342 shipped it.**
`extension/src/concierge/topicIcon.ts` + `topicIconSync.ts` make every BL
topic's icon track its ticket's state (fired from ticket transitions in
`conciergeTick.ts`; bulk tool: `tools/backfill-topic-icons.ts`). Current
mapping (`ICON_EMOJI`): ✅ done · 🦠 defect in flight · 💡 feature in flight ·
🔍 paused. Ownership rule: the swarm never touches an icon it did not set
(human-customised topics are left alone); epic icons are hand-assigned and
out of automation's scope.

**Platform wall:** Telegram bots may only use topic icons from the free
`getForumTopicIconStickers` set — arbitrary images/custom SVGs are NOT
allowed via the Bot API. The orchestra glyphs therefore CANNOT be Telegram
topic icons. The shipped resolver already validates against the live set and
skips unresolvable emoji (BL-342 scenario 06).

**Live set checked 2026-07-15** (112 stickers; the set can change over time):
- Musical/performance emoji PRESENT: 🎵 🎶 🎙 🎤 🎬 🎭 🎟 🎨 🎩 🕺 💃 🏛 ✍️ 📚
- ABSENT — no instruments or notation: 🎼 🎻 🥁 🎹 🎺 etc. The role-instrument
  glyphs cannot reach Telegram at all; that layer is PWA-only.
- Best musical remap available (small ticket if adopted):
  feature-in-flight 💡 → 🎵 ("a passage being played"); support/intake
  topics → 🎟 (the box office); standing Operator topic → 🏛 (opera house —
  decided by the human 2026-07-15);
  keep ✅ (done) 🦠 (defect) 🔍 (paused) — no musical stand-in beats them.
  Intake filed: `backlog/INTAKE-orchestra-emoji-topic-remap.md`.

**Consequence — where each layer of this system actually renders:**
- Telegram topics → stock-emoji state mapping only (the existing BL-342
  machinery; changing the table is a small, tested-code ticket in the shared
  concierge-tick file cluster).
- PWA / fleet console / leaderboard → the full orchestra glyph set with
  dynamics + freshness; no platform constraint. This is the surface the
  vocabulary above is really for.
- These branding docs themselves → no pipeline needed; docs-only commit.

## 6. Open questions / next steps

- [ ] Ratify the orchestra direction as the official mark.
- [ ] Wire `intensity` ← live activity (dispatch rate / active-agent count) and
      `freshness` ← last-report timestamp; decide the exact thresholds.
- [ ] Decide whether the **pupitre** becomes the per-agent/workstation icon in a
      matched pair with the orchestra (fleet) icon.
- [ ] Export the production size set (512 / 192 / 96 / 48) for PWA + Telegram.
- [ ] Fix the spec-sheet's right-edge clip on the "stale" tile (cosmetic).
- [ ] Consider a **crescendo** transition (animated Lottie) for state changes.
