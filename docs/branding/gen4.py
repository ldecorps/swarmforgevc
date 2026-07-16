import math, cairosvg

NAVY0, NAVY1 = "#1c2233", "#0b0f18"
GOLD, TEAL, BLUE, VIOLET, GREY, CORAL, GREEN, AMBER = (
    "#ffd36b", "#3ec9b0", "#3ea6ff", "#a68cff", "#9aa4b2", "#ff9a6b", "#6fd08a", "#f0b84c")

# ---- carried over from v1 ----
def g_clef(cx, cy, u, c):
    return (f'<path d="M{cx} {cy-u} C{cx+0.9*u} {cy-0.7*u} {cx+0.5*u} {cy+0.2*u} {cx} {cy+0.2*u} '
            f'C{cx-0.7*u} {cy+0.2*u} {cx-0.6*u} {cy-0.5*u} {cx+0.1*u} {cy-0.55*u} '
            f'C{cx+0.55*u} {cy-0.55*u} {cx+0.5*u} {cy-0.1*u} {cx+0.05*u} {cy-0.1*u}" '
            f'fill="none" stroke="{c}" stroke-width="{0.16*u}" stroke-linecap="round"/>'
            f'<rect x="{cx-0.03*u}" y="{cy-u}" width="{0.12*u}" height="{1.9*u}" rx="{0.06*u}" fill="{c}"/>'
            f'<circle cx="{cx}" cy="{cy+0.95*u}" r="{0.16*u}" fill="{c}"/>')

def g_staff(cx, cy, u, c):
    gap, span = 0.22*u, 1.7*u
    return "".join(f'<line x1="{cx-span/2}" y1="{cy-2*gap+k*gap}" x2="{cx+span/2}" y2="{cy-2*gap+k*gap}" stroke="{c}" stroke-width="{0.07*u}"/>' for k in range(5))

def g_beamed(cx, cy, u, c):
    return (f'<ellipse cx="{cx-0.55*u}" cy="{cy+0.6*u}" rx="{0.32*u}" ry="{0.24*u}" fill="{c}" transform="rotate(-22 {cx-0.55*u} {cy+0.6*u})"/>'
            f'<ellipse cx="{cx+0.55*u}" cy="{cy+0.6*u}" rx="{0.32*u}" ry="{0.24*u}" fill="{c}" transform="rotate(-22 {cx+0.55*u} {cy+0.6*u})"/>'
            f'<rect x="{cx-0.30*u}" y="{cy-0.8*u}" width="{0.1*u}" height="{1.4*u}" fill="{c}"/>'
            f'<rect x="{cx+0.80*u}" y="{cy-0.8*u}" width="{0.1*u}" height="{1.4*u}" fill="{c}"/>'
            f'<rect x="{cx-0.30*u}" y="{cy-0.85*u}" width="{1.2*u}" height="{0.22*u}" fill="{c}"/>')

def g_fork(cx, cy, u, c):
    return (f'<path d="M{cx-0.4*u} {cy-u} v{1.1*u} a{0.4*u} {0.4*u} 0 0 0 {0.8*u} 0 v-{1.1*u}" fill="none" stroke="{c}" stroke-width="{0.16*u}" stroke-linecap="round"/>'
            f'<rect x="{cx-0.06*u}" y="{cy+0.2*u}" width="{0.12*u}" height="{0.9*u}" rx="{0.06*u}" fill="{c}"/>')

def g_rest(cx, cy, u, c):
    return (f'<path d="M{cx-0.15*u} {cy-u} l{0.45*u} {0.5*u} -{0.45*u} {0.45*u} {0.5*u} {0.5*u} '
            f'q-{0.6*u} -{0.2*u} -{0.15*u} {0.55*u} q-{0.5*u} -{0.35*u} 0 -{0.75*u}z" fill="{c}" stroke="{c}" stroke-width="{0.05*u}" stroke-linejoin="round"/>')

