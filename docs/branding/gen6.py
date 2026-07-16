import cairosvg
import gen4  # unchanged glyphs come from v2 (side effect: re-renders v2, harmless)

# --- v3 rules ---------------------------------------------------------------
# RULE 1: a glyph may use ONLY its ink `c` and the module BG (the tile colour).
#         No hardcoded light/dark literals -> glyphs survive theme inversion.
BG = "#141a26"

P = dict(GOLD="#ffd36b", TEAL="#3ec9b0", BLUE="#3ea6ff", VIOLET="#a68cff",
         GREY="#9aa4b2", CORAL="#ff9a6b", GREEN="#6fd08a", AMBER="#f0b84c")

# --- redesigned glyphs -------------------------------------------------------
def g_podium_v3(cx, cy, u, c):
    """Coordinator: one bold diagonal baton + handle + downbeat star. Ink only."""
    baton = (f'<g transform="rotate(-38 {cx} {cy})">'
             f'<rect x="{cx-0.8*u}" y="{cy-0.1*u}" width="{1.45*u}" height="{0.2*u}" rx="{0.1*u}" fill="{c}"/></g>')
    handle = f'<circle cx="{cx-0.62*u}" cy="{cy+0.5*u}" r="{0.19*u}" fill="{c}"/>'
    tx, ty, a = cx+0.62*u, cy-0.55*u, 0.34*u
    spark = (f'<path d="M{tx} {ty-a} l{a*.3:.2f} {a*.7:.2f} {a*.7:.2f} {a*.3:.2f} '
             f'-{a*.7:.2f} {a*.3:.2f} -{a*.3:.2f} {a*.7:.2f} -{a*.3:.2f} -{a*.7:.2f} '
             f'-{a*.7:.2f} -{a*.3:.2f} {a*.7:.2f} -{a*.3:.2f}z" fill="{c}"/>')
    return baton + handle + spark

def g_ticket_v3(cx, cy, u, c):
    """Ticket: a score CARD holding one note — card shape survives 16px."""
    card = (f'<rect x="{cx-0.85*u}" y="{cy-0.65*u}" width="{1.7*u}" height="{1.3*u}" '
            f'rx="{0.16*u}" fill="none" stroke="{c}" stroke-width="{0.13*u}"/>')
    note = (f'<ellipse cx="{cx-0.22*u}" cy="{cy+0.22*u}" rx="{0.22*u}" ry="{0.17*u}" '
            f'fill="{c}" transform="rotate(-20 {cx-0.22*u} {cy+0.22*u})"/>'
            f'<rect x="{cx-0.04*u}" y="{cy-0.32*u}" width="{0.09*u}" height="{0.56*u}" fill="{c}"/>')
    line = f'<line x1="{cx+0.22*u}" y1="{cy-0.28*u}" x2="{cx+0.52*u}" y2="{cy-0.28*u}" stroke="{c}" stroke-width="{0.1*u}" stroke-linecap="round"/>'
    return card + note + line

def g_done_v3(cx, cy, u, c):
    """Done: final barline UNDER a fermata — silhouette no longer a bare bar."""
    thin = f'<rect x="{cx-0.3*u}" y="{cy-0.45*u}" width="{0.1*u}" height="{1.35*u}" fill="{c}"/>'
    thick = f'<rect x="{cx-0.05*u}" y="{cy-0.45*u}" width="{0.3*u}" height="{1.35*u}" fill="{c}"/>'
    ferm = (f'<path d="M{cx-0.62*u} {cy-0.62*u} A{0.62*u} {0.62*u} 0 0 1 {cx+0.62*u} {cy-0.62*u}" '
            f'fill="none" stroke="{c}" stroke-width="{0.13*u}" stroke-linecap="round"/>'
            f'<circle cx="{cx}" cy="{cy-0.72*u}" r="{0.13*u}" fill="{c}"/>')
    return thin + thick + ferm

def g_bounced_v3(cx, cy, u, c):
    """Bounced: repeat sign with DOMINANT dots — dots are the identity."""
    thick = f'<rect x="{cx-0.55*u}" y="{cy-0.9*u}" width="{0.28*u}" height="{1.8*u}" fill="{c}"/>'
    thin = f'<rect x="{cx-0.16*u}" y="{cy-0.9*u}" width="{0.1*u}" height="{1.8*u}" fill="{c}"/>'
    dots = (f'<circle cx="{cx+0.38*u}" cy="{cy-0.38*u}" r="{0.22*u}" fill="{c}"/>'
            f'<circle cx="{cx+0.38*u}" cy="{cy+0.38*u}" r="{0.22*u}" fill="{c}"/>')
    return thick + thin + dots

