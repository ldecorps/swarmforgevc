# gen8.py -- EPIC MARKS: full rendered marks in the podium/orchestra language
# (the concept-e-orchestra family), one per large-scale musical form. NOT the
# flat glyph tiles (gen7) -- these are the rich 512px marks the collection is
# actually made of: navy rounded tile, brass podium + white baton + downbeat
# star, glossy section-coloured arc-dots with faint arc-lines.
#
# Each epic form keeps the SAME rendering treatment and palette but rearranges
# the ensemble into that form's signature composition, so the family reads as
# one system. Reuses gen.py's primitives (arc_dots / arc_line / podium) so the
# podium and dots are pixel-identical to the flagship mark.
#
# Outputs (assets/): epic-symphony|concerto|suite|fugue|overture .svg/.png
# at 512, plus epic-marks-sheet.png (labelled family + a 96px legibility row).
import math, cairosvg
import gen  # primitives; side effect: re-renders the base mark to cwd (harmless)

GOLD, TEAL, BLUE, VIOLET = "#ffd36b", "#3ec9b0", "#3ea6ff", "#a68cff"

DEFS = ('<defs>'
        '<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">'
        '<stop offset="0" stop-color="#1c2233"/><stop offset="1" stop-color="#0b0f18"/></linearGradient>'
        '<linearGradient id="brass" x1="0" y1="0" x2="0" y2="1">'
        '<stop offset="0" stop-color="#ffe9a8"/><stop offset="1" stop-color="#e6a53c"/></linearGradient>'
        '<radialGradient id="soloist" cx="0.5" cy="0.38" r="0.62">'
        '<stop offset="0" stop-color="#fff3cf"/><stop offset="1" stop-color="#e6a53c"/></radialGradient>'
        '</defs>')


def spark(cx, cy, a, fill="url(#brass)", op=1.0):
    return (f'<path d="M{cx} {cy-a:.1f} l{a*.32:.1f} {a*.9:.1f} {a*.9:.1f} {a*.32:.1f} '
            f'-{a*.9:.1f} {a*.32:.1f} -{a*.32:.1f} {a*.9:.1f} -{a*.32:.1f} -{a*.9:.1f} '
            f'-{a*.9:.1f} -{a*.32:.1f} {a*.9:.1f} -{a*.32:.1f}z" fill="{fill}" opacity="{op:.2f}"/>')


def glow_dot(x, y, r, ring, core):
    return (f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r*2.3:.1f}" fill="{ring}" opacity="0.16"/>'
            f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r:.1f}" fill="{core}"/>')


def mini_fan(cx, cy, radius, n, color, span=(205, 335), rd=9):
    """A small self-contained ensemble bowl opening upward around (cx,cy)."""
    return (gen.arc_line(cx, cy, radius, span[0], span[1], color, 3, 0.16)
            + gen.arc_dots(cx, cy, radius, span[0], span[1], n, rd, color))


# --- the five epic forms (each returns 512-canvas inner SVG) ------------------
def comp_symphony(cx=256, cy=388):
    """Flagship: the full 4-section fan + podium — the canonical orchestra mark."""
    lines = "".join(gen.arc_line(cx, cy, r, s0, s1, c, 4, 0.16) for (r, (s0, s1), n, rd, c) in gen.FULL)
    dots = "".join(gen.arc_dots(cx, cy, r, s0, s1, n, rd, c) for (r, (s0, s1), n, rd, c) in gen.FULL)
    return f'<g stroke-linecap="round">{lines}</g>{dots}{gen.podium(cx, cy, 1.0)}'


def comp_concerto(cx=256, cy=396):
    """Soloist + tutti: two ensemble arcs behind one large glowing brass
    soloist dot front-centre — an epic driven by one headline capability."""
    tutti = "".join([
        mini_fan(cx, cy, 214, 9, BLUE, span=(206, 334), rd=9),
        mini_fan(cx, cy, 256, 11, VIOLET, span=(202, 338), rd=8),
    ])
    soloist = glow_dot(cx, cy - 108, 30, GOLD, "url(#soloist)")
    return tutti + soloist + gen.podium(cx, cy, 0.82)


