import cairosvg

NAVY0, NAVY1 = "#1c2233", "#0b0f18"
GOLD, TEAL, BLUE, VIOLET, GREY, CORAL, GREEN, AMBER = (
    "#ffd36b", "#3ec9b0", "#3ea6ff", "#a68cff", "#9aa4b2", "#ff9a6b", "#6fd08a", "#f0b84c")

# ---------- glyphs: each centered at (cx,cy), scaled by u ----------
def g_baton(cx, cy, u, c):
    return (f'<path d="M{cx} {cy+0.9*u} a{0.42*u} {0.42*u} 0 0 0 -{0.34*u} {0.16*u} '
            f'h{0.68*u} a{0.42*u} {0.42*u} 0 0 0 -{0.34*u} -{0.16*u}z" fill="{GOLD}"/>'
            f'<g transform="rotate(20 {cx} {cy+0.9*u})"><rect x="{cx-0.06*u}" y="{cy-0.1*u}" '
            f'width="{0.12*u}" height="{u}" rx="{0.06*u}" fill="#f4f7fa"/></g>'
            f'<path d="M{cx+0.25*u} {cy-0.35*u} l{0.14*u} {0.4*u} {0.4*u} {0.14*u} -{0.4*u} {0.14*u} '
            f'-{0.14*u} {0.4*u} -{0.14*u} -{0.4*u} -{0.4*u} -{0.14*u} {0.4*u} -{0.14*u}z" fill="{GOLD}"/>')

def g_clef(cx, cy, u, c):  # simplified treble-ish swirl
    return (f'<path d="M{cx} {cy-u} C{cx+0.9*u} {cy-0.7*u} {cx+0.5*u} {cy+0.2*u} {cx} {cy+0.2*u} '
            f'C{cx-0.7*u} {cy+0.2*u} {cx-0.6*u} {cy-0.5*u} {cx+0.1*u} {cy-0.55*u} '
            f'C{cx+0.55*u} {cy-0.55*u} {cx+0.5*u} {cy-0.1*u} {cx+0.05*u} {cy-0.1*u}" '
            f'fill="none" stroke="{c}" stroke-width="{0.16*u}" stroke-linecap="round"/>'
            f'<rect x="{cx-0.03*u}" y="{cy-u}" width="{0.12*u}" height="{1.9*u}" rx="{0.06*u}" fill="{c}"/>'
            f'<circle cx="{cx}" cy="{cy+0.95*u}" r="{0.16*u}" fill="{c}"/>')

def g_staff(cx, cy, u, c, groups=1):
    out = []
    gap = 0.22*u
    span = 1.7*u
    if groups == 1:
        for k in range(5):
            y = cy - 2*gap + k*gap
            out.append(f'<line x1="{cx-span/2}" y1="{y}" x2="{cx+span/2}" y2="{y}" stroke="{c}" stroke-width="{0.07*u}"/>')
    else:
        for gidx in range(groups):
            base = cy - u + gidx*(0.85*u)
            for k in range(3):
                y = base + k*(0.16*u)
                out.append(f'<line x1="{cx-span/2}" y1="{y}" x2="{cx+span/2}" y2="{y}" stroke="{c}" stroke-width="{0.06*u}"/>')
    return "".join(out)

def g_beamed(cx, cy, u, c):  # two beamed notes
    h1 = f'<ellipse cx="{cx-0.55*u}" cy="{cy+0.6*u}" rx="{0.32*u}" ry="{0.24*u}" fill="{c}" transform="rotate(-22 {cx-0.55*u} {cy+0.6*u})"/>'
    h2 = f'<ellipse cx="{cx+0.55*u}" cy="{cy+0.6*u}" rx="{0.32*u}" ry="{0.24*u}" fill="{c}" transform="rotate(-22 {cx+0.55*u} {cy+0.6*u})"/>'
    s1 = f'<rect x="{cx-0.30*u}" y="{cy-0.8*u}" width="{0.1*u}" height="{1.4*u}" fill="{c}"/>'
    s2 = f'<rect x="{cx+0.80*u}" y="{cy-0.8*u}" width="{0.1*u}" height="{1.4*u}" fill="{c}"/>'
    beam = f'<rect x="{cx-0.30*u}" y="{cy-0.85*u}" width="{1.2*u}" height="{0.22*u}" fill="{c}"/>'
    return h1+h2+s1+s2+beam