def g_book(cx, cy, u, c):
    return (f'<path d="M{cx} {cy-0.5*u} C{cx-0.4*u} {cy-0.75*u} {cx-0.9*u} {cy-0.6*u} {cx-0.9*u} {cy-0.55*u} '
            f'v{1.2*u} C{cx-0.9*u} {cy+0.55*u} {cx-0.4*u} {cy+0.45*u} {cx} {cy+0.7*u} '
            f'C{cx+0.4*u} {cy+0.45*u} {cx+0.9*u} {cy+0.55*u} {cx+0.9*u} {cy+0.65*u} '
            f'v-{1.2*u} C{cx+0.9*u} {cy-0.6*u} {cx+0.4*u} {cy-0.75*u} {cx} {cy-0.5*u}z" fill="none" stroke="{c}" stroke-width="{0.11*u}" stroke-linejoin="round"/>'
            f'<line x1="{cx}" y1="{cy-0.5*u}" x2="{cx}" y2="{cy+0.7*u}" stroke="{c}" stroke-width="{0.09*u}"/>')

def g_chair(cx, cy, u, c):
    return (f'<rect x="{cx-0.5*u}" y="{cy-0.9*u}" width="{u}" height="{0.55*u}" rx="{0.12*u}" fill="none" stroke="{c}" stroke-width="{0.12*u}"/>'
            f'<rect x="{cx-0.5*u}" y="{cy-0.2*u}" width="{u}" height="{0.28*u}" rx="{0.1*u}" fill="{c}"/>'
            f'<line x1="{cx-0.42*u}" y1="{cy+0.08*u}" x2="{cx-0.42*u}" y2="{cy+0.9*u}" stroke="{c}" stroke-width="{0.11*u}" stroke-linecap="round"/>'
            f'<line x1="{cx+0.42*u}" y1="{cy+0.08*u}" x2="{cx+0.42*u}" y2="{cy+0.9*u}" stroke="{c}" stroke-width="{0.11*u}" stroke-linecap="round"/>')

def g_bell(cx, cy, u, c):
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
            f'<circle cx="{cx+0.35*u}" cy="{cy-0.35*u}" r="{0.14*u}" fill="{c}"/><circle cx="{cx+0.35*u}" cy="{cy+0.35*u}" r="{0.14*u}" fill="{c}"/>')

def g_caesura(cx, cy, u, c):
    return (f'<line x1="{cx-0.35*u}" y1="{cy+0.7*u}" x2="{cx-0.05*u}" y2="{cy-0.7*u}" stroke="{c}" stroke-width="{0.12*u}" stroke-linecap="round"/>'
            f'<line x1="{cx+0.15*u}" y1="{cy+0.7*u}" x2="{cx+0.45*u}" y2="{cy-0.7*u}" stroke="{c}" stroke-width="{0.12*u}" stroke-linecap="round"/>')

def g_cresc(cx, cy, u, c):
    return (g_beamed(cx, cy-0.15*u, 0.7*u, c) +
            f'<path d="M{cx+0.9*u} {cy+0.6*u} L{cx-0.7*u} {cy+0.95*u} L{cx+0.9*u} {cy+1.3*u}" fill="none" stroke="{c}" stroke-width="{0.08*u}" stroke-linecap="round"/>')

def g_needsdesign(cx, cy, u, c):
    return (g_rest(cx-0.25*u, cy+0.1*u, 0.7*u, c) +
            f'<text x="{cx+0.5*u}" y="{cy-0.2*u}" font-family="Georgia,serif" font-size="{1.5*u}" fill="{c}" text-anchor="middle">?</text>')

def g_stub(cx, cy, u, c):
    return (f'<rect x="{cx-0.9*u}" y="{cy-0.45*u}" width="{1.8*u}" height="{0.9*u}" rx="{0.12*u}" fill="none" stroke="{c}" stroke-width="{0.1*u}"/>'
            f'<line x1="{cx+0.2*u}" y1="{cy-0.45*u}" x2="{cx+0.2*u}" y2="{cy+0.45*u}" stroke="{c}" stroke-width="{0.07*u}" stroke-dasharray="{0.1*u},{0.1*u}"/>'
            f'<circle cx="{cx-0.35*u}" cy="{cy}" r="{0.14*u}" fill="{c}"/>')

