# Raw intake — Phone wire format (protobuf vs REST) + offline-first

**Status:** DIRECTION SETTLED on client unification (human, 2026-07-30).
Wire-format / offline details still open below. Not minted. Do not auto-promote.

## PARKED by the specifier — 2026-07-30 root drain

The other nine root intakes of 2026-07-30 were drained this pass (BL-708..BL-713).
This one is **deliberately left in the root queue**: its own text says "only
after human picks remaining lanes", and every mintable slice below is blocked on
an answer this file does not yet contain.

Which open question blocks which slice:

| Blocked slice | Blocked on |
|---------------|-----------|
| companion-manifest + silent package refresh (the foundation) | Q4 — sync source: Pages artifacts, bridge mirror, or both |
| Bubble panels for backlog/docs (BL-659 retarget) | Q5 — WebView reuse vs native Kotlin over the same JSON |
| offline groom outbox | Q1 — read-only analysis first, or must offline drafts queue on device |
| protobuf | nothing: recommendation D is defer, and no measured JSON pain has been reported (Q7) |

**Why the specifier did not just ask.** `role_ask.bb` is the sanctioned channel
and it is currently unusable on two counts: (1) the delivery path is broken —
the bridge relay strips `roleQuestion`/`options`, so no role ask has reached
Telegram since 2026-07-24 (that is BL-708, specced this pass); and (2) the
single pending-ask slot is already held by an unanswered 2026-07-27 BL-687
question in `.swarmforge/operator/role-awaiting/specifier.json`, so a new ask
would be refused as `already-pending` even if delivery worked.

**To unpark:** answer Q1, Q4 and Q5 here (or in the specifier topic once BL-708
lands and the stale pending ask is retracted) and the foundation slice can be
minted the same pass. Nothing here is waiting on engineering.

**Settled — one app:** **Bubble** (`android/`, BL-707; product name locked
2026-07-30 — see `INTAKE-messaging-host-agent-interface-vs-incarnation.md`).
Migrate **into it**:
- Pages **PWA** (backlog, docs, board / groom)
- Telegram **Mini App** operator console (Let's Talk + related chrome)

Pages artifacts + bridge Mini App shells stay **sources / temporary fallbacks**,
not peer products. No second phone client.

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

## The debate (open)

### A. Wire format: protobuf vs REST+JSON

| | Protobuf | Stay REST + versioned JSON |
|---|---|---|
| Strength | Compact, codegen contracts, unknown-field evolution | Already everywhere (bridge, Mini App, companion, Pages artifacts); curl-debuggable; same packages for sync |
| Cost | Kotlin (+ maybe TS for bridge) codegen, build plumbing, opaque on the wire | Larger payloads; schema discipline is social (`format`/`version`) not generated |
| Fits when | High-frequency sync, bandwidth-starved | Sparse RPCs + snapshot packages (backlog, docs tree, chiptunes, flags) |

**Working claim (for challenge):** protobuf does **not** buy offline or unification.
Offline is a **package + on-device store + outbox** problem. Merging PWA into the
bubble strengthens the case for **one JSON package catalog** the companion
downloads (Pages and/or bridge), not for a binary RPC layer. Prefer not to mint
protobuf unless measured pain (size, schema drift, streaming).

**If we keep JSON:** normalize via shared schemas + companion-manifest of
packages. Bubble fetches the same `backlog.json` / `docs-tree.json` / chiptunes
shapes the PWA already uses — merge is UI ownership, not a new protocol.

### B. One app — migrate PWA + Mini App in (settled)

Unified install: **Bubble**. Modes / panels inside it:

1. **Groom / read (offline-capable)** — from PWA migration (board, docs,
   search). BL-659 corpus goals retarget here.
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
- Fetch while online (bubble start, idle, Wi‑Fi preference); network-first then
  cache; show "as of \<cached generation\>".
- Prefetch budget matters more once the full BL-659 corpus (~2–3 MB compressed)
  lives on the phone — still fine; sync opportunistically.

**Write path (grooming while offline):**
- Local outbox in the companion; sync when bridge (or a defined ingest) is up.
- Until outbox exists: offline = read/analyse + local scratch only.

**Talk offline minimum:** unchanged (prefs, chiptunes cache, honest offline).

### D. Recommendation to challenge

1. **Do not** introduce protobuf for normalization now.
2. **Do** REST + versioned JSON packages as the sync contract (manifest +
   backlog + docs + chiptunes).
3. **Do** invest complexity in **bubble-hosted** offline corpus (BL-659
   retarget) + Mini App capability migration + optional groom outbox.
4. Pages PWA + Telegram Mini App: maintain / package sources until parity;
   not feature destinations.
5. Revisit protobuf only if sync volume / drift hurts.

---

## Open questions for the human

1. Offline grooming: read-only analysis first, or must draft backlog mutations
   queue on-device?
2. ~~One vs two apps / tube surface?~~ **Answered: one companion; migrate PWA + Mini App.**
3. Accept "as of \<cache time\>" honesty?
4. Sync source while online: GitHub Pages artifacts, bridge mirror, or both?
5. Merge shape for PWA pieces: WebView vs native Kotlin on the same JSON?
6. ~~Mini App migration order: Let's Talk already native — next console slices?~~
   **Let's Talk Mini App crossed off 2026-07-30.** Next: remaining console
   slices + PWA panels into Bubble.
7. Any JSON pain that motivated protobuf?

## Suggested minting (only after human picks remaining lanes)

- Companion-manifest + silent package refresh — foundation.
- Bubble panels for backlog/docs (BL-659 retarget) — epic/slice.
- Mini App → companion capability migration tickets (per surface).
- Offline groom outbox — only if write-while-offline required.
- Protobuf / gRPC — **defer**.
