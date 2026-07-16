# gen7.py -- epic-forms family: distinct large-scale musical FORMS for epics.
# Grows the owned Orchestra vocabulary past its single epic mark (g_brace).
# Follows v3 rules: a glyph uses ONLY its ink `c` and the module BG (tile
# colour) -- no hardcoded light/dark literals, so every form survives theme
# inversion. Renders the family colour-sheet + a monochrome stress-test at
# 16/20/24/32/48px (dark) + 24px light, the project's own legibility gate.
#
# Why these live here and NOT in Telegram: the Bot API only allows topic
# icons from its free getForumTopicIconStickers set (no instruments/notation).
# These owned SVGs are the PWA / fleet-console layer; Telegram epics remain a
# separate stock-emoji decision. See docs/branding/icon-system.md.
import cairosvg
import gen4  # base library + palette; g_brace ("symphony") is reused as-is

BG = "#141a26"

P = dict(GOLD="#ffd36b", TEAL="#3ec9b0", BLUE="#3ea6ff", VIOLET="#a68cff",
         GREY="#9aa4b2", CORAL="#ff9a6b", GREEN="#6fd08a", AMBER="#f0b84c")


# --- epic forms --------------------------------------------------------------
def g_symphony(cx, cy, u, c):
    """The flagship: a brace grouping three staves -- a full multi-movement
    work. Delegates to the established v2 brace so the canonical epic mark
    stays a single source of truth."""
    return gen4.g_brace(cx, cy, u, c)


def g_concerto(cx, cy, u, c):
    """Soloist + tutti: one bold note-head under a shallow arc of three small
    ensemble dots -- an epic driven by one headline capability the rest
    supports. Silhouette = big note beneath three dots (no collision with the
    brace's staff lines)."""
    dots = "".join(
        f'<circle cx="{cx+dx*u:.3f}" cy="{cy+dy*u:.3f}" r="{0.13*u:.3f}" fill="{c}"/>'
        for dx, dy in [(-0.7, -0.72), (0.0, -0.9), (0.7, -0.72)])
    stem = f'<rect x="{cx+0.22*u:.3f}" y="{cy-0.5*u:.3f}" width="{0.1*u:.3f}" height="{0.95*u:.3f}" fill="{c}"/>'
    head = (f'<ellipse cx="{cx:.3f}" cy="{cy+0.45*u:.3f}" rx="{0.32*u:.3f}" ry="{0.25*u:.3f}" '
            f'fill="{c}" transform="rotate(-18 {cx:.3f} {cy+0.45*u:.3f})"/>')
    return dots + stem + head


def g_suite(cx, cy, u, c):
    """A themed set of movements: a square span-bracket over a row of three
    discrete movement-notes. Square bracket + GAPS between notes read as
    'a collection', distinct from the symphony's continuous curly brace."""
    span = (f'<path d="M{cx-0.8*u:.3f} {cy-0.55*u:.3f} v-{0.22*u:.3f} h{1.6*u:.3f} v{0.22*u:.3f}" '
            f'fill="none" stroke="{c}" stroke-width="{0.12*u:.3f}" stroke-linejoin="round"/>')
    notes = []
    for dx in (-0.6, 0.0, 0.6):
        hx, hy = cx + dx * u, cy + 0.5 * u
        notes.append(f'<ellipse cx="{hx:.3f}" cy="{hy:.3f}" rx="{0.2*u:.3f}" ry="{0.16*u:.3f}" '
                     f'fill="{c}" transform="rotate(-18 {hx:.3f} {hy:.3f})"/>'
                     f'<rect x="{hx+0.13*u:.3f}" y="{hy-0.62*u:.3f}" width="{0.08*u:.3f}" height="{0.62*u:.3f}" fill="{c}"/>')
    return span + "".join(notes)


