# Raw intake — Phone wire format (protobuf vs REST) + offline-first

**Status:** LANES SETTLED (human, 2026-08-09). Ready for specifier mint.
Unparked from `backlog/hold/` — do not re-park for Q1/Q4/Q5; those are answered.
Protobuf remains deferred (no measured pain). Not yet minted — specifier owns drain.

## Human lane picks — 2026-08-09

| Q | Decision |
|---|----------|
| Q1 — Offline grooming | **Device mutation outbox** — offline backlog drafts queue on device and sync when the bridge is up. Not read-only-first. |
| Q4 — Sync source while online | **Bridge** only (not Pages artifacts, not both). |
| Q5 — PWA merge shape | **Native Kotlin** over the same JSON packages (not WebView reuse). |

Still open (non-blocking for foundation mint): Q3 ("as of \<cache time\>" honesty — intake assumes yes), Q7 (any JSON pain for protobuf — none reported → defer).

## Was PARKED by the specifier — 2026-07-30 root drain

The other nine root intakes of 2026-07-30 were drained that pass (BL-708..BL-713).
This one stayed blocked until the human picked remaining lanes. **Unblocked
2026-08-09** by the answers above.

Slice readiness after the picks:

| Slice | Status |
|-------|--------|
| companion-manifest + silent package refresh (foundation) | **Unblocked** — sync source = bridge |
| Bubble panels for backlog/docs (BL-659 retarget) | **Unblocked** — native Kotlin on JSON |
| offline groom outbox | **Required** (not optional) — device mutation outbox |
| protobuf | **Defer** — recommendation D; no measured JSON pain (Q7) |

