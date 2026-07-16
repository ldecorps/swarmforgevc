import cairosvg
import gen4  # imports + renders v2 as a side effect; gives us all glyph fns

INK_LIGHT = "#e2e6ec"   # ink on dark tiles
INK_DARK  = "#232833"   # ink on light tiles

def set_ink(v):
    # glyph fns read these module globals at call time -> forces monochrome
    for name in ["GOLD","TEAL","BLUE","VIOLET","GREY","CORAL","GREEN","AMBER","NAVY1"]:
        setattr(gen4, name, v)

GLYPHS = [
    (gen4.g_podium, "Coordinator"), (gen4.g_clef, "Specifier"),
    (gen4.g_piano, "Architect"), (gen4.g_cello, "Coder"),
    (gen4.g_fork, "QA"), (gen4.g_kettledrum, "Hardener"),
    (gen4.g_natural, "Cleaner"), (gen4.g_book, "Documenter"),
    (gen4.g_chair, "Recruiter"), (gen4.g_bell, "Support"),
    (gen4.g_brace, "Epic"), (gen4.g_staff, "Ticket"),
    (gen4.g_rest, "Todo"), (gen4.g_cresc, "In progress"),
    (gen4.g_caesura, "Blocked"), (gen4.g_finalbar, "Done"),
    (gen4.g_repeat, "Bounced"), (gen4.g_needsdesign, "Needs design"),
    (gen4.g_ensemble, "Swarm"), (gen4.g_fleet, "Fleet"),
    (gen4.g_operator, "Operator"), (gen4.g_handoff, "Handoff"),
    (gen4.g_metronome, "Cost/burn"), (gen4.g_health, "Health"),
    (gen4.g_bell_ring, "New request"), (gen4.g_envelope, "Message"),
    (gen4.g_stub, "Ticket stub"),
]

SIZES = [16, 20, 24, 32, 48]          # dark-tile chips
DARK_TILE = "#141a26"

def chip(cx, cy, p, dark=True):
    side = p + 14
    bg = DARK_TILE if dark else "#ffffff"
    ink = INK_LIGHT if dark else INK_DARK
    set_ink(ink)
    sq = f'<rect x="{cx-side/2:.1f}" y="{cy-side/2:.1f}" width="{side}" height="{side}" rx="{side*0.22:.1f}" fill="{bg}"/>'
    glyph = GLYPHS_CUR[0](cx, cy, p/2.6, ink)
    return sq + glyph

# column layout
COLW = 660
BLOCKS = [GLYPHS[:14], GLYPHS[14:]]
RH = 66
TOP = 120
W = 2*COLW + 40
H = TOP + max(len(b) for b in BLOCKS)*RH + 30

parts = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">',
         f'<rect width="{W}" height="{H}" fill="#eef0f3"/>',
         '<text x="24" y="46" font-family="Helvetica,Arial" font-size="26" font-weight="800" fill="#1b2230">MONOCHROME STRESS-TEST</text>',
         '<text x="24" y="72" font-family="Helvetica,Arial" font-size="15" fill="#6b7480">one ink, no colour-coding &#8212; sizes 16 / 20 / 24 / 32 / 48 px on dark, + 24px light-mode</text>']

# column offsets for chips within a block (relative to block x0)
OFF = {16: 175, 20: 235, 24: 300, 32: 375, 48: 465, "light": 575}

for bi, block in enumerate(BLOCKS):
    x0 = 20 + bi*COLW
    # header sizes
    for s in SIZES:
        parts.append(f'<text x="{x0+OFF[s]}" y="{TOP-16}" text-anchor="middle" font-family="Helvetica,Arial" font-size="12" fill="#8b939d">{s}</text>')
    parts.append(f'<text x="{x0+OFF["light"]}" y="{TOP-16}" text-anchor="middle" font-family="Helvetica,Arial" font-size="12" fill="#8b939d">24&#9788;</text>')
    for ri, (fn, label) in enumerate(block):
        cy = TOP + ri*RH + RH/2
        parts.append(f'<text x="{x0+8}" y="{cy+5}" font-family="Helvetica,Arial" font-size="15" font-weight="600" fill="#1b2230">{label}</text>')
        globals()['GLYPHS_CUR'] = (fn,)
        for s in SIZES:
            parts.append(chip(x0+OFF[s], cy, s, dark=True))
        parts.append(chip(x0+OFF["light"], cy, 24, dark=False))

parts.append("</svg>")
svg = "\n".join(parts)
open("mono-test.svg", "w").write(svg)
cairosvg.svg2png(bytestring=svg.encode(), write_to="mono-test.png", output_width=W, output_height=H)
print(f"wrote mono-test  {W}x{H}")
