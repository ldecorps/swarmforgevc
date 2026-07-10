# INTAKE: render the architecture diagram(s) in the morning briefing email

Source: operator direction 2026-07-10 (via coordinator): "i need the
architecture diagrams rendered in the morning email as well."

## Want (observable)
The daily briefing morning email includes the project's architecture diagram(s)
rendered as viewable images inline in the email body — not merely a link to a
`.mmd` source or the repo. Opening the morning email shows the diagram.

## Existing assets (specifier: verify before scoping)
- Diagram SOURCES already exist as Mermaid: `docs/diagrams/architecture.mmd`
  (the two-layer host + tmux-substrate "as built" diagram, BL-146) and
  `docs/diagrams/swarm-flow.mmd`. These are the source of truth to render.
- Email COMPOSITION: `swarmforge/scripts/briefing_email_lib.bb` — the send path
  is `((:send-email! adapters) subject content)` where `content` is the briefing
  **markdown text** (BL-099 content, BL-214 headless daemon send). Today the
  email is text/markdown with NO HTML body and NO image/attachment path.
- The daily send is BL-214 (headless daemon); the morning GENERATION trigger is
  BL-258 (approved, queued). Content enrichment is BL-256 (approved, queued).

## The real design problem (for specifier/architect, not pre-decided here)
1. **Rendering.** Mermaid must be rendered to an image (SVG/PNG) at
   briefing-generation time. There is currently NO renderer installed
   (grep: no mermaid-cli / mmdc / puppeteer). Options the build must weigh:
   a pinned local renderer (`@mermaid-js/mermaid-cli` — heavy, pulls headless
   Chromium) vs. a lighter pinned path, vs. an external render service
   (kroki/mermaid.ink — REJECT if it breaks reproducibility/privacy: the diagram
   would leave the machine and depend on network). Prefer a LOCAL, PINNED,
   deterministic render (engineering pinned-tools rule). Tool choice is the
   build's, among vetted candidates.
2. **Embedding.** Email today is plaintext markdown. Rendering inline needs an
   HTML email body with the image embedded as an inline `data:` URI or a CID
   attachment — OR the diagram sent as a normal attachment. Verify the actual
   send adapter's (Resend) HTML/attachment capability before choosing; keep the
   existing plaintext path working for clients that don't render HTML
   (multipart, graceful degradation).

## Constraints
- REUSE the existing diagram sources and the BL-214 send / BL-258 schedule /
  BL-099+BL-256 content paths — this ADDS a rendered-diagram section; it does not
  fork the briefing or the send logic.
- PINNED, LOCAL, DETERMINISTIC render (engineering pinned-tools rule): exact
  version in package.json/lockfile; a bump is a human commit. Byte-stable output
  for identical `.mmd` input so the email is reproducible and diffable.
- REPRODUCIBILITY / PRIVACY (BL-252 projection boundary spirit): do not make the
  briefing depend on an external render service that ships project internals off
  the machine unless the operator explicitly accepts it.
- GRACEFUL DEGRADATION: if rendering is unavailable, the email still sends with a
  clear no-diagram note (and/or the `.mmd` link) — never a broken send (BL-099
  missing-data posture, BL-214 send must not crash).
- TESTABLE host-side: the render step (`.mmd` -> image bytes) and the
  embed/compose step (image -> HTML/multipart email body) are testable modules
  fed fixtures — assert on the produced image/body, NOT on a real render binary
  invocation or a real email send in unit tests. Validate the renderer itself by
  rendering a fixture `.mmd` and asserting a non-empty, well-formed image.
- COMPOSE, don't collide: this touches the same briefing email path as BL-256
  (briefing enrichment) and BL-258 (morning schedule). Specifier decide whether
  this is a slice of BL-256 or its own sibling ticket; sequence so the shared
  briefing-compose file isn't built by two active tickets at once.

## Delivery
Buildable now (sources exist; reuses BL-214/BL-258/BL-099). The renderer install
+ HTML/inline-image email body is the substantive work. Likely one slice, or a
slice under BL-256. Priority normal.