# ---- NEW / FIXED in v2 ----
def g_podium(cx, cy, u, c):
    b = cy+0.55*u
    mound = f'<path d="M{cx} {b} a{0.4*u} {0.4*u} 0 0 0 -{0.32*u} {0.16*u} h{0.64*u} a{0.4*u} {0.4*u} 0 0 0 -{0.32*u} -{0.16*u}z" fill="{GOLD}"/>'
    baton = f'<g transform="rotate(20 {cx} {b})"><rect x="{cx-0.055*u}" y="{b-0.85*u}" width="{0.11*u}" height="{0.85*u}" rx="{0.055*u}" fill="#f4f7fa"/></g>'
    tx, ty, a = cx+0.16*u, b-0.9*u, 0.22*u
    spark = f'<path d="M{tx} {ty-a} l{a*.32} {a*.9} {a*.9} {a*.32} -{a*.9} {a*.32} -{a*.32} {a*.9} -{a*.32} -{a*.9} -{a*.9} -{a*.32} {a*.9} -{a*.32}z" fill="{GOLD}"/>'
    return mound+baton+spark

def g_brace(cx, cy, u, c):
    x = cx-0.75*u
    d = (f'M{x} {cy-u} q-{0.28*u} {0.05*u} -{0.28*u} {0.45*u} q0 {0.3*u} -{0.22*u} {0.5*u} '
         f'q{0.22*u} {0.2*u} {0.22*u} {0.5*u} q0 {0.4*u} {0.28*u} {0.45*u}')
    brace = f'<path d="{d}" fill="none" stroke="{c}" stroke-width="{0.12*u}" stroke-linecap="round"/>'
    staves = []
    for yy in [cy-0.62*u, cy, cy+0.62*u]:
        for k in range(3):
            y = yy-0.12*u+k*0.12*u
            staves.append(f'<line x1="{cx-0.25*u}" y1="{y}" x2="{cx+0.85*u}" y2="{y}" stroke="{c}" stroke-width="{0.05*u}"/>')
    return brace+"".join(staves)

def g_natural(cx, cy, u, c):
    return (f'<rect x="{cx-0.28*u}" y="{cy-0.9*u}" width="{0.11*u}" height="{1.4*u}" fill="{c}"/>'
            f'<rect x="{cx+0.17*u}" y="{cy-0.5*u}" width="{0.11*u}" height="{1.4*u}" fill="{c}"/>'
            f'<path d="M{cx-0.28*u} {cy-0.35*u} L{cx+0.28*u} {cy-0.5*u} L{cx+0.28*u} {cy-0.2*u} L{cx-0.28*u} {cy-0.05*u}z" fill="{c}"/>'
            f'<path d="M{cx-0.28*u} {cy+0.2*u} L{cx+0.28*u} {cy+0.05*u} L{cx+0.28*u} {cy+0.35*u} L{cx-0.28*u} {cy+0.5*u}z" fill="{c}"/>')

def g_bell_ring(cx, cy, u, c):
    return (g_bell(cx, cy, u*0.85, c) +
            f'<path d="M{cx-1.05*u} {cy-0.25*u} q-{0.22*u} {0.35*u} 0 {0.7*u}" fill="none" stroke="{c}" stroke-width="{0.09*u}" stroke-linecap="round"/>'
            f'<path d="M{cx+1.05*u} {cy-0.25*u} q{0.22*u} {0.35*u} 0 {0.7*u}" fill="none" stroke="{c}" stroke-width="{0.09*u}" stroke-linecap="round"/>')