def comp_suite(cx=256, cy=410):
    """A themed SET of movements: three separate mini-fans side by side, each
    its own little dance — distinct groups, not one continuous ensemble."""
    fans = "".join([
        mini_fan(150, 268, 52, 3, GOLD, rd=10),
        mini_fan(256, 236, 52, 3, BLUE, rd=10),
        mini_fan(362, 268, 52, 3, VIOLET, rd=10),
    ])
    return fans + gen.podium(cx, cy, 0.8)


def comp_fugue(cx=256, cy=418):
    """Interwoven voices: one subject entering three times in staggered
    imitation (stretto) — the same short fan climbing up-right."""
    entries = "".join([
        mini_fan(180, 344, 60, 4, TEAL, span=(210, 330), rd=9),
        mini_fan(240, 288, 60, 4, BLUE, span=(210, 330), rd=9),
        mini_fan(300, 232, 60, 4, VIOLET, span=(210, 330), rd=9),
    ])
    return entries + gen.podium(cx, cy, 0.75)


def comp_overture(cx=256, cy=424):
    """The opening: a fanfare bursting from the podium — dots radiating in rays
    (curtain up) under an enlarged glowing downbeat star."""
    ax, ay = cx, cy - 150
    rays, angles, radii = [], range(205, 336, 22), [70, 116, 162]
    cols = [GOLD, TEAL, BLUE, VIOLET]
    for j, t in enumerate(angles):
        rad = math.radians(t)
        for k, R in enumerate(radii):
            x, y = ax + R * math.cos(rad), ay + R * math.sin(rad)
            rays.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{7+1.6*k:.1f}" fill="{cols[j % 4]}"/>')
    burst = (f'<circle cx="{ax}" cy="{ay}" r="46" fill="url(#soloist)" opacity="0.18"/>'
             + spark(ax, ay, 30, "url(#soloist)"))
    return "".join(rays) + gen.podium(cx, cy, 0.8) + burst


# --- small variants: ≤96px zoom of the two sparsest forms --------------------
# Same philosophy as concept-e-orchestra-small: drop to a few BOLD dots + a
# bolder podium so the identity survives 48px, where the full multi-dot
# compositions thin out. Suite = three big dots across a shallow bowl (a set
# side by side); Fugue = three big dots climbing a diagonal (staggered entries).
def comp_suite_small(cx=256, cy=362):
    dots = [(150, 250, GOLD, 30), (256, 222, BLUE, 33), (362, 250, VIOLET, 30)]
    tie = (f'<path d="M150 250 Q256 200 362 250" fill="none" stroke="{BLUE}" '
           f'stroke-width="5" opacity="0.16"/>')
    circles = "".join(f'<circle cx="{x}" cy="{y}" r="{r}" fill="{c}"/>' for (x, y, c, r) in dots)
    return tie + circles + gen.podium(cx, cy, 1.3)


def comp_fugue_small(cx=256, cy=384):
    dots = [(176, 322, TEAL, 28), (256, 268, BLUE, 31), (336, 214, VIOLET, 33)]
    guide = f'<path d="M176 322 L336 214" fill="none" stroke="{BLUE}" stroke-width="5" opacity="0.16"/>'
    circles = "".join(f'<circle cx="{x}" cy="{y}" r="{r}" fill="{c}"/>' for (x, y, c, r) in dots)
    return guide + circles + gen.podium(cx, cy, 1.25)


SMALL = {"epic-suite": comp_suite_small, "epic-fugue": comp_fugue_small}


FORMS = [
    ("epic-symphony", "Symphony", "multi-movement work", comp_symphony),
    ("epic-concerto", "Concerto", "soloist + tutti", comp_concerto),
    ("epic-suite", "Suite", "set of movements", comp_suite),
    ("epic-fugue", "Fugue", "parallel voices", comp_fugue),
    ("epic-overture", "Overture", "kickoff / foundation", comp_overture),
]