def g_fork(cx, cy, u, c):  # tuning fork
    return (f'<path d="M{cx-0.4*u} {cy-u} v{1.1*u} a{0.4*u} {0.4*u} 0 0 0 {0.8*u} 0 v-{1.1*u}" '
            f'fill="none" stroke="{c}" stroke-width="{0.16*u}" stroke-linecap="round"/>'
            f'<rect x="{cx-0.06*u}" y="{cy+0.2*u}" width="{0.12*u}" height="{0.9*u}" rx="{0.06*u}" fill="{c}"/>')

def g_timpani(cx, cy, u, c):  # drum bowl
    return (f'<path d="M{cx-0.8*u} {cy-0.3*u} a{0.8*u} {0.55*u} 0 0 0 {1.6*u} 0 v{0.05*u} '
            f'a{0.8*u} {0.5*u} 0 0 1 -{1.6*u} 0z" fill="{c}"/>'
            f'<ellipse cx="{cx}" cy="{cy-0.3*u}" rx="{0.8*u}" ry="{0.3*u}" fill="none" stroke="{c}" stroke-width="{0.12*u}"/>'
            f'<line x1="{cx-0.5*u}" y1="{cy+0.35*u}" x2="{cx-0.6*u}" y2="{cy+0.9*u}" stroke="{c}" stroke-width="{0.1*u}" stroke-linecap="round"/>'
            f'<line x1="{cx+0.5*u}" y1="{cy+0.35*u}" x2="{cx+0.6*u}" y2="{cy+0.9*u}" stroke="{c}" stroke-width="{0.1*u}" stroke-linecap="round"/>')

def g_rest(cx, cy, u, c):  # quarter-rest-ish zigzag
    return (f'<path d="M{cx-0.15*u} {cy-u} l{0.45*u} {0.5*u} -{0.45*u} {0.45*u} {0.5*u} {0.5*u} '
            f'q-{0.6*u} -{0.2*u} -{0.15*u} {0.55*u} q-{0.5*u} -{0.35*u} 0 -{0.75*u}z" '
            f'fill="{c}" stroke="{c}" stroke-width="{0.05*u}" stroke-linejoin="round"/>')

def g_book(cx, cy, u, c):  # open book
    return (f'<path d="M{cx} {cy-0.5*u} C{cx-0.4*u} {cy-0.75*u} {cx-0.9*u} {cy-0.6*u} {cx-0.9*u} {cy-0.55*u} '
            f'v{1.2*u} C{cx-0.9*u} {cy+0.55*u} {cx-0.4*u} {cy+0.45*u} {cx} {cy+0.7*u} '
            f'C{cx+0.4*u} {cy+0.45*u} {cx+0.9*u} {cy+0.55*u} {cx+0.9*u} {cy+0.65*u} '
            f'v-{1.2*u} C{cx+0.9*u} {cy-0.6*u} {cx+0.4*u} {cy-0.75*u} {cx} {cy-0.5*u}z" '
            f'fill="none" stroke="{c}" stroke-width="{0.11*u}" stroke-linejoin="round"/>'
            f'<line x1="{cx}" y1="{cy-0.5*u}" x2="{cx}" y2="{cy+0.7*u}" stroke="{c}" stroke-width="{0.09*u}"/>')

def g_chair(cx, cy, u, c):  # empty seat
    return (f'<rect x="{cx-0.5*u}" y="{cy-0.9*u}" width="{u}" height="{0.55*u}" rx="{0.12*u}" fill="none" stroke="{c}" stroke-width="{0.12*u}"/>'
            f'<rect x="{cx-0.5*u}" y="{cy-0.2*u}" width="{u}" height="{0.28*u}" rx="{0.1*u}" fill="{c}"/>'
            f'<line x1="{cx-0.42*u}" y1="{cy+0.08*u}" x2="{cx-0.42*u}" y2="{cy+0.9*u}" stroke="{c}" stroke-width="{0.11*u}" stroke-linecap="round"/>'
            f'<line x1="{cx+0.42*u}" y1="{cy+0.08*u}" x2="{cx+0.42*u}" y2="{cy+0.9*u}" stroke="{c}" stroke-width="{0.11*u}" stroke-linecap="round"/>')

