import math, cairosvg

def arc_dots(cx, cy, radius, start_deg, end_deg, n, r_dot, color):
    out = []
    for i in range(n):
        t = start_deg + (end_deg - start_deg) * (i / (n - 1))
        rad = math.radians(t)
        x = cx + radius * math.cos(rad)
        y = cy + radius * math.sin(rad)
        out.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r_dot}" fill="{color}"/>')
    return "\n".join(out)

def arc_line(cx, cy, radius, start_deg, end_deg, color, w, op):
    a, b = math.radians(start_deg), math.radians(end_deg)
    x0, y0 = cx + radius*math.cos(a), cy + radius*math.sin(a)
    x1, y1 = cx + radius*math.cos(b), cy + radius*math.sin(b)
    return (f'<path d="M{x0:.1f} {y0:.1f} A{radius} {radius} 0 0 1 {x1:.1f} {y1:.1f}" '
            f'fill="none" stroke="{color}" stroke-width="{w}" opacity="{op}"/>')

def podium(cx, cy, scale=1.0):
    """Clean podium mound + tilted baton + compact downbeat spark, drawn on top."""
    s = scale
    mound = (f'<path d="M{cx} {cy} a{54*s:.0f} {54*s:.0f} 0 0 0 -{42*s:.0f} {20*s:.0f} '
             f'h{84*s:.0f} a{54*s:.0f} {54*s:.0f} 0 0 0 -{42*s:.0f} -{20*s:.0f}z" '
             f'fill="url(#brass)"/>')
    # baton: tilted white stick rising from the podium
    baton = (f'<g transform="rotate(20 {cx} {cy})">'
             f'<rect x="{cx-4.5*s:.1f}" y="{cy-62*s:.0f}" width="{9*s:.1f}" '
             f'height="{62*s:.0f}" rx="{4.5*s:.1f}" fill="#f4f7fa"/></g>')
    # downbeat spark at the baton tip (offset up-right into open space)
    tx, ty = cx + 20*s, cy - 66*s
    a = 17*s
    spark = (f'<path d="M{tx} {ty-a} l{a*0.32:.1f} {a*0.9:.1f} {a*0.9:.1f} {a*0.32:.1f} '
             f'-{a*0.9:.1f} {a*0.32:.1f} -{a*0.32:.1f} {a*0.9:.1f} '
             f'-{a*0.32:.1f} -{a*0.9:.1f} -{a*0.9:.1f} -{a*0.32:.1f} '
             f'{a*0.9:.1f} -{a*0.32:.1f}z" fill="url(#brass)"/>')
    return mound + baton + spark

def build(name, cx, cy, sections, podium_scale, dot_lines=True):
    dots = "\n".join(arc_dots(cx, cy, r, s0, s1, n, rd, c)
                     for (r, (s0, s1), n, rd, c) in sections)
    lines = ""
    if dot_lines:
        lines = "\n".join(arc_line(cx, cy, r, s0, s1, c, 4, 0.16)
                          for (r, (s0, s1), n, rd, c) in sections)
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1c2233"/><stop offset="1" stop-color="#0b0f18"/>
    </linearGradient>
    <linearGradient id="brass" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffe9a8"/><stop offset="1" stop-color="#e6a53c"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="url(#bg)"/>
  <g stroke-linecap="round">{lines}</g>
  {dots}
  {podium(cx, cy, podium_scale)}
</svg>'''
    open(f"{name}.svg", "w").write(svg)
    cairosvg.svg2png(bytestring=svg.encode(), write_to=f"{name}.png",
                     output_width=512, output_height=512)
    return svg

# ---- FULL icon: 4 section-rings, opened-up center ----
FULL = [
    (108, (214, 326), 6,  11, "#ffd36b"),  # strings   (gold)
    (152, (208, 332), 8,  10, "#3ec9b0"),  # woodwinds (teal)
    (196, (204, 336), 10, 9,  "#3ea6ff"),  # brass     (blue)
    (238, (202, 338), 12, 8,  "#a68cff"),  # percussion(violet)
]
build("concept-e-orchestra", 256, 388, FULL, 1.0)

# ---- SMALL variant: 2 rings, fewer/bigger dots, bolder center ----
SMALL = [
    (108, (206, 334), 5, 17, "#ffd36b"),
    (168, (202, 338), 7, 15, "#3ea6ff"),
]
svg_small = build("concept-e-orchestra-small", 256, 336, SMALL, 1.35, dot_lines=False)
# also render the small variant at true tiny size to check legibility
cairosvg.svg2png(bytestring=svg_small.encode(),
                 write_to="concept-e-small-96.png", output_width=96, output_height=96)
print("done")
