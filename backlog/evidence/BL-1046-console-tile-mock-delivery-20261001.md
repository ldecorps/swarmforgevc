# BL-1046 console tile mock — operator delivery

Generated: 2026-10-01T05:27:02.648Z

## Mock artifact

- HTML: `backlog/evidence/BL-1046-console-tile-mock-20261001.html`
- Viewport: phone-width (375px)
- Sample holding seats: coordinator (BL-1041), coder (BL-1042), cleaner (BL-1010 +2), hardender (BL-1035), QA (BL-1011)

## Operator email / Approvals ask

Per BL-1046 approval_context, this mock is linked from the Approvals ask so Approve is informed by the rendered grid (not a blind tap).

When `RESEND_API_KEY` and operator inbox are configured, deliver via `daemon_alarm_lib.bb` `send-alarm-email!` with the HTML mock attached or linked — reuse the existing alarm mailer; do not mint a second sender.

Evidence path for QA: `backlog/evidence/BL-1046-console-tile-mock-20261001.html`