def g_bell(cx, cy, u, c):  # call bell
    return (f'<path d="M{cx-0.75*u} {cy+0.5*u} a{0.75*u} {0.75*u} 0 0 1 {1.5*u} 0z" fill="{c}"/>'
            f'<rect x="{cx-0.85*u}" y="{cy+0.5*u}" width="{1.7*u}" height="{0.18*u}" rx="{0.09*u}" fill="{c}"/>'
            f'<circle cx="{cx}" cy="{cy-0.35*u}" r="{0.16*u}" fill="{c}"/>')

def g_envelope(cx, cy, u, c):
    return (f'<rect x="{cx-0.85*u}" y="{cy-0.55*u}" width="{1.7*u}" height="{1.1*u}" rx="{0.1*u}" fill="none" stroke="{c}" stroke-width="{0.1*u}"/>'
            f'<path d="M{cx-0.85*u} {cy-0.5*u} L{cx} {cy+0.15*u} L{cx+0.85*u} {cy-0.5*u}" fill="none" stroke="{c}" stroke-width="{0.1*u}"/>')

def g_finalbar(cx, cy, u, c):
    return (f'<rect x="{cx+0.1*u}" y="{cy-u}" width="{0.28*u}" height="{2*u}" fill="{c}"/>'
            f'<rect x="{cx-0.15*u}" y="{cy-u}" width="{0.09*u}" height="{2*u}" fill="{c}"/>')

def g_repeat(cx, cy, u, c):
    return (f'<rect x="{cx-0.35*u}" y="{cy-u}" width="{0.24*u}" height="{2*u}" fill="{c}"/>'
            f'<rect x="{cx-0.05*u}" y="{cy-u}" width="{0.09*u}" height="{2*u}" fill="{c}"/>'
            f'<circle cx="{cx+0.35*u}" cy="{cy-0.35*u}" r="{0.14*u}" fill="{c}"/>'
            f'<circle cx="{cx+0.35*u}" cy="{cy+0.35*u}" r="{0.14*u}" fill="{c}"/>')

def g_caesura(cx, cy, u, c):
    return (f'<line x1="{cx-0.35*u}" y1="{cy+0.7*u}" x2="{cx-0.05*u}" y2="{cy-0.7*u}" stroke="{c}" stroke-width="{0.12*u}" stroke-linecap="round"/>'
            f'<line x1="{cx+0.15*u}" y1="{cy+0.7*u}" x2="{cx+0.45*u}" y2="{cy-0.7*u}" stroke="{c}" stroke-width="{0.12*u}" stroke-linecap="round"/>')

def g_cresc(cx, cy, u, c):  # notes + crescendo hairpin
    return (g_beamed(cx, cy-0.15*u, 0.7*u, c) +
            f'<path d="M{cx+0.9*u} {cy+0.6*u} L{cx-0.7*u} {cy+0.95*u} L{cx+0.9*u} {cy+1.3*u}" '
            f'fill="none" stroke="{c}" stroke-width="{0.08*u}" stroke-linecap="round"/>')

def g_needsdesign(cx, cy, u, c):
    return (g_rest(cx-0.25*u, cy+0.1*u, 0.7*u, c) +
            f'<text x="{cx+0.5*u}" y="{cy-0.2*u}" font-family="Georgia,serif" font-size="{1.5*u}" fill="{c}" text-anchor="middle">?</text>')

def g_stub(cx, cy, u, c):  # ticket stub / box office
    return (f'<rect x="{cx-0.9*u}" y="{cy-0.45*u}" width="{1.8*u}" height="{0.9*u}" rx="{0.12*u}" fill="none" stroke="{c}" stroke-width="{0.1*u}"/>'
            f'<line x1="{cx+0.2*u}" y1="{cy-0.45*u}" x2="{cx+0.2*u}" y2="{cy+0.45*u}" stroke="{c}" stroke-width="{0.07*u}" stroke-dasharray="{0.1*u},{0.1*u}"/>'
            f'<circle cx="{cx-0.35*u}" cy="{cy}" r="{0.14*u}" fill="{c}"/>')