def g_kettledrum(cx, cy, u, c):
    bowl = f'<path d="M{cx-0.8*u} {cy-0.35*u} C{cx-0.8*u} {cy+0.8*u} {cx+0.8*u} {cy+0.8*u} {cx+0.8*u} {cy-0.35*u}" fill="{c}" opacity="0.28"/>'
    edge = f'<path d="M{cx-0.8*u} {cy-0.35*u} C{cx-0.8*u} {cy+0.8*u} {cx+0.8*u} {cy+0.8*u} {cx+0.8*u} {cy-0.35*u}" fill="none" stroke="{c}" stroke-width="{0.11*u}"/>'
    head = f'<ellipse cx="{cx}" cy="{cy-0.35*u}" rx="{0.8*u}" ry="{0.25*u}" fill="none" stroke="{c}" stroke-width="{0.12*u}"/>'
    rods = "".join(f'<line x1="{cx+dx*0.78*u}" y1="{cy-0.3*u}" x2="{cx+dx*0.66*u}" y2="{cy-0.58*u}" stroke="{c}" stroke-width="{0.07*u}"/>' for dx in [-0.95,-0.5,0.5,0.95])
    legs = (f'<line x1="{cx-0.45*u}" y1="{cy+0.6*u}" x2="{cx-0.58*u}" y2="{cy+0.95*u}" stroke="{c}" stroke-width="{0.09*u}" stroke-linecap="round"/>'
            f'<line x1="{cx+0.45*u}" y1="{cy+0.6*u}" x2="{cx+0.58*u}" y2="{cy+0.95*u}" stroke="{c}" stroke-width="{0.09*u}" stroke-linecap="round"/>')
    return bowl+edge+head+rods+legs

def g_cello(cx, cy, u, c):
    return (f'<ellipse cx="{cx}" cy="{cy+0.42*u}" rx="{0.55*u}" ry="{0.6*u}" fill="{c}"/>'
            f'<ellipse cx="{cx}" cy="{cy-0.32*u}" rx="{0.42*u}" ry="{0.46*u}" fill="{c}"/>'
            f'<rect x="{cx-0.08*u}" y="{cy-1.3*u}" width="{0.16*u}" height="{0.7*u}" rx="{0.05*u}" fill="{c}"/>'
            f'<circle cx="{cx}" cy="{cy-1.35*u}" r="{0.14*u}" fill="{c}"/>'
            f'<line x1="{cx-0.17*u}" y1="{cy+0.18*u}" x2="{cx-0.17*u}" y2="{cy+0.62*u}" stroke="{NAVY1}" stroke-width="{0.06*u}"/>'
            f'<line x1="{cx+0.17*u}" y1="{cy+0.18*u}" x2="{cx+0.17*u}" y2="{cy+0.62*u}" stroke="{NAVY1}" stroke-width="{0.06*u}"/>'
            f'<line x1="{cx}" y1="{cy-1.25*u}" x2="{cx}" y2="{cy+0.7*u}" stroke="{NAVY1}" stroke-width="{0.04*u}"/>')

def g_piano(cx, cy, u, c):  # grand piano, top view
    body = (f'<path d="M{cx-0.7*u} {cy-0.75*u} L{cx+0.2*u} {cy-0.75*u} '
            f'C{cx+0.9*u} {cy-0.7*u} {cx+0.95*u} {cy+0.35*u} {cx+0.05*u} {cy+0.78*u} '
            f'L{cx-0.7*u} {cy+0.78*u} Z" fill="{c}"/>')
    kb = f'<rect x="{cx-0.7*u}" y="{cy-0.75*u}" width="{0.26*u}" height="{1.53*u}" fill="#f4f7fa"/>'
    keys = "".join(f'<line x1="{cx-0.7*u}" y1="{cy-0.75*u+k*0.19*u}" x2="{cx-0.44*u}" y2="{cy-0.75*u+k*0.19*u}" stroke="{NAVY1}" stroke-width="{0.04*u}"/>' for k in range(1,8))
    return body+kb+keys

def g_ensemble(cx, cy, u, c):
    oy = cy+0.7*u
    out = []
    for (r, col, n, s0, s1) in [(0.7*u, BLUE, 5, 210, 330), (1.05*u, VIOLET, 7, 205, 335)]:
        for i in range(n):
            t = s0+(s1-s0)*(i/(n-1))
            x = cx+r*math.cos(math.radians(t)); y = oy+r*math.sin(math.radians(t))
            out.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{0.12*u}" fill="{col}"/>')
    out.append(f'<circle cx="{cx}" cy="{oy-0.05*u}" r="{0.16*u}" fill="{GOLD}"/>')
    return "".join(out)

