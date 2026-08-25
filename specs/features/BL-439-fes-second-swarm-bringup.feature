Feature: FES second-swarm bring-up — executable acceptance (own creds, distinct fleet identity)

# BL-439 (epic BL-435, slice 4 — the fleet's real-world E2E acceptance). The full bring-up runs FES as a
# mono-rotate pack (BL-448) against free-email-scanner, launched from the Windows-side checkout, with its
# own bot+group. Two of the four acceptance behaviours are pinned to in-process testable seams and live
# here; the other two (the real Windows-side launch, and the live Telegram no-message-theft round-trip)
# are inherently live and are recorded as the ticket's E2E QA PROCEDURE plus the companion
# BL-439-fes-second-swarm-bringup.feature.draft — do NOT make them executable (no in-process handler can
# stand up a real second swarm or observe live Telegram delivery, and the runner throws on any scenario
# lacking a handler). Executable seams: BL-436 per-swarm creds resolution, BL-437 fleet status enumeration.

# BL-439 fes-second-swarm-bringup-02
Scenario: The FES swarm resolves its own bot token from its fleet creds file, not the primary's
  Given the FES swarm has its own fleet creds file carrying the FES bot token
  And the primary's bot token is exported in the environment
  When the FES front desk resolves its Telegram creds
  Then it uses the FES bot token from the fleet creds file
  And it does not fall back to the primary's token from the environment

# BL-439 fes-second-swarm-bringup-04
Scenario: Both swarms appear as distinct identities in the fleet console
  Given the primary and FES swarms have each published their own status.json
  When the fleet console reads the fleet
  Then it renders the primary and "fes" as two distinct swarms