# ---------- tile + layout ----------
def tile(cx, cy, size, glyph, label, sub, col):
    x0, y0 = cx - size/2, cy - size/2
    u = size*0.26
    body = glyph(cx, cy-0.04*size, u, col)
    return f'''
  <rect x="{x0}" y="{y0}" width="{size}" height="{size}" rx="{size*0.22}" fill="url(#bg)"/>
  {body}
  <text x="{cx}" y="{y0+size+26}" text-anchor="middle" font-family="Helvetica,Arial" font-size="19" font-weight="700" fill="#1b2230">{label}</text>
  <text x="{cx}" y="{y0+size+48}" text-anchor="middle" font-family="Helvetica,Arial" font-size="15" fill="#6b7480">{sub}</text>'''

def row(items, y, size, left=90, gap=44, W=1500):
    n = len(items)
    step = size + gap
    total = n*size + (n-1)*gap
    x = left + size/2
    out = []
    for (glyph, label, sub, col) in items:
        out.append(tile(x, y, size, glyph, label, sub, col))
        x += step
    return "".join(out)

W, H = 1560, 1220
S = 128
parts = [f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="{NAVY0}"/><stop offset="1" stop-color="{NAVY1}"/></linearGradient></defs>
  <rect width="{W}" height="{H}" fill="#eef0f3"/>''']

def hdr(x, y, t, s):
    return (f'<text x="{x}" y="{y}" font-family="Helvetica,Arial" font-size="26" font-weight="800" fill="#1b2230">{t}</text>'
            f'<text x="{x}" y="{y+26}" font-family="Helvetica,Arial" font-size="16" fill="#6b7480">{s}</text>')

parts.append(hdr(90, 54, "AGENTS / ROLES", "each player&#8217;s instrument or mark, coloured by section-family"))
roles = [
    (g_baton, "Coordinator", "conductor", GOLD),
    (g_clef, "Specifier", "sets the key", VIOLET),
    (lambda x,y,u,c: g_staff(x,y,u,c,groups=3), "Architect", "the score", VIOLET),
    (g_beamed, "Coder", "the voices", BLUE),
    (g_fork, "QA", "in tune?", TEAL),
    (g_timpani, "Hardener", "percussion", TEAL),
    (g_rest, "Cleaner", "silences", GREY),
    (g_book, "Documenter", "programme", GOLD),
    (g_chair, "Recruiter", "fill a seat", BLUE),
    (g_bell, "Support", "call bell", CORAL),
]
parts.append(row(roles, 150, S, left=70, gap=24))

parts.append(hdr(90, 440, "BL ITEMS", "a passage to be played + a state mark"))
bl = [
    (lambda x,y,u,c: g_staff(x,y,u,c,groups=3), "Epic", "symphony", GOLD),
    (lambda x,y,u,c: g_staff(x,y,u,c,groups=1), "Ticket", "a movement", BLUE),
    (g_rest, "Todo", "unplayed", GREY),
    (g_cresc, "In progress", "playing", TEAL),
    (g_caesura, "Blocked", "caesura", CORAL),
    (g_finalbar, "Done", "final barline", GREEN),
    (g_repeat, "Bounced", "da capo", AMBER),
    (g_needsdesign, "Needs design", "unresolved", VIOLET),
]
parts.append(row(bl, 540, S, left=70, gap=24))

parts.append(hdr(90, 830, "SUPPORT / FRONT-DESK", "the box office &#8212; inbound from humans"))
sup = [
    (g_bell, "New request", "call bell", CORAL),
    (g_envelope, "Message", "inbound note", CORAL),
    (g_stub, "Ticket stub", "box office", GOLD),
]
parts.append(row(sup, 930, S, left=70, gap=24))

parts.append("</svg>")
svg = "\n".join(parts)
open("glyph-sheet.svg", "w").write(svg)
cairosvg.svg2png(bytestring=svg.encode(), write_to="glyph-sheet.png", output_width=W, output_height=H)
print("wrote glyph-sheet")