def frame(inner):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">'
            f'{DEFS}<rect width="512" height="512" rx="112" fill="url(#bg)"/>{inner}</svg>')


for (name, _label, _sub, comp) in FORMS:
    svg = frame(comp())
    open(f"assets/{name}.svg", "w").write(svg)
    cairosvg.svg2png(bytestring=svg.encode(), write_to=f"assets/{name}.png", output_width=512, output_height=512)
print(f"wrote {len(FORMS)} epic marks (512px)")

for (name, comp) in SMALL.items():
    svg = frame(comp())
    open(f"assets/{name}-small.svg", "w").write(svg)
    cairosvg.svg2png(bytestring=svg.encode(), write_to=f"assets/{name}-small.png", output_width=512, output_height=512)
print(f"wrote {len(SMALL)} small variants (512px)")


# --- family contact sheet: labelled row + a 96px legibility row ---------------
T, GAP, LEFT, TOP = 240, 30, 70, 150
scale = T / 512
W = LEFT * 2 + len(FORMS) * T + (len(FORMS) - 1) * GAP
H = TOP + T + 80 + 96 + 90
parts = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">',
         DEFS,
         f'<rect width="{W}" height="{H}" fill="#eef0f3"/>',
         f'<text x="{LEFT}" y="66" font-family="Helvetica,Arial" font-size="30" font-weight="800" fill="#1b2230">EPIC MARKS &#8212; the orchestra family, one form per epic</text>',
         f'<text x="{LEFT}" y="98" font-family="Helvetica,Arial" font-size="18" fill="#6b7480">same podium / palette / rendering as concept-e-orchestra; each form rearranges the ensemble. Bottom row = 96px legibility.</text>']
x = LEFT
for (name, label, sub, comp) in FORMS:
    parts.append(f'<rect x="{x}" y="{TOP}" width="{T}" height="{T}" rx="{T*0.22:.0f}" fill="url(#bg)"/>')
    parts.append(f'<g transform="translate({x},{TOP}) scale({scale:.4f})">{comp()}</g>')
    parts.append(f'<text x="{x+T/2}" y="{TOP+T+34}" text-anchor="middle" font-family="Helvetica,Arial" font-size="22" font-weight="700" fill="#1b2230">{label}</text>')
    parts.append(f'<text x="{x+T/2}" y="{TOP+T+58}" text-anchor="middle" font-family="Helvetica,Arial" font-size="16" fill="#6b7480">{sub}</text>')
    x += T + GAP
# 96px legibility row
s2 = 96 / 512
y2 = TOP + T + 90
x = LEFT
for (name, label, sub, comp) in FORMS:
    parts.append(f'<rect x="{x}" y="{y2}" width="96" height="96" rx="21" fill="url(#bg)"/>')
    parts.append(f'<g transform="translate({x},{y2}) scale({s2:.4f})">{comp()}</g>')
    x += T + GAP
parts.append("</svg>")
svg = "\n".join(parts)
open("assets/epic-marks-sheet.svg", "w").write(svg)
cairosvg.svg2png(bytestring=svg.encode(), write_to="assets/epic-marks-sheet.png", output_width=W, output_height=H)
print(f"wrote epic-marks-sheet {W}x{H}")


# --- production size set: 512 / 192 / 96 / 48 for each form -------------------
# One vector source per form (the .svg written above); PNGs are pure raster
# downscales of it, so every size is crisp. Written to assets/prod/.
import os
PROD, SIZES = "assets/prod", [512, 192, 96, 48]
os.makedirs(PROD, exist_ok=True)
# Zoom switch: forms with a small variant use it at ≤96px; full comp at ≥192px.
for (name, _label, _sub, comp) in FORMS:
    for px in SIZES:
        c = SMALL[name] if (name in SMALL and px <= 96) else comp
        cairosvg.svg2png(bytestring=frame(c()).encode(), write_to=f"{PROD}/{name}-{px}.png",
                         output_width=px, output_height=px)
print(f"wrote prod set: {len(FORMS)} forms x {len(SIZES)} sizes -> {PROD}/ "
      f"(suite/fugue ≤96px use the small variant)")