def g_fleet(cx, cy, u, c):
    arch = f'<path d="M{cx-1.0*u} {cy+0.85*u} L{cx-1.0*u} {cy-0.2*u} A{u} {u} 0 0 1 {cx+1.0*u} {cy-0.2*u} L{cx+1.0*u} {cy+0.85*u}" fill="none" stroke="{c}" stroke-width="{0.1*u}"/>'
    dots = []
    for j, ry in enumerate([cy+0.05*u, cy+0.4*u, cy+0.72*u]):
        cols = 3+j
        for k in range(cols):
            x = cx + (k-(cols-1)/2)*(0.5*u)
            col = [GOLD, TEAL, BLUE, VIOLET][(k+j) % 4]
            dots.append(f'<circle cx="{x:.1f}" cy="{ry}" r="{0.09*u}" fill="{col}"/>')
    return arch+"".join(dots)

def g_operator(cx, cy, u, c):
    seat = f'<path d="M{cx-0.55*u} {cy+0.85*u} v-{0.45*u} a{0.18*u} {0.18*u} 0 0 1 {0.18*u} -{0.18*u} h{0.74*u} a{0.18*u} {0.18*u} 0 0 1 {0.18*u} {0.18*u} v{0.45*u}" fill="none" stroke="{c}" stroke-width="{0.1*u}"/>'
    back = f'<rect x="{cx-0.5*u}" y="{cy-0.1*u}" width="{u}" height="{0.5*u}" rx="{0.12*u}" fill="{c}"/>'
    head = f'<circle cx="{cx}" cy="{cy-0.5*u}" r="{0.22*u}" fill="{c}"/>'
    return seat+back+head

def g_handoff(cx, cy, u, c):
    slur = f'<path d="M{cx-0.65*u} {cy+0.1*u} Q{cx} {cy-0.9*u} {cx+0.65*u} {cy+0.1*u}" fill="none" stroke="{c}" stroke-width="{0.09*u}"/>'
    n1 = f'<ellipse cx="{cx-0.65*u}" cy="{cy+0.35*u}" rx="{0.24*u}" ry="{0.18*u}" fill="{c}" transform="rotate(-20 {cx-0.65*u} {cy+0.35*u})"/>'
    n2 = f'<ellipse cx="{cx+0.65*u}" cy="{cy+0.35*u}" rx="{0.24*u}" ry="{0.18*u}" fill="{c}" transform="rotate(-20 {cx+0.65*u} {cy+0.35*u})"/>'
    arrow = f'<path d="M{cx+0.48*u} {cy-0.12*u} L{cx+0.66*u} {cy+0.12*u} L{cx+0.8*u} {cy-0.18*u}" fill="none" stroke="{c}" stroke-width="{0.09*u}" stroke-linecap="round" stroke-linejoin="round"/>'
    return slur+n1+n2+arrow

def g_metronome(cx, cy, u, c):
    body = f'<path d="M{cx-0.5*u} {cy+0.9*u} L{cx+0.5*u} {cy+0.9*u} L{cx+0.26*u} {cy-0.9*u} L{cx-0.26*u} {cy-0.9*u}z" fill="none" stroke="{c}" stroke-width="{0.11*u}" stroke-linejoin="round"/>'
    pend = f'<line x1="{cx}" y1="{cy+0.6*u}" x2="{cx+0.22*u}" y2="{cy-0.75*u}" stroke="{c}" stroke-width="{0.09*u}" stroke-linecap="round"/>'
    weight = f'<rect x="{cx+0.03*u}" y="{cy-0.15*u}" width="{0.2*u}" height="{0.15*u}" fill="{c}"/>'
    return body+pend+weight

def g_health(cx, cy, u, c):
    return (f'<circle cx="{cx}" cy="{cy}" r="{0.85*u}" fill="none" stroke="{c}" stroke-width="{0.1*u}"/>'
            f'<path d="M{cx-0.4*u} {cy} L{cx-0.1*u} {cy+0.35*u} L{cx+0.45*u} {cy-0.4*u}" fill="none" stroke="{c}" stroke-width="{0.13*u}" stroke-linecap="round" stroke-linejoin="round"/>')