def g_fugue(cx, cy, u, c):
    """Interwoven parallel voices: three note-heads entering in staggered
    imitation (stretto), climbing a common diagonal -- an epic of tightly
    interdependent workstreams. The stagger is the identity."""
    guide = (f'<line x1="{cx-0.85*u:.3f}" y1="{cy+0.75*u:.3f}" x2="{cx+0.8*u:.3f}" y2="{cy-0.55*u:.3f}" '
             f'stroke="{c}" stroke-width="{0.07*u:.3f}" stroke-linecap="round" opacity="0.85"/>')
    voices = []
    for dx, dy in [(-0.6, 0.55), (-0.03, 0.15), (0.55, -0.25)]:
        hx, hy = cx + dx * u, cy + dy * u
        voices.append(f'<ellipse cx="{hx:.3f}" cy="{hy:.3f}" rx="{0.22*u:.3f}" ry="{0.17*u:.3f}" '
                      f'fill="{c}" transform="rotate(-22 {hx:.3f} {hy:.3f})"/>'
                      f'<rect x="{hx+0.14*u:.3f}" y="{hy-0.6*u:.3f}" width="{0.08*u:.3f}" height="{0.6*u:.3f}" fill="{c}"/>')
    return guide + "".join(voices)


def g_overture(cx, cy, u, c):
    """The opening: a fanfare note bursting from an opening double-barline --
    a foundational / kickoff epic that everything downstream follows. Rays +
    left double-bar keep it clear of the crescendo (in-progress) hairpin."""
    bar = (f'<rect x="{cx-0.7*u:.3f}" y="{cy-0.8*u:.3f}" width="{0.28*u:.3f}" height="{1.6*u:.3f}" fill="{c}"/>'
           f'<rect x="{cx-0.32*u:.3f}" y="{cy-0.8*u:.3f}" width="{0.1*u:.3f}" height="{1.6*u:.3f}" fill="{c}"/>')
    hx, hy = cx + 0.35 * u, cy + 0.12 * u
    head = f'<ellipse cx="{hx:.3f}" cy="{hy:.3f}" rx="{0.24*u:.3f}" ry="{0.19*u:.3f}" fill="{c}" transform="rotate(-18 {hx:.3f} {hy:.3f})"/>'
    stem = f'<rect x="{hx+0.16*u:.3f}" y="{hy-0.7*u:.3f}" width="{0.09*u:.3f}" height="{0.7*u:.3f}" fill="{c}"/>'
    rays = "".join(
        f'<line x1="{cx+0.55*u:.3f}" y1="{cy-0.35*u:.3f}" x2="{cx+0.55*u+rx*u:.3f}" y2="{cy-0.35*u+ry*u:.3f}" '
        f'stroke="{c}" stroke-width="{0.08*u:.3f}" stroke-linecap="round"/>'
        for rx, ry in [(0.35, -0.28), (0.5, 0.0), (0.35, 0.28)])
    return bar + rays + head + stem


FORMS = [
    ("Symphony", "multi-movement work", g_symphony, P["GOLD"]),
    ("Concerto", "soloist + tutti", g_concerto, P["BLUE"]),
    ("Suite", "set of movements", g_suite, P["VIOLET"]),
    ("Fugue", "parallel voices", g_fugue, P["TEAL"]),
    ("Overture", "kickoff / foundation", g_overture, P["AMBER"]),
]


# --- colour family sheet -----------------------------------------------------
def tile(cx, cy, size, fn, label, sub, col):
    x0, y0 = cx - size / 2, cy - size / 2
    return (f'<rect x="{x0}" y="{y0}" width="{size}" height="{size}" rx="{size*0.22}" fill="{BG}"/>'
            f'{fn(cx, cy-0.02*size, size*0.26, col)}'
            f'<text x="{cx}" y="{y0+size+24}" text-anchor="middle" font-family="Helvetica,Arial" font-size="18" font-weight="700" fill="#1b2230">{label}</text>'
            f'<text x="{cx}" y="{y0+size+45}" text-anchor="middle" font-family="Helvetica,Arial" font-size="13" fill="#6b7480">{sub}</text>')