def g_piano_v3(cx, cy, u, c):
    """Architect: grand piano; keyboard is a BG cutout, keys in ink -> theme-safe."""
    body = (f'<path d="M{cx-0.7*u} {cy-0.75*u} L{cx+0.2*u} {cy-0.75*u} '
            f'C{cx+0.9*u} {cy-0.7*u} {cx+0.95*u} {cy+0.35*u} {cx+0.05*u} {cy+0.78*u} '
            f'L{cx-0.7*u} {cy+0.78*u} Z" fill="{c}"/>')
    kb = f'<rect x="{cx-0.56*u}" y="{cy-0.62*u}" width="{0.2*u}" height="{1.27*u}" fill="{BG}"/>'
    keys = "".join(f'<line x1="{cx-0.56*u}" y1="{cy-0.62*u+k*0.212*u:.1f}" x2="{cx-0.36*u}" '
                   f'y2="{cy-0.62*u+k*0.212*u:.1f}" stroke="{c}" stroke-width="{0.05*u}"/>' for k in range(1, 6))
    return body + kb + keys

def g_cello_v3(cx, cy, u, c):
    """Coder: cello; centre line is a BG cutout, not a hardcoded navy."""
    return (f'<ellipse cx="{cx}" cy="{cy+0.42*u}" rx="{0.55*u}" ry="{0.6*u}" fill="{c}"/>'
            f'<ellipse cx="{cx}" cy="{cy-0.32*u}" rx="{0.42*u}" ry="{0.46*u}" fill="{c}"/>'
            f'<rect x="{cx-0.08*u}" y="{cy-1.3*u}" width="{0.16*u}" height="{0.7*u}" rx="{0.05*u}" fill="{c}"/>'
            f'<circle cx="{cx}" cy="{cy-1.35*u}" r="{0.14*u}" fill="{c}"/>'
            f'<line x1="{cx}" y1="{cy-1.2*u}" x2="{cx}" y2="{cy+0.85*u}" stroke="{BG}" stroke-width="{0.09*u}"/>')

# glyph table: v3 where redesigned, gen4 elsewhere
GLYPHS = [
    ("Coordinator", "conductor", g_podium_v3, P["GOLD"]),
    ("Specifier", "sets the key", gen4.g_clef, P["VIOLET"]),
    ("Architect", "grand piano", g_piano_v3, P["VIOLET"]),
    ("Coder", "cello", g_cello_v3, P["BLUE"]),
    ("QA", "in tune?", gen4.g_fork, P["TEAL"]),
    ("Hardener", "timpani", gen4.g_kettledrum, P["TEAL"]),
    ("Cleaner", "natural sign", gen4.g_natural, P["GREY"]),
    ("Documenter", "programme", gen4.g_book, P["GOLD"]),
    ("Recruiter", "fill a seat", gen4.g_chair, P["BLUE"]),
    ("Support", "call bell", gen4.g_bell, P["CORAL"]),
    ("Epic", "symphony (brace)", gen4.g_brace, P["GOLD"]),
    ("Ticket", "a movement (card)", g_ticket_v3, P["BLUE"]),
    ("Todo", "unplayed", gen4.g_rest, P["GREY"]),
    ("In progress", "playing", gen4.g_cresc, P["TEAL"]),
    ("Blocked", "caesura", gen4.g_caesura, P["CORAL"]),
    ("Done", "fermata + barline", g_done_v3, P["GREEN"]),
    ("Bounced", "da capo", g_bounced_v3, P["AMBER"]),
    ("Needs design", "unresolved", gen4.g_needsdesign, P["VIOLET"]),
    ("Swarm", "the ensemble", gen4.g_ensemble, P["BLUE"]),
    ("Fleet", "concert hall", gen4.g_fleet, P["VIOLET"]),
    ("Operator", "the patron", gen4.g_operator, P["CORAL"]),
    ("Handoff", "pass the motif", gen4.g_handoff, P["TEAL"]),
    ("Cost / burn", "tempo", gen4.g_metronome, P["AMBER"]),
    ("Health", "in tune", gen4.g_health, P["GREEN"]),
    ("New request", "bell rings", gen4.g_bell_ring, P["CORAL"]),
    ("Message", "inbound note", gen4.g_envelope, P["CORAL"]),
    ("Ticket stub", "box office", gen4.g_stub, P["GOLD"]),
]
ROWS = [("AGENTS / ROLES", GLYPHS[0:10]), ("BL ITEMS", GLYPHS[10:18]),
        ("STRUCTURE &amp; SIGNALS", GLYPHS[18:24]), ("SUPPORT / FRONT-DESK", GLYPHS[24:27])]