# ---------- layout ----------
def tile(cx, cy, size, glyph, label, sub, col):
    x0, y0 = cx-size/2, cy-size/2
    u = size*0.26
    return f'''
  <rect x="{x0}" y="{y0}" width="{size}" height="{size}" rx="{size*0.22}" fill="url(#bg)"/>
  {glyph(cx, cy-0.02*size, u, col)}
  <text x="{cx}" y="{y0+size+24}" text-anchor="middle" font-family="Helvetica,Arial" font-size="18" font-weight="700" fill="#1b2230">{label}</text>
  <text x="{cx}" y="{y0+size+45}" text-anchor="middle" font-family="Helvetica,Arial" font-size="14" fill="#6b7480">{sub}</text>'''

def row(items, y, size, left=60, gap=20):
    x = left+size/2
    out = []
    for (g, l, s, c) in items:
        out.append(tile(x, y, size, g, l, s, c)); x += size+gap
    return "".join(out)

def hdr(x, y, t, s):
    return (f'<text x="{x}" y="{y}" font-family="Helvetica,Arial" font-size="25" font-weight="800" fill="#1b2230">{t}</text>'
            f'<text x="{x}" y="{y+24}" font-family="Helvetica,Arial" font-size="15" fill="#6b7480">{s}</text>')

W, H, S = 1520, 1260, 120
parts = [f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="{NAVY0}"/><stop offset="1" stop-color="{NAVY1}"/></linearGradient></defs>
  <rect width="{W}" height="{H}" fill="#eef0f3"/>''']

parts.append(hdr(60, 50, "AGENTS / ROLES", "each player&#8217;s instrument or mark"))
parts.append(row([
    (g_podium, "Coordinator", "conductor", GOLD),
    (g_clef, "Specifier", "sets the key", VIOLET),
    (g_piano, "Architect", "grand piano", VIOLET),
    (g_cello, "Coder", "cello", BLUE),
    (g_fork, "QA", "in tune?", TEAL),
    (g_kettledrum, "Hardener", "timpani", TEAL),
    (g_natural, "Cleaner", "natural sign", GREY),
    (g_book, "Documenter", "programme", GOLD),
    (g_chair, "Recruiter", "fill a seat", BLUE),
    (g_bell, "Support", "call bell", CORAL),
], 140, S))

parts.append(hdr(60, 380, "BL ITEMS", "a passage to be played + a state mark"))
parts.append(row([
    (g_brace, "Epic", "symphony (brace)", GOLD),
    (g_staff, "Ticket", "a movement", BLUE),
    (g_rest, "Todo", "unplayed", GREY),
    (g_cresc, "In progress", "playing", TEAL),
    (g_caesura, "Blocked", "caesura", CORAL),
    (g_finalbar, "Done", "final barline", GREEN),
    (g_repeat, "Bounced", "da capo", AMBER),
    (g_needsdesign, "Needs design", "unresolved", VIOLET),
], 470, S))

parts.append(hdr(60, 710, "STRUCTURE &amp; SIGNALS", "the larger units and the live meters"))
parts.append(row([
    (g_ensemble, "Swarm", "the ensemble", BLUE),
    (g_fleet, "Fleet", "concert hall", VIOLET),
    (g_operator, "Operator", "the patron", CORAL),
    (g_handoff, "Handoff", "pass the motif", TEAL),
    (g_metronome, "Cost / burn", "tempo", AMBER),
    (g_health, "Health", "in tune", GREEN),
], 800, S))

parts.append(hdr(60, 1040, "SUPPORT / FRONT-DESK", "the box office &#8212; inbound from humans"))
parts.append(row([
    (g_bell_ring, "New request", "bell rings", CORAL),
    (g_envelope, "Message", "inbound note", CORAL),
    (g_stub, "Ticket stub", "box office", GOLD),
], 1130, S))

parts.append("</svg>")
svg = "\n".join(parts)
open("glyph-sheet-v2.svg", "w").write(svg)
cairosvg.svg2png(bytestring=svg.encode(), write_to="glyph-sheet-v2.png", output_width=W, output_height=H)
print("wrote glyph-sheet-v2")