S, GAP, LEFT = 120, 24, 60
W = LEFT * 2 + len(FORMS) * S + (len(FORMS) - 1) * GAP
H = 300
parts = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">',
         f'<rect width="{W}" height="{H}" fill="#eef0f3"/>',
         f'<text x="{LEFT}" y="50" font-family="Helvetica,Arial" font-size="25" font-weight="800" fill="#1b2230">EPIC FORMS</text>',
         f'<text x="{LEFT}" y="74" font-family="Helvetica,Arial" font-size="15" fill="#6b7480">large-scale musical forms &#8212; a distinct mark per epic shape (owned SVG; PWA / fleet-console layer)</text>']
x = LEFT + S / 2
for (label, sub, fn, col) in FORMS:
    parts.append(tile(x, 155, S, fn, label, sub, col))
    x += S + GAP
parts.append("</svg>")
svg = "\n".join(parts)
open("assets/glyph-sheet-epics.svg", "w").write(svg)
cairosvg.svg2png(bytestring=svg.encode(), write_to="assets/glyph-sheet-epics.png", output_width=W, output_height=H)
print(f"wrote glyph-sheet-epics {W}x{H}")


# --- monochrome stress-test --------------------------------------------------
INK_ON_DARK, INK_ON_LIGHT = "#e2e6ec", "#232833"
DARK_TILE, LIGHT_TILE = "#141a26", "#ffffff"


def set_bg(dark):
    global BG
    BG = DARK_TILE if dark else LIGHT_TILE
    return INK_ON_DARK if dark else INK_ON_LIGHT


SIZES = [16, 20, 24, 32, 48]
OFF = {16: 300, 20: 360, 24: 425, 32: 500, 48: 590, "light": 700}
RH, TOP, LABELX = 66, 120, 24
W2 = 800
H2 = TOP + len(FORMS) * RH + 30
parts = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W2}" height="{H2}" viewBox="0 0 {W2} {H2}">',
         f'<rect width="{W2}" height="{H2}" fill="#eef0f3"/>',
         '<text x="24" y="46" font-family="Helvetica,Arial" font-size="26" font-weight="800" fill="#1b2230">EPIC FORMS &#8212; MONOCHROME STRESS-TEST</text>',
         '<text x="24" y="72" font-family="Helvetica,Arial" font-size="15" fill="#6b7480">theme-safe inks; 16 / 20 / 24 / 32 / 48 px on dark + 24px on light</text>']
for s in SIZES:
    parts.append(f'<text x="{OFF[s]}" y="{TOP-16}" text-anchor="middle" font-family="Helvetica,Arial" font-size="12" fill="#8b939d">{s}</text>')
parts.append(f'<text x="{OFF["light"]}" y="{TOP-16}" text-anchor="middle" font-family="Helvetica,Arial" font-size="12" fill="#8b939d">24&#9788;</text>')
for ri, (label, sub, fn, col) in enumerate(FORMS):
    cy = TOP + ri * RH + RH / 2
    parts.append(f'<text x="{LABELX}" y="{cy+5}" font-family="Helvetica,Arial" font-size="15" font-weight="600" fill="#1b2230">{label}</text>')
    for s in SIZES:
        ink = set_bg(dark=True)
        side = s + 14
        cx = OFF[s]
        parts.append(f'<rect x="{cx-side/2:.1f}" y="{cy-side/2:.1f}" width="{side}" height="{side}" rx="{side*0.22:.1f}" fill="{DARK_TILE}"/>')
        parts.append(fn(cx, cy, s / 2.6, ink))
    ink = set_bg(dark=False)
    side = 24 + 14
    cx = OFF["light"]
    parts.append(f'<rect x="{cx-side/2:.1f}" y="{cy-side/2:.1f}" width="{side}" height="{side}" rx="{side*0.22:.1f}" fill="{LIGHT_TILE}"/>')
    parts.append(fn(cx, cy, 24 / 2.6, ink))
parts.append("</svg>")
svg = "\n".join(parts)
open("assets/mono-test-epics.svg", "w").write(svg)
cairosvg.svg2png(bytestring=svg.encode(), write_to="assets/mono-test-epics.png", output_width=W2, output_height=H2)
print(f"wrote mono-test-epics {W2}x{H2}")