# --- colour sheet ------------------------------------------------------------
def tile(cx, cy, size, fn, label, sub, col):
    x0, y0 = cx-size/2, cy-size/2
    return (f'<rect x="{x0}" y="{y0}" width="{size}" height="{size}" rx="{size*0.22}" fill="{BG}"/>'
            f'{fn(cx, cy-0.02*size, size*0.26, col)}'
            f'<text x="{cx}" y="{y0+size+24}" text-anchor="middle" font-family="Helvetica,Arial" font-size="18" font-weight="700" fill="#1b2230">{label}</text>'
            f'<text x="{cx}" y="{y0+size+45}" text-anchor="middle" font-family="Helvetica,Arial" font-size="14" fill="#6b7480">{sub}</text>')

S, GAP, LEFT = 120, 20, 60
W = 1520
H = 90 + len(ROWS)*330 - 90
parts = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">',
         f'<rect width="{W}" height="{H}" fill="#eef0f3"/>']
y = 50
for (title, items) in ROWS:
    parts.append(f'<text x="{LEFT}" y="{y}" font-family="Helvetica,Arial" font-size="25" font-weight="800" fill="#1b2230">{title}</text>')
    x = LEFT + S/2
    for (label, sub, fn, col) in items:
        parts.append(tile(x, y+90, S, fn, label, sub, col)); x += S+GAP
    y += 330
parts.append("</svg>")
svg = "\n".join(parts)
open("glyph-sheet-v3.svg", "w").write(svg)
cairosvg.svg2png(bytestring=svg.encode(), write_to="glyph-sheet-v3.png", output_width=W, output_height=H)
print("wrote glyph-sheet-v3")

# --- monochrome re-test -------------------------------------------------------
INK_ON_DARK, INK_ON_LIGHT = "#e2e6ec", "#232833"
DARK_TILE, LIGHT_TILE = "#141a26", "#ffffff"

def set_theme(dark):
    global BG
    ink = INK_ON_DARK if dark else INK_ON_LIGHT
    BG = DARK_TILE if dark else LIGHT_TILE
    for name in ["GOLD","TEAL","BLUE","VIOLET","GREY","CORAL","GREEN","AMBER","NAVY1"]:
        setattr(gen4, name, ink)
    return ink

SIZES = [16, 20, 24, 32, 48]
OFF = {16: 175, 20: 235, 24: 300, 32: 375, 48: 465, "light": 575}
COLW, RH, TOP = 660, 66, 120
BLOCKS = [GLYPHS[:14], GLYPHS[14:]]
W2 = 2*COLW + 40
H2 = TOP + max(len(b) for b in BLOCKS)*RH + 30

parts = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W2}" height="{H2}" viewBox="0 0 {W2} {H2}">',
         f'<rect width="{W2}" height="{H2}" fill="#eef0f3"/>',
         '<text x="24" y="46" font-family="Helvetica,Arial" font-size="26" font-weight="800" fill="#1b2230">MONOCHROME STRESS-TEST &#8212; v3</text>',
         '<text x="24" y="72" font-family="Helvetica,Arial" font-size="15" fill="#6b7480">theme-safe inks; redesigned Coordinator / Ticket / Done / Bounced; 16 / 20 / 24 / 32 / 48 px + 24px light</text>']

for bi, block in enumerate(BLOCKS):
    x0 = 20 + bi*COLW
    for s in SIZES:
        parts.append(f'<text x="{x0+OFF[s]}" y="{TOP-16}" text-anchor="middle" font-family="Helvetica,Arial" font-size="12" fill="#8b939d">{s}</text>')
    parts.append(f'<text x="{x0+OFF["light"]}" y="{TOP-16}" text-anchor="middle" font-family="Helvetica,Arial" font-size="12" fill="#8b939d">24&#9788;</text>')
    for ri, (label, sub, fn, col) in enumerate(block):
        cy = TOP + ri*RH + RH/2
        parts.append(f'<text x="{x0+8}" y="{cy+5}" font-family="Helvetica,Arial" font-size="15" font-weight="600" fill="#1b2230">{label}</text>')
        for s in SIZES:
            ink = set_theme(dark=True)
            side = s + 14
            cx = x0 + OFF[s]
            parts.append(f'<rect x="{cx-side/2:.1f}" y="{cy-side/2:.1f}" width="{side}" height="{side}" rx="{side*0.22:.1f}" fill="{DARK_TILE}"/>')
            parts.append(fn(cx, cy, s/2.6, ink))
        ink = set_theme(dark=False)
        side = 24 + 14
        cx = x0 + OFF["light"]
        parts.append(f'<rect x="{cx-side/2:.1f}" y="{cy-side/2:.1f}" width="{side}" height="{side}" rx="{side*0.22:.1f}" fill="{LIGHT_TILE}"/>')
        parts.append(fn(cx, cy, 24/2.6, ink))

parts.append("</svg>")
svg = "\n".join(parts)
open("mono-test-v3.svg", "w").write(svg)
cairosvg.svg2png(bytestring=svg.encode(), write_to="mono-test-v3.png", output_width=W2, output_height=H2)
print(f"wrote mono-test-v3 {W2}x{H2}")
