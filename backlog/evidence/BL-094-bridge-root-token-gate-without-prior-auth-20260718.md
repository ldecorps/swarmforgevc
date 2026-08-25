# Bridge root token gate reachable without prior auth (2026-07-18)

## Symptom
Browser open of the headless bridge showed Pretty-print
`{"error":"unauthorized"}` — live feed / pipeline board looked broken.

## Cause
Root HTML required read-auth before serve, so the in-page token gate was
unreachable on a plain navigation (Cloudflare tunnel root or :8765/).

## Fix
Serve holistic HTML for root before the auth check; data routes stay
bearer-gated. UI returns to the gate on 401. Tests updated.

## Verify
- GET `/` → 200 HTML with tokenGate
- GET `/pipeline` unauthenticated → 401 JSON
- `npx vitest run test/bridgeServer.test.js`