**Settled — one app:** **Bubble** (`android/`, BL-707; product name locked
2026-07-30 — see `INTAKE-messaging-host-agent-interface-vs-incarnation.md`).
Migrate **into it**:
- Pages **PWA** (backlog, docs, board / groom) → **native Kotlin** panels
- Telegram **Mini App** operator console (Let's Talk + related chrome)

Pages artifacts stay **package feedstock / temporary fallbacks**, not the online
sync source (bridge is). No second phone client.

**Origin story (human):** Bubble started as a **chatbox** → became a **native
app** to float → expand into the **full operator phone**. Human closed
"maybe two apps?": **No — one app.** Product name: **Bubble**.

**Surfaces in scope:** Bubble as sole phone UX; `pwa/` + Mini App HTML as
migration feedstock; JSON/bridge packages as sync contracts. Related: BL-659
(offline corpus → Bubble), BL-696/707 Let's Talk, STEERING freeze.

**Human framing (verbatim sense):**
- Protobuf to normalize messaging? Or REST?
- Minimal service when offline (tube, plane — docs + backlog groom)?
- PWA merges into the bubble; then: **one app, migrate PWA and Telegram Mini
  App into it.**

---

## The debate (settled lanes marked)

### A. Wire format: protobuf vs REST+JSON

| | Protobuf | Stay REST + versioned JSON |
|---|---|---|
| Strength | Compact, codegen contracts, unknown-field evolution | Already everywhere (bridge, Mini App, companion, Pages artifacts); curl-debuggable; same packages for sync |
| Cost | Kotlin (+ maybe TS for bridge) codegen, build plumbing, opaque on the wire | Larger payloads; schema discipline is social (`format`/`version`) not generated |
| Fits when | High-frequency sync, bandwidth-starved | Sparse RPCs + snapshot packages (backlog, docs tree, chiptunes, flags) |

**Working claim (for challenge):** protobuf does **not** buy offline or unification.
Offline is a **package + on-device store + outbox** problem. Prefer not to mint
protobuf unless measured pain (size, schema drift, streaming).

**Pinned 2026-08-09:** REST + versioned JSON packages; Bubble fetches from the
**bridge** (companion-manifest + package catalog). Pages may still *produce*
artifacts as build feedstock, but the phone's online sync source is the bridge.

### B. One app — migrate PWA + Mini App in (settled)

Unified install: **Bubble**. Modes / panels inside it:

1. **Groom / read (offline-capable)** — from PWA migration (board, docs,
   search), implemented as **native Kotlin** on the shared JSON shapes.
   BL-659 corpus goals retarget here.
2. **Talk / console (online-required for agent)** — from Mini App Let's Talk
   migration (**done 2026-07-30**: Mini App HTML retired; Bubble is the sole
   talk client; bridge turn/chiptunes API kept). Offline: banner, cached hold
   music, no fake agent.
3. **Other Mini App console pieces** — migrate capability-by-capability; do not
   grow the Telegram WebView as the home for new operator UX.

Same shell; bubble stays the ambient handle. Collapse returns to bubble; talk
engine stays in the overlay service.

**Implication:** maintain-only on Pages PWA UX and Telegram Mini App chrome;
Bubble is the feature destination. Bridge routes + JSON packages stay.

### C. Minimal offline service (inside the bubble)

**Read path (must work offline after one successful sync):**
- APK = shell (always).
- Data packages on device (`filesDir` / Room / simple JSON files): backlog,
  docs tree / corpus slices, chiptunes, companion-manifest.
- Fetch while online from the **bridge** (bubble start, idle, Wi‑Fi preference);
  network-first then cache; show "as of \<cached generation\>".
- Prefetch budget matters more once the full BL-659 corpus (~2–3 MB compressed)
  lives on the phone — still fine; sync opportunistically.

**Write path (grooming while offline) — pinned 2026-08-09:**
- Local **mutation outbox** in the companion; sync when the bridge is up.
- Offline drafts are real queued mutations, not read-only scratch.

**Talk offline minimum:** unchanged (prefs, chiptunes cache, honest offline).

### D. Recommendation (adopted where human pinned)

1. **Do not** introduce protobuf for normalization now.
2. **Do** REST + versioned JSON packages as the sync contract (manifest +
   backlog + docs + chiptunes), fetched from the **bridge**.
3. **Do** invest complexity in **bubble-hosted** offline corpus (BL-659
   retarget as native Kotlin) + Mini App capability migration + **groom
   mutation outbox** (required).
4. Pages PWA + Telegram Mini App: maintain / package sources until parity;
   not feature destinations; Pages is not the phone's sync source.
5. Revisit protobuf only if sync volume / drift hurts.

---

## Open questions for the human

1. ~~Offline grooming: read-only analysis first, or must draft backlog mutations
   queue on-device?~~ **Answered 2026-08-09: device mutation outbox.**
2. ~~One vs two apps / tube surface?~~ **Answered: one companion; migrate PWA + Mini App.**
3. Accept "as of \<cache time\>" honesty? *(assumed yes; confirm if wrong)*
4. ~~Sync source while online: GitHub Pages artifacts, bridge mirror, or both?~~
   **Answered 2026-08-09: bridge.**
5. ~~Merge shape for PWA pieces: WebView vs native Kotlin on the same JSON?~~
   **Answered 2026-08-09: native Kotlin.**
6. ~~Mini App migration order: Let's Talk already native — next console slices?~~
   **Let's Talk Mini App crossed off 2026-07-30.** Next: remaining console
   slices + PWA panels into Bubble.
7. Any JSON pain that motivated protobuf? *(none reported → defer)*

## Suggested minting (lanes picked — specifier may drain)

- Companion-manifest + silent package refresh from **bridge** — foundation.
- Bubble panels for backlog/docs (BL-659 retarget) — **native Kotlin** epic/slice.
- Offline groom **mutation outbox** — required for write-while-offline.
- Mini App → companion capability migration tickets (per surface).
- Protobuf / gRPC — **defer**.

## Specifier disposition 2026-08-09 — DRAINED

Minted as epic **BL-865** (`bubble-offline-sync`, M8) plus its foundation slice:

- **BL-866** — bridge side: a companion-manifest advertising versioned JSON
  packages with generations and format versions, package bodies served against
  the advertised generation, an unchanged-generation request answered without a
  body, and honest availability (never advertise or serve what cannot be read).
  Node-unit testable, bridge-side only.

**Only the foundation is minted, deliberately.** The other four slices named in
this file are recorded on BL-865's `remaining_slices` with their scope, and get
their own tickets once BL-866 lands — each one's acceptance depends on the
package contract BL-866 defines, and minting them now would fix their scenarios
against a format that does not exist yet:

- Bubble side: fetch/cache network-first, offline reads after one successful
  sync, "as of <generation>" labelling.
- Native Kotlin panels for backlog/docs (the BL-659 corpus retarget).
- Offline groom **mutation outbox** (required, per Q1).
- Mini App -> Bubble capability migration, one ticket per surface.

Protobuf is **not** minted, per the human's pin: REST + versioned JSON, revisit
only on measured pain. The Let's Talk Mini App migration is not a slice — it was
completed 2026-07-30.

All three lane picks (Q1 device mutation outbox, Q4 bridge-only sync source, Q5
native Kotlin) are carried verbatim into BL-865, and Q4's onto BL-866 which owns
it. The human's framing quotes travel on BL-865.

**Flagged, not applied:** this file retargets BL-659's corpus goals to native
Kotlin in Bubble and makes Pages PWA maintain-only. BL-659 is paused so the
retarget is permissible at spec time, but it changes what an already-approved
ticket builds — BL-865's `approval_context` asks the human to confirm before I
retarget or retire BL-659.

**Still open, assumed:** Q3 ("as of <cache time>" honesty) assumed YES, surfaced
on BL-865 for correction. Q7 (JSON pain) none reported.

Probe finding: the bridge has no package catalog today. `/lets-talk/manifest.json`
(`bridgeServer.ts:1642`) is a PWA web-app install descriptor, unrelated — the
companion-manifest is new surface, not an extension of that route.
