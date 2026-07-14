# INTAKE: Embed the daily briefing's diagrams as SVG instead of PNG

**Raised by:** the human (ldecorps), 2026-07-15, in the documenter's session
after asking to see `docs/diagrams/*.mmd` rendered — followed up: "daily
briefing to switch to embedding SVG instead of PNG".
**Relayed via:** the documenter role. Human-raised; documenter cannot
implement (production code is out of its scope), so filing as raw intake
for the specifier.

## What exists today

`renderMermaidToPng` (`extension/src/diagrams/mermaidRender.ts`, BL-260)
renders `docs/diagrams/*.mmd` to SVG via `beautiful-mermaid`
(`renderMermaidToFlatSvg`), flattens the CSS `var()`/`color-mix()` output
that a static renderer can't resolve, then rasterizes that flattened SVG to
PNG via `@resvg/resvg-js` for inline embedding in the daily briefing email.

**Note the existing code comment's own rationale for PNG**
(`mermaidRender.ts`, near `renderMermaidToPng`): PNG was chosen specifically
because it is safe to embed inline across email clients, several of which
strip or mishandle inline `<svg>`. `flattenMermaidThemeVars` already exists
and is exactly the function that would produce the SVG this ask wants — the
PNG step is only the last stage on top of it — so the change itself is
small (skip `Resvg`/rasterization, embed `flattenMermaidThemeVars`'s output
directly, e.g. as an inline `<img src="data:image/svg+xml;...">` or a
`<svg>` block), but the specifier should verify the client-compatibility
concern that motivated PNG in the first place is either no longer a
concern, acceptable to trade off, or addressed (e.g. gate by client, or
keep PNG as the plain-text-part fallback and add SVG only to the HTML
part). Don't drop client compatibility silently to satisfy this ask.

## Ask

Switch the daily briefing's diagram embedding from PNG to SVG. Confirm
where it's actually consumed (email body — see
`briefing_email_lib.bb`/`banked_briefing_lib.bb`, and any other daily
briefing surface) and that the result still renders correctly in the
human's actual mail client(s) before treating this as done.
