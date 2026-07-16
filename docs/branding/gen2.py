import math, cairosvg

SECTIONS = [  # (radius-fraction, (start,end)deg, count, color)
    (0.42, (214, 326), 6,  "#ffd36b"),
    (0.62, (208, 332), 8,  "#3ec9b0"),
    (0.82, (204, 336), 10, "#3ea6ff"),
    (1.00, (202, 338), 12, "#a68cff"),
]

def fade(hexc, f):
    """f=1 full colour; f->0 desaturates toward its own grey."""
    r, g, b = int(hexc[1:3],16), int(hexc[3:5],16), int(hexc[5:7],16)
    lum = 0.30*r + 0.59*g + 0.11*b
    m = 1 - f
    r = int(r + (lum-r)*m); g = int(g + (lum-g)*m); b = int(b + (lum-b)*m)
    return f'#{r:02x}{g:02x}{b:02x}'

def spark(cx, cy, a, color, op=1.0):
    return (f'<path d="M{cx} {cy-a:.1f} l{a*.32:.1f} {a*.9:.1f} {a*.9:.1f} {a*.32:.1f} '
            f'-{a*.9:.1f} {a*.32:.1f} -{a*.32:.1f} {a*.9:.1f} -{a*.32:.1f} -{a*.9:.1f} '
            f'-{a*.9:.1f} -{a*.32:.1f} {a*.9:.1f} -{a*.32:.1f}z" fill="{color}" opacity="{op:.2f}"/>')

def orchestra(ox, oy, R, intensity, freshness):
    """Podium at (ox,oy); ensemble fans up. intensity=dynamics, freshness=age."""
    op = 0.22 + 0.78*freshness
    dot = 0.052*R*(0.70 + 0.65*intensity)          # louder = bigger
    p = []
    for (rf, (s0, s1), n, col) in SECTIONS:
        r = rf*R
        c = fade(col, freshness)
        for i in range(n):
            t = s0 + (s1-s0)*(i/(n-1))
            x = ox + r*math.cos(math.radians(t))
            y = oy + r*math.sin(math.radians(t))
            glow = (f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{dot*2.1:.1f}" fill="{c}" '
                    f'opacity="{op*0.16*intensity:.2f}"/>') if intensity > 0.55 else ""
            p.append(glow + f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{dot:.1f}" fill="{c}" opacity="{op:.2f}"/>')
    brass = fade("#f0b84c", freshness)
    white = fade("#f4f7fa", freshness)
    # podium mound
    p.append(f'<path d="M{ox} {oy} a{0.24*R:.0f} {0.24*R:.0f} 0 0 0 -{0.19*R:.0f} {0.09*R:.0f} '
             f'h{0.38*R:.0f} a{0.24*R:.0f} {0.24*R:.0f} 0 0 0 -{0.19*R:.0f} -{0.09*R:.0f}z" '
             f'fill="{brass}" opacity="{op:.2f}"/>')
    # baton
    bw = 0.04*R
    p.append(f'<g transform="rotate(20 {ox} {oy})"><rect x="{ox-bw/2:.1f}" y="{oy-0.30*R:.0f}" '
             f'width="{bw:.1f}" height="{0.30*R:.0f}" rx="{bw/2:.1f}" fill="{white}" opacity="{op:.2f}"/></g>')
    # downbeat spark — size & glow scale with dynamics
    a = R*(0.06 + 0.14*intensity)
    tx, ty = ox + 0.09*R, oy - 0.32*R
    if intensity > 0.55:
        p.append(f'<circle cx="{tx:.1f}" cy="{ty:.1f}" r="{a*1.9:.1f}" fill="{brass}" opacity="{op*0.20:.2f}"/>')
    p.append(spark(tx, ty, a, brass, op))
    return "".join(p)

def tile(cx, cy, size, intensity, freshness, label, sub):
    R = size*0.40
    oy = cy + size*0.26
    ox = cx
    x0, y0 = cx - size/2, cy - size/2
    rx = size*0.22
    return f'''
  <rect x="{x0}" y="{y0}" width="{size}" height="{size}" rx="{rx}" fill="url(#bg)"/>
  {orchestra(ox, oy, R, intensity, freshness)}
  <text x="{cx}" y="{y0+size+34}" text-anchor="middle" font-family="Helvetica,Arial" font-size="24" font-weight="700" fill="#1b2230">{label}</text>
  <text x="{cx}" y="{y0+size+60}" text-anchor="middle" font-family="Helvetica,Arial" font-size="18" fill="#6b7480">{sub}</text>'''

W, H = 1500, 1080
parts = [f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#1c2233"/><stop offset="1" stop-color="#0b0f18"/>
  </linearGradient></defs>
  <rect width="{W}" height="{H}" fill="#eef0f3"/>
  <text x="70" y="70" font-family="Helvetica,Arial" font-size="30" font-weight="800" fill="#1b2230">DYNAMICS — how busy the swarm is</text>
  <text x="70" y="100" font-family="Helvetica,Arial" font-size="19" fill="#6b7480">pianissimo &#8594; fortissimo: dot size, brightness &amp; downbeat scale with activity</text>''']

# Dynamics row (fresh)
parts.append(tile(320, 260, 300, 0.15, 1.0, "pp · peaceful", "idle / parked"))
parts.append(tile(760, 260, 300, 0.55, 1.0, "mf · working", "steady dispatch"))
parts.append(tile(1200, 260, 300, 1.0, 1.0, "ff · tutti", "full swarm, dramatic"))

parts.append(f'''<text x="70" y="620" font-family="Helvetica,Arial" font-size="30" font-weight="800" fill="#1b2230">FRESHNESS — how recent the information is</text>
  <text x="70" y="650" font-family="Helvetica,Arial" font-size="19" fill="#6b7480">colour desaturates toward grey and fades as the last report ages</text>''')

# Freshness row (working intensity, varying age)
parts.append(tile(280, 800, 250, 0.6, 1.00, "now", "just reported"))
parts.append(tile(650, 800, 250, 0.6, 0.62, "~5 min", "recent"))
parts.append(tile(1020, 800, 250, 0.6, 0.32, "~30 min", "aging"))
parts.append(tile(1390, 800, 250, 0.6, 0.12, "stale", "silent / lost"))

parts.append("</svg>")
svg = "\n".join(parts)
open("spec-sheet.svg", "w").write(svg)
cairosvg.svg2png(bytestring=svg.encode(), write_to="spec-sheet.png", output_width=W, output_height=H)
print("wrote spec-sheet")
